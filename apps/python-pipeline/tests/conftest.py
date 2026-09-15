from __future__ import annotations

from pathlib import Path

import pytest

from aneural_pipeline.ingest import convert

SAMPLE = Path(__file__).resolve().parents[1] / "samples" / "sample-agreement.pdf"
CACHE = Path(__file__).resolve().parents[1] / ".aneural-cache"


@pytest.fixture(scope="session")
def converted():
    """The sample document, converted once. Conversion is the slow step."""
    if not SAMPLE.is_file():
        pytest.skip("run scripts/make_sample_pdf.py to build the fixture")
    return convert(SAMPLE, cache_dir=CACHE)
