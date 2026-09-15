"""Settings, and the per-corpus model binding.

CLAUDE.md: "Embedding model is configured **per corpus, not globally**". That is
the shape here — `Settings` holds process-wide things (where Redis is, which
Ollama), and `CorpusConfig` holds the choice that belongs to a body of
documents. A corpus that was built with one embedding model cannot be queried
with another, so the binding travels with the corpus rather than with the run.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

from .models import (
    EmbeddingModel,
    GenerationModel,
    Role,
    default_embedding_model,
    default_generation_model,
    resolve_embedding_model,
)


class Settings(BaseSettings):
    """Process-wide configuration, from the environment or a .env file."""

    model_config = SettingsConfigDict(
        env_prefix="ANEURAL_", env_file=".env", extra="ignore"
    )

    redis_url: str = "redis://localhost:6379"
    ollama_base_url: str = "http://localhost:11434"
    openai_api_key: str | None = None

    # Point this at an AI gateway (TrustGate, LiteLLM, a corporate proxy) to
    # route hosted traffic through policy without changing any call site: the
    # gateway speaks the OpenAI wire format, so only the base URL moves.
    openai_base_url: str | None = None

    # Default endpoint for OPENAI_COMPATIBLE models with no base_url of their
    # own - an exo cluster head node, vLLM, LM Studio.
    openai_compatible_base_url: str | None = None

    # AWS Bedrock. Credentials themselves come from the standard AWS chain
    # (env, profile, instance role), not from here.
    aws_region: str = "us-east-1"
    aws_profile: str | None = None

    # Where converted DoclingDocuments are cached. Conversion is the slow step
    # (layout models over every page); re-embedding the same corpus with a
    # different model should not pay it twice. This is what makes comparing
    # embedding models cheap enough to actually do.
    cache_dir: Path = Path(".aneural-cache")

    # Semantic cache. The threshold is a DISTANCE, not a similarity: lower is a
    # tighter match. A cache that answers a question the user did not ask is
    # worse than a cache miss, because the stale answer arrives carrying
    # citations that make it look verified.
    #
    # 0.25 is measured rather than guessed. On the sample corpus with
    # nomic-embed-text, paraphrases of one question sit at 0.12-0.22 while
    # genuinely different questions about the same document sit at 0.49+. The
    # gap is wide enough to put the threshold between them; 0.1 was inside the
    # paraphrase band, so the cache only ever hit on byte-identical questions
    # and earned nothing. Re-measure per corpus if hit rates look wrong -
    # `docs/semantic-cache.md` has the one-liner.
    semantic_cache_enabled: bool = True
    semantic_cache_distance_threshold: float = 0.25
    semantic_cache_ttl_seconds: int = 3600

    api_host: str = "127.0.0.1"
    api_port: int = 8000


@dataclass(frozen=True)
class CorpusConfig:
    """A named body of documents and the models bound to it.

    `name` is the user-facing handle. The Redis index name is derived from it
    together with the embedding model's identity, so indexing the same corpus
    under two models produces two coexisting indexes rather than one corrupt
    one. That is what makes the model comparison possible at all.
    """

    name: str
    embedding: EmbeddingModel
    generation: GenerationModel
    cache_embedding: EmbeddingModel

    # Chunk sizing is expressed in TOKENS of the embedding model's own tokenizer,
    # not characters, because the limit being respected is the model's window.
    # None means "use the model's max", which is what HybridChunker defaults to.
    max_chunk_tokens: int | None = None
    merge_peers: bool = True

    extra: dict[str, str] = field(default_factory=dict)

    @classmethod
    def build(
        cls,
        name: str,
        embedding_model: str | None = None,
        generation_model: str | None = None,
        cache_model: str | None = None,
        **kwargs: object,
    ) -> CorpusConfig:
        """Resolve a corpus config, falling back to this machine's tier."""
        embedding = (
            resolve_embedding_model(embedding_model)
            if embedding_model
            else default_embedding_model(Role.CORPUS)
        )
        cache_embedding = (
            resolve_embedding_model(cache_model)
            if cache_model
            else default_embedding_model(Role.CACHE)
        )
        from .models import GENERATION_MODELS

        generation = (
            GENERATION_MODELS[generation_model]
            if generation_model
            else default_generation_model()
        )
        return cls(
            name=name,
            embedding=embedding,
            generation=generation,
            cache_embedding=cache_embedding,
            **kwargs,  # type: ignore[arg-type]
        )

    @property
    def index_name(self) -> str:
        """Redis index name. Includes the model identity, deliberately.

        An index's vector width is fixed at creation. Naming it after the model
        means switching models creates a new index instead of writing
        incompatible vectors into an existing one — the failure mode becomes
        "the index is empty, reindex" rather than silently wrong search results.
        """
        return f"aneural-{self.name}-{self.embedding.index_suffix}"

    @property
    def cache_index_name(self) -> str:
        return f"aneural-cache-{self.name}-{self.cache_embedding.index_suffix}"

    def describe(self) -> str:
        return (
            f"corpus {self.name!r}\n"
            f"  embedding  {self.embedding.name} "
            f"({self.embedding.provider.value}, {self.embedding.dimension}d, "
            f"{self.embedding.max_tokens} tok)\n"
            f"  cache      {self.cache_embedding.name} "
            f"({self.cache_embedding.provider.value}, {self.cache_embedding.dimension}d)\n"
            f"  generation {self.generation.name} ({self.generation.provider.value})\n"
            f"  index      {self.index_name}"
        )


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
