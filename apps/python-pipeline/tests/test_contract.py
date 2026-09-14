"""The cross-field rules JSON Schema cannot carry, pinned to the TS examples."""

from __future__ import annotations

import pytest

from aneural_pipeline.report import (
    SCHEMA_VERSION,
    ContractError,
    time_span_issues,
    validate_time_span,
)


def test_schema_version_is_read_from_the_committed_artifact():
    assert SCHEMA_VERSION != "unknown"
    assert SCHEMA_VERSION.count(".") == 2


def test_date_only_timestamp_cannot_claim_minute_precision():
    issues = time_span_issues({"timestamp": "2019-03-01", "precision": "minute"})
    assert any("finer than the timestamp" in i.message for i in issues)


def test_day_precision_on_a_date_is_fine():
    assert time_span_issues({"timestamp": "2019-03-01", "precision": "day"}) == []


def test_millisecond_precision_needs_written_fractional_seconds():
    """09:12:00 and 09:12:00.000 are the same instant but not the same claim."""
    assert time_span_issues(
        {"timestamp": "2019-03-01T09:12:00Z", "precision": "millisecond"}
    )
    assert (
        time_span_issues(
            {"timestamp": "2019-03-01T09:12:00.000Z", "precision": "millisecond"}
        )
        == []
    )


def test_until_precision_without_until_is_meaningless():
    issues = time_span_issues({"timestamp": "2019-03-01", "untilPrecision": "day"})
    assert any("untilPrecision has no meaning" in i.message for i in issues)


def test_until_before_start_is_rejected():
    issues = time_span_issues({"timestamp": "2019-05-01", "until": "2019-03-01"})
    assert any("before the period starts" in i.message for i in issues)


def test_validate_raises_on_an_incoherent_span():
    with pytest.raises(ContractError):
        validate_time_span({"timestamp": "2019-03-01", "precision": "second"})
