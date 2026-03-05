from __future__ import annotations

from typing import Any

from rich.align import Align
from rich.console import Group
from rich.layout import Layout
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from .metrics import STEP_ORDER


def build_dashboard(snapshot: dict[str, Any]) -> Layout:
    layout = Layout(name="root")
    layout.split_column(
        Layout(name="header", size=6),
        Layout(name="body", ratio=3),
        Layout(name="bottom", ratio=2),
    )

    layout["body"].split_row(Layout(name="steps", ratio=2), Layout(name="features", ratio=1))
    layout["bottom"].split_row(Layout(name="events", ratio=2), Layout(name="api", ratio=1))

    layout["header"].update(_header(snapshot))
    layout["steps"].update(_steps_table(snapshot))
    layout["features"].update(_features_table(snapshot))
    layout["events"].update(_events_table(snapshot))
    layout["api"].update(_api_table(snapshot))

    return layout


def _header(s: dict[str, Any]) -> Panel:
    paused = "[yellow]PAUSA[/yellow]" if s["ramp_paused"] else "[green]ATTIVO[/green]"
    stop = "[red]SI[/red]" if s["stop_requested"] else "[green]NO[/green]"
    txt = Text.from_markup(
        "[bold cyan]Load Test Studenti[/bold cyan]\n"
        f"Pianificati: [bold]{s['planned']}[/bold]   "
        f"Lanciati: [bold]{s['launched']}[/bold]   "
        f"Attivi: [bold magenta]{s['active']}[/bold magenta]   "
        f"Completati: [bold green]{s['completed']}[/bold green]   "
        f"Falliti: [bold red]{s['failed']}[/bold red]\n"
        f"Concorrenza target: [bold]{s['current_target_concurrency']}[/bold]   "
        f"Ramp: {paused}   Stop richiesto: {stop}\n"
        "Comandi: [bold]p[/bold]=pausa/riprendi  [bold]+[/bold]=aumenta concorrenza  "
        "[bold]-[/bold]=riduci concorrenza  [bold]q[/bold]=stop"
    )
    return Panel(Align.left(txt), border_style="bright_cyan")


def _steps_table(s: dict[str, Any]) -> Panel:
    t = Table(expand=True)
    t.add_column("Step", style="bold")
    t.add_column("OK", justify="right", style="green")
    t.add_column("FAIL", justify="right", style="red")
    t.add_column("AVG ms", justify="right", style="cyan")
    t.add_column("P95 ms", justify="right", style="magenta")

    stats = s.get("step_stats", {})
    for step in STEP_ORDER:
        row = stats.get(step, {"ok": 0, "fail": 0, "avg": 0, "p95": 0})
        t.add_row(
            step,
            str(int(row.get("ok", 0))),
            str(int(row.get("fail", 0))),
            f"{row.get('avg', 0):.1f}",
            f"{row.get('p95', 0):.1f}",
        )
    return Panel(t, title="Journey Metrics", border_style="bright_blue")


def _features_table(s: dict[str, Any]) -> Panel:
    f = s.get("feature_counts", {})
    t = Table(expand=True)
    t.add_column("Funzionalita", style="bold yellow")
    t.add_column("Count", justify="right", style="bold green")

    keys = [
        "students_joined",
        "class_chat_messages",
        "chat_requests",
        "csv_uploaded",
        "dataset_fallback_synthetic",
        "training_started",
        "training_completed",
    ]
    for k in keys:
        t.add_row(k, str(f.get(k, 0)))
    return Panel(t, title="Attivazioni", border_style="yellow")


def _events_table(s: dict[str, Any]) -> Panel:
    table = Table(expand=True)
    table.add_column("Ora", width=8)
    table.add_column("User", width=6, justify="right")
    table.add_column("Step", width=20)
    table.add_column("Esito", width=6)
    table.add_column("ms", width=9, justify="right")
    table.add_column("Nota")

    events = s.get("events", [])[-18:]
    for e in events:
        status = "[green]OK[/green]" if e.status in ("ok", "start") else "[red]FAIL[/red]"
        ms = "" if e.ms <= 0 else f"{e.ms:.1f}"
        note = (e.note or "")[:90]
        table.add_row(e.ts, str(e.user_id), e.step, status, ms, note)

    return Panel(table, title="Journey Timeline", border_style="green")


def _api_table(s: dict[str, Any]) -> Panel:
    api = s.get("api_stats", {})
    t = Table(expand=True)
    t.add_column("Endpoint", style="bold")
    t.add_column("N", justify="right", style="green")
    t.add_column("AVG", justify="right", style="cyan")
    t.add_column("P95", justify="right", style="magenta")

    rows = sorted(api.items(), key=lambda item: item[1].get("count", 0), reverse=True)[:8]
    for endpoint, vals in rows:
        t.add_row(
            endpoint[-40:],
            str(int(vals.get("count", 0))),
            f"{vals.get('avg', 0):.1f}",
            f"{vals.get('p95', 0):.1f}",
        )

    if not rows:
        t.add_row("-", "0", "0", "0")

    return Panel(t, title="API Latency", border_style="magenta")


def legend_panel() -> Panel:
    lines = Group(
        Text("Colori principali", style="bold white"),
        Text("Verde: successi", style="green"),
        Text("Rosso: errori", style="red"),
        Text("Ciano/Magenta: tempi risposta (avg/p95)", style="cyan"),
        Text("Giallo: feature journey attivate", style="yellow"),
    )
    return Panel(lines, border_style="white", title="Legenda")
