import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * `@repo/report-schema` is aliased to its SOURCE rather than its build output.
 *
 * This package's `dev` watcher only watches its own `src`, so editing the
 * contract mid-session does not retrigger a build here and `dist` can go stale.
 * Tests that silently ran against a stale contract would be worse than no tests
 * at all — the whole point of the axis suite is that it pins arithmetic shared
 * with that package.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@repo/report-schema": resolve(__dirname, "../report-schema/src/index.ts"),
    },
  },
});
