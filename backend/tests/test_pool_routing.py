"""nginx sends an allow-list of routes to the multi-worker pool (API_ROLE=pool).

Pool processes hold none of the gateway's in-memory state, so every route the pool regex
captures must belong to a module checked to be stateless. This test reads the regexes from
the real nginx.conf and fails when a new route under a pool prefix comes from another module.
"""
import os
import re
from pathlib import Path

import pytest

STATELESS_MODULES = {
    "auth", "student", "ml_lab", "rag", "files", "admin_credits",
    "teacher_memory", "alerts", "feedback", "privacy", "media",
}


def _nginx_conf() -> Path | None:
    candidates = [os.environ.get("NGINX_CONF", ""), Path(__file__).resolve().parents[2] / "infrastructure/nginx/nginx.conf"]
    return next((Path(c) for c in candidates if c and Path(c).is_file()), None)


def _locations(conf: str) -> list[tuple[re.Pattern, str]]:
    """Regex locations in file order with their upstream (nginx picks the first regex that matches)."""
    out = []
    for match in re.finditer(r"location ~ (\S+) \{(.*?)\}", conf, re.S):
        upstream = re.search(r"proxy_pass http://(\w+);", match.group(2))
        out.append((re.compile(match.group(1)), upstream.group(1) if upstream else ""))
    return out


def test_pool_only_receives_stateless_routes():
    path = _nginx_conf()
    if path is None:
        pytest.skip("nginx.conf not available (set NGINX_CONF)")
    locations = _locations(path.read_text())
    assert any(upstream == "api_pool" for _, upstream in locations)

    from app.main import app

    misrouted = []
    for route in app.routes:
        route_path, endpoint = getattr(route, "path", ""), getattr(route, "endpoint", None)
        if not endpoint or not route_path.startswith("/api/"):
            continue
        sample = re.sub(r"\{[^}]+\}", "x", route_path)
        upstream = next((up for regex, up in locations if regex.search(sample)), "api")
        module = endpoint.__module__.rsplit(".", 1)[-1]
        if upstream == "api_pool" and module not in STATELESS_MODULES:
            misrouted.append(f"{route_path} ({module})")
    assert not misrouted, "stateful routes sent to the pool:\n" + "\n".join(sorted(set(misrouted)))
