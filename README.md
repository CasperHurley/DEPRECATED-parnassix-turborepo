# Parnassix

Parnassix generates reports assembled from reusable, deterministic components. Component templates are fixed in shape; backend agents influence the output only by choosing enum values and supplying data. A hallucinating agent can produce wrong data, but it cannot produce a shape this repo doesn't know how to render.

The primary use case is evidentiary work, legal being the sharpest example, so every fact shown must be traceable to its source. The failure to design against is the lawyer who cited a case that did not exist. This tool must never be able to do that: a model never sees or emits a page coordinate, only a node id, and the pipeline resolves that id back to a page, a bounding box, and a page size.

This is the monorepo for the whole system: a shared Tamagui component layer rendered by a web app, a native iOS/Android app, and an Electron desktop app; a NestJS API; and the Python pipeline that turns documents into embeddings with per-fact provenance.

## How the pieces fit

| Piece                        | Where                                          | Status                                                                   |
| ---------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| Wire contract                | `packages/report-schema`                       | Built. Zod is the source of truth; JSON Schema is emitted for Python.    |
| Renderer                     | `packages/ui`                                  | Built. `ReportCanvas` validates each component and renders by `kind`.    |
| Corpus ingestion + retrieval | `apps/python-pipeline`                         | Built. Docling → chunks → Redis vector index, with citation resolution.  |
| Agent workflows              | `apps/python-pipeline`                         | Not built. Will populate component templates and retry on invalid enums. |
| API gateway                  | `apps/api-client`                              | Scaffolded. Does not yet consume the contract or route to the pipeline.  |
| Frontends                    | `apps/web-vite`, `apps/desktop`, `apps/native` | Built. All three render the same `@repo/ui` canvas.                      |

`CLAUDE.md` holds the design decisions behind this table and the current state of each part in detail.

## What's inside

### Apps

| App                    | Stack                              | Purpose                                      |
| ---------------------- | ---------------------------------- | -------------------------------------------- |
| `apps/web-vite`        | Vite 8 + React 19                  | Browser app                                  |
| `apps/native`          | Expo SDK 57 + React Native 0.86    | iOS, Android, and native-web via Metro       |
| `apps/desktop`         | Electron 44 + electron-vite 5      | macOS/Windows/Linux desktop app              |
| `apps/api-client`      | NestJS 12 on Fastify               | HTTP API                                     |
| `apps/python-pipeline` | Python 3.13 + Docling + LlamaIndex | Documents → embeddings + per-fact provenance |

### Packages

