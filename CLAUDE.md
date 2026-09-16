# Parnassix — frontend monorepo

## What this project is

Parnassix generates **reports assembled from reusable, deterministic components**. The
frontend is a *renderer*: component templates are fixed in shape, and backend agents
influence output only by choosing enum values and supplying data. That bound is the point —
a hallucinating agent can produce wrong data, but it cannot produce a shape this repo
doesn't know how to render.

Primary use case is evidentiary work (legal being the sharpest example), which sets the
quality bar: **every fact shown must be traceable to its source**. The canonical failure to
design against is the lawyer who cited a case that did not exist. This tool must never be
able to do that.

### The wider system

| Piece | Where | Role |
| --- | --- | --- |
| Corpus ingestion + retrieval | **[`parnassix` (pythoness)](../../Pythoness/pythoness)** — a separate library | Documents, SQL and tabular sources → embeddings with per-fact provenance. Resolves ids back to citations. **[built, and extracted out of this repo]** |
| The report-schema contract | `apps/python-pipeline` | The Zod contract as Pydantic, the cross-field validators, and `ReportSchemaWire` — the ~20 lines that map the library's locators onto this project's `SourceRef`. **[built]** |
| Agent workflows | `apps/python-pipeline` (not built) | Populate component templates. Invalid enum values are caught and handed back to an agent for a limited number of retries. |
| API gateway | `apps/api-client` (NestJS/Fastify) | Routes between frontends and Python. Validates at the public boundary. |
| Frontends | `apps/web-vite`, `apps/desktop`, `apps/native` | Render reports from the shared `@repo/ui` component layer. |

Embedding model is configured **per corpus, not globally** (local Ollama/HuggingFace for
privileged documents; hosted OpenAI when a client brings their own key). Model name and
dimension are stored in index metadata so a mismatch fails loudly — indexes are not portable
across embedding models. The index NAME also carries the model identity, so two models cannot
collide on one index in the first place, and a corpus can be indexed under several models at
once to compare them.

The JSON Schema → Pydantic codegen stays in this repo as a turbo build edge rather than a
thing someone remembers to run. Model choice defaults from detected hardware (a memory tier
picks a model per ROLE — corpus embedding, cache embedding, generation), and **no tier ever
defaults to a hosted model**: detection must never be the reason a run starts costing money or
sends privileged documents off the machine. That rule, and everything else generic, now lives
in the library and is tested there.

### This repo is the worked example — [built]

`apps/python-pipeline` was the pipeline. It is now a consumer of one, and the split was made
on a simple test: **anything that does not know what a report is belongs in the library.**
About 2,700 lines moved out; about 500 stayed. What stayed is the contract and the wire that
maps onto it.

The seam is `WireFormat`. `pythoness` establishes WHERE a fact came from and knows nothing
about what a consumer calls those fields; `ReportSchemaWire` supplies the camelCase spelling
`packages/report-schema` defines and **validates the result against the generated
`SourceRef`** before returning it. That last part is a guarantee the old code did not have:
`ingest/provenance.py` built those keys inline, mirroring a Zod schema in a TypeScript package
with nothing connecting them — a shape coupling with no import, so no tool could see it drift.

Two consequences worth knowing:

- **The wire refuses anything that is not a page.** The library now has SQL and tabular
  sources whose locators are tables, rows and recorded queries. `SourceRef` has no spelling
  for those, so `ReportSchemaWire` raises rather than inventing one — a made-up camelCase
  shape would emit something the renderer's validator rejects, and it would reject it after a
  corpus had been built. A Parnassix corpus is documents. If it ever needs a database, the Zod
  contract grows a variant first and the wire follows it.
- **The library is an editable path dependency**, because `parnassix` is not published yet.
  So this app does not build without the pythoness checkout beside this repo, and **turbo will
  not invalidate on a library change** — it sits outside the workspace. `pretest` runs
  `uv sync` as a mitigation. Both go away at publication, when the path dep becomes a pinned
  version that `uv.lock` carries and turbo's existing `inputs` already watch.

## Repo layout

See `README.md` for the full stack table, commands, ports, and the two load-bearing
`pnpm-workspace.yaml` constraints (React pinned to 19.2.3; `@tamagui/*` public-hoisted).
**Read that section before touching workspace config** — both settings exist because
removing them reintroduces a real, silent Tamagui bug.

Short version: Turborepo + pnpm. `packages/ui` (`@repo/ui`) is the shared Tamagui component
layer consumed by web, desktop, and native. Add a component there, export it from
`src/index.tsx`, and all three apps pick it up.

## Design decisions

Status: **[decided]** = agreed, may not be built yet. **[built]** = exists in code.
**[open]** = still undecided.

### Two type layers, kept separate — [built]

Component types currently conflate two incompatible things. They must split:

- **Wire types** — plain JSON, schema-validated, what agents emit. Serializable. No React.
- **Component props** — wire type *plus* React-land concerns: event handlers,
  `ReactNode` escape hatches, callbacks.

```ts
type TimelineProps = TimelineSpec & TamaguiComponentProps & { /* render-only extras */ }
```

`React.ReactNode` fields (`oppositeContent`, `children`) and everything in
`TamaguiComponentProps` (`onPress`, `hitSlop`, …) **cannot cross a wire** and must never
appear in a wire type.

### Schema lives in its own package — [built]

Wire types belong in `packages/report-schema`, **not** in `packages/ui` and **not** in
NestJS. Everyone depends on the contract; the contract depends on nothing.

