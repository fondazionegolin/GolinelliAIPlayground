from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
import argparse
import yaml


@dataclass
class LoadTestConfig:
    journey_mode: str = "api"
    base_url: str = "http://localhost:5173"
    join_code: str = "XYLAS"
    message: str = "come faccio a calcolare la radice quadrata di un numero"
    csv_path: str = "dataset_1772097045952.csv"

    planned_users: int = 50
    start_concurrency: int = 3
    max_concurrency: int = 20
    ramp_step_users: int = 2
    ramp_every_seconds: float = 10.0

    action_timeout_seconds: float = 30.0
    headless: bool = True
    slow_mo_ms: int = 0

    wait_chat_response_seconds: float = 45.0
    wait_training_seconds: float = 40.0

    refresh_hz: int = 4
    recent_events_limit: int = 18

    @property
    def action_timeout_ms(self) -> int:
        return int(self.action_timeout_seconds * 1000)


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Config file non trovato: {path}")
    with path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        raise ValueError("Il file YAML deve contenere una mappa chiave/valore.")
    return data


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Student journey load test (join -> chatbot -> ML Lab)")
    p.add_argument("--config", default="loadtest/config.yaml", help="Path config YAML")
    p.add_argument("--base-url")
    p.add_argument("--journey-mode", choices=["api", "ui"], help="Journey execution mode")
    p.add_argument("--join-code")
    p.add_argument("--message")
    p.add_argument("--csv-path")

    p.add_argument("--planned-users", type=int)
    p.add_argument("--start-concurrency", type=int)
    p.add_argument("--max-concurrency", type=int)
    p.add_argument("--ramp-step-users", type=int)
    p.add_argument("--ramp-every-seconds", type=float)

    p.add_argument("--action-timeout-seconds", type=float)
    p.add_argument("--wait-chat-response-seconds", type=float)
    p.add_argument("--wait-training-seconds", type=float)
    p.add_argument("--headful", action="store_true", help="Run browser non-headless")
    p.add_argument("--slow-mo-ms", type=int)

    return p.parse_args()


def load_config(args: argparse.Namespace) -> LoadTestConfig:
    cfg = LoadTestConfig()

    config_path = Path(args.config)
    if config_path.exists():
        raw = _load_yaml(config_path)
        for k, v in raw.items():
            if hasattr(cfg, k):
                setattr(cfg, k, v)

    overrides = {
        "base_url": args.base_url,
        "journey_mode": args.journey_mode,
        "join_code": args.join_code,
        "message": args.message,
        "csv_path": args.csv_path,
        "planned_users": args.planned_users,
        "start_concurrency": args.start_concurrency,
        "max_concurrency": args.max_concurrency,
        "ramp_step_users": args.ramp_step_users,
        "ramp_every_seconds": args.ramp_every_seconds,
        "action_timeout_seconds": args.action_timeout_seconds,
        "wait_chat_response_seconds": args.wait_chat_response_seconds,
        "wait_training_seconds": args.wait_training_seconds,
        "slow_mo_ms": args.slow_mo_ms,
    }
    for k, v in overrides.items():
        if v is not None:
            setattr(cfg, k, v)

    if args.headful:
        cfg.headless = False

    cfg.start_concurrency = max(1, int(cfg.start_concurrency))
    cfg.max_concurrency = max(cfg.start_concurrency, int(cfg.max_concurrency))
    cfg.ramp_step_users = max(1, int(cfg.ramp_step_users))
    cfg.planned_users = max(1, int(cfg.planned_users))
    cfg.refresh_hz = max(1, int(cfg.refresh_hz))
    cfg.recent_events_limit = max(5, int(cfg.recent_events_limit))

    return cfg
