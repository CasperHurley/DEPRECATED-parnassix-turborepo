import { defineConfig, Options } from "tsup";

export default defineConfig((options: Options) => ({
  entry: { index: "src/index.ts" },
  // tsup deletes dist/ before each rebuild; in watch mode that leaves a window
  // where a consumer cannot resolve @repo/report-schema. Only clean on
  // one-shot builds. (Same reasoning as packages/ui.)
  clean: !options.watch,
  format: ["cjs", "esm"],
  // zod stays external so consumers share a single instance — schema objects
  // from two copies of zod would not be interchangeable.
  external: ["zod"],
  // Declarations are emitted by `tsc -p tsconfig.build.json` instead, which can
  // produce the .d.ts.map files that tsup's bundled `dts` cannot.
  dts: false,
  ...options,
}));
