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

### Two type layers, kept separate — [decided, not built]

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

### Schema lives in its own package — [decided, not built]

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

### Provenance is per-fact, first-class — [decided, shape open]

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

### Render context in the type system — [decided, not built]

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

### Versioning — [decided, not built]

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

### Timeline — [decided, not built]

One component with a `scale` prop, **not** two components. The difference between the two
useful layouts is only the position function:

- `ordinal` — evenly spaced, position = index. Good for milestones and narrow mobile
  viewports where proportional spacing collapses into overlap.
- `time` — position proportional to timestamp. **This is the important one for evidentiary
  work: the gaps are the evidence.** "Nothing for eight months, then five things in
  seventy-two hours" is an argument, and ordinal spacing destroys it.

Follow-ons:

- `unitOfTime` currently does two jobs — axis tick granularity and per-event label
  formatting. Split them. On a temporal scale, granularity should derive from the data range;
  label format stays an author/agent choice. **Every field exposed to an agent is a field an
  agent can get wrong** — keep the agent-facing surface minimal.
- Dense clusters need a defined answer (stacking, expandable clustering, or a broken/zoomable
  axis). Real extracted data will put nine events on one afternoon inside a five-year span.
  This is the interaction model, not a detail. **[open]**

## Current state of the code

Branch `CreateTimeline`. Scaffolding only — the types are further along than the rendering.

- `packages/ui/src/types.ts` — `ReportCanvasProps` (`{ data, components }`),
  empty `ReportCanvasData`, `TamaguiComponentProps` (normalized press/hover/focus surface),
  `ComponentProps`.
- `packages/ui/src/ReportCanvas/ReportCanvas.tsx` — takes **no props**; hardcodes an `<H1>`
  and a `<Timeline />`. The props contract is designed but not wired.
- `packages/ui/src/ReportCanvas/Components/Timeline/types.ts` — `TimelineComponentProps`,
  `TimelineEventProps`, `UnitOfTime`, `TimelineDirection` (enum values map directly onto flex
  values), `TimeFormatterMap`, `DateMethodMap`.
- `packages/ui/src/ReportCanvas/Components/Timeline/Timeline.tsx` — mock events inlined in
  `useState`; renders a bare `XStack` of event cards. None of the time machinery is used yet:
  no axis, no line, no `lineVariant`, no `oppositeContent`. `timelineData` is declared and
  unused.

Known gaps to fix: `apps/native/app/index.tsx` renders `ReportCanvas` **without** a
`TamaguiProvider` (web and desktop both wrap it) — theming will not apply on native.

## Immediate next work

1. Split wire types from component props.
2. Move wire types into `packages/report-schema`.
