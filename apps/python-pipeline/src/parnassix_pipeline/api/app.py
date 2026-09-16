"""HTTP surface, consumed by apps/api-client (NestJS).

Almost all of this is `pythoness`. `build_routes` mounts the library's whole
tool registry -- search, citation resolution, sync, the SQL tools -- so this
app does not describe, validate or version a single one of them. What is left
below is the part that is actually about reports.

Deliberately thin, for the same reason it always was: NestJS owns the public
boundary and its validation; this service is internal, and its job is to be the
only thing that ever produces a `SourceRef`. Note what it does NOT expose: any
endpoint that accepts coordinates from a caller. Provenance is produced here or
it does not exist.

The wire is `ReportSchemaWire`, bound to the corpus in `pythoness.toml`. That is
the whole of the integration: the library establishes where a fact came from,
this app decides what those fields are called and checks the result against
`@repo/report-schema`.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from pythoness.api.app import build_routes, configure, configure_cors
from pythoness.conf import find_config, settings_from

from ..report import SCHEMA_VERSION, ContractError, time_span_issues, validate_source_ref
from ..wire import ReportSchemaWire  # noqa: F401  (registers the "report-schema" wire)

log = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Point the library's routes at this project's config.

    Done here rather than left to the library's own discovery because this
    service is started by a process manager from an arbitrary directory, and
    "walk up from the working directory" would find whatever is above it.
    """
    resolved = find_config()
    configure(resolved.config, settings_from(resolved.config.settings))
    log.info("serving %s", resolved.describe())
    yield


app = FastAPI(
    title="Parnassix document pipeline",
    version=SCHEMA_VERSION,
    summary="pythoness, wearing the report-schema contract.",
    lifespan=lifespan,
)

build_routes(app)


# -- the Parnassix-only half -----------------------------------------------


class SourceRefRequest(BaseModel):
    ref: dict[str, Any]


class TimeSpanRequest(BaseModel):
    span: dict[str, Any] = Field(
        description="A TimeSpan as the wire carries it, camelCase."
    )


@app.get("/contract", operation_id="contract")
def contract() -> dict[str, Any]:
    """Which version of `@repo/report-schema` this service was built against."""
    return {"schemaVersion": SCHEMA_VERSION, "wire": ReportSchemaWire().version}


@app.post("/contract/source-ref", operation_id="validate_source_ref")
def check_source_ref(request: SourceRefRequest) -> dict[str, Any]:
    """Validate one citation against the contract and the rules it cannot state.

    Exposed because the agent workflow layer needs the same check the ingestion
    path applies, and a second implementation of it in NestJS is how the two
    would come to disagree.
    """
    try:
        validate_source_ref(request.ref)
    except (ContractError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"ok": True}


@app.post("/contract/time-span", operation_id="validate_time_span")
def check_time_span(request: TimeSpanRequest) -> dict[str, Any]:
    """Report every problem with a period, not just the first.

    Issues rather than an exception: this is the endpoint an agent retry loop
    calls, and a loop that is told one problem at a time takes one round trip
    per problem.
    """
    issues = time_span_issues(request.span)
    return {
        "ok": not issues,
        "issues": [{"message": i.message, "path": i.path} for i in issues],
    }


def serve(host: str = "127.0.0.1", port: int = 8000, reload: bool = False) -> None:
    import uvicorn
    from pythoness.config import get_settings

    configure_cors(app, get_settings().api_cors_origins)
    uvicorn.run(
        "parnassix_pipeline.api.app:app" if reload else app,
        host=host,
        port=port,
        reload=reload,
    )
