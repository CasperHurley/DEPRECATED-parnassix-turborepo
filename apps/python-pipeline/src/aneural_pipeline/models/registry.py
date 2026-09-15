"""The catalogue of models, what they cost, and which one a machine gets by default.

Two things live here and they are deliberately separate:

* **Facts about a model** — its dimension, its context window, whether it is
  local. `dimension` in particular is load-bearing and must be correct: it is
  written into index metadata and an index is not portable across models of
  different width. Getting it wrong produces an index that fails on the first
  query rather than at build time.
* **Which model a tier picks per ROLE.** Roles are separated because they have
  genuinely different cost profiles. Embedding a 400-page corpus is a large
  one-off batch job; embedding a single query for the semantic cache happens on
  every request and must be fast; generation is where hosted tokens get
  expensive. Forcing one model across all three is how a local-first setup ends
  up either slow or costly for no reason.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

from ..hardware import Tier, detect_machine

log = logging.getLogger(__name__)


class Provider(StrEnum):
    OLLAMA = "ollama"
    HUGGINGFACE = "huggingface"
    OPENAI = "openai"
    BEDROCK = "bedrock"
    """AWS Bedrock. Hosted, but inside the customer's own AWS account and
    region, which is a materially different privacy posture from a public API
    key — often the only acceptable hosted option for privileged documents."""

    OPENAI_COMPATIBLE = "openai-compatible"
    """Anything speaking the OpenAI wire format at a custom base URL: an exo
    cluster, vLLM, LM Studio, or an AI gateway such as TrustGate sitting in
    front of a real provider. One provider entry covers all of them because the
    protocol, not the vendor, is what the client needs to know."""


class Role(StrEnum):
    """What a model is being asked to do.

    CORPUS and QUERY are both embedding roles and are usually the same model —
    they have to be, for the vectors to be comparable. CACHE is the exception:
    the semantic cache embeds incoming QUERIES to find near-duplicate earlier
    ones, and that similarity space is entirely its own. It never compares a
    query vector against a corpus vector, so it is free to use a smaller and
    faster model, and it should.
    """

    CORPUS = "corpus"  # embedding documents into the vector index
    CACHE = "cache"  # embedding queries for the semantic cache
    GENERATION = "generation"  # the LLM that fills report templates


@dataclass(frozen=True)
class EmbeddingModel:
    name: str
    provider: Provider
    dimension: int
    max_tokens: int
    """Context window in tokens. The chunker is capped by this — chunks longer
    than the model's window are silently truncated, which loses text that the
    provenance still claims to cover. That is a correctness problem, not a
    quality one."""
    hf_tokenizer: str | None = None
    """HuggingFace repo id for this model's TOKENIZER.

    Needed because an Ollama tag ("bge-m3") is not a HuggingFace repo id, so the
    token-aware chunker cannot resolve one from the model name alone. Without it
    chunking silently falls back to structure-only splitting and stops
    respecting `max_tokens` - which for a 512-token model means chunks get
    truncated at embedding time, leaving provenance that claims to cover text
    the vector never saw."""

    notes: str = ""

    base_url: str | None = None
    """Endpoint override, for OPENAI_COMPATIBLE and for a gateway in front of a
    provider. None means the provider's own default from Settings."""

    @property
    def is_local(self) -> bool:
        """Whether inference happens on hardware the operator controls.

        OPENAI_COMPATIBLE is NOT counted as local even though it usually is
        (exo, vLLM on your own box): the base URL could equally be a hosted
        gateway, and this property gates whether a model may be a TIER DEFAULT.
        Guessing "probably local" there would let a default send documents off
        the machine, which is the one thing tier defaults must never do."""
        return self.provider in (Provider.OLLAMA, Provider.HUGGINGFACE)

    @property
    def index_suffix(self) -> str:
        """Identity of this model as it appears in an index name.

        Dimension is included even though the name implies it, because the name
        alone is not enough: a provider can change what a bare tag points at.
        """
        safe = self.name.replace(":", "-").replace("/", "-")
        return f"{self.provider.value}-{safe}-{self.dimension}"


@dataclass(frozen=True)
class GenerationModel:
    name: str
    provider: Provider
    context_window: int
    base_url: str | None = None
    notes: str = ""

    @property
    def is_local(self) -> bool:
        return self.provider in (Provider.OLLAMA, Provider.HUGGINGFACE)


