"""Generate an HTML report from TestReport."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .collector import TestReport


def render_html_report(report: "TestReport", output_path: str) -> None:
    """Render a self-contained HTML report."""
    html = _build_html(report)
    with open(output_path, "w") as f:
        f.write(html)


def _build_html(report: "TestReport") -> str:
    """Build the HTML string using template literals (no Jinja2 dependency)."""

    # Test results table rows
    test_rows = ""
    for t in report.test_results:
        color = {"passed": "#22c55e", "failed": "#ef4444", "skipped": "#eab308"}.get(t.status, "#6b7280")
        test_rows += f"""
        <tr>
            <td>{t.name}</td>
            <td style="color: {color}; font-weight: bold">{t.status.upper()}</td>
            <td>{t.duration_s:.3f}s</td>
            <td class="error">{t.error_message[:200] if t.error_message else ''}</td>
        </tr>"""

    # API latency table rows
    latency_rows = ""
    for l in sorted(report.api_latency, key=lambda x: x.p95_ms, reverse=True):
        p95_color = "#ef4444" if l.p95_ms > 1000 else "#eab308" if l.p95_ms > 500 else "#22c55e"
        latency_rows += f"""
        <tr>
            <td>{l.endpoint}</td>
            <td>{l.count}</td>
            <td>{l.avg_ms:.1f}</td>
            <td>{l.p50_ms:.1f}</td>
            <td style="color: {p95_color}; font-weight: bold">{l.p95_ms:.1f}</td>
            <td>{l.max_ms:.1f}</td>
        </tr>"""

    # Resource usage table rows
    resource_rows = ""
    for r in sorted(report.resource_usage, key=lambda x: x.max_cpu_pct, reverse=True):
        cpu_color = "#ef4444" if r.max_cpu_pct > 200 else "#eab308" if r.max_cpu_pct > 100 else "#22c55e"
        resource_rows += f"""
        <tr>
            <td>{r.name}</td>
            <td style="color: {cpu_color}">{r.max_cpu_pct:.1f}%</td>
            <td>{r.avg_cpu_pct:.1f}%</td>
            <td>{r.max_mem_mib:.0f} MiB</td>
            <td>{r.avg_mem_mib:.0f} MiB</td>
            <td>{r.samples}</td>
        </tr>"""

    # Spike events rows
    spike_rows = ""
    for s in report.spike_events:
        spike_rows += f"""
        <tr>
            <td>{s.timestamp}</td>
            <td>{s.container}</td>
            <td>{s.cpu_pct:.1f}%</td>
            <td>{s.mem_mib:.0f} MiB</td>
            <td>{s.reason}</td>
        </tr>"""

    # Loadtest summary
    ls = report.loadtest_summary
    loadtest_section = ""
    if ls:
        loadtest_section = f"""
        <h2>Loadtest Summary</h2>
        <div class="summary-cards">
            <div class="card"><span class="num">{ls.get('started', 0)}</span><span class="label">Started</span></div>
            <div class="card ok"><span class="num">{ls.get('completed', 0)}</span><span class="label">Completed</span></div>
            <div class="card {'fail' if ls.get('failed', 0) > 0 else 'ok'}"><span class="num">{ls.get('failed', 0)}</span><span class="label">Failed</span></div>
        </div>"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GolinelliAIPlayground — Test &amp; Benchmark Report</title>
<style>
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; }}
    h1 {{ font-size: 1.8rem; margin-bottom: 0.5rem; }}
    h2 {{ font-size: 1.3rem; margin: 2rem 0 1rem; border-bottom: 1px solid #334155; padding-bottom: 0.5rem; }}
    .meta {{ color: #94a3b8; margin-bottom: 2rem; }}
    .summary-cards {{ display: flex; gap: 1rem; margin-bottom: 1rem; }}
    .card {{ background: #1e293b; border-radius: 8px; padding: 1.2rem; min-width: 120px; text-align: center; }}
    .card .num {{ display: block; font-size: 2rem; font-weight: bold; }}
    .card .label {{ display: block; color: #94a3b8; font-size: 0.85rem; margin-top: 0.3rem; }}
    .card.ok .num {{ color: #22c55e; }}
    .card.fail .num {{ color: #ef4444; }}
    .card.warn .num {{ color: #eab308; }}
    table {{ width: 100%; border-collapse: collapse; margin-bottom: 2rem; }}
    th, td {{ padding: 0.6rem 0.8rem; text-align: left; border-bottom: 1px solid #1e293b; }}
    th {{ background: #1e293b; color: #94a3b8; font-size: 0.85rem; text-transform: uppercase; }}
    tr:hover {{ background: #1e293b; }}
    .error {{ color: #f87171; font-size: 0.8rem; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }}
    .empty {{ color: #64748b; font-style: italic; padding: 2rem; text-align: center; }}
</style>
</head>
<body>
<h1>Test &amp; Benchmark Report</h1>
<p class="meta">Generated: {report.timestamp}</p>

<div class="summary-cards">
    <div class="card"><span class="num">{report.total_tests}</span><span class="label">Total Tests</span></div>
    <div class="card ok"><span class="num">{report.passed}</span><span class="label">Passed</span></div>
    <div class="card {'fail' if report.failed > 0 else 'ok'}"><span class="num">{report.failed}</span><span class="label">Failed</span></div>
    <div class="card"><span class="num">{report.skipped}</span><span class="label">Skipped</span></div>
</div>

{loadtest_section}

<h2>Test Results</h2>
{"<table><thead><tr><th>Test</th><th>Status</th><th>Duration</th><th>Error</th></tr></thead><tbody>" + test_rows + "</tbody></table>" if test_rows else '<p class="empty">No test results found</p>'}

<h2>API Latency (ms)</h2>
{"<table><thead><tr><th>Endpoint</th><th>Count</th><th>Avg</th><th>p50</th><th>p95</th><th>Max</th></tr></thead><tbody>" + latency_rows + "</tbody></table>" if latency_rows else '<p class="empty">No latency data</p>'}

<h2>Container Resource Usage</h2>
{"<table><thead><tr><th>Container</th><th>Max CPU</th><th>Avg CPU</th><th>Max Mem</th><th>Avg Mem</th><th>Samples</th></tr></thead><tbody>" + resource_rows + "</tbody></table>" if resource_rows else '<p class="empty">No resource data (run with benchmark_docker.sh)</p>'}

<h2>Spike Events</h2>
{"<table><thead><tr><th>Time</th><th>Container</th><th>CPU</th><th>Memory</th><th>Reason</th></tr></thead><tbody>" + spike_rows + "</tbody></table>" if spike_rows else '<p class="empty">No spikes detected</p>'}

</body>
</html>"""
