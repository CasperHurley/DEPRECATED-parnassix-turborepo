"""Build a live embedding or LLM client from a catalogue entry.

One function per kind, switching on provider. Nothing else in the codebase
imports a provider-specific class, so adding a provider is a change here plus a
registry entry — which is the point of the indirection.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .registry import EmbeddingModel, GenerationModel, Provider

if TYPE_CHECKING:
    from llama_index.core.base.embeddings.base import BaseEmbedding
    from llama_index.core.llms import LLM


def build_embedding(model: EmbeddingModel, settings: Any) -> BaseEmbedding:
    """Instantiate the embedding client for `model`.

    Provider packages are imported lazily. The huggingface and openai
    integrations are optional extras, and importing them eagerly would make the
    default Ollama path fail on a machine that deliberately did not install a
    torch/sentence-transformers stack.
    """
    if model.provider is Provider.OLLAMA:
        from llama_index.embeddings.ollama import OllamaEmbedding

        return OllamaEmbedding(
            model_name=model.name,
            base_url=settings.ollama_base_url,
        )

    if model.provider is Provider.HUGGINGFACE:
        try:
            from llama_index.embeddings.huggingface import HuggingFaceEmbedding
        except ImportError as exc:
            raise ImportError(
                f"{model.name} needs the 'huggingface' extra: "
                f"uv sync --extra huggingface"
            ) from exc

        return HuggingFaceEmbedding(model_name=model.name)

    if model.provider is Provider.OPENAI_COMPATIBLE:
        try:
            from llama_index.embeddings.openai_like import OpenAILikeEmbedding
        except ImportError as exc:
            raise ImportError(
                f"{model.name} needs the 'compatible' extra: uv sync --extra compatible"
            ) from exc

        base_url = model.base_url or settings.openai_compatible_base_url
        if not base_url:
            raise ValueError(
                f"{model.name} is an openai-compatible model with no base_url. Set one "
                f"on the catalogue entry or via PARNASSIX_OPENAI_COMPATIBLE_BASE_URL."
            )
        # Such endpoints (exo, vLLM, a gateway) usually ignore the key but the
        # client insists on one being present.
        return OpenAILikeEmbedding(
            model_name=model.name,
            api_base=base_url,
            api_key=settings.openai_api_key or "not-needed",
            embed_batch_size=10,
        )

    if model.provider is Provider.BEDROCK:
        try:
            from llama_index.embeddings.bedrock import BedrockEmbedding
        except ImportError as exc:
            raise ImportError(
                f"{model.name} needs the 'bedrock' extra: uv sync --extra bedrock"
            ) from exc

        # Credentials come from the ordinary AWS chain (env, profile, IMDS, IRSA)
        # rather than being threaded through Settings - re-implementing that
        # resolution order is how a deployment ends up unable to use a role.
        return BedrockEmbedding(
            model_name=model.name,
            region_name=settings.aws_region,
            profile_name=settings.aws_profile,
        )

    if model.provider is Provider.OPENAI:
        try:
            from llama_index.embeddings.openai import OpenAIEmbedding
        except ImportError as exc:
            raise ImportError(
                f"{model.name} needs the 'openai' extra: uv sync --extra openai"
            ) from exc

        if not settings.openai_api_key:
            raise ValueError(
                f"{model.name} is a hosted model and PARNASSIX_OPENAI_API_KEY is unset. "
                f"Note that using it sends document text off this machine."
            )
        # api_base honours a gateway (TrustGate, LiteLLM) sitting in front of
        # OpenAI: same client, same key handling, traffic routed through policy.
        return OpenAIEmbedding(
            model=model.name,
            api_key=settings.openai_api_key,
            api_base=model.base_url or settings.openai_base_url,
        )

    raise ValueError(f"Unhandled embedding provider: {model.provider}")


def build_llm(model: GenerationModel, settings: Any, **kwargs: Any) -> LLM:
    """Instantiate the generation client for `model`.

    Temperature defaults to 0. Report generation is an extraction task against
    retrieved text, and sampling variety is not a feature there — the same
    question over the same corpus should give the same answer.
    """
    kwargs.setdefault("temperature", 0.0)

    if model.provider is Provider.OLLAMA:
        from llama_index.llms.ollama import Ollama

        return Ollama(
            model=model.name,
            base_url=settings.ollama_base_url,
            context_window=model.context_window,
            request_timeout=kwargs.pop("request_timeout", 300.0),
            **kwargs,
        )

    if model.provider is Provider.OPENAI_COMPATIBLE:
        try:
            from llama_index.llms.openai_like import OpenAILike
        except ImportError as exc:
            raise ImportError(
                f"{model.name} needs the 'compatible' extra: uv sync --extra compatible"
            ) from exc

        base_url = model.base_url or settings.openai_compatible_base_url
        if not base_url:
            raise ValueError(
                f"{model.name} is an openai-compatible model with no base_url. For an "
                f"exo cluster this is usually its head node, e.g. "
                f"http://localhost:8000/v1 - set PARNASSIX_OPENAI_COMPATIBLE_BASE_URL."
            )
        return OpenAILike(
            model=model.name,
            api_base=base_url,
            api_key=settings.openai_api_key or "not-needed",
            context_window=model.context_window,
            is_chat_model=True,
            **kwargs,
        )

    if model.provider is Provider.BEDROCK:
        try:
            from llama_index.llms.bedrock_converse import BedrockConverse
        except ImportError as exc:
            raise ImportError(
                f"{model.name} needs the 'bedrock' extra: uv sync --extra bedrock"
            ) from exc

        # Converse, not the legacy Bedrock API: it is the one with a uniform
        # tool-use and structured-output surface across model families, which is
        # what report generation needs.
        return BedrockConverse(
            model=model.name,
            region_name=settings.aws_region,
            profile_name=settings.aws_profile,
            **kwargs,
        )

    if model.provider is Provider.OPENAI:
        try:
            from llama_index.llms.openai import OpenAI
        except ImportError as exc:
            raise ImportError(
                f"{model.name} needs the 'openai' extra: uv sync --extra openai"
            ) from exc

        if not settings.openai_api_key:
            raise ValueError(f"{model.name} is hosted and PARNASSIX_OPENAI_API_KEY is unset.")
        return OpenAI(
            model=model.name,
            api_key=settings.openai_api_key,
            api_base=model.base_url or settings.openai_base_url,
            **kwargs,
        )

    raise ValueError(f"Unhandled generation provider: {model.provider}")
