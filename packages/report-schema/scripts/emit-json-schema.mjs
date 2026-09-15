/**
 * Emits the wire contract as JSON Schema for non-TypeScript consumers.
 *
 * The Python service generates Pydantic models from this artifact
 * (datamodel-code-generator), so the agents and the renderer are constrained by
 * the same definition rather than two hand-synced ones.
 *
 * Output lands in schema/ and is COMMITTED, deliberately: dist/ is gitignored,
 * and a separate Python repo cannot codegen against a file that was never
 * pushed.
 *
 * Run with --check to verify the committed artifact still matches the schemas.
 * That guard is the whole point of committing it — otherwise it silently drifts
 * from the Zod definitions it was generated from.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const { ReportSpecSchema, SCHEMA_VERSION } = await import(resolve(root, "dist/index.mjs"));

const schema = z.toJSONSchema(ReportSpecSchema, {
  io: "input",
  // Free CI guard: fails the build if anyone puts something unserializable
  // (z.date(), z.map(), z.bigint(), a .transform()) into a wire type.
  unrepresentable: "throw",
  reused: "ref",
});

const artifact =
  JSON.stringify(
    { $id: `https://parnassix.dev/schema/report/${SCHEMA_VERSION}`, ...schema },
    null,
    2,
  ) + "\n";

const target = resolve(root, "schema/report-schema.json");

if (process.argv.includes("--check")) {
  const existing = readFileSync(target, "utf8");
  if (existing !== artifact) {
    console.error(
      `report-schema: schema/report-schema.json is out of date.\n` +
        `Run \`pnpm --filter @repo/report-schema build\` and commit the result.`,
    );
    process.exit(1);
  }
  console.log("report-schema: committed JSON Schema is up to date");
} else {
  writeFileSync(target, artifact);
  console.log(`report-schema: wrote ${target} (v${SCHEMA_VERSION})`);
}
