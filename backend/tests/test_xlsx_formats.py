"""Excel import keeps values in machine form with their number format; export writes them back."""

import datetime
import io
import json

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill

from app.services.document_conversion import export_document, import_document


def _book() -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet["A1"] = 0.1 + 0.2
    sheet["A1"].number_format = "0.00"
    sheet["B1"] = datetime.datetime(2024, 12, 31)
    sheet["B1"].number_format = "dd/mm/yyyy"
    sheet["C1"] = 0.25
    sheet["C1"].number_format = "0%"
    sheet["D1"] = True
    sheet["E1"] = 3.0
    sheet["F1"] = "=A1*2"
    sheet["A2"] = "Rosso"
    sheet["A2"].font = Font(color="FFFF0000", bold=True, size=12)
    sheet["A2"].fill = PatternFill(fill_type="solid", start_color="FF00FF00", end_color="FF00FF00")
    sheet.column_dimensions["B"].width = 20
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def test_import_stores_machine_values_and_formats():
    content = json.loads(import_document("voti.xlsx", _book()).content_json)
    row = content["data"][0]
    assert abs(float(row[0]) - 0.3) < 1e-9
    assert row[1] == "45657", "dates are serials, never '2024-12-31 00:00:00'"
    assert row[3] == "TRUE" and row[4] == "3" and row[5] == "=A1*2"
    styles = content["styles"]
    assert styles["0:0"]["numberFormat"] == "0.00"
    assert styles["0:1"]["numberFormat"].lower().startswith("dd/mm/yy")
    assert styles["0:2"]["numberFormat"] == "0%"
    assert styles["1:0"]["color"] == "#FF0000" and styles["1:0"]["backgroundColor"] == "#00FF00"
    assert styles["1:0"]["fontSize"] == 16, "12pt in canvas px"
    assert content["dimensions"]["columnWidths"][1] == 140


def test_export_writes_formats_and_colours_back():
    content = import_document("voti.xlsx", _book()).content_json
    exported = load_workbook(io.BytesIO(export_document(content, "Voti", "xlsx").content))
    sheet = exported.active
    assert sheet["C1"].number_format == "0%" and sheet["C1"].value == 0.25
    assert sheet["B1"].value == datetime.datetime(2024, 12, 31)
    assert sheet["A2"].font.color.rgb.endswith("FF0000") and sheet["A2"].fill.fgColor.rgb.endswith("00FF00")