- Authored in Zod → OpenAPI/JSON Schema emitted as a build step → Python generates Pydantic
  models from that spec (`datamodel-code-generator`).
- NestJS reuses the same Zod schemas for DTO validation rather than a parallel
  class-validator set.
- Keeping it out of `packages/ui` also keeps schema consumers away from that package's
  Tamagui deps.

Validation runs in three places for three reasons: Python validates its agents' output
(the retry loop), NestJS validates the public boundary, the frontend validates at the
`ReportCanvas` boundary.

**Rule: an invalid component renders an error card; it never blanks the report.** Error
boundary per component, keyed by `id`. A user mid-walkthrough loses one panel, not the
whole document.

### Provenance is per-fact, first-class — [built: type, on-screen rendering, and the pipeline that produces it]

Citation granularity is per *fact* (a timeline event, a table cell), not per component. A
`SourceRef` belongs both on base `ComponentProps` and on individual data points.

```ts
{ documentId, nodeId, page, bbox, coordOrigin, pageSize?, chunkId?, quotedText? }
```

`apps/python-pipeline` now produces this, and three things about it were settled by running
a real conversion rather than by reading documentation:

- **The bottom-left gotcha was real, and worse than stated.** Docling emits `BOTTOMLEFT` for
  PDF content, and in that space **`t > b`** — `t` is the visually-upper edge holding the
  LARGER y. Flipping needs page height *and* has to swap the two edges' roles; treating `t`
  as a screen-space top mirrors every highlight about the page midline, which reads as a
  plausible offset rather than as a bug.
