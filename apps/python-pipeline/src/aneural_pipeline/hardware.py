"""Detect what this machine can comfortably run, so model choice has a default.

The point is cost control, not benchmarking. A laptop with 64 GB of unified
memory should not be told to call a paid hosted API to embed a document it could
embed locally in seconds, and a 16 GB machine should not be handed a model that
will swap. Detection picks a TIER; the registry maps a tier to a model per role.

Everything here is a default. An explicit setting always wins, and the resolved
choice is recorded in index metadata, so nothing downstream has to re-derive it.
"""

from __future__ import annotations

import os
import platform
import subprocess
from dataclasses import dataclass
from enum import StrEnum
from functools import lru_cache


class Tier(StrEnum):
    """How much local model weight this machine can carry.

    Thresholds are in unified/system memory because that is the binding
    constraint for local inference on the machines this runs on. They are
    deliberately conservative: the tier a machine gets should leave room for the
    editor, the browser, and the rest of the monorepo's dev servers.
    """

    SMALL = "small"  # < 16 GB — keep local models tiny, prefer hosted for generation
    MEDIUM = "medium"  # 16–32 GB — local embeddings comfortably, mid-size local LLM
    LARGE = "large"  # >= 32 GB — large local embeddings and a 30B-class local LLM


@dataclass(frozen=True)
class Machine:
    """What we managed to learn about the host."""

    tier: Tier
    total_memory_gb: float
    cpu: str
    arch: str
    apple_silicon: bool

    def describe(self) -> str:
        return (
            f"{self.cpu} ({self.arch}), {self.total_memory_gb:.0f} GB — tier {self.tier.value}"
        )


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

    forced = os.environ.get("ANEURAL_TIER")
    if forced:
        tier = Tier(forced.lower())
    elif memory_gb >= 32:
        tier = Tier.LARGE
    elif memory_gb >= 16:
        tier = Tier.MEDIUM
    else:
        tier = Tier.SMALL

    arch = platform.machine()
    return Machine(
        tier=tier,
        total_memory_gb=memory_gb,
        cpu=_cpu_brand(),
        arch=arch,
        apple_silicon=platform.system() == "Darwin" and arch == "arm64",
    )
