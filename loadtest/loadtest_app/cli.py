from __future__ import annotations

import asyncio
from pathlib import Path
import select
import sys
import termios
import threading
import time
import tty

from playwright.async_api import async_playwright
from rich.console import Console
from rich.live import Live

from .config import load_config, parse_args
from .journey import run_user_journey, run_user_journey_api
from .metrics import MetricsStore
from .ui import build_dashboard, legend_panel


class ControlState:
    def __init__(self) -> None:
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.stop = False


def start_keyboard_thread(ctrl: ControlState) -> threading.Thread | None:
    if not sys.stdin.isatty():
        return None

    def run() -> None:
        fd = sys.stdin.fileno()
        old = termios.tcgetattr(fd)
        try:
            tty.setcbreak(fd)
            while not ctrl.stop:
                r, _, _ = select.select([sys.stdin], [], [], 0.2)
                if r:
                    ch = sys.stdin.read(1)
                    if ch:
                        try:
                            ctrl.queue.put_nowait(ch)
                        except Exception:
                            pass
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, old)

    t = threading.Thread(target=run, daemon=True)
    t.start()
    return t


async def orchestrate() -> int:
    args = parse_args()
    cfg = load_config(args)

    console = Console()
    metrics = MetricsStore(recent_limit=cfg.recent_events_limit)
    metrics.planned = cfg.planned_users
    metrics.current_target_concurrency = cfg.start_concurrency

    csv_candidate = Path(cfg.csv_path)
    if not csv_candidate.is_absolute():
        csv_candidate = Path.cwd() / csv_candidate
    if not csv_candidate.exists():
        console.print(f"[red]CSV non trovato:[/red] {csv_candidate}")
        console.print("Suggerimento: copia `loadtest/config.example.yaml` in `loadtest/config.yaml` e aggiorna `csv_path`.")
        return 2

    ctrl = ControlState()
    keyboard_thread = start_keyboard_thread(ctrl)

    running_tasks: set[asyncio.Task] = set()
    launched = 0
    user_id = 0
    last_ramp_at = time.monotonic()

    async def scheduler_loop(launch_one) -> None:
        nonlocal launched, user_id, last_ramp_at, running_tasks
        with Live(build_dashboard(await metrics.snapshot()), refresh_per_second=cfg.refresh_hz, console=console) as live:
            live.console.print(legend_panel())
            while True:
                now = time.monotonic()

                while not ctrl.queue.empty():
                    k = await ctrl.queue.get()
                    if k.lower() == "p":
                        metrics.ramp_paused = not metrics.ramp_paused
                    elif k == "+":
                        metrics.current_target_concurrency += 1
                    elif k == "-":
                        metrics.current_target_concurrency = max(1, metrics.current_target_concurrency - 1)
                    elif k.lower() == "q":
                        metrics.stop_requested = True

                if not metrics.ramp_paused and (now - last_ramp_at) >= cfg.ramp_every_seconds:
                    metrics.current_target_concurrency = min(
                        cfg.max_concurrency,
                        metrics.current_target_concurrency + cfg.ramp_step_users,
                    )
                    last_ramp_at = now

                done = {t for t in running_tasks if t.done()}
                running_tasks.difference_update(done)

                if not metrics.stop_requested:
                    active = len(running_tasks)
                    can_launch = metrics.current_target_concurrency - active
                    while can_launch > 0 and launched < cfg.planned_users:
                        user_id += 1
                        launched += 1
                        t = asyncio.create_task(launch_one(user_id))
                        running_tasks.add(t)
                        can_launch -= 1

                snapshot = await metrics.snapshot()
                live.update(build_dashboard(snapshot), refresh=True)

                if launched >= cfg.planned_users and not running_tasks:
                    break
                if metrics.stop_requested and not running_tasks:
                    break

                await asyncio.sleep(0.2)

    if cfg.journey_mode == "ui":
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=cfg.headless, slow_mo=cfg.slow_mo_ms)

            async def launch_one(uid: int) -> None:
                await run_user_journey(uid, browser, cfg, metrics)

            await scheduler_loop(launch_one)
            await browser.close()
    else:
        async def launch_one(uid: int) -> None:
            await run_user_journey_api(uid, cfg, metrics)

        await scheduler_loop(launch_one)

    ctrl.stop = True
    if keyboard_thread is not None:
        keyboard_thread.join(timeout=0.5)

    final = await metrics.snapshot()
    console.print(
        f"[bold]Risultato:[/bold] completati={final['completed']} falliti={final['failed']} "
        f"su pianificati={final['planned']}"
    )
    return 0 if final["failed"] == 0 else 1


def main() -> int:
    try:
        return asyncio.run(orchestrate())
    except KeyboardInterrupt:
        return 130
