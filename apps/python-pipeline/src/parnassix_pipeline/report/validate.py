"""The contract rules that JSON Schema cannot carry.

From `packages/report-schema/src/primitives.ts`:

    The cross-field rules in `timeSpanIssues` are `superRefine`s, so - as with
    `precision` - they do **not** appear in the emitted artifact and
    `datamodel-code-generator` will not reproduce them. The Python side needs
    its own validator or a spec passes Pydantic and fails here.

This is that validator. It is a deliberate second implementation of rules that
already exist in TypeScript, which is a cost worth naming: two copies can drift.
The alternative is worse — without it, an agent emits a spec, Pydantic accepts
it, it crosses the wire, and the RENDERER rejects it, so the retry loop that is
supposed to catch agent mistakes never sees them. The tests pin the two
implementations to the same examples.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ._generated import SourceRef

_SCHEMA_PATH = (
    Path(__file__).resolve().parents[4].parents[0]
    / "packages"
    / "report-schema"
    / "schema"
    / "report-schema.json"
)


def _read_schema_version() -> str:
    """Read the contract version out of the committed artifact's `$id`.

    Taken from the artifact rather than hardcoded, so a version bump on the
    TypeScript side cannot leave a stale constant here claiming otherwise.
    """
    try:
        schema = json.loads(_SCHEMA_PATH.read_text())
        return str(schema.get("$id", "")).rsplit("/", 1)[-1] or "unknown"
    except (OSError, ValueError):
        return "unknown"


SCHEMA_VERSION = _read_schema_version()


class ContractError(ValueError):
    """A value that satisfies the JSON Schema but breaks a contract rule."""


@dataclass(frozen=True)
class Issue:
    message: str
    path: list[str]


# Mirrors SUB_DAY_PRECISIONS in primitives.ts.
_SUB_DAY = frozenset({"hour", "minute", "second"})
_FRACTIONAL = re.compile(r"\d{2}:\d{2}:\d{2}\.\d+")


def has_time_of_day(timestamp: str) -> bool:
    return "T" in timestamp


def has_fractional_seconds(timestamp: str) -> bool:
    return bool(_FRACTIONAL.search(timestamp))


def timestamp_supports_precision(timestamp: str, precision: str) -> bool:
    """Port of `timestampSupportsPrecision`.

    A date-only string cannot be known to the minute; claiming so is incoherent
    rather than merely imprecise.
    """
    if precision == "millisecond":
        return has_fractional_seconds(timestamp)
    if precision not in _SUB_DAY:
        return True
    return has_time_of_day(timestamp)


def time_span_issues(span: dict[str, Any]) -> list[Issue]:
    """Port of `timeSpanIssues`. Same rules, same messages, same paths.

    The ordering check that TypeScript does with `timestampInterval` is done
    here with a lexicographic comparison of the ISO strings. That is sound only
    because `TimestampSchema` has already constrained both values to ISO 8601 in
    the same two forms, where lexicographic order matches chronological order —
    EXCEPT across differing UTC offsets, which this deliberately does not try to
    resolve. A borderline pair with mixed offsets is left to the renderer's
    check rather than being wrongly rejected here.
    """
    issues: list[Issue] = []
    timestamp = span.get("timestamp")
    if not isinstance(timestamp, str):
        return [Issue("timestamp is required", ["timestamp"])]

    precision = span.get("precision") or "day"
    if not timestamp_supports_precision(timestamp, precision):
        issues.append(
            Issue(
                "precision is finer than the timestamp supports "
                "(no time-of-day component)",
                ["precision"],
            )
        )

    until = span.get("until")
    until_precision = span.get("untilPrecision")

    if until_precision is not None and until is None:
        issues.append(
            Issue("untilPrecision has no meaning without `until`", ["untilPrecision"])
        )

    if until is not None:
        if not timestamp_supports_precision(until, until_precision or "day"):
            issues.append(
                Issue(
                    "untilPrecision is finer than `until` supports "
                    "(no time-of-day component)",
                    ["untilPrecision"],
                )
            )
        # Only comparable when both carry the same offset convention; see above.
        if _same_offset(timestamp, until) and until < timestamp:
            issues.append(Issue("`until` is before the period starts", ["until"]))

    return issues


def _same_offset(a: str, b: str) -> bool:
    return _offset_token(a) == _offset_token(b)


def _offset_token(timestamp: str) -> str:
    if timestamp.endswith("Z"):
        return "Z"
    tail = timestamp[-6:]
    return tail if (tail.startswith(("+", "-")) and ":" in tail) else ""


def validate_time_span(span: dict[str, Any]) -> None:
    """Raise if a period says something incoherent about itself."""
    issues = time_span_issues(span)
    if issues:
        raise ContractError(
            "; ".join(f"{'.'.join(i.path)}: {i.message}" for i in issues)
        )


def validate_source_ref(ref: dict[str, Any]) -> SourceRef:
    """Validate one citation against the contract, plus the rules it cannot state.

    JSON Schema checks the field types. The extra check here is the one that
    matters for rendering: a `bottomleft` box with no `pageSize` cannot be
    flipped into the renderer's space, so it is a citation that will not draw.
    Catching it at ingestion is the difference between a loud failure in a
    pipeline run and a silently missing highlight in a report.
    """
    parsed = SourceRef.model_validate(ref)
    origin = getattr(parsed.coord_origin, "root", parsed.coord_origin)
    if str(origin) == "bottomleft" and parsed.bbox and parsed.page_size is None:
        raise ContractError(
            f"SourceRef for {parsed.document_id} page {parsed.page} has bottomleft "
            f"boxes but no pageSize; the renderer cannot flip it and the highlight "
            f"will not draw."
        )
    return parsed
