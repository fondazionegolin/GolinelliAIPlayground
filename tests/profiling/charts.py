"""
Chart generator for profiling data.

Reads the JSON outputs from the profiling plugin and produces matplotlib charts:
- Per-test bar charts: wall time, CPU time, memory delta
- Docker timeseries plots: CPU% and memory over time per container per test
- Summary comparison charts across all tests

Usage:
    python -m tests.profiling.charts [--input reports/profiling] [--output reports/profiling/charts]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")  # non-interactive backend
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker


COLORS = {
    "api": "#3498db",
    "postgres": "#2ecc71",
    "redis": "#e74c3c",
    "worker": "#f39c12",
    "frontend": "#9b59b6",
    "traefik": "#1abc9c",
}


def _color_for(container: str) -> str:
    for key, color in COLORS.items():
        if key in container.lower():
            return color
    return "#95a5a6"


def _short_name(test_id: str) -> str:
    """Shorten 'tests/integration/test_llm.py::TestChat::test_send_message' → 'test_send_message'."""
    parts = test_id.split("::")
    return parts[-1] if parts else test_id


# ---------------------------------------------------------------------------
# App-level charts
# ---------------------------------------------------------------------------

def plot_app_summary(app_data: dict, output_dir: Path, top_n: int = 25) -> None:
    """Bar chart comparing wall_ms, cpu_ms, mem_delta across tests (top N)."""
    if not app_data:
        return

    rows = []
    for test_id, profiles in app_data.items():
        if not profiles:
            continue
        total_wall = sum(p["wall_ms"] for p in profiles)
        total_cpu = sum(p["cpu_ms"] for p in profiles)
        max_mem = max((p["mem_delta_mb"] for p in profiles), default=0)
        rows.append((_short_name(test_id), total_wall, total_cpu, max_mem))

    if not rows:
        return

    def _plot_top(rows_sorted, value_idx, filename, xlabel, title, color, edge):
        top = rows_sorted[:top_n]
        names = [r[0] for r in top]
        values = [r[value_idx] for r in top]
        fig, ax = plt.subplots(figsize=(12, max(6, len(names) * 0.35)))
        bars = ax.barh(names, values, color=color, edgecolor=edge)
        ax.set_xlabel(xlabel)
        ax.set_title(f"{title} (top {len(names)})")
        ax.invert_yaxis()
        for bar, val in zip(bars, values):
            ax.text(bar.get_width() + max(values) * 0.01,
                    bar.get_y() + bar.get_height() / 2,
                    f"{val:.1f}", va="center", fontsize=8)
        plt.tight_layout()
        fig.savefig(output_dir / filename, dpi=150)
        plt.close(fig)

    # Wall time — sorted descending
    _plot_top(sorted(rows, key=lambda r: r[1], reverse=True), 1,
              "app_wall_time.png", "Total Wall Time (ms)",
              "Wall Clock Time per Test", "#3498db", "#2980b9")

    # CPU time
    _plot_top(sorted(rows, key=lambda r: r[2], reverse=True), 2,
              "app_cpu_time.png", "Total CPU Time (ms)",
              "CPU Time per Test", "#e74c3c", "#c0392b")

    # Memory delta
    mem_sorted = sorted(rows, key=lambda r: abs(r[3]), reverse=True)[:top_n]
    names = [r[0] for r in mem_sorted]
    mems = [r[3] for r in mem_sorted]
    fig, ax = plt.subplots(figsize=(12, max(6, len(names) * 0.35)))
    colors = ["#e74c3c" if m > 0 else "#2ecc71" for m in mems]
    ax.barh(names, mems, color=colors)
    ax.set_xlabel("Peak Memory Delta (MB)")
    ax.set_title(f"Memory Impact per Test (top {len(names)})")
    ax.invert_yaxis()
    ax.axvline(x=0, color="gray", linewidth=0.5)
    plt.tight_layout()
    fig.savefig(output_dir / "app_memory_delta.png", dpi=150)
    plt.close(fig)


def plot_app_per_request(app_data: dict, output_dir: Path) -> None:
    """Per-test breakdown: each request's wall time as a stacked timeline."""
    if not app_data:
        return

    per_test_dir = output_dir / "per_test"
    per_test_dir.mkdir(exist_ok=True)

    for test_id, profiles in app_data.items():
        if len(profiles) < 2:
            continue

        short = _short_name(test_id)
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 6), sharex=True)

        requests = [f"{p['method']} {p['path']}" for p in profiles]
        walls = [p["wall_ms"] for p in profiles]
        cpus = [p["cpu_ms"] for p in profiles]
        mems = [p["mem_delta_mb"] for p in profiles]

        x = range(len(profiles))

        ax1.bar(x, walls, color="#3498db", alpha=0.8, label="Wall (ms)")
        ax1.bar(x, cpus, color="#e74c3c", alpha=0.8, label="CPU (ms)")
        ax1.set_ylabel("Time (ms)")
        ax1.legend()
        ax1.set_title(f"{short} — Request Breakdown")

        ax2.bar(x, mems, color="#2ecc71", alpha=0.8)
        ax2.set_ylabel("Memory Δ (MB)")
        ax2.set_xlabel("Request #")

        plt.tight_layout()
        fig.savefig(per_test_dir / f"{short}.png", dpi=150)
        plt.close(fig)


