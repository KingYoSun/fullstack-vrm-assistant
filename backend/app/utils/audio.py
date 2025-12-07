import struct


def detect_audio_mime(audio_bytes: bytes) -> str | None:
    """Detect a simple audio mime type from magic bytes."""
    if not audio_bytes:
        return None
    if audio_bytes.startswith(b"OggS"):
        return "audio/ogg"
    if audio_bytes.startswith(b"RIFF") and audio_bytes[8:12] == b"WAVE":
        return "audio/wav"
    if audio_bytes.startswith(b"\x1a\x45\xdf\xa3"):
        return "audio/webm"
    return None


def pcm_to_wav(pcm_bytes: bytes, sample_rate: int, channels: int = 1) -> bytes:
    """Wrap raw PCM (s16le) in a minimal WAV header."""
    sample_width = 2
    block_align = channels * sample_width
    byte_rate = sample_rate * block_align
    data_size = len(pcm_bytes)
    riff_size = 36 + data_size
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        riff_size,
        b"WAVE",
        b"fmt ",
        16,
        1,
        channels,
        sample_rate,
        byte_rate,
        block_align,
        sample_width * 8,
        b"data",
        data_size,
    )
    return header + pcm_bytes

