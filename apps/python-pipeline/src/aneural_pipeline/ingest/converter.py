"""PDF (and friends) -> `DoclingDocument`, with a cache and an OCR decision.

Conversion is by far the slowest step — layout models run over every page — and
it is also completely deterministic for given options. Caching it is what makes
re-embedding a corpus under a different model cheap enough to actually compare
models, which is the whole reason the registry has more than one entry.
"""

from __future__ import annotations

import hashlib
import logging
import platform
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling_core.types.doc import DoclingDocument

from .nodes import ConvertedDocument, prepare

log = logging.getLogger(__name__)

# Below this many characters per page, a PDF is probably scanned images and the
# text layer is decorative or absent. Conversion will have "succeeded" and
# produced almost nothing, which is the quiet failure worth shouting about:
# a corpus that indexed cleanly and contains no text answers every question with
# "not found in source documents" and looks like a retrieval problem.
_SPARSE_TEXT_CHARS_PER_PAGE = 100


class OcrEngineChoice(StrEnum):
    """Which OCR engine to use on image content.

    Engine choice is not a performance knob, it is an accuracy one, and the
    spread is large. Measured on a rasterized copy of the sample agreement:

        auto (RapidOCR)   "Eit   tn  (or t  n  y ts t r t the other party."
        ocrmac (Vision)   "Either party may terminate this Agreement for
                           convenience upon thirty (30) days written notice
                           to the other party."

    Same page, same pipeline. The first is unusable as evidence and would be
    embedded, retrieved and quoted as if it were fine — a citation pointing at
    a real region of a real page, containing text the document does not say.
    """

    AUTO = "auto"
    """Docling picks from what is installed. Prefer NATIVE below on macOS."""

    NATIVE = "native"
    """Apple's Vision framework via `ocrmac`. macOS only, no model download,
    and the only engine here with real handwriting support. Needs the `ocrmac`
    extra."""

    RAPID = "rapid"
    EASY = "easy"
    TESSERACT = "tesseract"


def _default_ocr_engine() -> OcrEngineChoice:
    """Prefer Apple Vision on macOS, because it is markedly better there.

    Falls back to AUTO elsewhere, or when `ocrmac` is not installed, so this is
    a preference rather than a requirement.
    """
    if platform.system() == "Darwin":
        try:
            import ocrmac  # noqa: F401

            return OcrEngineChoice.NATIVE
        except ImportError:
            log.debug("ocrmac not installed; falling back to auto OCR engine")
    return OcrEngineChoice.AUTO


@dataclass(frozen=True)
class ConversionOptions:
    """What to ask Docling for.

    `ocr` is off by default because it roughly triples conversion time and does
    nothing for the digital PDFs that dominate most corpora. It is not off
    because scanned documents are rare — they are not, in evidentiary work — so
    a document that converts to nothing is reported loudly rather than passed
    over (see `_warn_if_sparse`, and the `empty_documents` list on IngestReport).
    """

    ocr: bool = False
    ocr_engine: OcrEngineChoice | None = None
    """None means `_default_ocr_engine()`, chosen when the converter is built."""

    force_full_page_ocr: bool = False
    """OCR the whole page rather than only regions layout analysis marked as
    images. Needed when a scan carries a junk text layer — a common output of
    cheap scanning software — which otherwise suppresses OCR on text that is
    really a picture of text."""

    table_structure: bool = True

    def resolved_engine(self) -> OcrEngineChoice:
        return self.ocr_engine or _default_ocr_engine()

    def fingerprint(self) -> str:
        # Part of the conversion cache key, so changing the engine correctly
        # invalidates a cached conversion made with a worse one.
        engine = self.resolved_engine().value if self.ocr else "off"
        return (
            f"ocr={engine},full_page={int(self.force_full_page_ocr)},"
            f"tables={int(self.table_structure)}"
        )


