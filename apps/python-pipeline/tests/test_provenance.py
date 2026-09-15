"""Tests for the part that has to be right: coordinates and identity.

Each of these pins a failure that is invisible on inspection — a mirrored
highlight and a correct one look equally plausible in JSON.
"""

from __future__ import annotations

import pytest
from docling_core.types.doc import BoundingBox, CoordOrigin

from parnassix_pipeline.ingest import build_nodes, source_refs_of
from parnassix_pipeline.ingest.provenance import PageGeometry, _bbox_to_wire
from parnassix_pipeline.report import ContractError, validate_source_ref


def test_pages_are_captured_with_dimensions(converted):
    assert converted.pages, "page geometry must survive conversion"
    for geometry in converted.pages.values():
        assert geometry.width > 0 and geometry.height > 0


def test_every_node_carries_resolvable_provenance(converted):
    nodes = build_nodes(converted)
    assert nodes
    for node in nodes:
        refs = source_refs_of(node)
        assert refs, f"node {node.id_} has no provenance and cannot be cited"
        for ref in refs:
            # Validated against the generated contract model, so a drift in the
            # Zod schema breaks this test rather than a report.
            validate_source_ref(ref)


def test_node_ids_are_stable_across_runs(converted):
    """The defect that motivated not using DoclingNodeParser's default id_func.

    uuid4 ids would make this fail, and the consequence is that every citation
    in every previously generated report stops resolving after a reindex.
    """
    first = [n.id_ for n in build_nodes(converted)]
    second = [n.id_ for n in build_nodes(converted)]
    assert first == second
    assert len(set(first)) == len(first), "node ids must be unique"


def test_node_ids_change_when_text_changes(converted):
    """An id must not survive a change to what it points at.

    Otherwise a stored citation silently rebinds to different words after
    rechunking — the citation still resolves, and now quotes something else.
    """
    nodes = build_nodes(converted)
    from parnassix_pipeline.ingest.provenance import stable_node_id

    class FakeChunk:
        text = "different text entirely"
        meta = type("M", (), {"doc_items": []})()

    assert stable_node_id("doc", FakeChunk(), 0) != nodes[0].id_


def test_bottomleft_flips_to_topleft_correctly():
    """t and b swap roles in the flip; getting it wrong mirrors the highlight."""
    page = PageGeometry(width=612.0, height=792.0)
    # In BOTTOMLEFT, t is the visually-upper edge and holds the LARGER y.
    box = BoundingBox(l=78.0, t=665.18, r=533.64, b=643.93, coord_origin=CoordOrigin.BOTTOMLEFT)

    wire, origin = _bbox_to_wire(box, page, to_topleft=True)

    assert origin is CoordOrigin.TOPLEFT
    assert wire["t"] == pytest.approx(792.0 - 665.18)
    assert wire["b"] == pytest.approx(792.0 - 643.93)
    # In screen space the top edge must now be the SMALLER value.
    assert wire["t"] < wire["b"]
    # Height is preserved by the flip.
    assert (wire["b"] - wire["t"]) == pytest.approx(665.18 - 643.93)
    # x is untouched: the flip is vertical only.
    assert wire["l"] == 78.0 and wire["r"] == 533.64


def test_flip_is_refused_rather_than_guessed_without_page_size():
    """No page height means no honest flip. The box stays labelled bottomleft."""
    box = BoundingBox(l=1, t=100, r=2, b=90, coord_origin=CoordOrigin.BOTTOMLEFT)
    wire, origin = _bbox_to_wire(box, None, to_topleft=True)
    assert origin is CoordOrigin.BOTTOMLEFT
    assert wire["t"] == 100


def test_topleft_output_declares_topleft(converted):
    for node in build_nodes(converted, to_topleft=True):
        for ref in source_refs_of(node):
            assert ref["coordOrigin"] == "topleft"
            assert ref["pageSize"]["height"] > 0


def test_raw_output_declares_bottomleft(converted):
    """The contract's stated origin must match the coordinates actually sent."""
    for node in build_nodes(converted, to_topleft=False):
        for ref in source_refs_of(node):
            assert ref["coordOrigin"] == "bottomleft"


def test_uncitable_bottomleft_ref_is_rejected():
    """A bottomleft box with no pageSize cannot be drawn; say so loudly."""
    with pytest.raises(ContractError, match="pageSize"):
        validate_source_ref(
            {
                "documentId": "d",
                "nodeId": "n",
                "page": 1,
                "bbox": [{"l": 0, "t": 10, "r": 5, "b": 0}],
                "coordOrigin": "bottomleft",
            }
        )


def test_pages_are_one_based(converted):
    """The contract requires a positive page number; Docling is already 1-based."""
    for node in build_nodes(converted):
        for ref in source_refs_of(node):
            assert ref["page"] >= 1


def test_coordinates_are_never_shown_to_the_llm(converted):
    """The anti-hallucination boundary, asserted rather than assumed.

    If coordinates reach the LLM's view of a node, a model can copy, mangle or
    invent them — and the whole citation design collapses into prompting.
    """
    for node in build_nodes(converted):
        visible = node.get_content(metadata_mode="llm")
        assert "bbox" not in visible
        assert "source_refs" not in visible
        assert "coordOrigin" not in visible
