#!/usr/bin/env bash
set -euo pipefail

DURATION_SECONDS=180
INTERVAL_SECONDS=2
PROJECT_NAME=""
OUT_DIR="benchmark"
CPU_SPIKE_PCT=120
MEM_SPIKE_MIB=1024
SPIKE_COOLDOWN_SECONDS=30
LOG_SINCE_SECONDS=30
QUIET=0

usage() {
  cat <<'USAGE'
Usage:
  benchmark_docker.sh [options]

Options:
  --duration <seconds>          Total benchmark duration (default: 180)
  --interval <seconds>          Sampling interval (default: 2)
  --project <compose_project>   Filter containers by compose project label
  --out-dir <dir>               Output directory (default: benchmark)
  --cpu-spike <pct>             Spike threshold for CPU percent (default: 120)
  --mem-spike-mib <mib>         Spike threshold for memory MiB (default: 1024)
  --spike-cooldown <seconds>    Cooldown between spike captures per container (default: 30)
  --log-since <seconds>         How far back logs are captured for spikes (default: 30)
  --quiet                       Reduce progress logs
  -h, --help                    Show this help
USAGE
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

mem_to_mib() {
  local value="$1"
  awk -v value="$value" 'BEGIN {
    gsub(/^ +| +$/, "", value)
    split(value, parts, " ")
    num = parts[1] + 0
    unit = parts[1]
    gsub(/[0-9.]/, "", unit)
    if (unit == "GiB")      printf "%.4f", num * 1024
    else if (unit == "MiB") printf "%.4f", num
    else if (unit == "KiB") printf "%.4f", num / 1024
    else if (unit == "B")   printf "%.4f", num / 1024 / 1024
    else                    printf "%.4f", num
  }'
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --duration)
        DURATION_SECONDS="$2"
        shift 2
        ;;
      --interval)
        INTERVAL_SECONDS="$2"
        shift 2
        ;;
      --project)
        PROJECT_NAME="$2"
        shift 2
        ;;
      --out-dir)
        OUT_DIR="$2"
        shift 2
        ;;
      --cpu-spike)
        CPU_SPIKE_PCT="$2"
        shift 2
        ;;
      --mem-spike-mib)
        MEM_SPIKE_MIB="$2"
        shift 2
        ;;
      --spike-cooldown)
        SPIKE_COOLDOWN_SECONDS="$2"
        shift 2
        ;;
      --log-since)
        LOG_SINCE_SECONDS="$2"
        shift 2
        ;;
      --quiet)
        QUIET=1
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        echo "Unknown argument: $1" >&2
        usage
        exit 1
        ;;
    esac
  done
}

parse_args "$@"

require_cmd docker
require_cmd awk
require_cmd sed
require_cmd date

if [[ "$DURATION_SECONDS" -le 0 || "$INTERVAL_SECONDS" -le 0 ]]; then
  echo "--duration and --interval must be > 0" >&2
  exit 1
fi

declare -a CONTAINERS
if [[ -n "$PROJECT_NAME" ]]; then
  mapfile -t CONTAINERS < <(docker ps --filter "label=com.docker.compose.project=${PROJECT_NAME}" --format '{{.Names}}')
else
  mapfile -t CONTAINERS < <(docker ps --format '{{.Names}}')
fi

if [[ "${#CONTAINERS[@]}" -eq 0 ]]; then
  if [[ -n "$PROJECT_NAME" ]]; then
    echo "No running containers found for compose project: ${PROJECT_NAME}" >&2
  else
    echo "No running containers found." >&2
  fi
  exit 1
fi

mkdir -p "$OUT_DIR"
RUN_ID="$(date +%Y%m%d_%H%M%S)"
RAW_CSV="${OUT_DIR}/docker_stats_${RUN_ID}.csv"
SPIKES_CSV="${OUT_DIR}/docker_spikes_${RUN_ID}.csv"
SUMMARY_CSV="${OUT_DIR}/docker_summary_${RUN_ID}.csv"
SPIKE_DIR="${OUT_DIR}/spikes_${RUN_ID}"
mkdir -p "$SPIKE_DIR"

echo "timestamp,name,cpu_perc,mem_usage,mem_perc,pids" > "$RAW_CSV"
echo "timestamp,name,cpu_perc,mem_mib,reason,top_file,logs_file" > "$SPIKES_CSV"

declare -A LAST_SPIKE_TS

ITERATIONS=$(( (DURATION_SECONDS + INTERVAL_SECONDS - 1) / INTERVAL_SECONDS ))

if [[ "$QUIET" -eq 0 ]]; then
  echo "Benchmark started: ${#CONTAINERS[@]} containers, ${DURATION_SECONDS}s duration, ${INTERVAL_SECONDS}s interval."
  echo "Project filter: ${PROJECT_NAME:-<none>}"
fi