def _ocr_options(options: ConversionOptions):
    """Build docling's OCR options for the chosen engine.

    An explicitly requested engine that is not installed raises rather than
    silently degrading: someone who asked for Vision and got RapidOCR would get
    the mangled transcription above and no indication why.
    """
    from docling.datamodel.pipeline_options import (
        EasyOcrOptions,
        OcrAutoOptions,
        OcrMacOptions,
        OcrMode,
        RapidOcrOptions,
        TesseractOcrOptions,
    )

    engine = options.resolved_engine()
    mode = OcrMode.FULL_PAGE if options.force_full_page_ocr else OcrMode.DEFAULT

    if engine is OcrEngineChoice.NATIVE:
        try:
            import ocrmac  # noqa: F401
        except ImportError as exc:
            raise ImportError(
                "OCR engine 'native' needs Apple's Vision bindings: "
                "uv sync --extra ocrmac (macOS only)."
            ) from exc
        # "accurate" over "fast": this is evidence, and the cost is seconds.
        return OcrMacOptions(recognition="accurate")

    if engine is OcrEngineChoice.RAPID:
        return RapidOcrOptions(mode=mode)
    if engine is OcrEngineChoice.EASY:
        return EasyOcrOptions()
    if engine is OcrEngineChoice.TESSERACT:
        return TesseractOcrOptions()
    return OcrAutoOptions(mode=mode)


def _converter(options: ConversionOptions) -> DocumentConverter:
    pipeline_options = PdfPipelineOptions()
    pipeline_options.do_ocr = options.ocr
    pipeline_options.do_table_structure = options.table_structure
    if options.ocr:
        pipeline_options.ocr_options = _ocr_options(options)
    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)
        }
    )


def _cache_key(path: Path, options: ConversionOptions) -> str:
    """Hash the file's CONTENT, not its path or mtime.

    A path-keyed cache goes stale the moment a document is edited in place, and
    an mtime-keyed one goes stale on any copy or checkout. Content hashing is the
    only version that cannot serve a stale conversion, and it is what makes the
    cache safe to keep across runs.
    """
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            digest.update(block)
    digest.update(options.fingerprint().encode())
    return digest.hexdigest()[:32]


def convert(
    path: str | Path,
    *,
    options: ConversionOptions | None = None,
    cache_dir: Path | None = None,
) -> ConvertedDocument:
    """Convert one document, reusing a cached conversion when the bytes match."""
    options = options or ConversionOptions()
    path = Path(path).resolve()
    if not path.is_file():
        raise FileNotFoundError(f"No such document: {path}")

    cache_path: Path | None = None
    if cache_dir is not None:
        cache_dir = Path(cache_dir)
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache_path = cache_dir / f"{_cache_key(path, options)}.docling.json"
        if cache_path.exists():
            try:
                doc = DoclingDocument.model_validate_json(cache_path.read_text())
                log.info("conversion cache hit: %s", path.name)
                return prepare(doc, str(path))
            except (ValueError, OSError) as exc:
                # A corrupt cache entry must never be fatal — it is a derived
                # artifact and reconversion always reproduces it.
                log.warning("discarding unreadable cache entry %s: %s", cache_path, exc)
                cache_path.unlink(missing_ok=True)

    log.info("converting %s (%s)", path.name, options.fingerprint())
    doc = _converter(options).convert(str(path)).document

    converted = prepare(doc, str(path))
    _warn_if_sparse(converted, options)

    if cache_path is not None:
        cache_path.write_text(doc.model_dump_json())

    return converted


def _warn_if_sparse(converted: ConvertedDocument, options: ConversionOptions) -> None:
    pages = max(converted.page_count, 1)
    chars = len(converted.doc.export_to_markdown())
    if chars / pages < _SPARSE_TEXT_CHARS_PER_PAGE and not options.ocr:
        log.warning(
            "%s yielded only %d characters across %d page(s). It is probably "
            "scanned; re-run with ocr enabled or it will index as empty.",
            Path(converted.source_path).name,
            chars,
            pages,
        )


def convert_all(
    paths: list[str | Path],
    *,
    options: ConversionOptions | None = None,
    cache_dir: Path | None = None,
) -> list[ConvertedDocument]:
    return [convert(p, options=options, cache_dir=cache_dir) for p in paths]