EMBEDDING_MODELS: dict[str, EmbeddingModel] = {
    "bge-m3": EmbeddingModel(
        name="bge-m3",
        provider=Provider.OLLAMA,
        dimension=1024,
        max_tokens=8192,
        hf_tokenizer="BAAI/bge-m3",
        notes="567M params. Long context and strong on retrieval; the quality default.",
    ),
    "nomic-embed-text": EmbeddingModel(
        name="nomic-embed-text",
        provider=Provider.OLLAMA,
        dimension=768,
        max_tokens=8192,
        hf_tokenizer="nomic-ai/nomic-embed-text-v1.5",
        notes="137M params. Much faster than bge-m3 at a lower quality ceiling.",
    ),
    "mxbai-embed-large": EmbeddingModel(
        name="mxbai-embed-large",
        provider=Provider.OLLAMA,
        dimension=1024,
        max_tokens=512,
        hf_tokenizer="mixedbread-ai/mxbai-embed-large-v1",
        notes=(
            "335M params, but a 512-token window. That is SHORTER than the chunks "
            "this pipeline produces by default, so the chunker must be told about "
            "it or chunks get truncated. Included for comparison; a poor fit here."
        ),
    ),
    # Hosted. Requires the `openai` extra and an API key. Present so switching is
    # a config change rather than a code change.
    "text-embedding-3-small": EmbeddingModel(
        name="text-embedding-3-small",
        provider=Provider.OPENAI,
        dimension=1536,
        max_tokens=8191,
        notes="Hosted. Sends document text off-machine — wrong for a privileged corpus.",
    ),
    "text-embedding-3-large": EmbeddingModel(
        name="text-embedding-3-large",
        provider=Provider.OPENAI,
        dimension=3072,
        max_tokens=8191,
        notes="Hosted, highest quality, most expensive per token.",
    ),
    # AWS Bedrock, via the `bedrock` extra. Hosted, but within the customer's own
    # AWS account - the usual answer when a client will not run local models but
    # also will not send documents to a public API.
    "amazon.titan-embed-text-v2:0": EmbeddingModel(
        name="amazon.titan-embed-text-v2:0",
        provider=Provider.BEDROCK,
        dimension=1024,
        max_tokens=8192,
        notes="Bedrock Titan v2. Dimension is configurable upstream (256/512/1024); "
        "this entry pins 1024 because an index cannot change its mind later.",
    ),
    "cohere.embed-english-v3": EmbeddingModel(
        name="cohere.embed-english-v3",
        provider=Provider.BEDROCK,
        dimension=1024,
        max_tokens=512,
        notes="Bedrock Cohere v3. 512-token window - short for Docling chunks.",
    ),
    # Local sentence-transformers, via the `huggingface` extra. No daemon needed.
    "BAAI/bge-small-en-v1.5": EmbeddingModel(
        name="BAAI/bge-small-en-v1.5",
        provider=Provider.HUGGINGFACE,
        dimension=384,
        max_tokens=512,
        hf_tokenizer="BAAI/bge-small-en-v1.5",
        notes="33M params, in-process. The floor: runs anywhere, including CI.",
    ),
}

GENERATION_MODELS: dict[str, GenerationModel] = {
    "qwen2.5:32b": GenerationModel(
        name="qwen2.5:32b",
        provider=Provider.OLLAMA,
        context_window=32768,
        notes="~19 GB resident. Strong structured-output adherence for a local model.",
    ),
    "llama3.1": GenerationModel(
        name="llama3.1",
        provider=Provider.OLLAMA,
        context_window=131072,
        notes="~4.9 GB resident. The modest-machine local option.",
    ),
    "llama3.3:70b": GenerationModel(
        name="llama3.3:70b",
        provider=Provider.OLLAMA,
        context_window=131072,
        notes="~43 GB resident. Needs 64 GB+ to run without swapping.",
    ),
    "exo-cluster": GenerationModel(
        name="exo-cluster",
        provider=Provider.OPENAI_COMPATIBLE,
        context_window=131072,
        notes="Whatever the exo cluster has loaded, reached over its "
        "OpenAI-compatible API. Model identity is the cluster's to decide.",
    ),
    "claude-sonnet-4-5-bedrock": GenerationModel(
        name="anthropic.claude-sonnet-4-5-20250929-v1:0",
        provider=Provider.BEDROCK,
        context_window=200000,
        notes="Bedrock, in the customer's own AWS account and region.",
    ),
    "gpt-4o-mini": GenerationModel(
        name="gpt-4o-mini",
        provider=Provider.OPENAI,
        context_window=128000,
        notes="Hosted and cheap, but per-token. Off by default.",
    ),
}

