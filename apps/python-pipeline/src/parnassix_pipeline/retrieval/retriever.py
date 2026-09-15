"""Retrieval, and the resolution of node ids back into citations.

The design rule this module implements is the one in CLAUDE.md: "Citations in
chat are structural, not textual... The model can be wrong; it cannot
manufacture a reference to a document that isn't in the corpus. **This is the
anti-hallucination mechanism and it cannot be replaced by prompting.**"

Concretely, that rules out the obvious design — telling the LLM to copy `bbox`
floats out of the context into its JSON output. A model asked to copy numbers
verbatim will usually copy them, and "usually" is not a property you can build
a legal citation on. It can transpose a digit, average two boxes, or attach page
4's coordinates to page 5's sentence, and every one of those failures produces
output that VALIDATES — a well-formed citation pointing at the wrong region.

So the model never sees coordinates (`nodes.PROVENANCE_KEYS` excludes them from
the LLM's view) and never emits them. It emits a `nodeId`, which is a value it
either retrieved or did not. `resolve_citations` then turns ids into provenance
from the index. An invented id resolves to nothing and is reported as
unresolvable, which is a visible failure instead of a plausible one.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from llama_index.core import VectorStoreIndex
from llama_index.core.schema import NodeWithScore
from llama_index.core.vector_stores.types import (
    FilterOperator,
    MetadataFilter,
    MetadataFilters,
)

from ..config import CorpusConfig, Settings
from ..index import CorpusStore
from ..ingest.nodes import source_refs_of
from ..models import build_embedding

log = logging.getLogger(__name__)


@dataclass
class Passage:
    """One retrieved chunk, with the citations that back it already resolved."""

    node_id: str
    text: str
    score: float | None
    document_id: str
    source_file: str
    headings: str
    source_refs: list[dict[str, Any]] = field(default_factory=list)

    @property
    def is_citable(self) -> bool:
        return bool(self.source_refs)

    def as_dict(self) -> dict[str, Any]:
        return {
            "nodeId": self.node_id,
            "text": self.text,
            "score": self.score,
            "documentId": self.document_id,
            "sourceFile": self.source_file,
            "headings": self.headings,
            "sourceRefs": self.source_refs,
            "citable": self.is_citable,
        }


def _to_passage(scored: NodeWithScore) -> Passage:
    node = scored.node
    return Passage(
        node_id=node.node_id,
        text=node.get_content(),
        score=scored.score,
        document_id=node.metadata.get("document_id", ""),
        source_file=node.metadata.get("source_file", ""),
        headings=node.metadata.get("headings", ""),
        source_refs=source_refs_of(node),  # type: ignore[arg-type]
    )


class CorpusRetriever:
    """Query one corpus and get back passages that can be cited."""

    def __init__(self, config: CorpusConfig, settings: Settings, schema_version: str):
        self.config = config
        self.settings = settings
        self.store = CorpusStore(config, settings, schema_version)
        self._embedding = build_embedding(config.embedding, settings)
        self._index: VectorStoreIndex | None = None

    def _ensure_index(self) -> VectorStoreIndex:
        if self._index is None:
            self._index = VectorStoreIndex.from_vector_store(
                self.store.vector_store(),
                embed_model=self._embedding,
            )
        return self._index

    def retrieve(
        self,
        question: str,
        *,
        top_k: int = 5,
        min_score: float | None = None,
        documents: list[str] | None = None,
        pages: tuple[int, int] | None = None,
    ) -> list[Passage]:
        """Retrieve passages for a question.

        `min_score` implements CLAUDE.md's "Strict Retrieval Filtering" note: it
        is better to return nothing and say so than to return the least-bad
        chunk in the corpus and let a report be built on it. The threshold is a
        SIMILARITY here (higher is closer), matching LlamaIndex's convention and
        deliberately not the semantic cache's distance convention — the two are
        different libraries and silently reinterpreting one as the other is an
        easy and expensive mistake.
        """
        filters: list[MetadataFilter] = []
        if documents:
            filters.append(
                MetadataFilter(key="document_id", value=documents, operator=FilterOperator.IN)
            )
        if pages:
            low, high = pages
            filters.append(
                MetadataFilter(key="page_end", value=low, operator=FilterOperator.GTE)
            )
            filters.append(
                MetadataFilter(key="page_start", value=high, operator=FilterOperator.LTE)
            )

        retriever = self._ensure_index().as_retriever(
            similarity_top_k=top_k,
            filters=MetadataFilters(filters=filters) if filters else None,
        )
        passages = [_to_passage(s) for s in retriever.retrieve(question)]

        if min_score is not None:
            kept = [p for p in passages if p.score is not None and p.score >= min_score]
            if len(kept) != len(passages):
                log.info(
                    "dropped %d passage(s) below similarity %.2f",
                    len(passages) - len(kept),
                    min_score,
                )
            passages = kept

        uncitable = [p for p in passages if not p.is_citable]
        if uncitable:
            # Not filtered out — CLAUDE.md: "Gaps are rendered, not omitted."
            # The caller is told so it can mark them, not so it can hide them.
            log.warning(
                "%d of %d retrieved passages carry no provenance",
                len(uncitable),
                len(passages),
            )
        return passages

    def resolve_citations(self, node_ids: list[str]) -> dict[str, Any]:
        """Turn node ids into provenance, server-side.

        This is the function the structured-output layer calls with whatever ids
        an agent emitted. Ids that do not exist come back in `unresolved` rather
        than being dropped, because a citation that silently vanishes is
        indistinguishable from a fact that was never cited — and the whole point
        is to be able to tell those apart.
        """
        resolved: dict[str, list[dict[str, Any]]] = {}
        unresolved: list[str] = []

        for node_id in dict.fromkeys(node_ids):  # de-dupe, keep order
            node = self.store.node_by_id(node_id)
            if node is None:
                unresolved.append(node_id)
                continue
            refs = source_refs_of(node)
            if not refs:
                unresolved.append(node_id)
                continue
            resolved[node_id] = refs

        if unresolved:
            log.warning("%d node id(s) did not resolve: %s", len(unresolved), unresolved)
        return {"resolved": resolved, "unresolved": unresolved}
