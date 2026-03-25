"""
Docker container stats collector.

Polls `docker stats --no-stream` at a configurable interval in a background
thread, producing a timeseries of CPU% and memory usage per container.
"""

from __future__ import annotations

import json
import subprocess
import threading
import time
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ContainerSnapshot:
    """Single stats reading for one container."""
    timestamp: float
    container: str
    cpu_percent: float
    mem_usage_mb: float
    mem_limit_mb: float
    mem_percent: float
    net_in_mb: float
    net_out_mb: float


@dataclass
class DockerTimeseries:
    """All snapshots for one test, keyed by container name."""
    test_name: str
    snapshots: dict[str, list[ContainerSnapshot]] = field(default_factory=dict)

    def add(self, snap: ContainerSnapshot) -> None:
        self.snapshots.setdefault(snap.container, []).append(snap)


def _parse_size(s: str) -> float:
    """Parse Docker size strings like '123.4MiB', '1.2GiB', '456kB', '901k' → MB."""
    s = s.strip()
    upper = s.upper()
    if upper.endswith("GIB"):
        return float(s[:-3]) * 1024
    if upper.endswith("MIB"):
        return float(s[:-3])
    if upper.endswith("KIB"):
        return float(s[:-3]) / 1024
    if upper.endswith("GB"):
        return float(s[:-2]) * 1000
    if upper.endswith("MB"):
        return float(s[:-2])
    if upper.endswith("KB"):
        return float(s[:-2]) / 1000
    # Handle shorthand: 901k, 1.2M, 3G, etc.
    if upper.endswith("K"):
        return float(s[:-1]) / 1000
    if upper.endswith("M"):
        return float(s[:-1])
    if upper.endswith("G"):
        return float(s[:-1]) * 1000
    if upper.endswith("B"):
        return float(s[:-1]) / (1024 * 1024)
    try:
        return float(s) / (1024 * 1024)  # assume bytes
    except ValueError:
        return 0.0


def _parse_net(s: str) -> float:
    """Parse network size string → MB."""
    return _parse_size(s)


def _poll_once(container_filter: Optional[list[str]] = None) -> list[ContainerSnapshot]:
    """Run `docker stats --no-stream` once and parse output."""
    try:
        result = subprocess.run(
            [
                "docker", "stats", "--no-stream",
                "--format", "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}",
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return []

    if result.returncode != 0:
        return []

    ts = time.time()
    snapshots = []

    for line in result.stdout.strip().splitlines():
        parts = line.split("\t")
        if len(parts) < 5:
            continue

        name = parts[0].strip()

        # Apply container filter if specified
        if container_filter and not any(f in name for f in container_filter):
            continue

        cpu_str = parts[1].strip().rstrip("%")
        try:
            cpu_pct = float(cpu_str)
        except ValueError:
            cpu_pct = 0.0

        # Memory: "123.4MiB / 1.5GiB"
        mem_parts = parts[2].split("/")
        mem_usage = _parse_size(mem_parts[0]) if len(mem_parts) >= 1 else 0.0
        mem_limit = _parse_size(mem_parts[1]) if len(mem_parts) >= 2 else 0.0

        mem_pct_str = parts[3].strip().rstrip("%")
        try:
            mem_pct = float(mem_pct_str)
        except ValueError:
            mem_pct = 0.0

        # Network: "1.23MB / 4.56MB"
        net_parts = parts[4].split("/")
        net_in = _parse_net(net_parts[0]) if len(net_parts) >= 1 else 0.0
        net_out = _parse_net(net_parts[1]) if len(net_parts) >= 2 else 0.0

        snapshots.append(ContainerSnapshot(
            timestamp=ts,
            container=name,
            cpu_percent=cpu_pct,
            mem_usage_mb=mem_usage,
            mem_limit_mb=mem_limit,
            mem_percent=mem_pct,
            net_in_mb=net_in,
            net_out_mb=net_out,
        ))

    return snapshots


class DockerStatsCollector:
    """Background thread that polls Docker stats at a fixed interval."""

    def __init__(
        self,
        interval: float = 0.5,
        container_filter: Optional[list[str]] = None,
    ):
        self._interval = interval
        self._filter = container_filter  # e.g. ["api", "postgres", "redis"]
        self._lock = threading.Lock()
        self._current_ts: Optional[DockerTimeseries] = None
        self._all: dict[str, DockerTimeseries] = {}
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start_test(self, test_name: str) -> None:
        """Begin collecting for a specific test."""
        with self._lock:
            ts = DockerTimeseries(test_name=test_name)
            self._current_ts = ts
            self._all[test_name] = ts

        self._stop_event.clear()
        self._thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._thread.start()

    def stop_test(self) -> None:
        """Stop collecting for the current test."""
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5)
            self._thread = None
        with self._lock:
            self._current_ts = None

    def get_timeseries(self, test_name: str) -> Optional[DockerTimeseries]:
        with self._lock:
            return self._all.get(test_name)

    def all_timeseries(self) -> dict[str, DockerTimeseries]:
        with self._lock:
            return dict(self._all)

    def clear(self) -> None:
        with self._lock:
            self._all.clear()
            self._current_ts = None

    def _poll_loop(self) -> None:
        while not self._stop_event.is_set():
            snapshots = _poll_once(self._filter)
            with self._lock:
                if self._current_ts:
                    for snap in snapshots:
                        self._current_ts.add(snap)
            self._stop_event.wait(self._interval)


# Global singleton
docker_collector = DockerStatsCollector(
    interval=0.5,
    container_filter=["api", "postgres", "redis", "worker", "frontend", "traefik"],
)
