"""
Unified report collector — merges results from pytest, loadtest, and Docker benchmark.

Usage:
    python -m tests.reporting.collector [reports_dir]
"""

from __future__ import annotations

import csv
import glob
import json
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from .html_report import render_html_report
from .json_report import export_json_report


@dataclass
class TestResult:
    name: str
    status: str  # "passed", "failed", "skipped", "error"
    duration_s: float = 0.0
    error_message: str = ""


@dataclass
class LatencyStats:
    endpoint: str
    count: int = 0
    avg_ms: float = 0.0
    p50_ms: float = 0.0
    p95_ms: float = 0.0
    max_ms: float = 0.0


@dataclass
class ContainerStats:
    name: str
    max_cpu_pct: float = 0.0
    avg_cpu_pct: float = 0.0
    max_mem_mib: float = 0.0
    avg_mem_mib: float = 0.0
    samples: int = 0


@dataclass
class SpikeEvent:
    timestamp: str
    container: str
    cpu_pct: float = 0.0
    mem_mib: float = 0.0
    reason: str = ""


@dataclass
class TestReport:
    timestamp: str = ""
    test_results: list[TestResult] = field(default_factory=list)
    api_latency: list[LatencyStats] = field(default_factory=list)
    resource_usage: list[ContainerStats] = field(default_factory=list)
    spike_events: list[SpikeEvent] = field(default_factory=list)
    loadtest_summary: dict[str, Any] = field(default_factory=dict)

    @property
    def total_tests(self) -> int:
        return len(self.test_results)

    @property
    def passed(self) -> int:
        return sum(1 for t in self.test_results if t.status == "passed")

    @property
    def failed(self) -> int:
        return sum(1 for t in self.test_results if t.status == "failed")

    @property
    def skipped(self) -> int:
        return sum(1 for t in self.test_results if t.status == "skipped")


def collect_report(reports_dir: str) -> TestReport:
    """Collect all available results from the reports directory."""
    report = TestReport(timestamp=datetime.now().isoformat())
    path = Path(reports_dir)

    # 1. Parse pytest JSON results
    pytest_file = path / "pytest_results.json"
    if pytest_file.exists():
        _parse_pytest_results(pytest_file, report)

    # 2. Parse loadtest metrics JSON
    for f in sorted(path.glob("loadtest_metrics_*.json")):
        _parse_loadtest_metrics(f, report)

    # 3. Parse Docker benchmark summary CSV (may be in subdirectories)
    for f in sorted(path.rglob("docker_summary_*.csv")):
        _parse_docker_summary(f, report)

    # 4. Parse Docker spike events CSV (may be in subdirectories)
    for f in sorted(path.rglob("docker_spikes_*.csv")):
        _parse_docker_spikes(f, report)

    return report


def _parse_pytest_results(filepath: Path, report: TestReport) -> None:
    """Parse pytest-json-report output."""
    try:
        with open(filepath) as f:
            data = json.load(f)
        for test in data.get("tests", []):
            report.test_results.append(TestResult(
                name=test.get("nodeid", "unknown"),
                status=test.get("outcome", "unknown"),
                duration_s=test.get("duration", 0.0),
                error_message=_extract_error(test),
            ))
    except (json.JSONDecodeError, KeyError):
        pass


def _extract_error(test: dict) -> str:
    """Extract error message from pytest test result."""
    call = test.get("call", {})
    if call.get("crash"):
        return call["crash"].get("message", "")
    if call.get("longrepr"):
        return str(call["longrepr"])[:500]
    return ""


def _parse_loadtest_metrics(filepath: Path, report: TestReport) -> None:
    """Parse loadtest MetricsStore JSON export."""
    try:
        with open(filepath) as f:
            data = json.load(f)

        report.loadtest_summary = {
            "started": data.get("started", 0),
            "completed": data.get("completed", 0),
            "failed": data.get("failed", 0),
            "feature_counts": data.get("feature_counts", {}),
        }

        # Extract API timing stats
        for endpoint, stats in data.get("api_stats", {}).items():
            report.api_latency.append(LatencyStats(
                endpoint=endpoint,
                count=int(stats.get("count", 0)),
                avg_ms=stats.get("avg", 0.0),
                p50_ms=stats.get("p50", 0.0),
                p95_ms=stats.get("p95", 0.0),
                max_ms=stats.get("max", 0.0),
            ))
    except (json.JSONDecodeError, KeyError):
        pass


def _parse_docker_summary(filepath: Path, report: TestReport) -> None:
    """Parse docker_summary_*.csv from benchmark_docker.sh."""
    try:
        with open(filepath) as f:
            reader = csv.DictReader(f)
            for row in reader:
                report.resource_usage.append(ContainerStats(
                    name=row.get("container", "unknown"),
                    max_cpu_pct=float(row.get("max_cpu_pct", 0)),
                    avg_cpu_pct=float(row.get("avg_cpu_pct", 0)),
                    max_mem_mib=float(row.get("max_mem_mib", 0)),
                    avg_mem_mib=float(row.get("avg_mem_mib", 0)),
                    samples=int(row.get("samples", 0)),
                ))
    except (csv.Error, ValueError, KeyError):
        pass


def _parse_docker_spikes(filepath: Path, report: TestReport) -> None:
    """Parse docker_spikes_*.csv from benchmark_docker.sh."""
    try:
        with open(filepath) as f:
            reader = csv.DictReader(f)
            for row in reader:
                report.spike_events.append(SpikeEvent(
                    timestamp=row.get("timestamp", ""),
                    container=row.get("container", "unknown"),
                    cpu_pct=float(row.get("cpu_pct", 0)),
                    mem_mib=float(row.get("mem_mib", 0)),
                    reason=row.get("reason", ""),
                ))
    except (csv.Error, ValueError, KeyError):
        pass


def collect_and_generate(reports_dir: str) -> None:
    """Collect results and generate both HTML and JSON reports."""
    report = collect_report(reports_dir)
    path = Path(reports_dir)

    html_path = path / "report.html"
    render_html_report(report, str(html_path))
    print(f"HTML report: {html_path}")

    json_path = path / "report.json"
    export_json_report(report, str(json_path))
    print(f"JSON report: {json_path}")


if __name__ == "__main__":
    reports_dir = sys.argv[1] if len(sys.argv) > 1 else "reports"
    collect_and_generate(reports_dir)
