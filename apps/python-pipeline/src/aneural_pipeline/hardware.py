"""Detect what this machine can comfortably run, so model choice has a default.

The point is cost control, not benchmarking. A laptop with 64 GB of unified
memory should not be told to call a paid hosted API to embed a document it could
embed locally in seconds, and a 16 GB machine should not be handed a model that
will swap. Detection picks a TIER; the registry maps a tier to a model per role.

Everything here is a default. An explicit setting always wins, and the resolved
choice is recorded in index metadata, so nothing downstream has to re-derive it.
"""

from __future__ import annotations

import logging
import os
import platform
import subprocess
from dataclasses import dataclass
from enum import StrEnum
from functools import lru_cache

log = logging.getLogger(__name__)


class Tier(StrEnum):
    """How much local model weight this machine can carry.

    Thresholds are in unified/system memory because that is the binding
    constraint for local inference on the machines this runs on. They are
    deliberately conservative: the tier a machine gets should leave room for the
    editor, the browser, and the rest of the monorepo's dev servers.

    The ladder runs past LARGE because the hardware does. A 64 GB laptop, a
    256 GB Mac Studio and a pair of machines pooled over Thunderbolt are three
    genuinely different capability classes, and collapsing them into ">= 32 GB"
    means a workstation runs the same 30B model a laptop does — leaving most of
    the machine idle for no reason.
    """

    SMALL = "small"  # < 16 GB — keep local models tiny
    MEDIUM = "medium"  # 16–32 GB — local embeddings comfortably, mid-size local LLM
    LARGE = "large"  # 32–64 GB — large local embeddings, 30B-class local LLM
    XLARGE = "xlarge"  # 64–128 GB — 70B-class comfortably
    WORKSTATION = "workstation"  # >= 128 GB — Mac Studio / Ultra territory
    CLUSTER = "cluster"  # pooled memory across machines (exo). See detect_cluster().


# Lower bound of each tier in GB, richest first. Read by `_tier_for`.
_TIER_FLOOR: list[tuple[Tier, float]] = [
    (Tier.WORKSTATION, 128),
    (Tier.XLARGE, 64),
    (Tier.LARGE, 32),
    (Tier.MEDIUM, 16),
    (Tier.SMALL, 0),
]


def _tier_for(memory_gb: float) -> Tier:
    for tier, floor in _TIER_FLOOR:
        if memory_gb >= floor:
            return tier
    return Tier.SMALL


@dataclass(frozen=True)
class Cluster:
    """A detected exo cluster: several machines pooling memory for inference."""

    base_url: str
    node_count: int
    pooled_memory_gb: float | None

    def describe(self) -> str:
        pooled = f"{self.pooled_memory_gb:.0f} GB pooled" if self.pooled_memory_gb else "pooled"
        return f"exo cluster at {self.base_url}: {self.node_count} node(s), {pooled}"


@dataclass(frozen=True)
class Machine:
    """What we managed to learn about the host."""

    tier: Tier
    total_memory_gb: float
    cpu: str
    arch: str
    apple_silicon: bool
    cluster: Cluster | None = None

    @property
    def usable_memory_gb(self) -> float:
        """Memory available for inference, pooled across a cluster when present."""
        if self.cluster and self.cluster.pooled_memory_gb:
            return self.cluster.pooled_memory_gb
        return self.total_memory_gb

    def describe(self) -> str:
        base = (
            f"{self.cpu} ({self.arch}), {self.total_memory_gb:.0f} GB — "
            f"tier {self.tier.value}"
        )
        return f"{base}\n{self.cluster.describe()}" if self.cluster else base


def _total_memory_bytes() -> int | None:
    """Total physical memory, or None if the platform will not say.

    On Apple Silicon this is unified memory, which is the number that actually
    governs how large a model can be resident.
    """
    try:
        if platform.system() == "Darwin":
            out = subprocess.run(
                ["sysctl", "-n", "hw.memsize"],
                capture_output=True,
                text=True,
                timeout=5,
                check=True,
            )
            return int(out.stdout.strip())
        # Linux; also covers the container case, where MemTotal reflects the host
        # rather than the cgroup limit. Good enough for a default.
        with open("/proc/meminfo") as fh:
            for line in fh:
                if line.startswith("MemTotal:"):
                    return int(line.split()[1]) * 1024
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
    return None


def _cpu_brand() -> str:
    try:
        if platform.system() == "Darwin":
            out = subprocess.run(
                ["sysctl", "-n", "machdep.cpu.brand_string"],
                capture_output=True,
                text=True,
                timeout=5,
                check=True,
            )
            return out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return platform.processor() or platform.machine() or "unknown"


@lru_cache(maxsize=1)
def detect_machine() -> Machine:
    """Inspect the host once per process.

    ANEURAL_TIER overrides detection outright. That exists for CI and for the
    case where someone wants a big machine to behave like a small one to
    reproduce a colleague's results — a tier that cannot be forced is a tier
    that makes results unreproducible across machines.
    """
    memory_bytes = _total_memory_bytes()
    memory_gb = (memory_bytes / 1024**3) if memory_bytes else 8.0

    cluster = detect_cluster()

    forced = os.environ.get("ANEURAL_TIER")
    if forced:
        tier = Tier(forced.lower())
    elif cluster is not None:
        # A cluster is its own tier rather than a bigger number, because what
        # changes is not only capacity but WHERE inference runs: generation goes
        # to the cluster endpoint while embedding stays local (see the registry).
        tier = Tier.CLUSTER
    else:
        tier = _tier_for(memory_gb)

    arch = platform.machine()
    return Machine(
        tier=tier,
        total_memory_gb=memory_gb,
        cpu=_cpu_brand(),
        arch=arch,
        apple_silicon=platform.system() == "Darwin" and arch == "arm64",
        cluster=cluster,
    )


@lru_cache(maxsize=1)
def detect_cluster() -> Cluster | None:
    """Probe for an exo cluster pooling several machines' memory.

    exo exposes an OpenAI-compatible API, so a detected cluster is usable
    through the ordinary `openai-like` provider path — no special client.

    Off unless `ANEURAL_EXO_BASE_URL` is set. Probing by default would mean a
    blocking HTTP call on every process start, and — because exo's head node
    also listens on :8000 — a default probe of localhost:8000 could just as
    easily find THIS service's own API and misread it as a cluster.

    Detection is best-effort by design: a cluster that cannot be reached is
    simply absent, and the machine falls back to its own memory tier rather
    than failing to start.
    """
    base_url = os.environ.get("ANEURAL_EXO_BASE_URL")
    if not base_url:
        return None

    import json
    import urllib.error
    import urllib.request

    base_url = base_url.rstrip("/")
    try:
        with urllib.request.urlopen(f"{base_url}/models", timeout=2.0) as response:
            payload = json.loads(response.read())
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        log.warning("no exo cluster at %s (%s); using this machine only", base_url, exc)
        return None

    # exo's topology fields have moved between releases, so read defensively and
    # report what is certain (the endpoint works) rather than guessing capacity.
    nodes = payload.get("topology") or payload.get("nodes") or []
    node_count = len(nodes) if isinstance(nodes, list) else 1
    pooled = None
    if isinstance(nodes, list):
        total = sum(
            n.get("memory_gb", 0) or 0 for n in nodes if isinstance(n, dict)
        )
        pooled = float(total) or None

    return Cluster(
        base_url=base_url, node_count=max(node_count, 1), pooled_memory_gb=pooled
    )