for ((i=1; i<=ITERATIONS; i++)); do
  timestamp="$(date -Iseconds)"

  while IFS= read -r line; do
    [[ -z "$line" ]] && continue

    IFS=',' read -r name cpu_perc mem_usage mem_perc pids <<< "$line"

    printf "%s,%s,%s,%s,%s,%s\n" \
      "$timestamp" "$name" "$cpu_perc" "$mem_usage" "$mem_perc" "$pids" >> "$RAW_CSV"

    cpu_value="$(echo "$cpu_perc" | tr -d '%')"
    mem_current="${mem_usage%%/*}"
    mem_mib="$(mem_to_mib "$mem_current")"

    cpu_spike="$(awk -v cpu="$cpu_value" -v t="$CPU_SPIKE_PCT" 'BEGIN { print (cpu >= t) ? 1 : 0 }')"
    mem_spike="$(awk -v mem="$mem_mib" -v t="$MEM_SPIKE_MIB" 'BEGIN { print (mem >= t) ? 1 : 0 }')"

    reason=""
    if [[ "$cpu_spike" -eq 1 ]]; then
      reason="cpu>=${CPU_SPIKE_PCT}%"
    fi
    if [[ "$mem_spike" -eq 1 ]]; then
      if [[ -n "$reason" ]]; then
        reason="${reason};"
      fi
      reason="${reason}mem>=${MEM_SPIKE_MIB}MiB"
    fi

    if [[ -n "$reason" ]]; then
      now_epoch="$(date +%s)"
      last_epoch="${LAST_SPIKE_TS[$name]:-0}"

      if (( now_epoch - last_epoch >= SPIKE_COOLDOWN_SECONDS )); then
        safe_name="$(printf "%s" "$name" | tr -c 'a-zA-Z0-9_.-' '_')"
        safe_ts="$(date +%Y%m%d_%H%M%S)"
        top_file="${SPIKE_DIR}/${safe_ts}_${safe_name}.top.txt"
        logs_file="${SPIKE_DIR}/${safe_ts}_${safe_name}.logs.txt"

        docker top "$name" -eo pid,ppid,pcpu,pmem,rss,vsz,args > "$top_file" 2>&1 || true
        docker logs --timestamps --since "${LOG_SINCE_SECONDS}s" "$name" > "$logs_file" 2>&1 || true

        printf "%s,%s,%.2f,%.2f,%s,%s,%s\n" \
          "$timestamp" "$name" "$cpu_value" "$mem_mib" "$reason" "$top_file" "$logs_file" >> "$SPIKES_CSV"

        LAST_SPIKE_TS["$name"]="$now_epoch"
      fi
    fi
  done < <(docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}},{{.PIDs}}')

  if [[ "$QUIET" -eq 0 && $(( i % 10 )) -eq 0 ]]; then
    elapsed=$(( i * INTERVAL_SECONDS ))
    echo "Progress: ${elapsed}s / ${DURATION_SECONDS}s"
  fi

  if (( i < ITERATIONS )); then
    sleep "$INTERVAL_SECONDS"
  fi
done

awk -F, '
function to_cpu(value) {
  gsub(/%/, "", value)
  return value + 0
}
function to_mib(value, parts, num, unit) {
  gsub(/^ +| +$/, "", value)
  split(value, parts, " ")
  num = parts[1] + 0
  unit = parts[1]
  gsub(/[0-9.]/, "", unit)
  if (unit == "GiB")      return num * 1024
  else if (unit == "MiB") return num
  else if (unit == "KiB") return num / 1024
  else if (unit == "B")   return num / 1024 / 1024
  return num
}
NR == 1 { next }
{
  ts = $1
  name = $2
  cpu = to_cpu($3)
  split($4, mem_parts, "/")
  mem = to_mib(mem_parts[1])

  samples[name] += 1
  sum_cpu[name] += cpu
  sum_mem[name] += mem

  if (!(name in max_cpu) || cpu > max_cpu[name]) {
    max_cpu[name] = cpu
    max_cpu_ts[name] = ts
  }
  if (!(name in max_mem) || mem > max_mem[name]) {
    max_mem[name] = mem
    max_mem_ts[name] = ts
  }
}
END {
  print "container,max_cpu_pct,max_cpu_ts,max_mem_mib,max_mem_ts,avg_cpu_pct,avg_mem_mib,samples"
  for (name in samples) {
    printf "%s,%.2f,%s,%.2f,%s,%.2f,%.2f,%d\n",
      name, max_cpu[name], max_cpu_ts[name], max_mem[name], max_mem_ts[name],
      (sum_cpu[name] / samples[name]), (sum_mem[name] / samples[name]), samples[name]
  }
}
' "$RAW_CSV" > "${SUMMARY_CSV}.tmp"

{
  head -n 1 "${SUMMARY_CSV}.tmp"
  tail -n +2 "${SUMMARY_CSV}.tmp" | sort -t, -k2,2nr
} > "$SUMMARY_CSV"
rm -f "${SUMMARY_CSV}.tmp"

if [[ "$QUIET" -eq 0 ]]; then
  echo
  echo "Benchmark finished."
  echo "Raw samples:      $RAW_CSV"
  echo "Spike events:     $SPIKES_CSV"
  echo "Per-service peak: $SUMMARY_CSV"
  echo "Spike snapshots:  $SPIKE_DIR"
fi
