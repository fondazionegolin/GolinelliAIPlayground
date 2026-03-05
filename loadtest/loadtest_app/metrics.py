from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime
import statistics
from typing import Any
import asyncio


STEP_ORDER = [
    "join",
    "class_chat_message",
    "open_chatbot",
    "chat_message",
    "open_ml_lab",
    "select_data_mode",
    "upload_csv",
    "start_training",
    "wait_training_result",
]


@dataclass
class StepStats:
    ok: int = 0
    fail: int = 0
    durations_ms: list[float] = field(default_factory=list)


@dataclass
class Event:
    ts: str
    user_id: int
    step: str
    status: str
    ms: float
    note: str = ""


class MetricsStore:
    def __init__(self, recent_limit: int = 18) -> None:
        self.lock = asyncio.Lock()
        self.started = 0
        self.completed = 0
        self.failed = 0
        self.active = 0

        self.planned = 0
        self.launched = 0
        self.current_target_concurrency = 0
        self.ramp_paused = False
        self.stop_requested = False

        self.step_stats: dict[str, StepStats] = defaultdict(StepStats)
        self.events: deque[Event] = deque(maxlen=recent_limit)

        self.feature_counts: dict[str, int] = defaultdict(int)
        self.api_timings: dict[str, list[float]] = defaultdict(list)

    async def mark_launched(self, user_id: int) -> None:
        async with self.lock:
            self.launched += 1
            self.started += 1
            self.active += 1
            self.events.append(Event(_now(), user_id, "journey", "start", 0.0, "user avviato"))

    async def mark_finished(self, user_id: int, ok: bool, note: str = "") -> None:
        async with self.lock:
            self.active = max(0, self.active - 1)
            if ok:
                self.completed += 1
                self.events.append(Event(_now(), user_id, "journey", "ok", 0.0, note or "journey completata"))
            else:
                self.failed += 1
                self.events.append(Event(_now(), user_id, "journey", "fail", 0.0, note or "journey fallita"))

    async def add_step(self, user_id: int, step: str, ok: bool, ms: float, note: str = "") -> None:
        async with self.lock:
            s = self.step_stats[step]
            if ok:
                s.ok += 1
                s.durations_ms.append(ms)
                status = "ok"
            else:
                s.fail += 1
                status = "fail"
            self.events.append(Event(_now(), user_id, step, status, ms, note))

    async def add_feature(self, key: str, amount: int = 1) -> None:
        async with self.lock:
            self.feature_counts[key] += amount

    async def add_api_timing(self, endpoint_key: str, ms: float) -> None:
        async with self.lock:
            self.api_timings[endpoint_key].append(ms)

    async def snapshot(self) -> dict[str, Any]:
        async with self.lock:
            return {
                "started": self.started,
                "completed": self.completed,
                "failed": self.failed,
                "active": self.active,
                "planned": self.planned,
                "launched": self.launched,
                "current_target_concurrency": self.current_target_concurrency,
                "ramp_paused": self.ramp_paused,
                "stop_requested": self.stop_requested,
                "step_stats": {k: _step_summary(v) for k, v in self.step_stats.items()},
                "events": list(self.events),
                "feature_counts": dict(self.feature_counts),
                "api_stats": {
                    k: _series_summary(v) for k, v in self.api_timings.items()
                },
            }


def _series_summary(values: list[float]) -> dict[str, float]:
    if not values:
        return {"count": 0, "avg": 0.0, "p50": 0.0, "p95": 0.0, "max": 0.0}
    p50 = statistics.quantiles(values, n=100)[49] if len(values) >= 2 else values[0]
    p95 = statistics.quantiles(values, n=100)[94] if len(values) >= 20 else max(values)
    return {
        "count": float(len(values)),
        "avg": float(sum(values) / len(values)),
        "p50": float(p50),
        "p95": float(p95),
        "max": float(max(values)),
    }


def _step_summary(s: StepStats) -> dict[str, float]:
    base = _series_summary(s.durations_ms)
    return {
        "ok": float(s.ok),
        "fail": float(s.fail),
        **base,
    }


def _now() -> str:
    return datetime.now().strftime("%H:%M:%S")
