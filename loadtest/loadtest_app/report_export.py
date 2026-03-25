"""
Export MetricsStore snapshot to JSON for unified reporting.

Usage:
    from loadtest_app.report_export import export_snapshot
    export_snapshot(snapshot_dict, output_dir="reports")
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any


def export_snapshot(
    snapshot: dict[str, Any],
    output_dir: str = "reports",
    prefix: str = "loadtest_metrics",
) -> Path:
    """
    Write a MetricsStore snapshot to a timestamped JSON file.

    Returns the path to the written file.
    """
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{prefix}_{ts}.json"
    filepath = out_dir / filename

    # Convert Event namedtuples/dataclasses to dicts for serialization
    serializable = _make_serializable(snapshot)

    with open(filepath, "w") as f:
        json.dump(serializable, f, indent=2, default=str)

    return filepath


def _make_serializable(obj: Any) -> Any:
    """Recursively convert non-serializable objects."""
    if isinstance(obj, dict):
        return {k: _make_serializable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_make_serializable(item) for item in obj]
    if hasattr(obj, "__dataclass_fields__"):
        return {k: _make_serializable(getattr(obj, k)) for k in obj.__dataclass_fields__}
    return obj
