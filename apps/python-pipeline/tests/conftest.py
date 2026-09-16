from __future__ import annotations

from pathlib import Path

import pytest

SAMPLE = Path(__file__).resolve().parents[1] / "samples" / "sample-agreement.pdf"
CACHE = Path(__file__).resolve().parents[1] / ".parnassix-cache"


@pytest.fixture(scope="session")
def fragments():
    """The sample document, as `pythoness` fragments.

    Note what this fixture no longer has to do. It used to import
    `parnassix_pipeline.ingest` and drive a converter this app owned; now it
    calls a library, and everything below the `Fragment` boundary -- Docling,
    the conversion cache, the coordinate flip, stable ids -- is tested in
    `pythoness` rather than here. What is left to test in this repo is the
    contract, which is the only part that is Parnassix's.
    """
    from pythoness.sources import DirectorySource, FragmentContext
    from pythoness.sources.base import SourceUnit

    from parnassix_pipeline.wire import ReportSchemaWire

    if not SAMPLE.is_file():
        pytest.skip("run scripts/make_sample_pdf.py to build the fixture")

    source = DirectorySource(SAMPLE.parent)
    unit = SourceUnit(
        id=SAMPLE.name, display_name=SAMPLE.name, fingerprint="x", payload=SAMPLE
    )
    ctx = FragmentContext(wire=ReportSchemaWire(), max_tokens=512, cache_dir=CACHE)
    return list(source.fragments(unit, ctx))
