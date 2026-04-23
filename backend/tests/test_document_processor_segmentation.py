import importlib.util
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "app" / "services" / "document_processor.py"
SPEC = importlib.util.spec_from_file_location("document_processor", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

DocumentProcessor = MODULE.DocumentProcessor


def test_segments_from_blocks_preserves_all_content():
    processor = DocumentProcessor()
    blocks = [f"Paragrafo {idx}: " + ("x" * 220) for idx in range(1, 8)]
    text = "\n\n".join(blocks)

    segments = processor._segments_from_blocks(text, target_chars=500)

    assert len(segments) >= 3
    rebuilt = "\n\n".join(segment.text for segment in segments)
    assert rebuilt == text


def test_stringify_cell_truncates_very_long_values():
    processor = DocumentProcessor()
    rendered = processor._stringify_cell("a" * 250)

    assert len(rendered) == 200
    assert rendered.endswith("...")
