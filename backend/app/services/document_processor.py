"""
Multi-step document processor.

Pipeline:
  1. Extract text (PyMuPDF → PyPDF2 fallback, python-docx, plain text)
  2. Detect visual-heavy pages (charts, diagrams, images)
  3. Analyze visual pages with vision LLM (GPT-4o)
  4. Generate structured summary (summary, key_concepts, entities)
  5. Return DocumentAnalysis with ready-to-inject context string
"""

import io
import re
import json
import base64
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

MAX_TEXT_CHARS = 30000
MAX_VISUAL_PAGES = 4
VISION_MODEL = "gpt-4o"
VISION_PROVIDER = "openai"


@dataclass
class DocumentAnalysis:
    filename: str
    mime_type: str
    raw_text: str
    page_count: int
    summary: str
    key_concepts: list
    entities: list
    visual_descriptions: list
    structured_extract: str       # Ready-to-inject context block
    has_visual_content: bool
    processing_steps: list


class DocumentProcessor:

    async def process(
        self,
        file_bytes: bytes,
        filename: str,
        mime_type: str,
        llm_service=None,
        analyze_visuals: bool = True,
    ) -> DocumentAnalysis:
        steps: list[str] = []

        # Step 1: Extract text
        raw_text, page_count, visual_page_indices = await self._extract_content(
            file_bytes, filename, mime_type, steps
        )

        # Step 2: Analyze visual pages
        visual_descriptions: list[str] = []
        has_visual = len(visual_page_indices) > 0

        if analyze_visuals and has_visual and llm_service:
            fn_lower = filename.lower()
            if mime_type == "application/pdf" or fn_lower.endswith(".pdf"):
                visual_descriptions = await self._analyze_pdf_visuals(
                    file_bytes, visual_page_indices, llm_service, steps
                )
            elif visual_page_indices == [-1]:
                visual_descriptions = await self._analyze_image_file(
                    file_bytes, filename, mime_type, llm_service, steps
                )

        # Step 3: Structured summary
        summary, key_concepts, entities = await self._generate_summary(
            raw_text, visual_descriptions, llm_service, steps
        )

        # Step 4: Build context string
        structured_extract = self._build_structured_extract(
            filename, summary, key_concepts, entities, visual_descriptions, raw_text
        )

        return DocumentAnalysis(
            filename=filename,
            mime_type=mime_type,
            raw_text=raw_text,
            page_count=page_count,
            summary=summary,
            key_concepts=key_concepts,
            entities=entities,
            visual_descriptions=visual_descriptions,
            structured_extract=structured_extract,
            has_visual_content=has_visual,
            processing_steps=steps,
        )

    # -------------------------------------------------------------------------
    # Text extraction
    # -------------------------------------------------------------------------

    async def _extract_content(
        self, file_bytes: bytes, filename: str, mime_type: str, steps: list
    ) -> tuple:
        """Returns (raw_text, page_count, visual_page_indices)."""
        fn_lower = filename.lower()

        if mime_type == "application/pdf" or fn_lower.endswith(".pdf"):
            return await self._extract_pdf(file_bytes, steps)

        if (
            mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            or fn_lower.endswith(".docx")
        ):
            text = self._extract_docx(file_bytes, steps)
            return text, 1, []

        if mime_type.startswith("text/") or fn_lower.endswith((".txt", ".md", ".csv")):
            try:
                text = file_bytes.decode("utf-8", errors="ignore")
            except Exception:
                text = ""
            text = text[:MAX_TEXT_CHARS]
            steps.append(f"Testo piano estratto ({len(text)} caratteri)")
            return text, 1, []

        if mime_type.startswith("image/"):
            steps.append("File immagine: analisi visiva")
            return "", 1, [-1]

        steps.append(f"Tipo file non supportato: {mime_type}")
        return "", 0, []

    async def _extract_pdf(self, file_bytes: bytes, steps: list) -> tuple:
        try:
            import fitz  # PyMuPDF
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            page_count = len(doc)
            parts: list[str] = []
            visual_pages: list[int] = []
            total_chars = 0

            for i in range(page_count):
                page = doc[i]
                page_text = page.get_text()
                text_len = len(page_text.strip())

                n_images = len(page.get_images())
                n_drawings = len(page.get_drawings())
                is_visual = (n_images > 0 and text_len < 500) or (n_drawings > 2 and text_len < 300)

                if is_visual and len(visual_pages) < MAX_VISUAL_PAGES:
                    visual_pages.append(i)

                parts.append(f"[Pagina {i + 1}]\n{page_text}")
                total_chars += text_len

                if total_chars > MAX_TEXT_CHARS:
                    parts.append(f"\n[Troncato a pagina {i + 1}/{page_count}]")
                    break

            doc.close()
            full_text = "\n\n".join(parts)
            steps.append(
                f"PDF estratto con PyMuPDF: {page_count} pagine, {len(visual_pages)} pagine visive"
            )
            return full_text, page_count, visual_pages

        except ImportError:
            steps.append("PyMuPDF non disponibile, uso PyPDF2")
            return await self._extract_pdf_fallback(file_bytes, steps)
        except Exception as e:
            steps.append(f"Errore PyMuPDF ({e}), uso PyPDF2")
            return await self._extract_pdf_fallback(file_bytes, steps)

    async def _extract_pdf_fallback(self, file_bytes: bytes, steps: list) -> tuple:
        try:
            from PyPDF2 import PdfReader
            reader = PdfReader(io.BytesIO(file_bytes))
            text = ""
            for page in reader.pages:
                text += page.extract_text() or ""
                if len(text) > MAX_TEXT_CHARS:
                    break
            text = text[:MAX_TEXT_CHARS]
            steps.append(f"PDF estratto con PyPDF2: {len(reader.pages)} pagine")
            return text, len(reader.pages), []
        except Exception as e:
            steps.append(f"Errore PyPDF2: {e}")
            return "", 0, []

    def _extract_docx(self, file_bytes: bytes, steps: list) -> str:
        try:
            from docx import Document
            doc = Document(io.BytesIO(file_bytes))
            paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
            text = "\n".join(paragraphs)[:MAX_TEXT_CHARS]
            steps.append(f"DOCX estratto: {len(paragraphs)} paragrafi")
            return text
        except Exception as e:
            steps.append(f"Errore DOCX: {e}")
            return ""

    # -------------------------------------------------------------------------
    # Visual analysis
    # -------------------------------------------------------------------------

    async def _analyze_pdf_visuals(
        self, file_bytes: bytes, page_indices: list, llm_service, steps: list
    ) -> list[str]:
        descriptions: list[str] = []
        try:
            import fitz
            doc = fitz.open(stream=file_bytes, filetype="pdf")

            for page_idx in page_indices[:MAX_VISUAL_PAGES]:
                try:
                    page = doc[page_idx]
                    mat = fitz.Matrix(1.5, 1.5)   # ~108 DPI – good quality/size tradeoff
                    pix = page.get_pixmap(matrix=mat)
                    img_b64 = base64.b64encode(pix.tobytes("png")).decode("utf-8")

                    vision_resp = await llm_service.generate(
                        messages=[{
                            "role": "user",
                            "content": [
                                {
                                    "type": "text",
                                    "text": (
                                        "Descrivi il contenuto visivo di questa pagina: grafici, tabelle, "
                                        "diagrammi, immagini. Estrai tutti i dati numerici e le informazioni "
                                        "chiave. Sii preciso e conciso. Rispondi in italiano."
                                    ),
                                },
                                {
                                    "type": "image_url",
                                    "image_url": {"url": f"data:image/png;base64,{img_b64}"},
                                },
                            ],
                        }],
                        provider=VISION_PROVIDER,
                        model=VISION_MODEL,
                        temperature=0.2,
                        max_tokens=500,
                    )
                    descriptions.append(f"[Pagina {page_idx + 1}]: {vision_resp.content}")
                    steps.append(f"Analizzata pagina visiva {page_idx + 1}")
                except Exception as e:
                    steps.append(f"Errore analisi visiva pagina {page_idx + 1}: {e}")

            doc.close()
        except ImportError:
            steps.append("PyMuPDF non disponibile per analisi visiva")
        except Exception as e:
            steps.append(f"Errore analisi visiva PDF: {e}")

        return descriptions

    async def _analyze_image_file(
        self, file_bytes: bytes, filename: str, mime_type: str, llm_service, steps: list
    ) -> list[str]:
        try:
            img_b64 = base64.b64encode(file_bytes).decode("utf-8")
            vision_resp = await llm_service.generate(
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Descrivi dettagliatamente questa immagine. "
                                "Se contiene grafici, tabelle o dati, estraili tutti. "
                                "Rispondi in italiano."
                            ),
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime_type};base64,{img_b64}"},
                        },
                    ],
                }],
                provider=VISION_PROVIDER,
                model=VISION_MODEL,
                temperature=0.2,
                max_tokens=600,
            )
            steps.append("Immagine analizzata")
            return [f"[{filename}]: {vision_resp.content}"]
        except Exception as e:
            steps.append(f"Errore analisi immagine: {e}")
            return []

    # -------------------------------------------------------------------------
    # Summary generation
    # -------------------------------------------------------------------------

    async def _generate_summary(
        self, raw_text: str, visual_descriptions: list, llm_service, steps: list
    ) -> tuple:
        """Returns (summary, key_concepts, entities)."""
        if not raw_text and not visual_descriptions:
            return "Documento vuoto o non analizzabile.", [], []

        if not llm_service:
            words = raw_text.split()
            summary = " ".join(words[:80]) + "..." if len(words) > 80 else raw_text
            return summary, [], []

        content = raw_text[:6000]
        if visual_descriptions:
            content += "\n\nCONTENUTO VISIVO:\n" + "\n".join(visual_descriptions[:3])

        try:
            response = await llm_service.generate(
                messages=[{
                    "role": "user",
                    "content": (
                        'Analizza questo documento e rispondi in JSON:\n'
                        '{"summary":"Riassunto sintetico (3-5 frasi)",'
                        '"key_concepts":["concetto1","concetto2"],'
                        '"entities":["entità1","entità2"]}\n\n'
                        f'DOCUMENTO:\n{content}\n\nRispondi SOLO con JSON valido.'
                    ),
                }],
                system_prompt=(
                    "Sei un esperto analista di documenti. "
                    "Estrai informazioni strutturate in JSON. "
                    "Rispondi SOLO con JSON valido, nessun altro testo."
                ),
                temperature=0.2,
                max_tokens=600,
            )

            text = response.content.strip()
            # Strip markdown code fences
            text = re.sub(r"^```\w*\n?", "", text)
            text = re.sub(r"\n?```$", "", text)

            data = json.loads(text)
            summary = str(data.get("summary", ""))
            key_concepts = [str(c) for c in data.get("key_concepts", [])][:10]
            entities = [str(e) for e in data.get("entities", [])][:10]
            steps.append("Sommario strutturato generato")
            return summary, key_concepts, entities

        except Exception as e:
            steps.append(f"Sommario auto-generato ({e})")
            words = raw_text.split()
            summary = " ".join(words[:80]) + "..." if len(words) > 80 else raw_text
            return summary, [], []

    # -------------------------------------------------------------------------
    # Context builder
    # -------------------------------------------------------------------------

    def _build_structured_extract(
        self,
        filename: str,
        summary: str,
        key_concepts: list,
        entities: list,
        visual_descriptions: list,
        raw_text: str,
    ) -> str:
        parts = [f"## DOCUMENTO: {filename}"]

        if summary:
            parts.append(f"\n### Sommario\n{summary}")

        if key_concepts:
            parts.append(f"\n### Concetti chiave\n" + " | ".join(key_concepts))

        if entities:
            parts.append(f"\n### Entità principali\n" + " | ".join(entities))

        if visual_descriptions:
            parts.append("\n### Contenuto visivo")
            for desc in visual_descriptions:
                parts.append(desc)

        if raw_text:
            preview = raw_text[:4000]
            parts.append(f"\n### Contenuto testuale\n{preview}")
            if len(raw_text) > 4000:
                parts.append(f"\n[...testo troncato ({len(raw_text)} caratteri totali)]")

        return "\n".join(parts)


document_processor = DocumentProcessor()
