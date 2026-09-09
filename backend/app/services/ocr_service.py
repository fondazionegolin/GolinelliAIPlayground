"""Local OCR service for teacher-uploaded assignment images.

The service intentionally imports OCR engines lazily. Production can install a
high-performance local engine such as PaddleOCR or TrOCR without making app
startup depend on model availability.
"""

from __future__ import annotations

import io
import csv
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageEnhance, ImageOps

from app.core.config import settings


SUPPORTED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


@dataclass
class OCRResult:
    text: str
    engine: str
    confidence: float | None = None
    lines: list[dict[str, Any]] | None = None


class OCRUnavailableError(RuntimeError):
    pass


class OCRService:
    def __init__(self) -> None:
        self._paddle_ocr: Any | None = None
        self._trocr_pipe: Any | None = None

    def transcribe(self, image_bytes: bytes, mime_type: str | None = None) -> OCRResult:
        if mime_type and mime_type not in SUPPORTED_IMAGE_TYPES:
            raise ValueError("Unsupported image type")

        image = self._load_image(image_bytes)
        engine = settings.OCR_ENGINE.lower().strip()

        engines = [engine] if engine != "auto" else ["paddle", "trocr", "tesseract"]
        errors: list[str] = []
        for candidate in engines:
            try:
                if candidate == "paddle":
                    return self._with_paddle(image)
                if candidate == "trocr":
                    return self._with_trocr(image)
                if candidate == "tesseract":
                    return self._with_tesseract(image)
            except OCRUnavailableError as exc:
                errors.append(f"{candidate}: {exc}")
            except Exception as exc:
                errors.append(f"{candidate}: {exc}")

        detail = "; ".join(errors) or "no OCR engine configured"
        raise OCRUnavailableError(f"Nessun motore OCR locale disponibile ({detail}).")

    def _load_image(self, image_bytes: bytes) -> Image.Image:
        try:
            image = Image.open(io.BytesIO(image_bytes))
            image = ImageOps.exif_transpose(image)
            return image.convert("RGB")
        except Exception as exc:
            raise ValueError("Invalid image") from exc

    def _preprocess(self, image: Image.Image) -> Image.Image:
        max_side = 2200
        image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
        image = ImageOps.grayscale(image)
        image = ImageEnhance.Contrast(image).enhance(1.6)
        image = ImageEnhance.Sharpness(image).enhance(1.25)
        return image

    def _bbox_from_polygon(self, box: Any, width: int, height: int) -> dict[str, float] | None:
        try:
            points = [(float(point[0]), float(point[1])) for point in box]
            xs = [point[0] for point in points]
            ys = [point[1] for point in points]
            left = max(0.0, min(xs) / width)
            top = max(0.0, min(ys) / height)
            right = min(1.0, max(xs) / width)
            bottom = min(1.0, max(ys) / height)
            return {"left": left, "top": top, "width": right - left, "height": bottom - top}
        except Exception:
            return None

    def _with_paddle(self, image: Image.Image) -> OCRResult:
        try:
            import numpy as np
            from paddleocr import PaddleOCR
        except Exception as exc:
            raise OCRUnavailableError("PaddleOCR non installato") from exc

        lang = "it" if settings.OCR_LANGUAGE.lower().startswith("it") else settings.OCR_LANGUAGE
        if self._paddle_ocr is None:
            self._paddle_ocr = PaddleOCR(use_angle_cls=True, lang=lang, show_log=False)
        processed = self._preprocess(image.copy()).convert("RGB")
        width, height = processed.size
        result = self._paddle_ocr.ocr(np.array(processed), cls=True)

        lines: list[dict[str, Any]] = []
        confidences: list[float] = []
        for page in result or []:
            for item in page or []:
                if len(item) < 2:
                    continue
                box, rec = item[0], item[1]
                if not rec:
                    continue
                text = str(rec[0]).strip()
                confidence = float(rec[1]) if len(rec) > 1 and rec[1] is not None else None
                if text:
                    lines.append({
                        "text": text,
                        "confidence": confidence,
                        "box": box,
                        "bbox": self._bbox_from_polygon(box, width, height),
                    })
                    if confidence is not None:
                        confidences.append(confidence)

        text = "\n".join(line["text"] for line in lines).strip()
        return OCRResult(
            text=text,
            engine="paddle",
            confidence=sum(confidences) / len(confidences) if confidences else None,
            lines=lines,
        )

    def _with_trocr(self, image: Image.Image) -> OCRResult:
        try:
            from transformers import pipeline
        except Exception as exc:
            raise OCRUnavailableError("transformers/TrOCR non installato") from exc

        if self._trocr_pipe is None:
            self._trocr_pipe = pipeline("image-to-text", model=settings.OCR_TROCR_MODEL)
        output = self._trocr_pipe(self._preprocess(image).convert("RGB"))
        text = "\n".join(item.get("generated_text", "") for item in output if item.get("generated_text")).strip()
        return OCRResult(text=text, engine="trocr", confidence=None, lines=None)

    def _with_tesseract(self, image: Image.Image) -> OCRResult:
        lang = "ita" if settings.OCR_LANGUAGE.lower().startswith("it") else settings.OCR_LANGUAGE
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "ocr-input.png"
            processed = self._preprocess(image.copy())
            width, height = processed.size
            processed.save(path)
            try:
                completed_tsv = subprocess.run(
                    ["tesseract", str(path), "stdout", "-l", lang, "--psm", "6", "tsv"],
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=60,
                )
            except FileNotFoundError as exc:
                raise OCRUnavailableError("tesseract non installato") from exc
            except subprocess.CalledProcessError as exc:
                raise OCRUnavailableError((exc.stderr or "tesseract failed").strip()) from exc

        rows = csv.DictReader(io.StringIO(completed_tsv.stdout), delimiter="\t")
        words: list[dict[str, Any]] = []
        confidences: list[float] = []
        for row in rows:
            text = (row.get("text") or "").strip()
            if not text:
                continue
            try:
                confidence = float(row.get("conf") or -1)
            except ValueError:
                confidence = -1
            if confidence < 0:
                continue

            left = float(row.get("left") or 0)
            top = float(row.get("top") or 0)
            box_width = float(row.get("width") or 0)
            box_height = float(row.get("height") or 0)
            words.append({
                "text": text,
                "confidence": confidence / 100,
                "bbox": {
                    "left": max(0.0, min(1.0, left / width)),
                    "top": max(0.0, min(1.0, top / height)),
                    "width": max(0.0, min(1.0, box_width / width)),
                    "height": max(0.0, min(1.0, box_height / height)),
                },
                "line": row.get("line_num"),
                "word": row.get("word_num"),
            })
            confidences.append(confidence / 100)

        text = " ".join(word["text"] for word in words).strip()
        return OCRResult(
            text=text,
            engine="tesseract",
            confidence=sum(confidences) / len(confidences) if confidences else None,
            lines=words,
        )


ocr_service = OCRService()