- **The pipeline flips to top-left at ingestion** (docling's own `to_top_left_origin`) and
  states the result in `coordOrigin`, so the renderer's flip path is a fallback rather than
  the primary one. `pageSize` is sent regardless, because points still have to be scaled to
  whatever width the page was drawn at.
- **`nodeId` is NOT LlamaIndex's default id.** `DoclingNodeParser` assigns `uuid4`, so
  re-ingesting an unchanged document would mint new ids and every `SourceRef` in every saved
  report would stop resolving. The pipeline derives ids from content instead: stable across
  reruns, and *different* when the text changes, so an id can never silently rebind to
  different words.

One shape consequence worth knowing: a `SourceRef` carries one `page` and many `bbox`es, but
a chunk can straddle a page break. Such a chunk yields **one ref per page**, all sharing a
`nodeId`.

**Citation is resolved server-side, never copied by a model.** The LLM is not shown
coordinates and does not emit them; it emits a `nodeId`, and the pipeline resolves it. An
id the model invented resolves to nothing and is reported as unresolvable — a visible
failure rather than a well-formed citation pointing at the wrong place. This is the same
anti-hallucination rule as "citations in chat are structural, not textual", applied to the
ingestion side, and it is pinned by a test asserting coordinates never enter the model's
view of a node.

Citations must degrade for print: interactive highlight-in-the-PDF on screen, numbered
footnote markers plus a reference table on export. Same data, two presentations.
**Hover-only citation is not acceptable** — it doesn't survive the export path.

The Timeline's `DetailPanel` is the first half of that pair, and only the screen half: document
id, page, quoted text, and how many highlight regions a ref carries. The regions are not drawn
yet — that needs the page image plus `pageSize.height` to flip a BOTTOMLEFT box into the
renderer's TOPLEFT space. **The print half — footnote markers and a reference table — is not
built**, and until it is, no card or table renders a citation at all; the panel adds provenance
on screen without removing any from export, because there was none there to remove.

**Gaps are rendered, not omitted.** `periodSourcesOf` pairs every period of a fact with its own
source *including the periods nothing backs*, and an unbacked one prints "No source recorded"
where the citation would have been. A fact claiming three periods and backed by two ledger
pages must not be able to read as fully sourced — listing only the citations that exist is
precisely how it would. Pinned by a test.

### Render context in the type system — [built]

Both scales deliberately sidestep this, and it turned out measurement was never the answer.
They position everything as a *percentage* of the axis, and the renderer NAMES the axis's
minimum length in pixels rather than inheriting the viewport's. The lane-collision threshold
is then derived — `oneCardSlot / axisLength` — which makes "cards never overprint" a
guarantee by construction rather than a constant that happened to hold at desktop width.
A wider viewport only ever adds slack; a narrower one scrolls.

That replaced a constant `minSeparation` of ~12%, which was right on a desktop and badly
wrong on a phone: a 390px axis made the threshold 47px while a card is 168px wide, so every
card in a cluster overprinted its neighbours. Pinned now by a test asserting that any two
cards sharing a lane are at least one card apart.

No component owns its own dimensions. Every component receives a render context —
approximately `{ medium: 'screen' | 'print' | 'slide', width, height }` — and lays out from
the box it's given. The same report must render to a phone, a slide, letter paper, and a
poster board, filling the space dynamically. Agent-emitted templates stay size-agnostic.

**`ReportCanvas` measures its own box and provides it**, rather than components reading the
viewport. The box a report is rendered into is not the window — a report in a sidebar is
narrow on a 4K monitor — so a media query would tell every component the wrong thing. An
ancestor that *states* a box always wins over the measurement: letter paper is 8.5in across
whatever a browser reports, and export has to be deterministic from the stated width alone.

The first thing to lay out from it is **`Timeline`'s axis**. `resolveTimelineOrientation`
narrows a specified `horizontal` to `vertical` when the box is under `3 * CARD_WIDTH` —
derived from the card, not a device breakpoint, because the thing that actually fails is a
horizontal axis showing about one card at a time, where every comparison between two events
costs a sideways scroll. Vertical spends the page's OWN scroll on time instead, which is the
direction a phone has to give.

It is deliberately one-directional: a specified `vertical` is never widened back. Fitting a
horizontal axis into a narrow box is a decision only the renderer can make, because only the
renderer knows the box — but a vertical axis already fits every box, so overriding one would
be the renderer second-guessing the agent for nothing. An unmeasured box (width 0) keeps the
spec rather than guessing for one frame and flipping on the next.

The win is uneven across the two scales, and the reason is structural. **Ordinal has no
lanes**, so a vertical ordinal timeline is exactly one card wide and fits a 390px phone with
nothing off-screen — it is the right mobile layout, permanently. The **time scale always
needs a cross-axis** for lanes, and vertical puts that cross-axis on X, the scarce direction
on a phone: the fixture's five-event cluster forces seven lanes and ~1422px across. Axis
length cannot fix that — lane count is floored by the biggest cluster, not by the span
(measured: `minSeparation` 0.143 → 7 lanes, 0.02 → 5 lanes, cluster size 5 throughout).
That is answered by the **frozen rail** below rather than by moving the cards.

#### The frozen rail, on a vertical axis — [built]

A vertical timeline stacks its lanes along X, so panning through a dense cluster used to
carry the axis and its tick labels off the left edge, leaving a column of cards with no
visible time reference. The axis therefore comes OUT of the scrolling area: in vertical
orientation the component is a fixed column beside a horizontally scrolling lane area, and
the lane area measures its cross-axis from the column's right edge (`axisEdge`, `laneOrigin`).
Horizontal is untouched and renders pixel-for-pixel as before — there, panning moves you
through TIME, which is the thing the axis is a ruler for, so axis and cards belong together.

The column carries **one node per group**, not per event, listing member titles in
chronological order. Per group because a group is already one branch point: five calls in an
afternoon share a mark, and five rail entries at that position would have to lie about where
four of them are. It is the existing trunk grouping that makes this fit at all — the fixture's
ten events are six groups, and its five-event cluster is one of them.

A node carries no date of its own: the tick labels immediately to its left already state the
time, and a group spanning three days has no single date to print that would not be wrong for
four of its five members.

**Nothing collapses and nothing is hidden.** The rail always lists every event; what varies is
where the DETAIL goes, which `resolveTimelineDetail` decides:

- `cards` — every event drawn beside the axis. What the horizontal scale always does.
- `panel` — the rail alone, opening an event's detail when a node is pressed. Taken when the
  box is too narrow to hold a card next to the rail, where `cards` could only be reached by
  scrolling sideways through them.

On a phone this is the difference between a component that scrolls in two directions and one
that fits: the rail then spends the whole width on titles, so nothing truncates, and the page
has no horizontal scroll anywhere. Pressing any node opens the whole GROUP with that event
marked — pressing the third of five calls in an afternoon and being shown only that call would
hide the very thing the grouping exists to say.

`DetailPanel` is a **drawer, not a popup**, because of what it has to hold. The event's own
detail is the small part; the substance is its PROVENANCE — document, page, quoted line, and
eventually the page image with the region highlighted. That is a reading surface, so it opens
against the axis and runs to the far edge, leaving the ruler and tick labels visible the whole
time: reading a citation while unable to see WHEN the thing happened would throw away the
reason the axis was frozen. Its height is named rather than inherited, for the same reason the
axis names its length — a vertical timeline is taller than a phone, so a drawer filling it
could not be seen at once.

**A static medium never gets `panel`, however narrow the page.** A panel that opens on a press
is exactly the interaction this file rules out as the ONLY route to a fact — the rule that
rejected hover-only citation and expandable clustering — and paper cannot be pressed. On export
every card is drawn. This is the first thing to depend on `useIsStaticMedium`, and it is the
reason that hook exists. Pinned by a test over letter-width pages.

That distinction is the whole of why this is allowed and expandable clustering was not: there,
the collapsed state was the only state, and a fact lived behind an interaction. Here the rail
is complete before anything is pressed, and the press only enlarges what it already says.

The open selection is held as an id and resolved by LOOKUP each render, not kept as an
object: a report is a session document whose components are replaced by id as the backend
regenerates them, and a held reference would keep a panel open on evidence no longer in the
report.

`stackRailNodes` nudges an entry clear when the one above would run into it — the same
collision problem lane packing solves, in text height rather than card height, so it is much
rarer and a nudge suffices instead of a new lane. Greedy over a sorted copy with ties broken
by original index, like `packGroupLanes`, so it is reproducible byte-for-byte. **Only the text
moves**; the mark on the axis stays where the evidence puts it, so a nudge never makes a claim
about when something happened.

#### The lit chain — [built]

A card, the leader that carries it back to the axis, and the band that leader lands on are
**one claim drawn in three places**. In a dense cluster that is genuinely hard to read: six
leaders converge on one trunk, and nothing on screen says which of them belongs to the card
being read. Hovering or pressing a card lights all three together and fades everything else.

**A marker may be dimmed but never brightened; a connector may be either.** The split is the
whole design. A marker's opacity is EVIDENCE — `PRECISION_EMPHASIS` says how much the source
knew — so raising a lit band to full strength would overwrite that with a hover state, making
a window the source only guessed at read as a time it fixed. Every tier in `HIGHLIGHT_WEIGHT`
is therefore a fraction ≤ 1 and a lit band sits at exactly the strength its precision earned.
A connector asserts nothing — it is a routing device — so its own strength is free to carry
the emphasis the marker cannot, and a lit leader goes to full opacity in the MARKER's colour:
the leader's whole job is to say this card belongs to that band, so drawing it in the band's
colour is the shortest way to say it. The card's border takes the same colour, and the three
read as one object.

**Known limit: opacity is carrying two things at once**, and the bands are only comparable
WITHIN a tier. A `related` year-precision band (0.3 × 0.6) is fainter than an `aside`
minute-precision one (1 × 0.3), so the precision ordering inverts across a tier boundary. That
is inherent to spending one channel on both, and it is bounded in the way that matters: the
tier is transient pointer state that paper never has, so the exported artifact always carries
precision alone. Widening the scale would not fix it and would cost the thing the fade is
for.

At rest, with nothing lit, the component draws exactly what it drew before this existed —
verified pixel-identical at desktop width with the feature stashed out and rebuilt.

What lights is decided by **whose claim each part is**, and the answer is a stretch of a line
rather than a whole one. **The lit path is the route and no more.** The arms and the branch are
one event's outright: an arm lands where one period of one fact was recorded, and lighting a
sibling's alongside would say the lit card was placed there too. The trunk and the rail are the
GROUP's — a routing device several cards share — but only the part a lit card actually travels
belongs to it. A trunk lit past the card it points at is pointing at the WRONG card, which is
what it did: one element from the rail to the group's deepest lane, lit end to end for any
member, so hovering the fourth of five cards drew a bright line straight past it to the fifth.
It now stops where that card's own branch turns off, and the rail lights only from that event's
mark across to the trunk.

The lit rail stretch is a **route, not an extent**. The rail's own job is to say a group owns
the span its events fall in; a sub-stretch of it lit for one member would, read the same way,
claim that member owns arm-to-midpoint, which no source said. It is the piece of rail the
card's route travels along, which is exactly why `litRailSpan` takes the trunk's foot as well
as the arms — without it the blue chain has a gap between the arm and the trunk, and "a lit
card's route back to the axis is unbroken" stops being true.

A group's `arms` are deduped across its members and so cannot say which are whose, which is why
`armsOf` is its own export — the rule stated once, asked twice, rather than restated in the
renderer where the two copies would drift. Pinned by a test asserting a group's arms are exactly
the union of its members'.

Those lines are **split, not overlaid**. A bright element drawn on top of a dim one is not the
same colour as the bright one alone, and — because a browser fits a dashed border's period to
the length of the side it is on — a shorter overlay drifts out of phase with the base beneath
it, showing grey dashes through the blue one's gaps. `splitLitRun` serves both the rail (in
fractions) and the trunk (in cross-axis pixels), and its pieces always tile the original run
exactly, so a highlight can never make a leader longer or shorter than the one the layout drew.
At rest it returns exactly one piece, which is what keeps the resting render byte-identical.
The cost is the same dash-fitting rule pointing the other way: in a multi-member group drawn
dashed, the unlit remainder re-fits its rhythm while a member is lit. No element moves or
resizes — the rule that matters, since lane packing is arithmetic done before any of this and a
card that grew on hover would overprint the neighbour the packing had cleared it of — but the
dashes in the faded part are not in the same places. A lone event never splits at all: its rail
and trunk are wholly its own and light end to end.

