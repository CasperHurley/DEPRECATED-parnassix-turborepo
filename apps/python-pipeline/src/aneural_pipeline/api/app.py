"""HTTP surface, consumed by apps/api-client (NestJS).

Deliberately thin. NestJS owns the public boundary and its validation; this
service is internal, and its job is to be the only thing that ever produces a
`SourceRef`. Note what it does NOT expose: any endpoint that accepts coordinates
from a caller. Provenance is produced here or it does not exist.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from ..config import CorpusConfig, Settings, get_settings
from ..hardware import detect_machine
from ..index import CorpusStore, build_cache, cache_lookup, cache_store
from ..report import SCHEMA_VERSION
from ..retrieval import CorpusRetriever

log = logging.getLogger(__name__)

# Retrievers hold an embedding client and an open index handle; rebuilding one
# per request would reload the embedding model on every call.
_retrievers: dict[str, CorpusRetriever] = {}
_caches: dict[str, Any] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    _retrievers.clear()
    _caches.clear()


app = FastAPI(
    title="Aneural document pipeline",
    version=SCHEMA_VERSION,
    lifespan=lifespan,
)


class QueryRequest(BaseModel):
    question: str = Field(min_length=1)
    corpus: str = "default"
    embedding_model: str | None = None
    top_k: int = Field(default=5, ge=1, le=50)
    min_score: float | None = Field(
        default=None,
        description=(
            "Similarity floor. Passages below it are dropped rather than returned, "
            "so the caller gets nothing instead of the least-bad chunk."
        ),
    )
    documents: list[str] | None = None
    use_cache: bool = True


class ResolveRequest(BaseModel):
    node_ids: list[str] = Field(min_length=1)
    corpus: str = "default"
    embedding_model: str | None = None


def _config(corpus: str, embedding_model: str | None) -> CorpusConfig:
    return CorpusConfig.build(corpus, embedding_model=embedding_model)


def _retriever(config: CorpusConfig, settings: Settings) -> CorpusRetriever:
    key = config.index_name
    if key not in _retrievers:
        _retrievers[key] = CorpusRetriever(config, settings, SCHEMA_VERSION)
    return _retrievers[key]


@app.get("/health")
def health(settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    machine = detect_machine()
    return {
        "status": "ok",
        "schemaVersion": SCHEMA_VERSION,
        "machine": {
            "tier": machine.tier.value,
            "cpu": machine.cpu,
            "memoryGb": round(machine.total_memory_gb),
        },
    }


@app.get("/corpora/{corpus}")
def corpus_info(
    corpus: str,
    embedding_model: str | None = None,
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    config = _config(corpus, embedding_model)
    return CorpusStore(config, settings, SCHEMA_VERSION).stats()


@app.post("/query")
def query(
    request: QueryRequest, settings: Settings = Depends(get_settings)
) -> dict[str, Any]:
    """Retrieve passages with citations resolved.

    The semantic cache stores the answer AND its citations as one payload. They
    are not re-resolved on a cache hit, deliberately: an answer and the evidence
    for it are a single artifact, and resolving citations fresh against a corpus
    that may have been reindexed since would let the two disagree.
    """
    config = _config(request.corpus, request.embedding_model)

    cache = None
    if request.use_cache:
        if config.index_name not in _caches:
            _caches[config.index_name] = build_cache(config, settings)
        cache = _caches[config.index_name]
        hit = cache_lookup(cache, request.question)
        if hit is not None:
            return hit

    try:
        retriever = _retriever(config, settings)
        passages = retriever.retrieve(
            request.question,
            top_k=request.top_k,
            min_score=request.min_score,
            documents=request.documents,
        )
    except ValueError as exc:  # index/model mismatch, raised by CorpusStore.verify
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    payload: dict[str, Any] = {
        "question": request.question,
        "corpus": request.corpus,
        "embeddingModel": config.embedding.name,
        "passages": [p.as_dict() for p in passages],
        # Surfaced rather than inferred by the caller. A caller that cannot tell
        # "nothing matched" from "matches exist but none can be cited" will
        # eventually present the second as the first.
        "citable": sum(1 for p in passages if p.is_citable),
        "uncitable": sum(1 for p in passages if not p.is_citable),
        "_cache": {"hit": False},
    }

    if request.use_cache:
        cache_store(cache, request.question, payload)
    return payload


@app.post("/citations/resolve")
def resolve(
    request: ResolveRequest, settings: Settings = Depends(get_settings)
) -> dict[str, Any]:
    """Turn node ids into provenance.

    This is the endpoint that keeps citation deterministic. An agent picks node
    ids out of retrieved context; this resolves them from the index. The agent
    never handles a coordinate, so it cannot corrupt one, and an id it invented
    comes back under `unresolved` instead of becoming a well-formed citation
    pointing at the wrong place.
    """
    config = _config(request.corpus, request.embedding_model)
    try:
        return _retriever(config, settings).resolve_citations(request.node_ids)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
