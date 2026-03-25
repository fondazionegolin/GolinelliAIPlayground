# Docker Benchmark Workflow

This folder contains a lightweight benchmark script to measure container CPU/memory usage and capture evidence when spikes happen.

## Script

`benchmark_docker.sh`

## Quick Start

```bash
# From repo root
./infrastructure/benchmark/benchmark_docker.sh \
  --project dev_golinelli_ai \
  --duration 180 \
  --interval 2 \
  --cpu-spike 120 \
  --mem-spike-mib 900
```

## Common Options

```bash
--project <compose_project>    # e.g. dev_golinelli_ai
--duration <seconds>           # total benchmark duration
--interval <seconds>           # sample frequency
--cpu-spike <pct>              # spike threshold for CPU
--mem-spike-mib <mib>          # spike threshold for memory
--out-dir <dir>                # output folder (default: benchmark)
```

## Output Files

- `docker_stats_<timestamp>.csv`: raw samples from `docker stats`
- `docker_summary_<timestamp>.csv`: max/avg CPU and memory per container
- `docker_spikes_<timestamp>.csv`: spike events that crossed thresholds
- `spikes_<timestamp>/`: per-spike snapshots:
  - `*.top.txt` from `docker top`
  - `*.logs.txt` from `docker logs --since <N>s`

## Suggested Workflow

1. Start benchmark script.
2. Run your workload (for this repo: the `loadtest/` runner).
3. Open the generated `docker_summary_*.csv` to identify top consumers.
4. Open `docker_spikes_*.csv` and inspect referenced `top/logs` files for root-cause clues.
