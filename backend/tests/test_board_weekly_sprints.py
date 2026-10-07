from datetime import date
import unittest

from app.board_sprints import ensure_weekly_sprints


class WeeklySprintsTests(unittest.TestCase):
    def test_creates_monday_to_sunday_and_is_idempotent(self):
        created = ensure_weekly_sprints([], date(2026, 10, 7))
        self.assertEqual(
            [(sprint["start_date"], sprint["end_date"]) for sprint in created],
            [("2026-10-05", "2026-10-11"), ("2026-10-12", "2026-10-18")],
        )
        self.assertEqual(ensure_weekly_sprints(created, date(2026, 10, 7)), created)

    def test_keeps_manual_sprints_and_adds_next_week_on_rollover(self):
        manual = {"id": "manual", "name": "Piano", "start_date": "2026-10-05", "end_date": "2026-10-11"}
        current = ensure_weekly_sprints([manual], date(2026, 10, 5))
        following = ensure_weekly_sprints(current, date(2026, 10, 12))
        self.assertIs(following[0], manual)
        self.assertEqual(len(following), 3)
        self.assertEqual(following[-1]["start_date"], "2026-10-19")


if __name__ == "__main__":
    unittest.main()
