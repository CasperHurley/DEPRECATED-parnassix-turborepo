"""The wire contract, as Python sees it.

`_generated.py` is produced from `packages/report-schema/schema/report-schema.json`
and must not be edited. This package re-exports the useful names from it under
stable aliases, so the rest of the codebase is insulated from the codegen's
naming (which changes when the schema's shape changes).
"""

from ._generated import BBox, CoordOrigin, SourceRef, TimePrecision, TimeSpan
from .validate import (
    SCHEMA_VERSION,
    ContractError,
    time_span_issues,
    validate_source_ref,
    validate_time_span,
)

__all__ = [
    "SCHEMA_VERSION",
    "BBox",
    "ContractError",
    "CoordOrigin",
    "SourceRef",
    "TimePrecision",
    "TimeSpan",
    "time_span_issues",
    "validate_source_ref",
    "validate_time_span",
]
