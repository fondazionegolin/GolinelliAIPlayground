#!/usr/bin/env bash
# ---------------------------------------------------------------
# GolinelliAI Benchmark Runner
#
# Runs integration tests with app-level + Docker profiling,
# then generates resource usage charts.
#
# Usage:
#   ./run_benchmark.sh                  # all integration tests
#   ./run_benchmark.sh --quick          # skip Docker stats (faster)
#   ./run_benchmark.sh --tests "test_llm.py test_chat.py"  # specific files
#   ./run_benchmark.sh --docker-duration 300  # also run standalone Docker monitoring
# ---------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
VENV="$BACKEND_DIR/.venv/bin/python"
REPORTS_DIR="$SCRIPT_DIR/reports"
TESTS_DIR="$SCRIPT_DIR/tests"

DATABASE_URL="${DATABASE_URL:-postgresql+asyncpg://eduai:eduai_secure_2025@localhost:5432/eduai}"
PROJECT_NAME="${PROJECT_NAME:-dev_golinelli_ai}"

# Defaults
SKIP_DOCKER=0
TEST_FILES=""
DOCKER_DURATION=0
EXTRA_PYTEST_ARGS=""

usage() {
    cat <<'EOF'
Usage: ./run_benchmark.sh [options]

Options:
  --quick                 Skip Docker container stats (app-level profiling only)
  --tests "file1 file2"   Run specific test files (relative to tests/integration/)
  --docker-duration <s>   Run standalone Docker monitoring for <s> seconds alongside tests
  --timeout <s>           Per-test timeout in seconds (default: 60)
  --pytest-args "..."     Extra arguments to pass to pytest
  -h, --help              Show this help
EOF
}

TIMEOUT=60

while [[ $# -gt 0 ]]; do
    case "$1" in
        --quick)          SKIP_DOCKER=1; shift ;;
        --tests)          TEST_FILES="$2"; shift 2 ;;
        --docker-duration) DOCKER_DURATION="$2"; shift 2 ;;
        --timeout)        TIMEOUT="$2"; shift 2 ;;
        --pytest-args)    EXTRA_PYTEST_ARGS="$2"; shift 2 ;;
        -h|--help)        usage; exit 0 ;;
        *)                echo "Unknown option: $1"; usage; exit 1 ;;
    esac
done

# ---------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------
if [[ ! -f "$VENV" ]]; then
    echo "ERROR: Python venv not found at $VENV"
    echo "Run: cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
    exit 1
fi

if ! docker info >/dev/null 2>&1; then
    echo "WARNING: Docker not available — skipping Docker stats"
    SKIP_DOCKER=1
fi

if [[ "$SKIP_DOCKER" -eq 0 ]] && ! docker ps --filter "label=com.docker.compose.project=${PROJECT_NAME}" --format '{{.Names}}' | grep -q .; then
    echo "WARNING: No containers found for project '$PROJECT_NAME' — skipping Docker stats"
    SKIP_DOCKER=1
fi

mkdir -p "$REPORTS_DIR/profiling"

# ---------------------------------------------------------------
# Build test path list
# ---------------------------------------------------------------
if [[ -n "$TEST_FILES" ]]; then
    TEST_PATHS=""
    for f in $TEST_FILES; do
        TEST_PATHS="$TEST_PATHS $TESTS_DIR/integration/$f"
    done
else
    TEST_PATHS="$TESTS_DIR/integration/"
fi

# ---------------------------------------------------------------
# Build pytest command
# ---------------------------------------------------------------
PROFILE_FLAGS="--profile"
if [[ "$SKIP_DOCKER" -eq 0 ]]; then
    PROFILE_FLAGS="$PROFILE_FLAGS --profile-docker"
fi

PYTEST_CMD=(
    "$VENV" -m pytest
    $TEST_PATHS
    -v
    $PROFILE_FLAGS
    --timeout="$TIMEOUT"
    --json-report
    --json-report-file="$REPORTS_DIR/pytest_results.json"
)

if [[ -n "$EXTRA_PYTEST_ARGS" ]]; then
    PYTEST_CMD+=($EXTRA_PYTEST_ARGS)
fi

# ---------------------------------------------------------------
# Optionally start standalone Docker monitoring in background
# ---------------------------------------------------------------
BENCH_PID=""
if [[ "$DOCKER_DURATION" -gt 0 ]]; then
    BENCH_SCRIPT="$SCRIPT_DIR/infrastructure/benchmark/benchmark_docker.sh"
    if [[ -f "$BENCH_SCRIPT" ]]; then
        echo "=== Starting Docker stats monitoring (${DOCKER_DURATION}s) ==="
        bash "$BENCH_SCRIPT" \
            --project "$PROJECT_NAME" \
            --duration "$DOCKER_DURATION" \
            --interval 2 \
            --cpu-spike 150 \
            --mem-spike-mib 1024 \
            --out-dir "$REPORTS_DIR" \
            --quiet &
        BENCH_PID=$!
    fi
fi

# ---------------------------------------------------------------
# Run tests with profiling
# ---------------------------------------------------------------
echo ""
echo "=== GolinelliAI Benchmark ==="
echo "  Tests:    $TEST_PATHS"
echo "  Profile:  app-level$([ "$SKIP_DOCKER" -eq 0 ] && echo ' + Docker stats' || echo ' only')"
echo "  Timeout:  ${TIMEOUT}s per test"
echo "  Reports:  $REPORTS_DIR/profiling/"
echo ""

cd "$BACKEND_DIR"
export DATABASE_URL

set +e
"${PYTEST_CMD[@]}"
TEST_EXIT=$?
set -e

# ---------------------------------------------------------------
# Wait for Docker monitoring if running
# ---------------------------------------------------------------
if [[ -n "$BENCH_PID" ]]; then
    echo ""
    echo "=== Waiting for Docker stats collection ==="
    wait "$BENCH_PID" || true
fi

# ---------------------------------------------------------------
# Generate charts (already auto-generated by plugin, but re-run for standalone Docker data)
# ---------------------------------------------------------------
echo ""
echo "=== Generating charts ==="
"$VENV" "$TESTS_DIR/profiling/charts.py" \
    --input "$REPORTS_DIR/profiling" \
    --output "$REPORTS_DIR/profiling/charts"

# ---------------------------------------------------------------
# Summary
# ---------------------------------------------------------------
echo ""
echo "========================================="
echo "  Benchmark complete"
echo "========================================="
echo ""
echo "  Test result:  $([ $TEST_EXIT -eq 0 ] && echo 'ALL PASSED' || echo "EXIT CODE $TEST_EXIT")"
echo ""
echo "  Reports:"
echo "    JSON data:     $REPORTS_DIR/profiling/app_profiles.json"
if [[ "$SKIP_DOCKER" -eq 0 ]]; then
echo "    Docker data:   $REPORTS_DIR/profiling/docker_stats.json"
fi
echo "    Charts:        $REPORTS_DIR/profiling/charts/"
echo ""
echo "  Key charts:"
echo "    Wall time:     $REPORTS_DIR/profiling/charts/app_wall_time.png"
echo "    CPU time:      $REPORTS_DIR/profiling/charts/app_cpu_time.png"
echo "    Memory:        $REPORTS_DIR/profiling/charts/app_memory_delta.png"
if [[ "$SKIP_DOCKER" -eq 0 ]]; then
echo "    Docker peaks:  $REPORTS_DIR/profiling/charts/docker_peak_summary.png"
echo "    Per-test:      $REPORTS_DIR/profiling/charts/docker/"
fi
echo ""

exit $TEST_EXIT
