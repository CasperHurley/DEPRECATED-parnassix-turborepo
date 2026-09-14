"""The index/model mismatch guard.

Needs a live Redis, so it skips rather than fails where there isn't one — the
rest of the suite is deliberately infrastructure-free.
"""

from __future__ import annotations

import json

import pytest

from aneural_pipeline.config import CorpusConfig, get_settings
from aneural_pipeline.index import CorpusStore
from aneural_pipeline.report import SCHEMA_VERSION


@pytest.fixture
def redis_client():
    redis = pytest.importorskip("redis")
    client = redis.Redis.from_url(get_settings().redis_url)
    try:
        client.ping()
    except Exception:
        pytest.skip("no Redis on ANEURAL_REDIS_URL")
    return client


def test_index_names_cannot_collide_across_models():
    """The first line of defence: two models never share an index.

    An index's vector width is fixed at creation, so a shared name is how you
    get an index that accepts writes and returns ranked nonsense.
    """
    a = CorpusConfig.build("c", embedding_model="bge-m3")
    b = CorpusConfig.build("c", embedding_model="nomic-embed-text")
    assert a.index_name != b.index_name
    assert str(a.embedding.dimension) in a.index_name


def test_metadata_guard_rejects_a_repointed_model_tag(redis_client):
    """The second line: same name and width, different model underneath.

    A provider can change what a bare tag resolves to. Vectors of the right
    WIDTH from the wrong MODEL still produce cosine distances and still rank, so
    without this check the failure is not an error but a silent quality
    collapse.
    """
    config = CorpusConfig.build("guard-test", embedding_model="bge-m3")
    store = CorpusStore(config, get_settings(), SCHEMA_VERSION)
    store.record_metadata()
    try:
        store.verify()  # matching metadata passes

        stored = json.loads(redis_client.get(store.metadata_key))
        stored["embedding_model"] = "bge-m3-but-actually-different"
        redis_client.set(store.metadata_key, json.dumps(stored))

        with pytest.raises(ValueError, match="built with different settings"):
            store.verify()
    finally:
        redis_client.delete(store.metadata_key)


def test_schema_version_bump_alone_does_not_invalidate_an_index(redis_client):
    """A contract bump changes the emitted shape, not the vectors.

    Treating it as invalidating would force a full reindex on every version
    bump, for no retrieval-quality reason.
    """
    config = CorpusConfig.build("guard-test-version", embedding_model="bge-m3")
    store = CorpusStore(config, get_settings(), SCHEMA_VERSION)
    store.record_metadata()
    try:
        stored = json.loads(redis_client.get(store.metadata_key))
        stored["schema_version"] = "0.0.1-ancient"
        redis_client.set(store.metadata_key, json.dumps(stored))
        store.verify()  # must not raise
    finally:
        redis_client.delete(store.metadata_key)
