"""A bad document must not lose the batch.

The failure this pins is not a crash but a *silent shortfall*: a run over a
thousand documents that stops on number three, or — worse — reports success
having skipped some. Both end with a corpus that answers questions confidently
using a fraction of the evidence.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from aneural_pipeline.config import CorpusConfig, get_settings
from aneural_pipeline.ingest import ConversionOptions, OcrEngineChoice
from aneural_pipeline.ingest.pipeline import FailedDocument, IngestReport, ingest
from aneural_pipeline.models.registry import (
    EMBEDDING_MODELS,
    load_catalog_overrides,
    resolve_embedding_model,
)

SAMPLE = Path(__file__).resolve().parents[1] / "samples" / "sample-agreement.pdf"


def test_a_missing_document_does_not_abort_the_batch(tmp_path, monkeypatch):
    """The good documents still land; the bad one is named."""
    if not SAMPLE.is_file():
        pytest.skip("fixture missing")

    missing = tmp_path / "does-not-exist.pdf"

    # Stop before the embedding step: this is about the conversion loop, and it
    # should not need Ollama or Redis to be running.
    import aneural_pipeline.ingest.pipeline as pipeline

    captured: dict = {}

    class FakeStore:
        def __init__(self, *a, **k): ...
        def drop(self): ...
        def vector_store(self, overwrite=False):
            raise AssertionError("should not index when only failures remain")

    monkeypatch.setattr(pipeline, "CorpusStore", FakeStore)
    monkeypatch.setattr(
        pipeline, "VectorStoreIndex", lambda *a, **k: captured.setdefault("indexed", a)
    )
    monkeypatch.setattr(pipeline, "build_embedding", lambda *a, **k: object())
    monkeypatch.setattr(
        pipeline,
        "StorageContext",
        type("SC", (), {"from_defaults": staticmethod(lambda **k: None)}),
    )

    class OkStore(FakeStore):
        def vector_store(self, overwrite=False):
            return None

    monkeypatch.setattr(pipeline, "CorpusStore", OkStore)

    report = ingest(
        [missing, SAMPLE],
        CorpusConfig.build("resilience-test"),
        get_settings(),
        "0.0.0",
    )

    assert len(report.failures) == 1
    assert report.failures[0].error_type == "FileNotFoundError"
    assert "does-not-exist" in report.failures[0].path
    # The good document still made it through.
    assert len(report.documents) == 1
    assert report.node_count > 0
    # And the run refuses to describe itself as clean.
    assert report.ok is False
    assert "1 FAILED" in report.summary()


def test_report_is_ok_only_when_everything_landed():
    report = IngestReport(corpus="c", index_name="i", embedding_model="m")
    report.documents.append("doc-1")
    report.node_count = 5
    assert report.ok

    report.failures.append(FailedDocument(path="x", error="boom", error_type="OSError"))
    assert not report.ok
    assert report.attempted == 2


def test_a_document_that_yields_no_text_is_reported_not_silently_skipped():
    """The scanned-PDF-without-OCR case.

    It raises nothing and indexes nothing, which without this check looks
    exactly like a successful ingest of a document that happens to answer no
    question.
    """
    report = IngestReport(corpus="c", index_name="i", embedding_model="m")
    report.empty_documents.append("/docs/scan.pdf")
    assert not report.ok
    assert "no text" in report.summary()


def test_ocr_engine_choice_changes_the_conversion_cache_key():
    """A better engine must not be served a conversion made by a worse one."""
    a = ConversionOptions(ocr=True, ocr_engine=OcrEngineChoice.NATIVE)
    b = ConversionOptions(ocr=True, ocr_engine=OcrEngineChoice.RAPID)
    off = ConversionOptions(ocr=False)
    assert a.fingerprint() != b.fingerprint() != off.fingerprint()
    assert "native" in a.fingerprint()


def test_full_page_ocr_is_part_of_the_cache_key():
    a = ConversionOptions(ocr=True, force_full_page_ocr=True)
    b = ConversionOptions(ocr=True, force_full_page_ocr=False)
    assert a.fingerprint() != b.fingerprint()


def test_catalog_override_adds_a_model(tmp_path, monkeypatch):
    catalog = tmp_path / "models.json"
    catalog.write_text(
        json.dumps(
            {
                "embedding": {
                    "my-finetune": {
                        "provider": "openai-compatible",
                        "dimension": 1024,
                        "max_tokens": 8192,
                        "base_url": "http://gpu-rig:8000/v1",
                    }
                }
            }
        )
    )
    monkeypatch.setenv("ANEURAL_MODEL_CATALOG", str(catalog))
    try:
        model = resolve_embedding_model("my-finetune")
        assert model.dimension == 1024
        assert model.base_url == "http://gpu-rig:8000/v1"
        # It must be distinguishable in an index name like any other model.
        assert "1024" in model.index_suffix
    finally:
        EMBEDDING_MODELS.pop("my-finetune", None)


def test_catalog_override_refuses_an_embedding_without_a_dimension(tmp_path, monkeypatch):
    """Dimension cannot be defaulted: a wrong one fails only at query time."""
    catalog = tmp_path / "bad.json"
    catalog.write_text(json.dumps({"embedding": {"nope": {"provider": "ollama"}}}))
    monkeypatch.setenv("ANEURAL_MODEL_CATALOG", str(catalog))
    with pytest.raises(ValueError, match="dimension"):
        load_catalog_overrides()


def test_a_missing_catalog_file_is_an_error_not_a_shrug(tmp_path, monkeypatch):
    """Silently ignoring it would run the whole corpus on the wrong models."""
    monkeypatch.setenv("ANEURAL_MODEL_CATALOG", str(tmp_path / "absent.json"))
    with pytest.raises(FileNotFoundError):
        load_catalog_overrides()
