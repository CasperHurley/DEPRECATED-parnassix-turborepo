"""The seam between the library and this project's contract.

`ReportSchemaWire` is the whole of what Parnassix adds to `pythoness`, and this
is the test that would have caught the thing nothing caught before the
extraction: `ingest/provenance.py` built `{documentId, nodeId, page, bbox,
coordOrigin, pageSize, quotedText}` with hardcoded keys mirroring
`packages/report-schema/src/source.ts`, and nothing anywhere checked that the
dict it produced satisfied the schema it was imitating. A shape coupling with
no import, so no tool could see it drift.
"""

from __future__ import annotations

import pytest
from pythoness.wire import (
    BBox,
    PageLocator,
    PageSize,
    QueryLocator,
    SchemaLocator,
    wire_named,
)

from parnassix_pipeline.report import SCHEMA_VERSION, ContractError, SourceRef
from parnassix_pipeline.wire import WIRE_NAME, ReportSchemaWire

WIRE_KEYS = {
    "documentId",
    "nodeId",
    "page",
    "bbox",
    "coordOrigin",
    "pageSize",
    "quotedText",
}
REQUIRED = {"documentId", "nodeId", "page", "bbox", "coordOrigin"}


@pytest.fixture
def wire() -> ReportSchemaWire:
    return ReportSchemaWire()


@pytest.fixture
def locator() -> PageLocator:
    return PageLocator(
        page=3,
        bbox=(BBox(left=78.0, top=126.8, right=533.6, bottom=148.1),),
        coord_origin="topleft",
        page_size=PageSize(width=612.0, height=792.0),
        quoted_text="the liability cap",
    )


def test_a_ref_validates_against_the_generated_contract(wire, locator):
    """The guarantee that is new.

    Not "the keys look right" -- the dict is parsed by the Pydantic model
    generated from `packages/report-schema/schema/report-schema.json`. If the
    Zod source changes shape, this fails on the next build rather than in the
    renderer.
    """
    ref = wire.source_ref(locator, document_id="agreement.pdf:9f3a", node_id="n1")
    parsed = SourceRef.model_validate(ref)
    assert parsed.page == 3
    assert parsed.document_id == "agreement.pdf:9f3a"


def test_the_key_set_is_exactly_the_contract_keys(wire, locator):
    """A new key is as much a break as a renamed one for a strict consumer."""
    ref = wire.source_ref(locator, document_id="d", node_id="n")
    assert set(ref) <= WIRE_KEYS
    assert set(ref) >= REQUIRED
    for box in ref["bbox"]:
        assert set(box) == {"l", "t", "r", "b"}


def test_optional_fields_are_omitted_rather_than_nulled(wire):
    bare = PageLocator(
        page=1,
        bbox=(BBox(left=0.0, top=1.0, right=2.0, bottom=3.0),),
        coord_origin="topleft",
    )
    ref = wire.source_ref(bare, document_id="d", node_id="n")
    assert "pageSize" not in ref
    assert "quotedText" not in ref


def test_the_wire_reports_the_contract_version(wire):
    """What lands in index metadata is the version of the CONTRACT a corpus was
    built against — the thing that can change under this app."""
    assert wire.version == SCHEMA_VERSION
    assert SCHEMA_VERSION != "unknown", (
        "the schema was not copied into the package; run "
        "`pnpm --filter python-pipeline build`"
    )


def test_a_bottomleft_box_without_a_page_size_is_refused(wire):
    """The rule JSON Schema cannot state, applied at ingestion.

    A bottomleft box with no pageSize cannot be flipped into the renderer's
    space, so it is a citation that will silently not draw. Catching it here is
    the difference between a loud failure in a pipeline run and a missing
    highlight nobody notices.
    """
    unflippable = PageLocator(
        page=1,
        bbox=(BBox(left=1.0, top=100.0, right=2.0, bottom=90.0),),
        coord_origin="bottomleft",
        page_size=None,
    )
    with pytest.raises(ContractError, match="pageSize"):
        wire.source_ref(unflippable, document_id="d", node_id="n")


@pytest.mark.parametrize(
    "locator",
    [
        SchemaLocator(source_id="db", table="invoices"),
        QueryLocator(query_id="q_1", source_id="db", sql="SELECT 1"),
    ],
    ids=["schema", "query"],
)
def test_locator_kinds_the_contract_cannot_spell_are_refused(wire, locator):
    """Deliberate, and not a gap to fill in later.

    `SourceRef` in `packages/report-schema/src/source.ts` is a document, a page
    and boxes. Inventing a camelCase spelling for a table or a recorded query
    would emit something the renderer's validator rejects -- and it would reject
    it after a corpus had been built. If Parnassix ever needs a database source,
    the Zod contract grows a variant first and this class follows it.
    """
    with pytest.raises(TypeError, match="describes pages only"):
        wire.source_ref(locator, document_id="d", node_id="n")


def test_the_wire_is_nameable_from_a_config_file(wire):
    """Importing this package is what makes `wire = "report-schema"` resolve."""
    assert wire_named(WIRE_NAME).version == SCHEMA_VERSION


def test_a_corpus_can_be_built_on_it():
    from pythoness.conf import CorpusSpec
    from pythoness.corpus import Corpus

    corpus = Corpus.from_spec(CorpusSpec(name="parnassix", wire=WIRE_NAME))
    assert corpus.wire.version == SCHEMA_VERSION
    assert corpus.to_spec().wire == WIRE_NAME


# -- over a real document ---------------------------------------------------


def test_every_ref_from_a_real_conversion_satisfies_the_contract(fragments):
    """End to end, because the shape coupling this replaces was invisible.

    A unit test over a hand-built locator proves the mapping; running a real PDF
    through the library and validating everything that comes out is what proves
    the two halves still fit.
    """
    wire = ReportSchemaWire()
    assert fragments

    refs = [
        wire.source_ref(loc, document_id=f.document_id, node_id=f.id)
        for f in fragments
        for loc in f.locators
    ]
    assert refs, "the sample produced no provenance at all"

    for ref in refs:
        parsed = SourceRef.model_validate(ref)
        assert parsed.page >= 1
        assert parsed.bbox
        assert set(ref) <= WIRE_KEYS


def test_coordinates_never_reach_the_text_a_model_sees(fragments):
    """The rule this repo exists for, asserted on this side of the boundary too.

    `pythoness` pins it structurally -- a Fragment keeps locators in a different
    field from its text. Asserting it here as well costs one loop and covers the
    case where this app's own wiring puts them back.
    """
    for fragment in fragments:
        for needle in ("bbox", "coordOrigin", "pageSize", "documentId"):
            assert needle not in fragment.text
