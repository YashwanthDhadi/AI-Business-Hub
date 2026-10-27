"""
Speech to text, via Groq's hosted Whisper.

One multipart POST. No SDK, because there is nothing an SDK would add.

This is the ONLY part of the project still on Groq — chat moved to OpenRouter.
Groq stays here because its Whisper endpoint is free, fast and ungated.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from app.config import settings

logger = logging.getLogger("aibh.speech")

TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
TIMEOUT = 45

# Groq accepts these container formats. The KEY is the browser's MIME type,
# the VALUE is the filename extension Groq expects — it reads the extension,
# so sending "blob" with no extension is rejected.
SUPPORTED_TYPES = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/mpga": "mp3",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/flac": "flac",
}


@dataclass
class Transcript:
    ok: bool
    text: str = ""
    error: str | None = None


def _extension_for(content_type: str | None) -> str | None:
    """Map a browser MIME type to a file extension Groq understands."""
    if not content_type:
        return None
    # Browsers send 'audio/webm;codecs=opus' — strip the parameters.
    base = content_type.split(";")[0].strip().lower()
    return SUPPORTED_TYPES.get(base)


def transcribe(audio: bytes, content_type: str | None, language: str | None = None) -> Transcript:
    """
    Turn recorded audio into text.

    Never raises: a failed transcription is an ordinary outcome the customer
    should be told about politely, not a 500.
    """
    if not settings.groq_api_key:
        return Transcript(ok=False, error="Speech recognition is not configured.")

    if not audio:
        return Transcript(ok=False, error="The recording was empty.")

    if len(audio) > settings.voice_max_upload_bytes:
        return Transcript(
            ok=False,
            error=f"That recording is too long. Please keep it under "
            f"{settings.voice_max_upload_mb} MB.",
        )

    extension = _extension_for(content_type)
    if extension is None:
        logger.warning("Unsupported audio type: %s", content_type)
        return Transcript(ok=False, error="That audio format is not supported.")

    data = {"model": settings.groq_stt_model, "response_format": "json"}
    if language:
        data["language"] = language

    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            response = client.post(
                TRANSCRIBE_URL,
                headers={"Authorization": f"Bearer {settings.groq_api_key}"},
                files={"file": (f"recording.{extension}", audio, content_type)},
                data=data,
            )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Transcription request failed")
        return Transcript(ok=False, error=f"Could not reach the transcription service: {exc}")

    if response.status_code >= 300:
        detail = ""
        try:
            detail = (response.json().get("error") or {}).get("message", "")
        except Exception:  # noqa: BLE001
            detail = response.text[:200]
        logger.error("Groq transcription failed: %s %s", response.status_code, detail)
        return Transcript(ok=False, error=detail or "Transcription failed.")

    try:
        text = (response.json().get("text") or "").strip()
    except Exception:  # noqa: BLE001
        return Transcript(ok=False, error="Transcription returned an unreadable response.")

    if not text:
        return Transcript(ok=False, error="I couldn't hear anything. Please try again.")

    logger.info("Transcribed %s bytes -> %r", len(audio), text[:80])
    return Transcript(ok=True, text=text)
