"""Local neural voice (Piper TTS) for the coach.

Free, offline, dramatically more human than OS speech synthesis. The voice
model (~110MB ONNX) lives in ``data/voices/`` (gitignored, never committed)
and is used only by the local app — the static demo keeps OS speech.
"""

from __future__ import annotations

import asyncio
import io
import logging
import wave
from pathlib import Path
from threading import Lock

logger = logging.getLogger(__name__)

VOICE_NAME = "en_US-lessac-high"
MODEL_URL = (
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/"
    "en/en_US/lessac/high/en_US-lessac-high.onnx"
)
CONFIG_URL = MODEL_URL + ".json"


def voice_paths() -> tuple[Path, Path]:
    repo_root = Path(__file__).resolve().parent.parent.parent
    voices = repo_root / "data" / "voices"
    return voices / f"{VOICE_NAME}.onnx", voices / f"{VOICE_NAME}.onnx.json"


def voice_available() -> bool:
    model, config = voice_paths()
    return model.exists() and config.exists()


_lock = Lock()
_voice = None


def _load():
    global _voice
    with _lock:
        if _voice is None:
            from piper import PiperVoice

            model, _ = voice_paths()
            _voice = PiperVoice.load(str(model))
        return _voice


def synthesize_wav(text: str) -> bytes:
    """Render text to 16-bit WAV bytes. Raises RuntimeError when unavailable."""
    cleaned = " ".join(text.replace("*", "").split())[:1200]
    if not cleaned:
        raise RuntimeError("Nothing to speak")
    if not voice_available():
        raise RuntimeError("Neural voice model is not installed")
    voice = _load()
    chunks: list[bytes] = []
    sample_rate = 22050
    sample_width = 2
    channels = 1
    with _lock:
        for chunk in voice.synthesize(cleaned):
            sample_rate = chunk.sample_rate
            sample_width = chunk.sample_width
            channels = chunk.sample_channels
            chunks.append(chunk.audio_int16_bytes)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(sample_width)
        wav.setframerate(sample_rate)
        wav.writeframes(b"".join(chunks))
    return buffer.getvalue()


async def synthesize_wav_async(text: str) -> bytes:
    return await asyncio.to_thread(synthesize_wav, text)