# ---------------------------------------------------------------------------
# Docker-level charts
# ---------------------------------------------------------------------------

def _is_single_snapshot(containers: dict) -> bool:
    """Check if all containers have only a single data point."""
    return all(len(snaps) <= 1 for snaps in containers.values())


def _plot_docker_bars(containers: dict, short: str, output_path: Path) -> None:
    """Bar chart for tests with only 1 snapshot (too fast for timeseries)."""
    names = []
    cpus = []
    mems = []
    colors = []

    for container_name, snaps in sorted(containers.items()):
        if not snaps:
            continue
        names.append(container_name.replace("dev_golinelli_ai-", "").rstrip("-1"))
        cpus.append(snaps[0]["cpu_percent"])
        mems.append(snaps[0]["mem_usage_mb"])
        colors.append(_color_for(container_name))

    if not names:
        return

    fig, (ax_cpu, ax_mem) = plt.subplots(1, 2, figsize=(14, 5))

    ax_cpu.barh(names, cpus, color=colors)
    ax_cpu.set_xlabel("CPU %")
    ax_cpu.set_title(f"{short} — CPU Snapshot")
    for i, v in enumerate(cpus):
        ax_cpu.text(v + max(cpus) * 0.02, i, f"{v:.2f}%", va="center", fontsize=8)

    ax_mem.barh(names, mems, color=colors)
    ax_mem.set_xlabel("Memory (MB)")
    ax_mem.set_title(f"{short} — Memory Snapshot")
    for i, v in enumerate(mems):
        ax_mem.text(v + max(mems) * 0.02, i, f"{v:.0f}", va="center", fontsize=8)

    plt.tight_layout()
    fig.savefig(output_path, dpi=150)
    plt.close(fig)


