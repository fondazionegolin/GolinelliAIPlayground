"""
Content moderation service.

Pipeline:
  1. Detect PII (codice fiscale, telefono, email, IBAN, carta di credito)
     → Mask in-place + return masked text
  2. Call OpenAI Moderation API to flag inappropriate content
     (sexual, hateful, violent, threatening)
  3. Return ModerationResult with is_safe, pii types found, flagged categories

Usage:
    result = await moderation_service.check(text)
    if not result.is_safe:
        # block or mask message
"""

import re
import logging
from dataclasses import dataclass, field
from typing import Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# PII patterns (Italian context)
# ---------------------------------------------------------------------------

_PII_PATTERNS: dict[str, re.Pattern] = {
    "codice_fiscale": re.compile(
        r'\b[A-Z]{6}\d{2}[ABCDEHLMPRST]\d{2}[A-Z]\d{3}[A-Z]\b',
        re.IGNORECASE,
    ),
    "telefono": re.compile(
        r'\b(?:\+39\s?)?(?:0\d{1,4}[\s.\-]?\d{5,8}|\d{3}[\s.\-]?\d{3,4}[\s.\-]?\d{4})\b',
    ),
    "email": re.compile(
        r'\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b',
    ),
    "iban": re.compile(
        r'\bIT\d{2}\s?[A-Z0-9]{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{3}\b',
        re.IGNORECASE,
    ),
    "carta_credito": re.compile(
        r'\b(?:\d{4}[\s\-]?){3}\d{4}\b',
    ),
}

# Human-readable labels for student-facing messages
_PII_LABELS: dict[str, str] = {
    "codice_fiscale": "codice fiscale",
    "telefono": "numero di telefono",
    "email": "indirizzo email",
    "iban": "IBAN",
    "carta_credito": "numero di carta",
}

_REPLACEMENT: dict[str, str] = {
    "codice_fiscale": "[CODICE FISCALE RIMOSSO]",
    "telefono": "[TELEFONO RIMOSSO]",
    "email": "[EMAIL RIMOSSA]",
    "iban": "[IBAN RIMOSSO]",
    "carta_credito": "[CARTA DI CREDITO RIMOSSA]",
}

# OpenAI moderation threshold – flag if any category score exceeds this
_SCORE_THRESHOLD = 0.6

# Categories we consider actionable
_ACTIONABLE_CATEGORIES = {
    "sexual",
    "sexual/minors",
    "hate",
    "hate/threatening",
    "harassment",
    "harassment/threatening",
    "violence",
    "violence/graphic",
    "self-harm",
    "self-harm/intent",
    "self-harm/instructions",
}

# Map OpenAI categories to our AlertType values
_CATEGORY_TO_ALERT: dict[str, str] = {
    "sexual": "sexual",
    "sexual/minors": "sexual",
    "hate": "offensive",
    "hate/threatening": "threatening",
    "harassment": "offensive",
    "harassment/threatening": "threatening",
    "violence": "offensive",
    "violence/graphic": "offensive",
    "self-harm": "offensive",
    "self-harm/intent": "threatening",
    "self-harm/instructions": "threatening",
}


@dataclass
class ModerationResult:
    is_safe: bool
    pii_found: list[str] = field(default_factory=list)   # e.g. ["email", "telefono"]
    masked_text: Optional[str] = None                     # text with PII replaced
    flagged: bool = False                                  # OpenAI moderation flagged
    flagged_categories: list[str] = field(default_factory=list)
    alert_type: Optional[str] = None                      # most severe category
    risk_score: float = 0.0


class ModerationService:

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def check(self, text: str) -> ModerationResult:
        """Run full moderation pipeline on *text*."""
        # 1. PII detection + masking
        pii_found, masked = self._detect_and_mask_pii(text)

        # 2. Content moderation via OpenAI
        flagged, categories, risk_score = await self._openai_moderation(masked or text)

        is_safe = not pii_found and not flagged
        alert_type = self._resolve_alert_type(pii_found, categories)

        return ModerationResult(
            is_safe=is_safe,
            pii_found=pii_found,
            masked_text=masked,
            flagged=flagged,
            flagged_categories=categories,
            alert_type=alert_type,
            risk_score=risk_score,
        )

    # ------------------------------------------------------------------
    # PII helpers
    # ------------------------------------------------------------------

    def _detect_and_mask_pii(self, text: str) -> tuple[list[str], Optional[str]]:
        found: list[str] = []
        masked = text
        for pii_type, pattern in _PII_PATTERNS.items():
            if pattern.search(masked):
                found.append(pii_type)
                masked = pattern.sub(_REPLACEMENT[pii_type], masked)
        return found, masked if found else None

    def pii_label_list(self, pii_found: list[str]) -> str:
        """Return a human-readable comma-separated list of PII types."""
        return ", ".join(_PII_LABELS.get(p, p) for p in pii_found)

    # ------------------------------------------------------------------
    # OpenAI Moderation API
    # ------------------------------------------------------------------

    async def _openai_moderation(self, text: str) -> tuple[bool, list[str], float]:
        """Returns (flagged, flagged_categories, max_score)."""
        api_key = getattr(settings, "OPENAI_API_KEY", None)
        if not api_key:
            return False, [], 0.0

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    "https://api.openai.com/v1/moderations",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={"input": text[:4096]},  # API limit
                )
                resp.raise_for_status()
                data = resp.json()

            result = data["results"][0]
            scores: dict[str, float] = result.get("category_scores", {})
            # Use both flagged field and score threshold
            flagged_by_api: dict[str, bool] = result.get("categories", {})

            flagged_cats: list[str] = []
            max_score = 0.0
            for cat in _ACTIONABLE_CATEGORIES:
                score = scores.get(cat, 0.0)
                if score > max_score:
                    max_score = score
                if flagged_by_api.get(cat, False) or score >= _SCORE_THRESHOLD:
                    flagged_cats.append(cat)

            return bool(flagged_cats), flagged_cats, round(max_score, 3)

        except Exception as e:
            logger.warning(f"[Moderation] OpenAI API error: {e}")
            return False, [], 0.0

    # ------------------------------------------------------------------
    # Alert type resolution
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_alert_type(pii_found: list[str], flagged_cats: list[str]) -> Optional[str]:
        if flagged_cats:
            # Return the most severe category
            for cat in ("sexual/minors", "sexual", "hate/threatening", "harassment/threatening", "self-harm/intent"):
                if cat in flagged_cats:
                    return _CATEGORY_TO_ALERT[cat]
            return _CATEGORY_TO_ALERT.get(flagged_cats[0], "offensive")
        if pii_found:
            return "pii_detected"
        return None


moderation_service = ModerationService()
