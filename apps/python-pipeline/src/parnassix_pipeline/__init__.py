"""Parnassix's document pipeline: `pythoness` wearing the report-schema contract.

This package used to BE the pipeline -- conversion, chunking, provenance,
embeddings, a vector store, a semantic cache, hardware tiering and retrieval,
about 2,700 lines of it. None of that was specific to reports, or to evidentiary
work, or to Parnassix, so it is now the `pythoness` library and this is a
worked example of consuming it.

What remains is what a consumer actually has to write:

    wire.py     the project's own SourceRef spelling, validated against its
                own contract -- about 20 lines of code under its rationale
    report/     the contract itself: generated Pydantic models, plus the
                cross-field rules JSON Schema cannot carry
    api/        the library's tool routes, mounted, plus three report-specific
                endpoints
    cli.py      the report-specific commands; everything else is `pn`

That ratio is the point of the example.
"""

from .report import SCHEMA_VERSION
from .wire import ReportSchemaWire

__all__ = ["SCHEMA_VERSION", "ReportSchemaWire"]
