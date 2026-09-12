import { defineConfig, Options } from "tsup";

export default defineConfig((options: Options) => ({
  entry: { index: "src/index.ts" },
  // NEVER clean — same reasoning as packages/ui. Deleting dist/ leaves a window
  // in which this package points at files that do not exist, and any consumer's
  // watcher resolving in that window fails hard. A single entry means every file
  // is overwritten in place, so cleaning buys nothing.
  clean: false,
  format: ["cjs", "esm"],
  // zod stays external so consumers share a single instance — schema objects
  // from two copies of zod would not be interchangeable.
  external: ["zod"],
  // Declarations are emitted by `tsc -p tsconfig.build.json` instead, which can
  // produce the .d.ts.map files that tsup's bundled `dts` cannot.
  dts: false,
  ...options,
}));
