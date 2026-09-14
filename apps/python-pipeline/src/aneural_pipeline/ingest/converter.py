"""PDF (and friends) -> `DoclingDocument`, with a cache and an OCR decision.

Conversion is by far the slowest step — layout models run over every page — and
it is also completely deterministic for given options. Caching it is what makes
re-embedding a corpus under a different model cheap enough to actually compare
models, which is the whole reason the registry has more than one entry.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
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


@dataclass(frozen=True)
class ConversionOptions:
    """What to ask Docling for.

    `ocr` is off by default because it roughly triples conversion time and does
    nothing for the digital PDFs that dominate most corpora. It is not off
    because scanned documents are rare — they are not, in evidentiary work — so
    sparse output is detected and reported rather than passed over silently.
    """

    ocr: bool = False
    table_structure: bool = True

    def fingerprint(self) -> str:
        return f"ocr={int(self.ocr)},tables={int(self.table_structure)}"


def _converter(options: ConversionOptions) -> DocumentConverter:
    pipeline_options = PdfPipelineOptions()
    pipeline_options.do_ocr = options.ocr
    pipeline_options.do_table_structure = options.table_structure
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
