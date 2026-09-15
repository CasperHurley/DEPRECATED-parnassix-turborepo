"""The Redis vector index, and the metadata that makes a mismatch fail loudly.

CLAUDE.md: "Model name and dimension are stored in index metadata so a mismatch
fails loudly — indexes are not portable across embedding models." That rule is
implemented here, in two layers:

* The index NAME embeds the model identity (see `CorpusConfig.index_name`), so
  two models cannot collide on one index in the first place.
* A sidecar metadata key records what built the index, so an index created by an
  older run under different settings is detected on open rather than queried
  against and quietly trusted.
"""

from __future__ import annotations

import contextlib
import json
import logging
from dataclasses import asdict, dataclass
from typing import Any

import redis
from llama_index.core.schema import TextNode
from llama_index.core.vector_stores.types import BasePydanticVectorStore
from llama_index.vector_stores.redis import RedisVectorStore
from redisvl.schema import IndexSchema

from ..config import CorpusConfig, Settings

log = logging.getLogger(__name__)

_METADATA_KEY_PREFIX = "aneural:index-meta:"


@dataclass(frozen=True)
class IndexMetadata:
    """What built an index. Compared on open; a mismatch is an error."""

    corpus: str
    embedding_model: str
    embedding_provider: str
    dimension: int
    schema_version: str

    def conflicts_with(self, other: IndexMetadata) -> list[str]:
        """Differences that make the two incompatible.

        `schema_version` is deliberately NOT in this list. A contract version
        bump changes the shape of what is emitted from the index, not the
        vectors inside it, so it does not invalidate an index — it is recorded
        for diagnosis only.
        """
        return [
            f"{field}: index has {getattr(other, field)!r}, config wants {getattr(self, field)!r}"
            for field in ("embedding_model", "embedding_provider", "dimension")
            if getattr(self, field) != getattr(other, field)
        ]


def _schema(config: CorpusConfig) -> IndexSchema:
    """Declare the index fields explicitly rather than letting them be inferred.

    Inference builds the schema from whatever the first batch of nodes happened
    to contain, which makes the filterable field set depend on ingestion order.
    Naming the fields makes "filter by page" work on an empty index and fail at
    startup if a field is dropped, instead of returning zero results later.
    """
    return IndexSchema.from_dict(
        {
            "index": {
                "name": config.index_name,
                "prefix": f"{config.index_name}/vector",
                "key_separator": ":",
                "storage_type": "hash",
            },
            "fields": [
                {"name": "id", "type": "tag"},
                {"name": "doc_id", "type": "tag"},
                {"name": "text", "type": "text"},
                {"name": "document_id", "type": "tag"},
                {"name": "source_file", "type": "tag"},
                {"name": "headings", "type": "text"},
                # Provenance. Stored, never indexed for search: it is a payload
                # to hand back, and indexing a blob of coordinates would be cost
                # with no query behind it.
                {"name": "source_refs", "type": "text"},
                # Denormalized out of source_refs so page filtering is a numeric
                # range query rather than a scan-and-parse.
                {"name": "page_start", "type": "numeric"},
                {"name": "page_end", "type": "numeric"},
                {"name": "has_provenance", "type": "numeric"},
                {
                    "name": "vector",
                    "type": "vector",
                    "attrs": {
                        "dims": config.embedding.dimension,
                        "algorithm": "hnsw",
                        "distance_metric": "cosine",
                        "datatype": "float32",
                    },
                },
            ],
        }
    )


class CorpusStore:
    """A corpus's Redis index plus the guard rails around opening it."""

    def __init__(self, config: CorpusConfig, settings: Settings, schema_version: str):
        self.config = config
        self.settings = settings
        self.schema_version = schema_version
        self._client = redis.Redis.from_url(settings.redis_url)

    @property
    def metadata_key(self) -> str:
        return f"{_METADATA_KEY_PREFIX}{self.config.index_name}"

    def expected_metadata(self) -> IndexMetadata:
        return IndexMetadata(
            corpus=self.config.name,
            embedding_model=self.config.embedding.name,
            embedding_provider=self.config.embedding.provider.value,
            dimension=self.config.embedding.dimension,
            schema_version=self.schema_version,
        )

    def stored_metadata(self) -> IndexMetadata | None:
        raw = self._client.get(self.metadata_key)
        if not raw:
            return None
        try:
            return IndexMetadata(**json.loads(raw))
        except (TypeError, ValueError, KeyError):
            log.warning("index metadata at %s is unreadable", self.metadata_key)
            return None

    def record_metadata(self) -> None:
        self._client.set(self.metadata_key, json.dumps(asdict(self.expected_metadata())))

    def verify(self) -> None:
        """Refuse to use an index that was built by a different model.

        Without this the failure is not an error but a silent quality collapse:
        vectors of the right WIDTH from the wrong MODEL still produce cosine
        distances, still rank, and still return confident nonsense.
        """
        stored = self.stored_metadata()
        if stored is None:
            return  # New index, or one from before metadata was recorded.
        conflicts = self.expected_metadata().conflicts_with(stored)
        if conflicts:
            raise ValueError(
                f"Index {self.config.index_name!r} was built with different settings:\n  "
                + "\n  ".join(conflicts)
                + "\nReindex the corpus, or point at the index that matches."
            )

    def vector_store(self, overwrite: bool = False) -> BasePydanticVectorStore:
        self.verify()
        store = RedisVectorStore(
            schema=_schema(self.config),
            redis_client=self._client,
            overwrite=overwrite,
        )
        self.record_metadata()
        return store

    def stats(self) -> dict[str, Any]:
        try:
            info = self._client.ft(self.config.index_name).info()
        except redis.ResponseError:
            return {"exists": False, "index": self.config.index_name}
        def decode(value):
            return value.decode() if isinstance(value, bytes) else value

        # FT.INFO comes back as a flat [key, value, key, value, ...] list on
        # some client versions and a dict on others.
        if isinstance(info, list):
            raw = {
                decode(k): decode(v)
                for k, v in zip(info[::2], info[1::2], strict=False)
            }
        else:
            raw = info
        return {
            "exists": True,
            "index": self.config.index_name,
            "documents": raw.get("num_docs", raw.get("num_records")),
            "metadata": asdict(self.stored_metadata()) if self.stored_metadata() else None,
        }

    def drop(self) -> None:
        """Delete the index and its records. Used by `reindex`."""
        with contextlib.suppress(redis.ResponseError):
            self._client.ft(self.config.index_name).dropindex(delete_documents=True)
        self._client.delete(self.metadata_key)

    def node_by_id(self, node_id: str) -> TextNode | None:
        """Resolve a node id back to its stored node.

        This is the deterministic half of citation: an agent names a node id and
        the pipeline — not the model — produces the provenance for it. See
        `retrieval.citations`.
        """
        key = f"{self.config.index_name}/vector:{node_id}"
        raw = self._client.hgetall(key)
        if not raw:
            return None
        decoded = {
            (k.decode() if isinstance(k, bytes) else k): v
            for k, v in raw.items()
        }

        def text_of(field: str) -> str:
            value = decoded.get(field, b"")
            return value.decode("utf-8", "replace") if isinstance(value, bytes) else str(value)

        content = text_of("text")
        metadata: dict[str, Any] = {}
        for field in ("document_id", "source_file", "source_refs", "headings"):
            if field in decoded:
                metadata[field] = text_of(field)
        for field in ("page_start", "page_end", "has_provenance"):
            if field in decoded:
                with contextlib.suppress(ValueError):
                    metadata[field] = int(float(text_of(field)))
        return TextNode(id_=node_id, text=content, metadata=metadata)