# Tier -> role -> model name. Local-first at every tier that can afford it: the
# hosted entries above are reachable by explicit config, never by default, so
# nothing starts costing money because a machine happened to be detected.
_TIER_DEFAULTS: dict[Tier, dict[Role, str]] = {
    Tier.SMALL: {
        Role.CORPUS: "BAAI/bge-small-en-v1.5",
        Role.CACHE: "BAAI/bge-small-en-v1.5",
        Role.GENERATION: "llama3.1",
    },
    Tier.MEDIUM: {
        Role.CORPUS: "nomic-embed-text",
        Role.CACHE: "nomic-embed-text",
        Role.GENERATION: "llama3.1",
    },
    Tier.LARGE: {
        Role.CORPUS: "bge-m3",
        # Deliberately NOT bge-m3. The cache embeds one short query per request
        # and its vectors are never compared against corpus vectors, so the
        # small model is strictly the better trade here.
        Role.CACHE: "nomic-embed-text",
        Role.GENERATION: "qwen2.5:32b",
    },
    # Embedding does not get better by throwing memory at it - bge-m3 is already
    # the best local option in the catalogue, so the richer tiers spend their
    # headroom on GENERATION, which is where it actually buys accuracy.
    Tier.XLARGE: {
        Role.CORPUS: "bge-m3",
        Role.CACHE: "nomic-embed-text",
        Role.GENERATION: "llama3.3:70b",
    },
    Tier.WORKSTATION: {
        Role.CORPUS: "bge-m3",
        Role.CACHE: "nomic-embed-text",
        Role.GENERATION: "llama3.3:70b",
    },
    # A cluster pools memory for GENERATION only. Embedding stays on this
    # machine: it is a throughput-bound batch job over many small inputs, and
    # shipping every chunk across a network to a pooled model would be slower
    # than running a 567M-parameter model locally, not faster.
    Tier.CLUSTER: {
        Role.CORPUS: "bge-m3",
        Role.CACHE: "nomic-embed-text",
        Role.GENERATION: "exo-cluster",
    },
}


def load_catalog_overrides(path: str | Path | None = None) -> int:
    """Merge a user-supplied model catalogue over the built-in one.

    The built-in catalogue cannot know about a model released next month, a
    private fine-tune, or an internal endpoint. Rather than force a code change
    for each, point `ANEURAL_MODEL_CATALOG` at a JSON file:

        {
          "embedding": {
            "my-finetune": {
              "provider": "openai-compatible",
              "dimension": 1024,
              "max_tokens": 8192,
              "base_url": "http://gpu-rig:8000/v1",
              "hf_tokenizer": "BAAI/bge-m3"
            }
          },
          "generation": {
            "my-llm": {"provider": "ollama", "context_window": 32768}
          }
        }

    `dimension` is mandatory for an embedding entry and is NOT defaulted. It is
    the one field that cannot be guessed: a wrong value builds an index that
    accepts writes and fails at query time, long after the run that caused it.

    Overrides may replace built-in entries by name, which is the supported way
    to repoint a tag at a different endpoint without editing this file.
    """
    raw = path or os.environ.get("ANEURAL_MODEL_CATALOG")
    if not raw:
        return 0
    catalog_path = Path(raw)
    if not catalog_path.is_file():
        raise FileNotFoundError(
            f"ANEURAL_MODEL_CATALOG points at {catalog_path}, which does not exist"
        )

    data = json.loads(catalog_path.read_text())
    count = 0

    for name, spec in (data.get("embedding") or {}).items():
        missing = {"provider", "dimension"} - spec.keys()
        if missing:
            raise ValueError(
                f"embedding model {name!r} in {catalog_path} is missing {sorted(missing)}. "
                f"'dimension' in particular cannot be inferred - a wrong one builds an "
                f"index that only fails at query time."
            )
        EMBEDDING_MODELS[name] = EmbeddingModel(
            name=spec.get("model_name", name),
            provider=Provider(spec["provider"]),
            dimension=int(spec["dimension"]),
            max_tokens=int(spec.get("max_tokens", 512)),
            hf_tokenizer=spec.get("hf_tokenizer"),
            base_url=spec.get("base_url"),
            notes=spec.get("notes", f"user-defined ({catalog_path.name})"),
        )
        count += 1

    for name, spec in (data.get("generation") or {}).items():
        if "provider" not in spec:
            raise ValueError(f"generation model {name!r} in {catalog_path} is missing 'provider'")
        GENERATION_MODELS[name] = GenerationModel(
            name=spec.get("model_name", name),
            provider=Provider(spec["provider"]),
            context_window=int(spec.get("context_window", 8192)),
            base_url=spec.get("base_url"),
            notes=spec.get("notes", f"user-defined ({catalog_path.name})"),
        )
        count += 1

    log.info("loaded %d model override(s) from %s", count, catalog_path)
    return count


def resolve_embedding_model(name: str) -> EmbeddingModel:
    """Look up a model, failing loudly on an unknown one.

    Unknown names are rejected rather than passed through because the catalogue
    is where `dimension` comes from, and a guessed dimension builds an index
    that is wrong in a way nothing detects until query time.
    """
    load_catalog_overrides()
    try:
        return EMBEDDING_MODELS[name]
    except KeyError:
        known = ", ".join(sorted(EMBEDDING_MODELS))
        raise KeyError(
            f"Unknown embedding model {name!r}. Known models: {known}. "
            f"Add it to EMBEDDING_MODELS with its true dimension before using it."
        ) from None


def default_embedding_model(role: Role = Role.CORPUS) -> EmbeddingModel:
    if role is Role.GENERATION:
        raise ValueError("GENERATION is not an embedding role")
    return EMBEDDING_MODELS[_TIER_DEFAULTS[detect_machine().tier][role]]


def default_generation_model() -> GenerationModel:
    return GENERATION_MODELS[_TIER_DEFAULTS[detect_machine().tier][Role.GENERATION]]
