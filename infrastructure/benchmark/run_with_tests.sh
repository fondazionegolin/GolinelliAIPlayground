#!/usr/bin/env bash
# ---------------------------------------------------------------
# Full benchmark: Docker stats monitoring + E2E/performance tests
# ---------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPORTS_DIR="$PROJECT_ROOT/reports"
DURATION="${1:-300}"
PROJECT="${2:-dev_golinelli_ai}"

mkdir -p "$REPORTS_DIR"

echo "=== Starting Docker stats monitoring (${DURATION}s) ==="
bash "$SCRIPT_DIR/benchmark_docker.sh" \
    --project "$PROJECT" \
    --duration "$DURATION" \
    --interval 2 \
    --cpu-spike 150 \
    --mem-spike-mib 1024 &
BENCH_PID=$!

echo "=== Running E2E + performance tests ==="
cd "$PROJECT_ROOT/backend"
python -m pytest ../tests/e2e/ ../tests/performance/ \
    -v \
    --run-e2e \
    --run-benchmark \
    --timeout="$DURATION" \
    --json-report \
    --json-report-file="$REPORTS_DIR/pytest_results.json" \
    || true  # Don't exit if tests fail — still collect benchmark

echo "=== Waiting for Docker stats collection to complete ==="
wait "$BENCH_PID" || true

# Move benchmark outputs to reports dir
mv docker_stats_*.csv docker_summary_*.csv docker_spikes_*.csv "$REPORTS_DIR/" 2>/dev/null || true
mv spikes_*/ "$REPORTS_DIR/" 2>/dev/null || true

echo "=== Generating unified report ==="
cd "$PROJECT_ROOT"
python -m tests.reporting.collector "$REPORTS_DIR" 2>/dev/null || echo "(collector not yet implemented)"

echo ""
echo "=== Benchmark complete ==="
echo "Results in: $REPORTS_DIR/"
ls -la "$REPORTS_DIR/"