Everything else in the lit event's own group takes a **middle tier** rather than the far fade.
Two tiers were not enough: a sibling three milliseconds away faded exactly as hard as an event
eight months away, and a cluster exists precisely to say those things happened at the same
moment. `related` is still a FADE — 0.6 against `aside`'s 0.3 — so the dim-never-brighten rule
is untouched; it is a smaller fade, not an increase. Connectors need no new value for it, since
a connector's resting 0.5 already IS the middle: a cluster holding the lit event keeps the
structure it draws at rest, and only the route through it brightens.

The frozen rail's nodes (`AxisNode`) deliberately stay on a single emphasis. The rail is already
a compact list of every event in order, and a third weight on eighteen-pixel rows would be noise
rather than information — and in `railOnly` mode there are no cards to hover in the first place.

`highlighted` is resolved by LOOKUP against the placed events, like the drawer's `selection` and
for the same reason: a pin naming an event that has since left the spec — or become undated,
which places it nowhere — would otherwise fade every remaining event against a card that is not
on screen.

**A hover is transient; a press pins.** Two sources, kept separate and composed as
`hover ?? pinned`, because a pointer and a finger are not the same gesture: a pin survives
reading the card, hovering a second card lights that one and hands the highlight back when the
pointer leaves, and touch — which has no hover at all — reaches the same affordance by
tapping. A tap emits a compatibility hover first, so a press always drops its own card's
hover; otherwise the press that puts a card out would leave it lit.

It is allowed under the rule that rejected hover-only citation for the same reason the drawer
is: **nothing lives behind it.** Every part of the chain is already drawn, the fade is
transient, and `useIsStaticMedium` withholds the state entirely on paper — an export that
inherited whatever a screen happened to be pointing at would print one event emphasised over
the rest for no reason a reader could see.

### Platform divergence via file extensions — [decided, not built]

Default is one implementation across web/desktop/native. When that's genuinely impossible,
fork behind a single export using platform file extensions
(`NodeGraph.web.tsx` / `NodeGraph.native.tsx` → one `NodeGraph`), so divergence is invisible
to `ReportCanvas` and to the agents emitting the spec. Metro resolves these natively; web
and desktop need resolution configured in their bundlers.

