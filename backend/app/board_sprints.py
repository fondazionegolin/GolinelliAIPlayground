"""Date-based sprint creation for boards with weekly scheduling enabled."""

from datetime import date, timedelta
import uuid


def ensure_weekly_sprints(sprints: list[dict], today: date) -> list[dict]:
    """Keep this week and next week available without changing existing sprints."""
    result = list(sprints)
    monday = today - timedelta(days=today.weekday())
    existing_starts = {sprint.get("start_date") for sprint in result}
    for offset in (0, 7):
        start = monday + timedelta(days=offset)
        if start.isoformat() in existing_starts or len(result) >= 520:
            continue
        result.append({
            "id": f"spr_{uuid.uuid4().hex[:12]}",
            "name": f"Settimana {start.strftime('%d/%m/%Y')}",
            "goal": "",
            "start_date": start.isoformat(),
            "end_date": (start + timedelta(days=6)).isoformat(),
            "auto_generated": True,
        })
        existing_starts.add(start.isoformat())
    return result
