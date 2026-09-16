"""Generate Pydantic models from the committed JSON Schema of @repo/report-schema.

CLAUDE.md: wire types are "Authored in Zod -> OpenAPI/JSON Schema emitted as a
build step -> Python generates Pydantic models from that spec". This is the
Python half of that. It reads the artifact the schema package commits, so the
models here cannot drift from the contract the renderer enforces.

Run via `pnpm --filter python-pipeline build`, which turbo orders after
@repo/report-schema's own build, so the JSON being read is always current.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
SCHEMA = APP.parents[1] / "packages" / "report-schema" / "schema" / "report-schema.json"
PACKAGE = APP / "src" / "parnassix_pipeline" / "report"
OUT = PACKAGE / "_generated.py"
# The same artifact, copied in as package data. `validate.py` reads it through
# `importlib.resources` for the contract version and could not before: it walked
# six directory levels up, which resolves from a checkout and from nowhere else.
SCHEMA_COPY = PACKAGE / "schema.json"

BANNER = '''"""GENERATED FILE - DO NOT EDIT.

Produced from packages/report-schema/schema/report-schema.json by
scripts/generate_models.py. Edit the Zod schemas and rebuild instead; anything
changed here is lost on the next build, and a hand-edit here is exactly the
"two hand-synced definitions" the codegen exists to prevent.
"""
'''


def main() -> int:
    if not SCHEMA.is_file():
        print(
            f"error: {SCHEMA} not found.\n"
            f"Build the contract first: pnpm --filter @repo/report-schema build",
            file=sys.stderr,
        )
        return 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        [
            "datamodel-codegen",
            "--input", str(SCHEMA),
            "--input-file-type", "jsonschema",
            "--output", str(OUT),
            "--output-model-type", "pydantic_v2.BaseModel",
            "--target-python-version", "3.12",
            "--use-annotated",
            "--use-standard-collections",
            "--use-union-operator",
            # Field names cross from camelCase (the wire) to snake_case (Python)
            # with aliases, so serializing by alias reproduces the wire shape
            # exactly. Without this the JSON Python emits would not validate
            # against the very schema it was generated from.
            "--snake-case-field",
            "--use-field-description",
            "--field-constraints",
            "--collapse-root-models",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(result.stdout, file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        return result.returncode

    OUT.write_text(BANNER + "\n" + OUT.read_text())
    # One read, two outputs, so the models and the version they report cannot
    # come from different revisions of the schema.
    SCHEMA_COPY.write_text(SCHEMA.read_text())
    print(f"generated {OUT.relative_to(APP)} and {SCHEMA_COPY.relative_to(APP)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
