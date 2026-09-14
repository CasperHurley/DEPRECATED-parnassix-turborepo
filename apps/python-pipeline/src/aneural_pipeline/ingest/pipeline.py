"""Ingestion: documents in, a queryable index with provenance out."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path

from docling_core.transforms.chunker import BaseChunker, HierarchicalChunker, HybridChunker
from llama_index.core import StorageContext, VectorStoreIndex

from ..config import CorpusConfig, Settings
from ..index import CorpusStore
from ..models import build_embedding
from .converter import ConversionOptions, convert
from .nodes import build_nodes

log = logging.getLogger(__name__)


@dataclass
class IngestReport:
    """What an ingestion run did. Returned rather than printed, so the CLI, the
    API and the tests can each present it their own way."""

    corpus: str
    index_name: str
    embedding_model: str
    documents: list[str] = field(default_factory=list)
    node_count: int = 0
    nodes_without_provenance: int = 0
    pages: int = 0
    seconds: float = 0.0

    @property
    def provenance_coverage(self) -> float:
        """Fraction of nodes that can actually be cited.

        Surfaced deliberately. A corpus where this is below 1.0 has chunks that
        can be retrieved and quoted but not pointed at, and the operator should
        know that before a report does.
        """
        if not self.node_count:
            return 0.0
        return (self.node_count - self.nodes_without_provenance) / self.node_count


def build_chunker(config: CorpusConfig) -> BaseChunker:
    """Choose a chunker that respects the embedding model's context window.

    `HybridChunker` is tokenizer-aware: it merges undersized sibling chunks and
    splits oversized ones against the model's real tokenizer. That matters here
    beyond quality — a chunk longer than the model's window is silently
    truncated at embedding time, so the vector stops representing the tail of
    text whose provenance still claims to cover it. The citation would point at
    a region containing words that were never embedded.

    It falls back to `HierarchicalChunker` if the tokenizer cannot be loaded
    (an Ollama-only machine with no HuggingFace tokenizer for the model), since
    structural chunking without token awareness beats not ingesting at all.
    """
    tokenizer_id = config.embedding.hf_tokenizer
    if tokenizer_id is None:
        log.info(
            "%s has no tokenizer mapping; using structural chunking.",
            config.embedding.name,
        )
        return HierarchicalChunker()
    try:
        return HybridChunker(
            tokenizer=tokenizer_id,
            max_tokens=config.max_chunk_tokens or config.embedding.max_tokens,
            merge_peers=config.merge_peers,
        )
    except Exception as exc:
        log.warning(
            "could not load tokenizer %s for %s (%s); falling back to "
            "HierarchicalChunker. Chunks are no longer guaranteed to fit the "
            "model's %d-token window.",
            tokenizer_id,
            config.embedding.name,
            exc,
            config.embedding.max_tokens,
        )
        return HierarchicalChunker()


def ingest(
    paths: list[str | Path],
    config: CorpusConfig,
    settings: Settings,
    schema_version: str,
    *,
    conversion: ConversionOptions | None = None,
    overwrite: bool = False,
    to_topleft: bool = True,
) -> IngestReport:
    """Convert, chunk, embed and index a set of documents."""
    started = time.monotonic()
    conversion = conversion or ConversionOptions()
    chunker = build_chunker(config)

    store = CorpusStore(config, settings, schema_version)
    if overwrite:
        store.drop()

    report = IngestReport(
        corpus=config.name,
        index_name=config.index_name,
        embedding_model=config.embedding.name,
    )

    all_nodes = []
    for path in paths:
        converted = convert(path, options=conversion, cache_dir=settings.cache_dir)
        nodes = build_nodes(converted, chunker=chunker, to_topleft=to_topleft)
        all_nodes.extend(nodes)
        report.documents.append(converted.doc_id)
        report.pages += converted.page_count
        log.info(
            "%s -> %d nodes across %d pages",
            Path(converted.source_path).name,
            len(nodes),
            converted.page_count,
        )

    report.node_count = len(all_nodes)
    report.nodes_without_provenance = sum(
        1 for n in all_nodes if not n.metadata.get("has_provenance")
    )

    if all_nodes:
        vector_store = store.vector_store(overwrite=overwrite)
        storage_context = StorageContext.from_defaults(vector_store=vector_store)
        VectorStoreIndex(
            all_nodes,
            storage_context=storage_context,
            embed_model=build_embedding(config.embedding, settings),
            show_progress=True,
        )

    report.seconds = time.monotonic() - started
    if report.nodes_without_provenance:
        log.warning(
            "%d of %d nodes carry no provenance and cannot be cited",
            report.nodes_without_provenance,
            report.node_count,
        )
    return report
