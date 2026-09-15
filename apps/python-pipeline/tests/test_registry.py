"""Model catalogue invariants."""

from __future__ import annotations

import pytest

from aneural_pipeline.config import CorpusConfig
from aneural_pipeline.hardware import Tier, detect_machine
from aneural_pipeline.models import EMBEDDING_MODELS, Role, default_embedding_model
from aneural_pipeline.models.registry import _TIER_DEFAULTS


def test_every_tier_names_a_model_for_every_role():
    for tier in Tier:
        for role in Role:
            assert _TIER_DEFAULTS[tier][role]


def test_tier_defaults_are_all_local():
    """No tier may default to a hosted model.

    Detection must never be the reason a run starts costing money or sending
    privileged documents off the machine.
    """
    for tier, roles in _TIER_DEFAULTS.items():
        for role, name in roles.items():
            model = EMBEDDING_MODELS.get(name)
            if model is not None:
                assert model.is_local, f"{tier}/{role} defaults to hosted {name}"


def test_index_name_distinguishes_models():
    """Two models must never be able to collide on one index.

    An index's vector width is fixed at creation; sharing a name across models
    is how you get an index that accepts writes and returns nonsense.
    """
    a = CorpusConfig.build("c", embedding_model="bge-m3")
    b = CorpusConfig.build("c", embedding_model="nomic-embed-text")
    assert a.index_name != b.index_name


def test_unknown_model_is_rejected_not_guessed():
    """A guessed dimension builds an index that is wrong until query time."""
    with pytest.raises(KeyError, match="Unknown embedding model"):
        CorpusConfig.build("c", embedding_model="not-a-real-model")


def test_forced_tier_overrides_detection(monkeypatch):
    detect_machine.cache_clear()
    monkeypatch.setenv("ANEURAL_TIER", "small")
    try:
        assert detect_machine().tier is Tier.SMALL
    finally:
        detect_machine.cache_clear()


def test_cache_role_may_differ_from_corpus_role():
    """The cache embeds queries only, so it is free to be cheaper."""
    detect_machine.cache_clear()
    corpus = default_embedding_model(Role.CORPUS)
    cache = default_embedding_model(Role.CACHE)
    assert corpus.is_local and cache.is_local
