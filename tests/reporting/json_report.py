"""Export TestReport as JSON."""

from __future__ import annotations

import json
from dataclasses import asdict
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .collector import TestReport


def export_json_report(report: "TestReport", output_path: str) -> None:
    """Write the TestReport to a JSON file."""
    data = asdict(report)
    with open(output_path, "w") as f:
        json.dump(data, f, indent=2, default=str)
