"""Redis Semantic Cache — and the reasons it is configured conservatively.

A semantic cache answers a new question with an old answer when the two
questions are close enough in embedding space. That is a large saving on both
latency and, when generation is hosted, money. It is also the one component here
that can be *wrong on purpose*: set the threshold loosely and "what is the
liability cap?" gets served the answer to "what is the notice period?", with the
earlier answer's citations attached. In evidentiary work that is worse than any
cache miss, because the citations make it look verified.

So: tight distance threshold by default, corpus-scoped keys, and the cache
carries the answer's citations with it rather than reconstructing them.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from redisvl.extensions.llmcache import SemanticCache
from redisvl.utils.vectorize import BaseVectorizer

from ..config import CorpusConfig, Settings
from ..models import build_embedding

log = logging.getLogger(__name__)


class _LlamaIndexVectorizer(BaseVectorizer):
    """Adapt a LlamaIndex embedding to redisvl's vectorizer interface.

    Needed because the cache and the corpus index are configured from the same
    registry, and the registry speaks LlamaIndex. Without this the cache would
    need its own parallel provider setup — and would drift from it.
    """

    model_config = {"arbitrary_types_allowed": True}

    def __init__(self, embedding: Any, dims: int, model: str):
        super().__init__(model=model, dims=dims)
        object.__setattr__(self, "_embedding", embedding)

    def embed(self, text: str, preprocess: Any = None, as_buffer: bool = False, **kwargs: Any):
        if preprocess:
            text = preprocess(text)
        return self._process_embedding(
            self._embedding.get_text_embedding(text), as_buffer, kwargs.get("dtype")
        )

    def embed_many(
        self,
        texts: list[str],
        preprocess: Any = None,
        batch_size: int = 10,
        as_buffer: bool = False,
        **kwargs: Any,
    ):
        if preprocess:
            texts = [preprocess(t) for t in texts]
        vectors = self._embedding.get_text_embedding_batch(texts)
        return [
            self._process_embedding(v, as_buffer, kwargs.get("dtype")) for v in vectors
        ]

    async def aembed(self, text: str, **kwargs: Any):
        return self.embed(text, **kwargs)

    async def aembed_many(self, texts: list[str], **kwargs: Any):
        return self.embed_many(texts, **kwargs)


def build_cache(config: CorpusConfig, settings: Settings) -> SemanticCache | None:
    """Open the semantic cache for a corpus, or None if it is disabled."""
    if not settings.semantic_cache_enabled:
        return None

    embedding = build_embedding(config.cache_embedding, settings)
    vectorizer = _LlamaIndexVectorizer(
        embedding,
        dims=config.cache_embedding.dimension,
        model=config.cache_embedding.name,
    )
    return SemanticCache(
        name=config.cache_index_name,
        redis_url=settings.redis_url,
        vectorizer=vectorizer,
        distance_threshold=settings.semantic_cache_distance_threshold,
        ttl=settings.semantic_cache_ttl_seconds,
        overwrite=False,
    )


def cache_lookup(cache: SemanticCache | None, question: str) -> dict[str, Any] | None:
    """Check for a near-identical earlier question.

    Returns the stored payload — answer AND citations together. The citations
    are cached rather than re-resolved because an answer and the evidence for it
    are one artifact: serving a cached answer beside freshly-resolved citations
    would let the two drift apart if the corpus were reindexed in between.
    """
    if cache is None:
        return None
    try:
        hits = cache.check(prompt=question, num_results=1)
    except Exception as exc:  # a cache failure must never fail the query
        log.warning("semantic cache lookup failed, continuing uncached: %s", exc)
        return None
    if not hits:
        return None

    hit = hits[0]
    try:
        payload = json.loads(hit["response"])
    except (KeyError, TypeError, ValueError):
        return None
    payload["_cache"] = {
        "hit": True,
        "distance": hit.get("vector_distance"),
        "matched_question": hit.get("prompt"),
    }
    return payload


def cache_store(cache: SemanticCache | None, question: str, payload: dict[str, Any]) -> None:
    if cache is None:
        return
    try:
        cache.store(prompt=question, response=json.dumps(payload))
    except Exception as exc:
        log.warning("semantic cache store failed: %s", exc)
