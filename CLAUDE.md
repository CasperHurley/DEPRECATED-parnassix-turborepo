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
  Tamagui deps and TS 5.9 pin.

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

### Timeline — [built: contract only; no temporal-axis rendering]

One component with a `scale` prop, **not** two components. The difference between the two
useful layouts is only the position function:

- `ordinal` — evenly spaced, position = index. Good for milestones and narrow mobile
  viewports where proportional spacing collapses into overlap.
- `time` — position proportional to timestamp. **This is the important one for evidentiary
  work: the gaps are the evidence.** "Nothing for eight months, then five things in
  seventy-two hours" is an argument, and ordinal spacing destroys it.

Follow-ons:

- `unitOfTime` did two jobs — axis tick granularity and per-event label formatting.
  Resolved by exposing **only** `labelUnit`: tick granularity is derived by the renderer from
  the data range, so it is not an agent-facing field at all. **Every field exposed to an agent
  is a field an agent can get wrong** — keep the agent-facing surface minimal.
- Dense clusters need a defined answer (stacking, expandable clustering, or a broken/zoomable
  axis). Real extracted data will put nine events on one afternoon inside a five-year span.
  This is the interaction model, not a detail. **[open]**

### Contract decisions made while building the schema package

- **The axis is `orientation` + `order`, semantic and unambiguous.**
  `horizontal | vertical` and `ascending | descending`, mapped to flex by the 2×2
  `LAYOUT_TO_FLEX` in `packages/ui`. Two things drove this: the original enum's values were
  literally `'row'` / `'row-reverse'` (an agent should not be choosing CSS), and the first
  replacement — `forward` / `backward` / `down` / `up` — kept a `backward` member readable
  as either "right-to-left" or "reverse-chronological". An agent choosing between those two
  readings had no way to know which was meant. Same four combinations, no ambiguity.
  `order` sets the direction of the axis; the renderer does not re-sort events.
- **Timestamps accept ISO date *or* datetime.** Precision of knowledge is itself evidence: a
  document saying "January 2023" must not be promoted to a fabricated `2023-01-01T00:00:00Z`.
  **[open]** An explicit `precision` field is probably needed before `scale: 'time'` can
  position such an event honestly.
- **`SourceRef.bbox` is an array and carries `pageSize`.** A quoted fact spans lines, so one
  ref needs many boxes; and a BOTTOMLEFT box cannot be flipped into the renderer's TOPLEFT
  space without the page height.
- **Per-event ReactNode became render props.** `oppositeContent` was a per-event field, which
  cannot survive serialization. `Timeline` now takes `renderOppositeContent` / `renderEvent`
  instead: the spec carries data, the renderer supplies nodes.
- **Unknown fields are stripped, not rejected.** Deliberately lenient on read so a newer
  backend adding a field cannot break an older client. An invented value in a *known* field
  still fails — that is where the contract does its work.
- **Enums are const objects, not TS `enum`s.** They do not round-trip to JSON Schema.
  `UnitOfTime.Year` call sites are unchanged.
- **The emitted JSON Schema is committed** at `packages/report-schema/schema/`, not left in
  gitignored `dist/`, because a separate Python repo cannot codegen against an unpushed file.
  `pnpm --filter @repo/report-schema check:schema` fails if it drifts from the Zod source.

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
- `packages/ui/src/ReportCanvas/Components/Timeline/` — `types.ts` holds the props layer plus
  the renderer lookups (`DIRECTION_TO_FLEX`, `TimeFormatterMap`, `DateMethodMap`);
  `Timeline.tsx` is prop-driven, keyed by `event.id`. **No axis, no line, no temporal
  positioning yet** — `scale` and `labelUnit` are carried but unused by the renderer.
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

1. Timeline's temporal axis (`scale: 'time'`), which needs the `precision` question answered.
2. A second component (Table) — the first real test of whether adding a `kind` is mechanical.
3. The chat/SSE session layer and the canvas mutation protocol
   (append / replace-by-id / remove), which the current snapshot-shaped `ReportSpec`
   deliberately does not yet support.