`NodeGraph` is the first test of this (React Flow likely fits web/desktop and not mobile).
Whether per-platform design becomes common or stays an exception is **[open]** pending that.

### Versioning — [built: `schemaVersion` on `ReportSpec`]

Component/template schema version travels in the payload. Caching invalidates when the data
changes **or** when component templates/designs change; including a renderer version in the
cache key makes that mechanical rather than a thing someone remembers to do.

### Session, chat, and streaming — [decided, not built]

A collapsible chat panel (SSE) lets the user talk to an LLM that retrieves data and
documents and returns template data, which renders as components into the report view.
**The chat is part of the frontend, not part of the report** — it's how you get the report,
and it is not included in export. It can also walk a user through an existing report.

Consequences:

- A report is a **session document**, not a one-shot payload. `ReportCanvas` needs a
  mutation protocol (append / replace-by-id / remove), not a snapshot array.
- `ComponentProps.id` is therefore **load-bearing** — it's the reconciliation key for React
  and the address for "regenerate that one".
- **Stream whole components, never partial ones.** The backend holds a component until its
  spec validates, then emits it complete. SSE events are coarse (`component.added`,
  `component.updated`, plus token streaming for chat prose) — never a half-parsed JSON
  object rendering as a broken table.
- **The server owns the component list; the client is a projection** that sends intents
  ("remove this", "redo as a table"). This makes SSE reconnect a non-question — resync, not
  reconcile two divergent copies.
- **Citations in chat are structural, not textual.** A message is spans, where factual
  claims carry resolved `SourceRef`s — not prose with citation markers the model typed. A
  claim without a resolvable source is then visible as such in the transport and can be
  marked or withheld by the UI. The model can be wrong; it cannot manufacture a reference
  to a document that isn't in the corpus. **This is the anti-hallucination mechanism and it
  cannot be replaced by prompting.**
- Walkthrough and citation-click converge: both are "focus component X, highlight source Y",
  emitted by the chat against server-owned IDs.
- Redis Semantic Cache on the Python side is session-aware.

Caching golden rule overall: **invalidate only when the data changes, or when component
templates/designs change.** Layers will accumulate as this productionizes (Redis, React
memoization, eventually AWS edge caching) — the rule holds at every layer.

## Components

Built with Tamagui so one implementation serves web, desktop, and mobile. Planned:
`Timeline`, `Table`, `NodeGraph` (cards connected by established relationships), and more.
Components may own state, including calling next/prev API routes for paginated or batched
data. Interactivity is decided per component: the user should be able to reach all the data
they need on the frontend they're using, and design may differ across web/mobile/desktop.

### Timeline — [built]

One component with a `scale` prop, **not** two components. The difference between the two
useful layouts is only the position function:

- `ordinal` — evenly spaced, position = index. Good for milestones and narrow mobile
  viewports where proportional spacing collapses into overlap. It needs none of the time
  scale's machinery: no domain, no ticks, no lanes, no trunks, because events given an equal
  share of the axis cannot collide. It has no undated case either — an unreadable timestamp
  cannot break an ordinal position, so the event still renders in sequence. Precision is shown
  by the WEIGHT of its marker rather than by the width of a band, since an even axis has no
  width to spend on it.
- `time` — position proportional to timestamp. **This is the important one for evidentiary
  work: the gaps are the evidence.** "Nothing for eight months, then five things in
  seventy-two hours" is an argument, and ordinal spacing destroys it.

Follow-ons:

- `unitOfTime` did two jobs — axis tick granularity and per-event label formatting.
  Resolved by exposing **only** `labelUnit`: tick granularity is derived by the renderer from
  the data range, so it is not an agent-facing field at all. **Every field exposed to an agent
  is a field an agent can get wrong** — keep the agent-facing surface minimal.
- **A card is tied to its period, not to a point.** An event known only to its month or year
  occupies a span, and a single leader line dropped from the middle of that span says the
  opposite — it points at an instant the source never identified. Ranged events therefore get
  a bracket whose arms land on the real start and end of the period; only point events get
  the single line. Markers also fade with the coarseness of their precision, because a
  full-strength band across a whole year reads as "this lasted a year" rather than "this is
  the window it falls in".
- **Both scales scroll rather than shrink.** Each wraps its axis in a horizontal
  `ScrollView` whose content has a minimum length, so a narrow viewport pans along a timeline
  that keeps its proportions instead of crushing every card toward zero width. The page itself
  never scrolls sideways — only the component does.
- **The card box is a fixed size, and clips.** Lane positions are pure arithmetic with
  nothing measured, so the renderer has to know a card's extent before it draws one — a card
  that grew a line taller than its lane would silently overprint the lane below rather than
  push it down.
- Dense clusters are answered by **deterministic lane stacking**: events whose footprints
  collide are pushed to parallel lanes and reached by a leader line back to the axis.
  Expandable clustering and a zoomable axis were both rejected for the same reason
  hover-only citation was — an interaction that is the *only* route to a fact does not
  survive the export path. Lane assignment is greedy-lowest over a sorted copy, so it is
  reproducible byte-for-byte and a PDF matches the screen. Lane count is bounded
  (`maxLanes`, default 6): a year-precision event occupies a year of axis, and unbounded
  lanes make the component arbitrarily tall.

### Contract decisions made while building the schema package

