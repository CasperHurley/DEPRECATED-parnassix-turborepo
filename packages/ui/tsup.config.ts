import { defineConfig, Options } from "tsup";

export default defineConfig((options: Options) => ({
  entry: {
    index: "src/index.tsx",
  },
  banner: {
    js: "'use client'",
  },
  // Never clean: deleting dist/ leaves a window in which this package's
  // package.json points at files that do not exist, and a consumer's watcher
  // resolving there fails hard — Metro cannot resolve @repo/ui, and the native
  // app surfaces that later as `undefined is not a function`. A single entry
  // means every file is overwritten in place, so cleaning buys nothing.
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
