import { defineConfig, Options } from "tsup";

export default defineConfig((options: Options) => ({
  entry: {
    index: "src/index.tsx",
  },
  banner: {
    js: "'use client'",
  },
  // NEVER clean.
  //
  // tsup deletes dist/ before recreating it, which leaves a window — tens of
  // milliseconds, but real — in which this package HAS a package.json pointing
  // at files that do not exist. Any consumer's watcher resolving in that window
  // fails hard: Metro reports `Unable to resolve "@repo/ui"` and the running
  // native app is then left holding a broken module graph, which surfaces later
  // as `undefined is not a function` rather than as a resolve error. In a
  // monorepo someone is nearly always running a dev server, so the one-shot
  // build is exactly as dangerous as the watch build.
  //
  // Nothing is lost by skipping it: there is a single entry, so every emitted
  // file is overwritten in place and no orphans accumulate.
  clean: false,
  format: ["cjs", "esm"],
  // @repo/report-schema and zod stay external: schema objects created by two
  // different copies of zod are not interchangeable, and consumers resolve the
  // workspace package through the pnpm symlink anyway.
  external: [
    "react",
    "react-dom",
    "react-native",
    "tamagui",
    /^@tamagui\//,
    "@repo/report-schema",
    "zod",
  ],
  // Declarations are emitted by `tsc -p tsconfig.build.json` instead of tsup's
  // bundled `dts`, which cannot produce the .d.ts.map files that let editors
  // jump from a consuming app into this package's source.
  dts: false,
  ...options,
}));