- **The axis is `orientation` + `order`, semantic and unambiguous.**
  `horizontal | vertical` and `ascending | descending`, mapped to flex by the 2×2
  `LAYOUT_TO_FLEX` in `packages/ui`. Two things drove this: the original enum's values were
  literally `'row'` / `'row-reverse'` (an agent should not be choosing CSS), and the first
  replacement — `forward` / `backward` / `down` / `up` — kept a `backward` member readable
  as either "right-to-left" or "reverse-chronological". An agent choosing between those two
  readings had no way to know which was meant. Same four combinations, no ambiguity.
  `order` sets the direction of the axis; the renderer does not re-sort events.
- **Timestamps carry a canonical instant plus an explicit `precision`.** Precision of
  knowledge is itself evidence: a document saying "March 2019" must not be promoted to a
  fabricated `2019-03-01T00:00:00Z`. `timestamp` holds the canonical instant, `precision`
  (`year`…`second`, no `week`) says how much of it to believe, and the renderer must never
  display or position an event more precisely than that allows.
  - `precision` is **optional and derived when absent** (`resolveTimePrecision`), so it stays
    off the agent-facing surface for the common case. An agent sets it only when the source
    is *vaguer* than the timestamp string looks.
  - A precision finer than the string supports (date-only claimed to the minute, or
    `millisecond` on a timestamp that writes no fraction) is **rejected** — that is
    incoherent, not merely imprecise.
  - **The scale bottoms out at `millisecond`, because machine-generated evidence is
    evidence.** Server logs, audit trails and transaction records establish a time to the
    millisecond, and with those sources the ORDER is frequently the whole argument — which
    write landed first, whether the transfer preceded the instruction it claims to authorise.
    Stopping at `second` did not make the contract more careful: fractional seconds were
    accepted on the wire and silently floored, so two writes 800ms apart shared a position and
    a label. That is the same over-claim the precision scale exists to prevent, pointing the
    other way. `UnitOfTime` gained `millisecond` alongside it so the tick ladder can resolve a
    sub-second window at all; below a millisecond the contract stops, and finer digits are
    truncated rather than kept as resolution nothing can position or display.
  - **Caveat: JSON Schema cannot express this cross-field rule**, so the emitted artifact does
    not carry it and `datamodel-code-generator` will not reproduce it. The Python side needs
    its own validator or the pair passes Pydantic and fails here. Pinned by a test.
- **Positioning honours the source zone too, not just display.** `timestampInterval` reads a
  timestamp's own offset and never calls a local-time `Date` accessor, because `getDate()` in
  a negative-offset viewer can return the previous day and move an event across a day
  boundary — the same failure `formatTimestamp` was written to prevent, arriving through the
  layout layer. It returns **`null`, not `NaN`**, for an unreadable timestamp: `Math.min(NaN, x)`
  is `NaN`, so one bad value would poison the domain and blank the whole axis. The renderer
  lists such events as undated rather than placing them at position zero, which would assert
  they happened at the start of the report.
- **`labelUnit` may only coarsen.** `labelPrecision` clamps it against the event's resolved
  precision: asking for minute labels on a month-precision event is the same fabrication
  `PRECISION_FORMAT` exists to prevent, arriving through a different field.
- **`formatTimestamp` renders in the zone the timestamp was written in, never the viewer's**,
  and lives in `@repo/report-schema` rather than a renderer. Both follow from the same
  requirement: two people in different timezones looking at the same evidence must see the
  same time, and the guarantee has to hold identically on web, native, and in an exported
  PDF. A local-zone shift can move an event across a day boundary or reorder it against a
  neighbour — material when the timeline *is* the argument. (`TimeFormatterMap` and
  `AXIS_TICK_FORMAT` stay in `packages/ui`: those are axis labelling policy, not claims about
  evidence. The calendar *mechanism* they rely on — `timestampInterval`, `floorToUnit`,
  `addUnits` — lives in the contract, because what a precision denotes is a claim about
  evidence even though which unit to tick at is not.)
- **`SourceRef.bbox` is an array and carries `pageSize`.** A quoted fact spans lines, so one
  ref needs many boxes; and a BOTTOMLEFT box cannot be flipped into the renderer's TOPLEFT
  space without the page height.
- **Per-event ReactNode became render props.** `oppositeContent` was a per-event field, which
  cannot survive serialization. `Timeline` now takes `renderOppositeContent` / `renderEvent`
  instead: the spec carries data, the renderer supplies nodes.
- **Input and output types are both named.** `ReportSpec` is what the renderer holds AFTER
  validation, with every default filled in; `ReportSpecInput` is what an agent emits and the
  wire carries. `ReportCanvas` takes the *input* type, because anything reading unvalidated
  data should say so in its types rather than claim a guarantee it has not checked — the
  fixtures are authored input for the same reason.
- **Unknown fields are stripped, not rejected.** Deliberately lenient on read so a newer
  backend adding a field cannot break an older client. An invented value in a *known* field
  still fails — that is where the contract does its work.
- **Enums are const objects, not TS `enum`s.** They do not round-trip to JSON Schema.
  `UnitOfTime.Year` call sites are unchanged.
- **The emitted JSON Schema is committed** at `packages/report-schema/schema/`, not left in
  gitignored `dist/`, because a separate Python repo cannot codegen against an unpushed file.
  `pnpm --filter @repo/report-schema check:schema` fails if it drifts from the Zod source.

### Multiple periods — [built] — and grouped events — [decided, not built]

Two needs that look alike and need different answers.

**(a) One fact, several periods.** "Payments were made in March, July and November" is a
single fact with three spans. `TimelineEventSpec` carries one `timestamp` + `precision`,
which denotes exactly one interval.

**(b) Several facts, one card.** Three calls on one afternoon that the report wants to
present as one entry rather than three stacked cards — while each call keeps its own
`SourceRef`.

