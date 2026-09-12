# Aneural — frontend monorepo

## What this project is

Aneural generates **reports assembled from reusable, deterministic components**. The
frontend is a *renderer*: component templates are fixed in shape, and backend agents
influence output only by choosing enum values and supplying data. That bound is the point —
a hallucinating agent can produce wrong data, but it cannot produce a shape this repo
doesn't know how to render.

Primary use case is evidentiary work (legal being the sharpest example), which sets the
quality bar: **every fact shown must be traceable to its source**. The canonical failure to
design against is the lawyer who cited a case that did not exist. This tool must never be
able to do that.

### The wider system (mostly outside this repo)

| Piece | Where | Role |
| --- | --- | --- |
| Corpus ingestion | Python service (separate repo) | PDFs via LlamaIndex + `DoclingReader` / `DoclingNodeParser` → `VectorStoreIndex`. Extracts data, embeddings, and per-item provenance (page + bbox). |
| Agent workflows | Same Python service | Populate component templates. Invalid enum values are caught and handed back to an agent for a limited number of retries — **this repo does not own that retry loop**. |
| API gateway | `apps/api-client` (NestJS/Fastify) | Routes between frontends and Python. Validates at the public boundary. |
| Frontends | `apps/web-vite`, `apps/desktop`, `apps/native` | Render reports from the shared `@repo/ui` component layer. |

Embedding model is configured **per corpus, not globally** (local Ollama/HuggingFace for
privileged documents; hosted OpenAI when a client brings their own key). Model name and
dimension are stored in index metadata so a mismatch fails loudly — indexes are not portable
across embedding models.

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

### Provenance is per-fact, first-class — [built: type only; shape provisional]

Citation granularity is per *fact* (a timeline event, a table cell), not per component. A
`SourceRef` belongs both on base `ComponentProps` and on individual data points.

Working shape, to be firmed up as the Python backend matures:

```ts
{ documentId, nodeId, page, bbox, chunkId?, quotedText? }
```

LlamaIndex nodes carry a stable `node_id` and Docling preserves per-item page + bbox, so
this should round-trip to a highlight. **Gotcha to verify:** PDF bounding boxes are
conventionally bottom-left origin while the renderer is top-left — a highlight overlay needs
page height to flip them.

Citations must degrade for print: interactive highlight-in-the-PDF on screen, numbered
footnote markers plus a reference table on export. Same data, two presentations.
**Hover-only citation is not acceptable** — it doesn't survive the export path.

### Render context in the type system — [built: type + context; nothing lays out from it yet]

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

- `packages/report-schema` (`@repo/report-schema`) — the wire contract, Zod as source of
  truth, zero deps but zod. `source.ts` (SourceRef/BBox), `primitives.ts` (Timestamp,
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
  `useIsStaticMedium`. Defined, not yet consumed by any layout.

Known gaps:

- `apps/native/app/index.tsx` renders `ReportCanvas` **without** a `TamaguiProvider` (web and
  desktop both wrap it) — theming will not apply on native. Pre-existing.
- `packages/ui`'s `dev` watcher (`tsup --watch`) only watches its own `src`, so editing
  `@repo/report-schema` mid-session does not retrigger ui's declaration emit. Runtime is
  fine; `.d.ts` can go stale until the next build.
- `apps/api-client` does not consume the contract yet. Reusing the Zod schemas for NestJS DTO
  validation is the natural next step there.

## Immediate next work

1. A second component (Table) — the first real test of whether adding a `kind` is mechanical.
2. The chat/SSE session layer and the canvas mutation protocol
   (append / replace-by-id / remove), which the current snapshot-shaped `ReportSpec`
   deliberately does not yet support.
3. `groupId`, if grouping several facts onto one card turns out to be wanted. Automatic trunk
   grouping already covers the visual half of that need.
