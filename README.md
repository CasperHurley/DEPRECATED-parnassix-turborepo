# Aneural Frontend

A cross-platform monorepo: one shared Tamagui component layer rendered by a web app, a native iOS/Android app, and an Electron desktop app, with a NestJS API alongside them.

## What's inside

### Apps

| App               | Stack                           | Purpose                                |
| ----------------- | ------------------------------- | -------------------------------------- |
| `apps/web-vite`   | Vite 8 + React 19               | Browser app                            |
| `apps/native`     | Expo SDK 57 + React Native 0.86 | iOS, Android, and native-web via Metro |
| `apps/desktop`    | Electron 44 + electron-vite 5   | macOS/Windows/Linux desktop app        |
| `apps/api-client` | NestJS 12 on Fastify            | HTTP API                               |

### Packages

| Package                                                  | Purpose                                                                                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `packages/ui` (`@repo/ui`)                               | The shared design system. Re-exports all of Tamagui plus the single shared `config`, built to CJS + ESM + types with `tsup`. |
| `packages/report-schema` (`@repo/report-schema`)          | The wire contract between the agents and the renderer. Zod schemas are the source of truth; emits committed JSON Schema for the Python service to generate Pydantic models from. |
| `packages/typescript-config` (`@repo/typescript-config`) | Shared `tsconfig.json` bases.                                                                                                |

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

**Tooling**

- [TypeScript](https://www.typescriptlang.org) 6 everywhere
- [oxlint](https://oxc.rs) — linting
- [Vitest](https://vitest.dev) 4 — tests in `api-client`
- [tsup](https://tsup.egoist.dev) — builds `@repo/ui`
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
| `pnpm lint`   | oxlint across the workspace              |
| `pnpm format` | Prettier over the repo                   |
| `pnpm clean`  | Remove build output and `node_modules`   |

## Ports

| Service            | Port                                           |
| ------------------ | ---------------------------------------------- |
| `web-vite`         | 5173                                           |
| `desktop` renderer | 5173, or 5174 when `web-vite` already holds it |
| `native` (Metro)   | 8081                                           |
| `api-client`       | 3000                                           |

## Workspace constraints

Two settings in `pnpm-workspace.yaml` are load-bearing. Both exist because of how Tamagui resolves its runtime under pnpm's strict `node_modules` layout, and removing either reintroduces a real bug.

**`overrides` pins React.** Tamagui resolves a separate copy of its runtime per React peer version. If the apps drift apart on React, `web-vite` and `native` end up with different `@tamagui/web` instances, and the `config` created in `@repo/ui` becomes invisible to the components rendering it — themes silently stop applying. React and React DOM are pinned to `19.2.3`, the version Expo SDK 57 expects. **Changing the React version means changing it everywhere at once.**

**`publicHoistPattern` hoists `@tamagui/*`.** Tamagui's Vite and Metro plugins, and its static compiler, resolve `@tamagui/*` from the app root — but pnpm nests those under the `tamagui` package where the tooling can't see them. Without hoisting, the compiler fails silently and style extraction never runs.

Two smaller things worth knowing:

- `packages/typescript-config/base.json` uses `moduleResolution: "bundler"`. Don't put `"node"` (node10) back: it is deprecated in TS 6, removed in TS 7, and it ignores package `exports` maps, which is how modern dependencies expose their types.
- No package sets `baseUrl` or `paths`. `baseUrl` is deprecated in TS 6, and the `@/` alias it supported also required a `tsc-alias` post-pass that could — and did — silently no-op, shipping `.d.ts` files with unresolvable specifiers that `skipLibCheck` then hid. Use relative imports inside a package.

## Adding a component

Put it in `packages/ui/src/`, export it from `src/index.tsx`, and all three UI apps pick it up. `pnpm dev` runs `tsup --watch` on the package, so changes rebuild automatically.