def plot_docker_timeseries(docker_data: dict, output_dir: Path) -> None:
    """Per-test charts: timeseries if multiple snapshots, bar chart if single."""
    if not docker_data:
        return

    docker_dir = output_dir / "docker"
    docker_dir.mkdir(exist_ok=True)

    for test_id, containers in docker_data.items():
        if not containers:
            continue

        short = _short_name(test_id)
        out_path = docker_dir / f"{short}.png"

        # Single snapshot → bar chart
        if _is_single_snapshot(containers):
            _plot_docker_bars(containers, short, out_path)
            continue

        # Multiple snapshots → timeseries line plot
        fig, (ax_cpu, ax_mem) = plt.subplots(2, 1, figsize=(12, 7), sharex=True)

        for container_name, snaps in containers.items():
            if not snaps:
                continue

            t0 = snaps[0]["timestamp"]
            times = [(s["timestamp"] - t0) for s in snaps]
            cpus = [s["cpu_percent"] for s in snaps]
            mems = [s["mem_usage_mb"] for s in snaps]
            color = _color_for(container_name)

            ax_cpu.plot(times, cpus, label=container_name, color=color,
                        linewidth=1.5, marker="o", markersize=3)
            ax_mem.plot(times, mems, label=container_name, color=color,
                        linewidth=1.5, marker="o", markersize=3)

        ax_cpu.set_ylabel("CPU %")
        ax_cpu.set_title(f"{short} — Docker Container Resources")
        ax_cpu.legend(fontsize=8, loc="upper right")
        ax_cpu.grid(True, alpha=0.3)

        ax_mem.set_ylabel("Memory (MB)")
        ax_mem.set_xlabel("Time (seconds)")
        ax_mem.legend(fontsize=8, loc="upper right")
        ax_mem.grid(True, alpha=0.3)

        plt.tight_layout()
        fig.savefig(out_path, dpi=150)
        plt.close(fig)


def plot_docker_summary(docker_data: dict, output_dir: Path) -> None:
    """Summary: peak CPU and memory per container across all tests."""
    if not docker_data:
        return

    # Aggregate peak stats per container across all tests
    peak_cpu: dict[str, float] = {}
    peak_mem: dict[str, float] = {}

    for test_id, containers in docker_data.items():
        for container_name, snaps in containers.items():
            if not snaps:
                continue
            max_cpu = max(s["cpu_percent"] for s in snaps)
            max_mem = max(s["mem_usage_mb"] for s in snaps)
            peak_cpu[container_name] = max(peak_cpu.get(container_name, 0), max_cpu)
            peak_mem[container_name] = max(peak_mem.get(container_name, 0), max_mem)

    if not peak_cpu:
        return

    containers = sorted(peak_cpu.keys())
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))

    colors = [_color_for(c) for c in containers]

    # Peak CPU
    ax1.barh(containers, [peak_cpu[c] for c in containers], color=colors)
    ax1.set_xlabel("Peak CPU %")
    ax1.set_title("Peak CPU Usage per Container")

    # Peak Memory
    ax2.barh(containers, [peak_mem[c] for c in containers], color=colors)
    ax2.set_xlabel("Peak Memory (MB)")
    ax2.set_title("Peak Memory Usage per Container")

    plt.tight_layout()
    fig.savefig(output_dir / "docker_peak_summary.png", dpi=150)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def generate_all_charts(input_dir: Path, output_dir: Path) -> None:
    """Generate all charts from profiling JSON data."""
    output_dir.mkdir(parents=True, exist_ok=True)

    # App-level data
    app_file = input_dir / "app_profiles.json"
    if app_file.exists():
        app_data = json.loads(app_file.read_text())
        print(f"  App profiles: {len(app_data)} tests")
        plot_app_summary(app_data, output_dir)
        plot_app_per_request(app_data, output_dir)

    # Docker data
    docker_file = input_dir / "docker_stats.json"
    if docker_file.exists():
        docker_data = json.loads(docker_file.read_text())
        print(f"  Docker stats: {len(docker_data)} tests")
        plot_docker_timeseries(docker_data, output_dir)
        plot_docker_summary(docker_data, output_dir)

    print(f"  Charts saved to {output_dir}")


def main():
    parser = argparse.ArgumentParser(description="Generate profiling charts")
    parser.add_argument(
        "--input", type=Path, default=Path("reports/profiling"),
        help="Directory containing profiling JSON data",
    )
    parser.add_argument(
        "--output", type=Path, default=None,
        help="Output directory for charts (default: <input>/charts)",
    )
    args = parser.parse_args()

    output = args.output or args.input / "charts"
    print("Generating profiling charts...")
    generate_all_charts(args.input, output)
    print("Done.")


if __name__ == "__main__":
    main()
