from app.services.model_catalog import parse_anthropic


def test_anthropic_parser_reads_tiered_rows_and_ignores_the_navigation_menu():
    page = (
        "<nav>Claude Haiku 5.5<li>Specialized models</li><li>Legacy models</li></nav>"
        "<table><tr><td>Base input tokens</td></tr>"
        "<tr><td>Claude Sonnet 5.5</td><td>The best combination of speed and intelligence</td><td>$2 / MTok</td><td>$10 / MTok</td><td>$2.50 / MTok</td></tr>"
        "<tr><td>Claude Haiku 5.5</td><td>For high-volume, latency-sensitive tasks such as classification, extraction, and routing</td>"
        "<td>$0.10 / MTok</td><td>for prompts up to 100,000 tokens</td><td>$0.50 / MTok</td><td>$0.125 / MTok</td><td>$0.01 / MTok</td>"
        "<td>$0.50 / MTok</td><td>for prompts over 100,000 tokens</td><td>$2.50 / MTok</td><td>$0.05 / MTok</td></tr>"
        "<tr><td>Claude Haiku 4.5</td><td>Fastest</td><td>$1 / MTok</td><td>$5 / MTok</td></tr></table>"
    )
    prices = parse_anthropic(page)
    assert prices["claude-haiku-5-5"] == (0.50, 2.50)  # the long-prompt tier: the prudent price
    assert prices["claude-sonnet-5-5"] == (2.0, 10.0)
    assert prices["claude-haiku-4-5"] == (1.0, 5.0)
