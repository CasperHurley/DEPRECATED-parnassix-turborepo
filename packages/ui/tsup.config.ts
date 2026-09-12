import { defineConfig, Options } from "tsup";

export default defineConfig((options: Options) => ({
  entry: {
    index: "src/index.tsx",
  },
  banner: {
    js: "'use client'",
  },
  // tsup deletes dist/ before each rebuild; in watch mode that leaves a window
  // where a running Vite dev server cannot resolve @repo/ui. Only clean on
  // one-shot builds.
  clean: !options.watch,
  format: ["cjs", "esm"],
  external: ["react", "react-dom", "react-native", "tamagui", /^@tamagui\//],
  // Declarations are emitted by `tsc -p tsconfig.build.json` instead of tsup's
  // bundled `dts`, which cannot produce the .d.ts.map files that let editors
  // jump from a consuming app into this package's source.
  dts: false,
  ...options,
}));
