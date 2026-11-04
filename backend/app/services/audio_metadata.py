"""Bounded, local-only audio duration inspection using the installed FFmpeg tools."""
import json
import math
import subprocess
import tempfile
from pathlib import Path

from app.services import drive_service as drive


def duration_seconds(storage_key: str) -> float | None:
    def probe(path):
        result = subprocess.run(["ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe",
            "-format_whitelist", "mp3,wav,ogg,mov,flac,aac,matroska,webm,aiff",
            "-show_entries", "format=duration", "-of", "json", str(path)],
            capture_output=True, timeout=8, check=True)
        duration = float(json.loads(result.stdout)["format"]["duration"])
        return duration if math.isfinite(duration) and 0 < duration <= 86400 else None
    try:
        local = drive.blob_path(storage_key)
        if local and local.is_file():
            return probe(local)
        with tempfile.TemporaryDirectory(prefix="audio-metadata-") as directory:
            path = Path(directory) / "audio"
            path.write_bytes(drive.read_blob(storage_key))
            return probe(path)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        return None
