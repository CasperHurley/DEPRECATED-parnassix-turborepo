"""Docling chunks -> LlamaIndex nodes, with provenance and stable identity intact.

`DoclingNodeParser` from `llama-index-node-parser-docling` is not used directly,
for two reasons that are both defects from this pipeline's point of view:

* It assigns `uuid4` node ids. See `provenance.stable_node_id` — random ids make
  citations rot on every reindex.
* It ends with `node.metadata = metadata`, a plain assignment of the CHUNK's
  metadata. Anything set on the source `Document` — which is where the document
  id and filename live — is overwritten and lost.

Rather than subclass around both, this builds nodes directly from the converted
document. It is less code than the workarounds, and the chunker is still
Docling's own, so the chunking behaviour is unchanged.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from docling_core.transforms.chunker import BaseChunker, HierarchicalChunker
from docling_core.types.doc import DoclingDocument
from llama_index.core.schema import TextNode

from .provenance import (
    PageGeometry,
    document_id,
    page_geometry,
    source_refs_for_chunk,
    stable_node_id,
)

# Metadata keys that must never reach the embedding model or the LLM.
#
# Embedding: serialized JSON of bounding boxes would be embedded as if it were
# prose, diluting the vector with coordinate noise and making retrieval worse.
#
# LLM: this is the anti-hallucination boundary. The model is never shown raw
# coordinates, so it cannot copy them, paraphrase them, or invent them. It sees
# text and a node id; the pipeline resolves that id back to provenance itself.
PROVENANCE_KEYS = ("source_refs", "doc_items", "origin", "schema_name", "version")


@dataclass(frozen=True)
class ConvertedDocument:
    """A converted document plus the geometry that chunking is about to discard."""

    doc: DoclingDocument
    doc_id: str
    source_path: str
    pages: dict[int, PageGeometry]

    @property
    def page_count(self) -> int:
        return len(self.pages)


def prepare(doc: DoclingDocument, source_path: str) -> ConvertedDocument:
    """Capture identity and page geometry from a freshly converted document."""
    return ConvertedDocument(
        doc=doc,
        doc_id=document_id(doc, fallback=source_path),
        source_path=source_path,
        pages=page_geometry(doc),
    )


def build_nodes(
    converted: ConvertedDocument,
    *,
    chunker: BaseChunker | None = None,
    to_topleft: bool = True,
    extra_metadata: dict[str, Any] | None = None,
) -> list[TextNode]:
    """Chunk a converted document into nodes carrying resolvable provenance.

    Every node gets `source_refs`: the JSON-serialized list of `SourceRef`
    objects covering it, already in the wire contract's shape. It is stored as a
    string because Redis metadata is a flat hash — a nested list would not
    survive the round trip, and flattening it into numbered keys would make it
    unreadable for no gain.
    """
    chunker = chunker or HierarchicalChunker()
    nodes: list[TextNode] = []

    for ordinal, chunk in enumerate(chunker.chunk(dl_doc=converted.doc)):
        node_id = stable_node_id(converted.doc_id, chunk, ordinal)
        refs = source_refs_for_chunk(
            chunk,
            doc_id=converted.doc_id,
            node_id=node_id,
            pages=converted.pages,
            quoted_text=chunk.text,
            to_topleft=to_topleft,
        )

        headings = list(getattr(chunk.meta, "headings", None) or [])
        pages = sorted({ref["page"] for ref in refs})

        metadata: dict[str, Any] = {
            "document_id": converted.doc_id,
            "source_file": converted.source_path.rsplit("/", 1)[-1],
            "source_refs": json.dumps(refs),
            # Flat and filterable. Redis can only filter on scalars, so the page
            # range is denormalized out of source_refs to support "only search
            # pages 10-20" without parsing every stored blob.
            "page_start": pages[0] if pages else 0,
            "page_end": pages[-1] if pages else 0,
            "has_provenance": int(bool(refs)),
            "headings": " > ".join(headings) if headings else "",
        }
        if extra_metadata:
            metadata.update(extra_metadata)

        node = TextNode(
            id_=node_id,
            text=chunk.text,
            metadata=metadata,
            # Headings stay visible to both: they are real context ("this
            # paragraph sits under 'Limitation of Liability'") and they measurably
            # help retrieval on documents whose sections read alike.
            excluded_embed_metadata_keys=[
                *PROVENANCE_KEYS,
                "document_id",
                "source_file",
                "page_start",
                "page_end",
                "has_provenance",
            ],
            excluded_llm_metadata_keys=[
                *PROVENANCE_KEYS,
                "page_start",
                "page_end",
                "has_provenance",
            ],
        )
        nodes.append(node)

    return nodes


def source_refs_of(node: TextNode) -> list[dict[str, Any]]:
    """Read a node's provenance back out.

    The inverse of the `json.dumps` in `build_nodes`. Returns an empty list for a
    node that carries none, rather than raising — a node without provenance is a
    real state (see `source_refs_for_chunk`) and the caller is expected to render
    the gap.
    """
    raw = node.metadata.get("source_refs")
    if not raw:
        return []
    if isinstance(raw, list):
        return raw
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return []
