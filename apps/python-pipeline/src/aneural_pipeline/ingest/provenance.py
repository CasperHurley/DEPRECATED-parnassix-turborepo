"""Turn Docling layout provenance into the `SourceRef` shape the renderer expects.

This module is the whole reason the pipeline exists. Everything else is
plumbing; this is the part that lets a report say "here, on this page, in this
box" and be right about it.

Three facts about Docling's output drive the code below, all verified against a
real PDF conversion rather than taken from documentation:

1. `coord_origin` is `BOTTOMLEFT` for PDF-parsed content, and it is serialized
   UPPERCASE. The wire contract's enum is lowercase.
2. In BOTTOMLEFT space `t > b` — `t` is the visually-upper edge and holds the
   LARGER y. Treating `t` as a screen-space top produces highlights mirrored
   about the page's horizontal midline, which reads as a plausible-looking
   offset rather than an obvious bug.
3. Page dimensions are NOT in chunk metadata. They live on `DoclingDocument.pages`
   and are gone by the time chunks exist, so they have to be captured during
   conversion and carried alongside. Without them a BOTTOMLEFT box cannot be
   flipped and a box in points cannot be scaled to a rendered page.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any

from docling_core.transforms.chunker import BaseChunk
from docling_core.types.doc import BoundingBox, CoordOrigin, DoclingDocument

# The wire contract spells these lowercase (packages/report-schema/src/source.ts).
# Docling spells them uppercase. Convert at exactly one place: here.
_ORIGIN_TO_WIRE = {
    CoordOrigin.TOPLEFT: "topleft",
    CoordOrigin.BOTTOMLEFT: "bottomleft",
}


@dataclass(frozen=True)
class PageGeometry:
    """Dimensions of one source page, in the same units as its bounding boxes."""

    width: float
    height: float

    def as_wire(self) -> dict[str, float]:
        return {"width": self.width, "height": self.height}


def page_geometry(doc: DoclingDocument) -> dict[int, PageGeometry]:
    """Capture every page's size before chunking discards it.

    Call this on the converted document and keep the result for as long as you
    intend to build citations from it.
    """
    return {
        no: PageGeometry(width=page.size.width, height=page.size.height)
        for no, page in doc.pages.items()
        if page.size is not None
    }


def document_id(doc: DoclingDocument, fallback: str) -> str:
    """A document id that is the same every time the same bytes are ingested.

    Docling's `origin.binary_hash` is a hash of the source file's content, so it
    survives renaming and re-ingestion but changes if the document is edited —
    which is the behaviour a citation needs. A report citing `documentId` X must
    resolve to the same bytes a year later or the citation is worthless, and it
    must NOT silently resolve to a revised document that no longer says what was
    quoted.
    """
    origin = getattr(doc, "origin", None)
    if origin is not None and getattr(origin, "binary_hash", None):
        stem = (getattr(origin, "filename", None) or fallback).rsplit("/", 1)[-1]
        return f"{stem}:{origin.binary_hash:x}"
    # No origin (a document built in memory, or a backend that does not set it).
    # Fall back to the caller's identifier so ingestion still works, accepting
    # that stability is now the caller's problem.
    return fallback


def stable_node_id(doc_id: str, chunk: BaseChunk, ordinal: int) -> str:
    """A deterministic id for a chunk.

    `DoclingNodeParser` assigns `uuid4` by default, which is wrong for this
    pipeline in a way that is easy to miss: re-ingesting an unchanged document
    produces entirely new node ids, so every `SourceRef` in every previously
    generated report stops resolving. Citations would rot on reindex.

    The id is derived from the document, the structural references of the items
    the chunk covers (`#/texts/2`, stable across runs for unchanged input), the
    chunk's position, and a hash of its text. Text is included so that a change
    in chunking parameters yields different ids rather than silently rebinding
    an old id to different words.
    """
    refs = "|".join(
        getattr(item, "self_ref", "") for item in getattr(chunk.meta, "doc_items", [])
    )
    digest = hashlib.sha256(
        f"{doc_id}\x00{refs}\x00{ordinal}\x00{chunk.text}".encode()
    ).hexdigest()
    return f"{doc_id}#{digest[:16]}"


def _bbox_to_wire(bbox: BoundingBox, geometry: PageGeometry | None, to_topleft: bool):
    """One Docling box as a wire `BBox`, optionally flipped into screen space.

    Returns the box and the origin it ended up in, because the two must agree —
    reporting an origin the coordinates are not actually in is the single
    highest-consequence mistake available in this file.
    """
    if to_topleft and bbox.coord_origin is CoordOrigin.BOTTOMLEFT:
        if geometry is None:
            # Refuse to guess. A box whose origin we cannot convert is emitted
            # unconverted and honestly labelled, so the renderer can decide.
            return (
                {"l": bbox.l, "t": bbox.t, "r": bbox.r, "b": bbox.b},
                CoordOrigin.BOTTOMLEFT,
            )
        # Docling's own helper rather than a hand-rolled `height - y`: it is
        # tested upstream and it knows that `t` and `b` swap roles in the flip.
        flipped = bbox.to_top_left_origin(page_height=geometry.height)
        return (
            {"l": flipped.l, "t": flipped.t, "r": flipped.r, "b": flipped.b},
            CoordOrigin.TOPLEFT,
        )
    return (
        {"l": bbox.l, "t": bbox.t, "r": bbox.r, "b": bbox.b},
        bbox.coord_origin,
    )


def source_refs_for_chunk(
    chunk: BaseChunk,
    *,
    doc_id: str,
    node_id: str,
    pages: dict[int, PageGeometry],
    quoted_text: str | None = None,
    to_topleft: bool = True,
) -> list[dict[str, Any]]:
    """Build the `SourceRef`s covering one chunk.

    Returns a LIST, not a single ref, and the reason is structural: the wire
    contract's `SourceRef` carries one `page` and many `bbox`es, but a chunk can
    straddle a page break — a sentence beginning at the foot of page 4 and
    finishing at the head of page 5 is one chunk covering two pages. That cannot
    be expressed as one `SourceRef`, so boxes are grouped by page and each page
    becomes its own ref. A highlight then spans two pages as two regions, which
    is also how a reader would see it.

    All refs from one chunk share a `nodeId`, so they still resolve back to a
    single retrieval unit.
    """
    by_page: dict[int, list[dict[str, float]]] = {}
    origins: dict[int, set[CoordOrigin]] = {}

    for item in getattr(chunk.meta, "doc_items", []):
        for prov in getattr(item, "prov", []) or []:
            page_no = prov.page_no
            box, origin = _bbox_to_wire(prov.bbox, pages.get(page_no), to_topleft)
            by_page.setdefault(page_no, []).append(box)
            origins.setdefault(page_no, set()).add(origin)

    refs: list[dict[str, Any]] = []
    for page_no in sorted(by_page):
        page_origins = origins[page_no]
        if len(page_origins) > 1:
            # Mixed origins on one page cannot be described by a single
            # `coordOrigin`, and emitting one of them would mislabel the others.
            raise ValueError(
                f"page {page_no} of {doc_id} produced boxes in mixed coordinate "
                f"origins ({sorted(o.value for o in page_origins)}); a SourceRef "
                f"can only declare one."
            )
        geometry = pages.get(page_no)
        ref: dict[str, Any] = {
            "documentId": doc_id,
            "nodeId": node_id,
            "page": page_no,  # Docling is already 1-based, as the contract wants
            "bbox": by_page[page_no],
            "coordOrigin": _ORIGIN_TO_WIRE[next(iter(page_origins))],
        }
        if geometry is not None:
            # Always sent when known. Even a TOPLEFT box needs it: the renderer
            # has to scale points onto whatever width it drew the page at.
            ref["pageSize"] = geometry.as_wire()
        if quoted_text:
            ref["quotedText"] = quoted_text
        refs.append(ref)

    if not refs:
        # A chunk with no layout provenance (some backends, some element types).
        # Returning nothing is correct: CLAUDE.md's rule is that gaps are
        # rendered rather than omitted, and an empty list is a gap the caller can
        # see. Inventing a page-1 box would be the failure this project exists
        # to prevent.
        return []
    return refs