| Package                                                  | Purpose                                                                                                                                                                          |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/ui` (`@repo/ui`)                               | The shared design system and the `ReportCanvas` renderer. Re-exports all of Tamagui plus the single shared `config`, built to CJS + ESM + types with `tsup`.                     |
| `packages/report-schema` (`@repo/report-schema`)         | The wire contract between the agents and the renderer. Zod schemas are the source of truth; emits committed JSON Schema for the Python service to generate Pydantic models from. |
| `packages/typescript-config` (`@repo/typescript-config`) | Shared `tsconfig.json` bases.                                                                                                                                                    |

The Python app is a full turbo citizen: a thin `package.json` maps `build`/`dev`/`lint`/`test`
onto `uv`, and its build depends on `@repo/report-schema` so the Zod → JSON Schema → Pydantic
codegen reruns whenever the contract changes. It needs `uv`, Docker (for Redis Stack) and
Ollama; see `apps/python-pipeline/README.md`.

All three UI apps import from `@repo/ui`, so a component or theme token changes in one place and lands everywhere.

## Tech stack

**Monorepo**

- [Turborepo](https://turborepo.dev) 2.10 — task graph, caching
- [pnpm](https://pnpm.io) 12.3.4 workspaces
- Node >= 18

**UI layer**

- [Tamagui](https://tamagui.dev) 2.7.7 — cross-platform components and theming, shared by web, native, and desktop
- [React](https://react.dev) 19.2.3
- `@tamagui/vite-plugin` (web, desktop) and `@tamagui/metro-plugin` (native) run the optimizing compiler
- Config lives in `packages/ui/src/tamagui.config.ts`, built on the `@tamagui/config` v3 preset

**Web** — Vite 8.2.2, `@vitejs/plugin-react` 6

**Native** — Expo SDK 57.0.20, React Native 0.86.3, `expo-router` 57 (file-based routing in `apps/native/app/`), `react-native-web` 0.21

**Desktop** — Electron 44.2.0, electron-vite 5. Split `main` / `preload` / `renderer`, with `contextIsolation: true`, `nodeIntegration: false`, and a CSP meta tag. The renderer reaches the main process only through the `contextBridge` API in `src/preload/`.

**API** — NestJS 12 on the Fastify adapter, CORS enabled, listening on `PORT` (default 3000)

**Contract** — [Zod](https://zod.dev) 4 in `@repo/report-schema`, emitted to JSON Schema and regenerated as Pydantic models by `datamodel-code-generator`

**Pipeline** — Python 3.13, [Docling](https://github.com/docling-project/docling) for conversion and OCR, [LlamaIndex](https://www.llamaindex.ai) with Redis Stack as the vector store, [Ollama](https://ollama.com) for local embeddings, FastAPI for the HTTP surface

**Tooling**

- [TypeScript](https://www.typescriptlang.org) 6 everywhere
- [oxlint](https://oxc.rs) — linting; [ruff](https://docs.astral.sh/ruff/) for Python
- [Vitest](https://vitest.dev) 4 — tests in `@repo/ui`, `@repo/report-schema`, and `api-client`; [pytest](https://docs.pytest.org) in the pipeline
- [tsup](https://tsup.egoist.dev) — builds `@repo/ui` and `@repo/report-schema`
- [Prettier](https://prettier.io) — formatting

## Getting started

```sh
pnpm install     # also downloads the Electron binary via apps/desktop postinstall
pnpm dev         # every app at once
```

Run one app on its own:

```sh
pnpm --filter web-vite dev
pnpm --filter desktop dev
pnpm --filter api-client dev
pnpm --filter python-pipeline dev   # needs Redis: pnpm --filter python-pipeline redis:up
pnpm --filter native dev      # expo start --web
```

For native on a device or simulator:

```sh
cd apps/native
npx expo start --ios        # Expo Go
npx expo start --android
pnpm ios                    # expo run:ios - full native build, generates ios/
```

## Commands

| Command       | Does                                     |
| ------------- | ---------------------------------------- |
| `pnpm dev`    | All apps in watch mode (`turbo run dev`) |
| `pnpm build`  | Build everything (`turbo run build`)     |
| `pnpm test`   | Vitest and pytest across the workspace   |
| `pnpm lint`   | oxlint and ruff across the workspace     |
| `pnpm format` | Prettier over the repo                   |
| `pnpm clean`  | Remove build output and `node_modules`   |

`pnpm --filter @repo/report-schema check:schema` verifies the committed JSON Schema matches the Zod source; run it after changing the contract.

## Ports

Web and desktop both pin their port with `strictPort`, so neither silently slides to the next free one.

| Service            | Port                                 |
| ------------------ | ------------------------------------ |
| `web-vite`         | 5173                                 |
| `desktop` renderer | 5174                                 |
| `native` (Metro)   | 8081                                 |
| `api-client`       | 3000                                 |
| `python-pipeline`  | 8000 (Redis 6379, RedisInsight 8001) |

## Workspace constraints

Two settings in `pnpm-workspace.yaml` are load-bearing. Both exist because of how Tamagui resolves its runtime under pnpm's strict `node_modules` layout, and removing either reintroduces a real bug.

**`overrides` pins React.** Tamagui resolves a separate copy of its runtime per React peer version. If the apps drift apart on React, `web-vite` and `native` end up with different `@tamagui/web` instances, and the `config` created in `@repo/ui` becomes invisible to the components rendering it — themes silently stop applying. React and React DOM are pinned to `19.2.3`, the version Expo SDK 57 expects. **Changing the React version means changing it everywhere at once.**

**`publicHoistPattern` hoists `@tamagui/*`.** Tamagui's Vite and Metro plugins, and its static compiler, resolve `@tamagui/*` from the app root — but pnpm nests those under the `tamagui` package where the tooling can't see them. Without hoisting, the compiler fails silently and style extraction never runs.

Two smaller things worth knowing:

- `packages/typescript-config/base.json` uses `moduleResolution: "bundler"`. Don't put `"node"` (node10) back: it is deprecated in TS 6, removed in TS 7, and it ignores package `exports` maps, which is how modern dependencies expose their types.
- No package sets `baseUrl` or `paths`. `baseUrl` is deprecated in TS 6, and the `@/` alias it supported also required a `tsc-alias` post-pass that could — and did — silently no-op, shipping `.d.ts` files with unresolvable specifiers that `skipLibCheck` then hid. Use relative imports inside a package.

## Adding a component

Put it in `packages/ui/src/`, export it from `src/index.tsx`, and all three UI apps pick it up. `pnpm dev` runs `tsup --watch` on the package, so changes rebuild automatically.