#### (a) `spans` on the event — **[built]**

```ts
// primitives.ts
export const TimeSpanSchema = z.object({
  timestamp: TimestampSchema,
  precision: TimePrecisionSchema.optional(),
  /** An explicit end. Absent means the span is exactly the precision's own width. */
  until: TimestampSchema.optional(),
  untilPrecision: TimePrecisionSchema.optional(),
  /** Periods of one fact can come from different documents. */
  source: SourceRefSchema.optional(),
});

// timeline.ts — additive only
TimelineEventSpecSchema = z.object({
  /* …unchanged… */
  timestamp: TimestampSchema,                    // still required, still primary
  precision: TimePrecisionSchema.optional(),
  spans: z.array(TimeSpanSchema).default([]),    // NEW: further periods of the same fact
});
```

- **`timestamp` stays required and primary.** Replacing it with a `spans` array would break
  every existing spec and, worse, remove the invariant that every event has one canonical
  position — which `order`, lane packing and "regenerate that one" all lean on. Additive
  means an older client strips the unknown field and still renders the event at its primary
  time: degraded, never wrong. That is the existing unknown-fields rule doing its job.
- **`until` is separate from `precision`.** A span with a real end ("the injunction ran 3
  March to 19 May") is a different claim from an imprecise instant ("some time in March").
  Collapsing them would let a renderer draw a month-precision point as a two-month duration —
  a fabricated duration, the same class of error `precision` exists to prevent.
  `timestampInterval` already yields the precision's own width; `until` overrides only the end.
- **Cross-field rules JSON Schema cannot carry**, exactly as with `precision` today: `until`
  must not precede `timestamp`; `untilPrecision` requires `until` and must be supportable by
  that string. Zod `.refine` plus a test each, and the Python side needs its own validator or
  the pair passes Pydantic and fails here.

`until` sits on the event itself as well as inside `spans`, so the primary period can be a
duration too. Both are checked by one function, `timeSpanIssues` — two copies of those rules
would drift, and the half that drifted would be the half no test covered.

Renderer: `eventIntervals(event)` returns the primary interval plus each span.
`PositionedEvent` gains a `spans` array of fractions, and its own `startFraction` /
`endFraction` are now the **hull** across all of them, so an event with periods in March and
November occupies that whole stretch for collision purposes and is never drawn as two cards.
One band is drawn per period. The span bracket generalised exactly as designed — arms-plus-rail
rather than a box, so N arms meet one rail and feed one leader.

#### Trunks: one branch point per cluster — **[built]**

Drawing a line from the axis to every card produced a bundle of near-identical verticals in
any dense cluster — noise rather than structure. Events now share a trunk when they fall on
the same calendar day in the axis's zone, or when they sit closer than the lane-collision
threshold. The second rule is self-scaling: zoom in until a cluster spreads out and it stops
applying, so events get their own trunks again exactly when there is room to tell them apart.

Positional honesty survives because the **arms** carry it: one rises to the axis at every
period the group covers, landing where the evidence does, whatever the trunk does. The trunk
is only a routing device.

An event with a visible extent, or with several periods, is always its own group — folding it
into a neighbour's trunk would imply the two are one fact.

**Lane packing runs on groups, not events**, because a card is drawn at its group's branch
point; packing the events would measure collisions somewhere the cards are not. Members take
the lowest free lanes in chronological order, so a cluster reads top-to-bottom the way it
happened.

#### (b) `groupId` across events — [decided, not built]

Note this is now only about *presentation* — automatic trunk grouping above already gives a
cluster one branch point. `groupId` would additionally merge several facts into a single
**card**.

```ts
/** Events sharing a groupId MAY be presented as one card. A hint, not a command. */
groupId: z.string().min(1).optional(),
```

- **A hint the renderer may decline.** Three calls may be better as three cards on a poster
  and one card on a phone. Because it is a hint, no agent output becomes invalid when the
  renderer decides otherwise.
- **Flat array, not nesting.** `event.children` would make every consumer walk a tree, push
  provenance a level down, and stop `id` being a flat reconciliation key — which the planned
  SSE `replace-by-id` mutation protocol depends on.
- **Each member keeps its own mark and its own `SourceRef`.** The card is a presentation
  container; the axis still shows N marks and the card lists N citations. Grouping that
  erased per-fact provenance would defeat the thing this repo exists for.

#### Versioning and scope

`spans`, `until` and `untilPrecision` are additive and optional, so `SCHEMA_VERSION` went
`0.3.0` → `0.4.0`, `schema/report-schema.json` was regenerated and committed, and Python
regenerates its Pydantic models from it. An older renderer reading a newer spec strips the new
fields and still renders every event once, at its primary time.

`0.5.0` added `millisecond` to `TimePrecision` and `UnitOfTime`, and that one is **not**
backward compatible in the same way: a new optional field is stripped by an older client, but
a new ENUM member is not — an older renderer handed `precision: "millisecond"` fails
validation and shows an error card, because an invented value in a KNOWN field is exactly what
the contract refuses. Adding an enum member is therefore always a version negotiation, never a
silent upgrade.

The cross-field rules in `timeSpanIssues` are `superRefine`s, so — as with `precision` — they
do **not** appear in the emitted artifact and `datamodel-code-generator` will not reproduce
them. The Python side needs its own validator or a spec passes Pydantic and fails here.

**Deliberately excluded: recurrence rules** ("every Tuesday"). A recurrence rule is a
generator, and this contract carries facts rather than generators — a renderer that has to
expand one is a renderer that can disagree with the backend about what the evidence says. The
Python side expands any such rule into `spans` before it crosses the wire.

## Current state of the code

The wire contract exists and is enforced; the rendering is still scaffolding.

- `apps/python-pipeline` — the worked example, ~500 lines. `wire.py` (`ReportSchemaWire`,
  registered under the name `"report-schema"` so `pythoness.toml` can name it), `report/`
  (Pydantic generated from the committed JSON Schema, plus the validators JSON Schema cannot
  carry), `api/app.py` (the library's ten tool routes mounted via `build_routes`, plus
  `/contract`, `/contract/source-ref`, `/contract/time-span`), `cli.py` (`contract`, `check`,
  `serve` — everything else is `pn`). `pythoness.toml` binds the corpus to the wire.
  Requires `uv` and a `pythoness` checkout; no Docker, no Ollama, no Python upper bound —
  the library dropped the LlamaIndex Redis integration that had pinned both.
- `packages/report-schema` (`@repo/report-schema`) — the wire contract, Zod as source of
  truth, zero deps but zod. Reused schemas carry `.meta({ id })` so the emitted JSON Schema
  has named `$defs` — without them Python codegen produces `FieldSchema0` instead of
  `SourceRef`. Note that naming a schema makes a standalone `z.toJSONSchema` call return a
  `$ref` into `$defs` rather than inlining it. `source.ts` (SourceRef/BBox), `primitives.ts` (Timestamp,
  UnitOfTime, LineVariant), `component.ts` (ComponentSpecBase), `timeline.ts`, `report.ts`
  (the `kind` discriminated union + `ReportSpec`). Emits committed JSON Schema to `schema/`.
  Re-exports `z` so consumers share one zod instance.
- `packages/ui/src/types.ts` — renderer-side only now: `TamaguiComponentProps`, `Insets`,
  `ReportCanvasProps`.
- `packages/ui/src/ReportCanvas/ReportCanvas.tsx` — takes `report`, `safeParse`s each
  component, switches on `kind`, wraps each in `ComponentErrorBoundary`. Validation failure
  and render throw are two separate mechanisms; both produce a `ComponentErrorCard`.
- `packages/ui/src/ReportCanvas/Components/Timeline/` — `types.ts` holds the props layer and
  `LAYOUT_TO_FLEX` (the ordinal path's flex lookup); `axis.ts` is the pure layout module for
  `scale: 'time'` (domain, tick ladder, lane packing, `AXIS_PLACEMENT`, `TimeFormatterMap`,
  `AXIS_TICK_FORMAT`) with no React or Tamagui import, so it is unit-testable without a DOM;
  `Timeline.tsx` branches on `scale` into `OrdinalTimeline.tsx` or `TimeScaleTimeline.tsx`.
  `axis.ts` also owns `groupTimelineEvents` (shared branch points) and `packGroupLanes`
  (collision packing, which runs on groups because cards are drawn at a group's trunk).
  `card.tsx` holds everything the two scales share — the card box and its body, the header,
  the empty state, `formatEventPeriods`. The scales differ in where a card is PUT and in
  nothing else, so writing that twice would let the same report read differently depending on
  a `scale` value that is supposed to control position alone.
  `DateMethodMap` was deleted — it had no call sites, used local-time accessors, and could
  not express `week`.
- `packages/ui/src/ReportCanvas/fixtures.ts` — `mockReport`, the data formerly inlined in
  Timeline's `useState`. The three apps pass it explicitly.
- `packages/ui/src/render-context.tsx` — `RenderContextProvider` / `useRenderContext` /
  `useIsStaticMedium`. `ReportCanvas` measures its own box and provides it (an ancestor's
  stated width wins); `Timeline` resolves its orientation from it via
  `resolveTimelineOrientation` in the Timeline's `types.ts`.

Known gaps:

- `apps/native/app/index.tsx` renders `ReportCanvas` **without** a `TamaguiProvider` (web and
  desktop both wrap it) — theming will not apply on native. Pre-existing.
- `packages/ui`'s `dev` watcher (`tsup --watch`) only watches its own `src`, so editing
  `@repo/report-schema` mid-session does not retrigger ui's declaration emit. Runtime is
  fine; `.d.ts` can go stale until the next build.
- `apps/api-client` does not consume the contract yet. Reusing the Zod schemas for NestJS DTO
  validation is the natural next step there. It also does not yet route to
  `apps/python-pipeline`, which currently serves on :8000 directly.
- The Zod `superRefine` rules are reimplemented in Python (`report/validate.py`) because
  JSON Schema cannot carry them. Two implementations of one rule set can drift; tests pin
  both to the same examples, but a new cross-field rule has to be added in both places.
- `parnassix` is unpublished, so the library is consumed by path. See "This repo is the worked
  example" above for what that costs.

## Immediate next work

0. Draw the highlights. The pipeline emits top-left boxes with page sizes, so the
   Timeline's `DetailPanel` has everything it needs to stop reporting "N regions" and
   actually render them over a page image. The library can serve the page images
   (`pythoness` was designed for that: `pageSize` is already on every ref).
1. A second component (Table) — the first real test of whether adding a `kind` is mechanical.
2. The chat/SSE session layer and the canvas mutation protocol
   (append / replace-by-id / remove), which the current snapshot-shaped `ReportSpec`
   deliberately does not yet support.
3. `groupId`, if grouping several facts onto one card turns out to be wanted. Automatic trunk
   grouping already covers the visual half of that need.
