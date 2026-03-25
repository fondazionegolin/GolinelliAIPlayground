"""
Orchestration script: runs Docker benchmark + test suite together.

Usage:
    python -m tests.performance.benchmark_runner [--duration 300] [--project dev_golinelli_ai]

This script:
  1. Starts infrastructure/benchmark/benchmark_docker.sh in background
  2. Runs pytest E2E + performance tests
  3. Waits for benchmark to finish
  4. Feeds results into the unified reporting collector
"""

import argparse
import asyncio
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
BENCHMARK_SCRIPT = ROOT / "infrastructure" / "benchmark" / "benchmark_docker.sh"
REPORTS_DIR = ROOT / "reports"


def main():
    parser = argparse.ArgumentParser(description="Run full benchmark suite")
    parser.add_argument("--duration", type=int, default=300, help="Benchmark duration in seconds")
    parser.add_argument("--project", type=str, default="dev_golinelli_ai", help="Docker compose project name")
    parser.add_argument("--students", type=int, default=10, help="Number of concurrent students for E2E")
    args = parser.parse_args()

    REPORTS_DIR.mkdir(exist_ok=True)

    # 1. Start Docker benchmark in background
    print(f"[benchmark] Starting Docker stats monitoring ({args.duration}s)...")
    bench_proc = None
    if BENCHMARK_SCRIPT.exists():
        bench_proc = subprocess.Popen(
            [
                "bash", str(BENCHMARK_SCRIPT),
                "--project", args.project,
                "--duration", str(args.duration),
                "--interval", "2",
                "--cpu-spike", "150",
                "--mem-spike-mib", "1024",
            ],
            cwd=str(REPORTS_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    else:
        print(f"[benchmark] Warning: {BENCHMARK_SCRIPT} not found, skipping Docker monitoring")

    # 2. Run pytest test suites
    print("[benchmark] Running E2E and performance tests...")
    env = os.environ.copy()
    # Ensure backend app is importable
    backend_dir = str(ROOT / "backend")
    env["PYTHONPATH"] = backend_dir + os.pathsep + env.get("PYTHONPATH", "")
    pytest_args = [
        sys.executable, "-m", "pytest",
        "tests/e2e/", "tests/performance/",
        "-v",
        "--run-e2e",
        "--run-benchmark",
        f"--timeout={args.duration}",
        f"--json-report",
        f"--json-report-file={REPORTS_DIR}/pytest_results.json",
    ]
    test_result = subprocess.run(pytest_args, cwd=str(ROOT), env=env)

    # 3. Wait for benchmark to finish
    if bench_proc:
        print("[benchmark] Waiting for Docker stats collection to complete...")
        bench_proc.wait()

    # 4. Run collector to generate unified report
    print("[benchmark] Generating unified report...")
    try:
        from tests.reporting.collector import collect_and_generate
        collect_and_generate(str(REPORTS_DIR))
        print(f"[benchmark] Report generated at {REPORTS_DIR}/")
    except ImportError:
        print("[benchmark] Collector not yet implemented — raw results in reports/")

    return test_result.returncode


if __name__ == "__main__":
    sys.exit(main())
