"""The entire Parnassix-specific surface of the pipeline.

Everything else in this app is a thin wrapper over `pythoness`. This file is
the part that could not be: it is where a locator the library produced becomes
the `SourceRef` shape `packages/report-schema` defines, and where that shape is
checked against the contract it claims to satisfy.

## What this demonstrates

This is the seam the library exists to have. `pythoness` establishes WHERE a
fact came from -- a document, a page, boxes on it -- and knows nothing about
what any consumer calls those fields. A consumer brings a `WireFormat` and gets
its own spelling, with its own rules enforced at the boundary.

Before the extraction, `ingest/provenance.py` built `{documentId, nodeId, page,
bbox, coordOrigin, pageSize, quotedText}` inline, with hardcoded camelCase keys
that mirrored a Zod schema in a TypeScript package with nothing connecting them.
Two copies of one contract, and the half that drifted would be the half no test
covered. Now there is one copy, in `@repo/report-schema`, and this class is the
only thing that has to agree with it.

## The guarantee that is new

`source_ref` round-trips through `report.SourceRef` -- the Pydantic model
generated from the committed JSON Schema -- so a ref that does not satisfy the
contract fails HERE, during ingestion, rather than in the renderer three steps
later. The old code never checked that the dict it built satisfied the schema it
was imitating.

`validate_source_ref` also applies the rule JSON Schema cannot state: a
`bottomleft` box with no `pageSize` cannot be flipped into the renderer's space,
so it is a citation that will silently not draw.

## Why it refuses anything that is not a page

`SourceRef` in `packages/report-schema/src/source.ts` is a document, a page and
boxes. It has no spelling for a table, a row, or a recorded SQL statement, so
`CamelWire` -- which this extends -- raises on those locator kinds rather than
inventing one.

That is the right answer and not a gap to fill in later. Emitting a made-up
camelCase shape for a query citation would produce something the renderer's
validator rejects, and it would reject it AFTER a corpus had been built. A
Parnassix corpus is documents; if it ever needs a database, the Zod contract
grows a variant first and this class follows it. `pythoness` itself has a
`snake` wire that already spells all five kinds, for consumers without a
contract to keep.
"""

from __future__ import annotations

from typing import Any

from pythoness.wire import CamelWire, Locator, register_wire

from .report import SCHEMA_VERSION, validate_source_ref


class ReportSchemaWire(CamelWire):
    """`CamelWire`, validated against `@repo/report-schema`."""

    @property
    def version(self) -> str:
        """The REPORT contract's version, not the library's.

        This lands in the index metadata, where it is diagnostic only. Recording
        the contract a corpus was built against is more useful to this app than
        recording which camelCase dialect produced it -- they are the same
        dialect, and only one of them can change under us.
        """
        return SCHEMA_VERSION

    def source_ref(
        self, locator: Locator, *, document_id: str, node_id: str
    ) -> dict[str, Any]:
        ref = super().source_ref(locator, document_id=document_id, node_id=node_id)
        # Round-tripped, then thrown away: the check is the point, and the dict
        # is what goes on the wire. Returning the model's `model_dump` instead
        # would put the codegen's field ordering and its idea of optionality
        # between this app and the bytes the renderer reads.
        validate_source_ref(ref)
        return ref


WIRE_NAME = "report-schema"

register_wire(WIRE_NAME, ReportSchemaWire())
"""Registered at import, so `wire = "report-schema"` in a pythoness.toml works.

This is why `api/app.py` imports this module for its side effect. A config file
cannot know which formats have been imported, so the library validates the name
when a `Corpus` is built -- and importing this package is what makes the name
resolvable.
"""

__all__ = ["WIRE_NAME", "ReportSchemaWire"]
