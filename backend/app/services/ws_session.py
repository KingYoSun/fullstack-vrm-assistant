import asyncio
import json
import logging
import math
import shutil
import subprocess
import time
from collections import deque
from typing import Deque
from uuid import uuid4

from fastapi import WebSocket, WebSocketDisconnect

from app.providers.llm import ChatMessage
from app.providers.registry import ProviderRegistry
from app.services.rag_service import RagService

logger = logging.getLogger(__name__)

try:
    import webrtcvad
except ImportError:  # pragma: no cover - optional dependency guard
    webrtcvad = None


class WebSocketSession:
    """Phase 2: 音声WSセッションのパイプライン制御。"""

    def __init__(
        self,
        session_id: str,
        websocket: WebSocket,
        providers: ProviderRegistry,
        rag_service: RagService,
        idle_timeout_sec: float = 60.0,
        silence_flush_ms: int = 600,
        input_max_chunks: int = 150,
        tts_max_chunks: int = 50,
    ):
        self.session_id = session_id
        self.websocket = websocket
        self.providers = providers
        self.rag_service = rag_service
        self.idle_timeout_sec = idle_timeout_sec
        self.silence_flush_ms = silence_flush_ms
        self._input_chunks: Deque[bytes] = deque()
        self._pcm_chunks: Deque[bytes] = deque()
        self._pcm_buffer = bytearray()
        self._input_max_chunks = input_max_chunks
        self._tts_max_chunks = tts_max_chunks
        self._state: str = "listening"
        self._silence_task: asyncio.Task | None = None
        self._current_turn_id: str | None = None
        self._last_avatar_event_at: float = 0.0
        self._vad_sample_rate = providers.config.stt.target_sample_rate or 16000
        self._vad_frame_ms = 20
        self._vad_frame_bytes = int(self._vad_sample_rate * 2 * self._vad_frame_ms / 1000)
        self._vad = webrtcvad.Vad(2) if webrtcvad else None
        self._consecutive_silence_ms = 0
        self._ffmpeg_available = shutil.which("ffmpeg") is not None

    async def run(self) -> None:
        await self.websocket.accept()
        await self.websocket.send_json({"type": "ready", "session_id": self.session_id})
        try:
            while True:
                try:
                    message = await asyncio.wait_for(
                        self.websocket.receive(), timeout=self.idle_timeout_sec
                    )
                except asyncio.TimeoutError:
                    await self._send_error("idle timeout", recoverable=False)
                    await self.websocket.close(code=1001)
                    break

                if message["type"] == "websocket.disconnect":
                    break
                if (text := message.get("text")) is not None:
                    await self._handle_text(text)
                elif (data := message.get("bytes")) is not None:
                    await self._handle_binary(data)
        except WebSocketDisconnect:
            logger.info("WebSocket disconnected: session_id=%s", self.session_id)
        except Exception as exc:  # noqa: BLE001
            logger.exception("WebSocket error: %s", exc)
            await self._send_error("internal_error", recoverable=False)
            await self.websocket.close(code=1011)
        finally:
            self._cancel_silence_timer()

    async def _handle_text(self, text: str) -> None:
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            await self._send_error("invalid JSON", recoverable=True)
            return

        msg_type = payload.get("type")
        if msg_type == "ping":
            await self.websocket.send_json({"type": "pong"})
        elif msg_type == "flush":
            await self._finalize_turn(trigger="flush")
        elif msg_type == "resume":
            self._state = "listening"
            await self.websocket.send_json({"type": "ack", "ack": msg_type})
        else:
            await self._send_error(f"unsupported type: {msg_type}", recoverable=True)

    async def _handle_binary(self, data: bytes) -> None:
        if not data:
            return
        if self._state == "responding":
            await self._send_error("currently responding; drop audio", recoverable=True)
            return

        dropped = False
        if len(self._input_chunks) >= self._input_max_chunks:
            self._input_chunks.popleft()
            if self._pcm_chunks:
                self._pcm_chunks.popleft()
            dropped = True

        self._input_chunks.append(data)
        if self._current_turn_id is None:
            self._current_turn_id = uuid4().hex

        if dropped:
            await self._send_error(
                "audio backlog exceeded; dropped oldest chunk", recoverable=True
            )

        pcm_chunk = await self._decode_opus_chunk(data)
        vad_flush = False
        if pcm_chunk:
            self._pcm_chunks.append(pcm_chunk)
            vad_flush = self._update_vad(pcm_chunk)

        partial = self.providers.stt.build_partial(self._pcm_chunks)
        if partial:
            await self.websocket.send_json(
                {
                    "type": "partial_transcript",
                    "session_id": self.session_id,
                    "turn_id": self._current_turn_id,
                    "text": partial,
                    "timestamp": time.time(),
                }
            )

        if vad_flush:
            await self._finalize_turn(trigger="vad_silence")
            return

        self._schedule_silence_flush()

    def _schedule_silence_flush(self) -> None:
        self._cancel_silence_timer()
        self._silence_task = asyncio.create_task(self._auto_flush_after_silence())

    def _cancel_silence_timer(self) -> None:
        if self._silence_task and not self._silence_task.done():
            self._silence_task.cancel()
        self._silence_task = None

    async def _auto_flush_after_silence(self) -> None:
        try:
            await asyncio.sleep(self.silence_flush_ms / 1000)
            if self._input_chunks and self._state == "listening":
                await self._finalize_turn(trigger="silence")
        except asyncio.CancelledError:
            return

    async def _finalize_turn(self, trigger: str) -> None:
        if not self._input_chunks:
            await self._send_error("no audio to finalize", recoverable=True)
            return

        self._cancel_silence_timer()
        self._state = "recognizing"
        turn_id = self._current_turn_id or uuid4().hex
        audio_chunks = list(self._input_chunks)
        pcm_chunks = list(self._pcm_chunks)
        self._input_chunks.clear()
        self._pcm_chunks.clear()
        self._pcm_buffer.clear()
        self._current_turn_id = None
        self._consecutive_silence_ms = 0

        stt_start = time.monotonic()
        try:
            transcript = await self.providers.stt.transcribe(pcm_chunks or audio_chunks)
        except Exception as exc:  # noqa: BLE001
            logger.exception("STT failed for session=%s: %s", self.session_id, exc)
            await self._send_error("stt_failed", recoverable=False)
            self._state = "listening"
            return
        stt_end = time.monotonic()

        if not transcript:
            await self._send_error("transcription_empty", recoverable=True)
            self._state = "listening"
            return

        await self.websocket.send_json(
            {
                "type": "final_transcript",
                "session_id": self.session_id,
                "turn_id": turn_id,
                "text": transcript,
                "timestamp": time.time(),
                "trigger": trigger,
            }
        )

        await self._run_llm_and_tts(turn_id=turn_id, user_text=transcript, stt_latency_ms=(stt_end - stt_start) * 1000)
        self._state = "listening"

    async def _run_llm_and_tts(self, turn_id: str, user_text: str, stt_latency_ms: float) -> None:
        self._state = "responding"
        try:
            docs = await self.rag_service.search(user_text)
            context_text = self.rag_service.context_as_text(docs)
            messages = self._build_messages(user_text, context_text)

            tokens: list[str] = []
            llm_start = time.monotonic()
            async for token in self.providers.llm.stream_chat(messages):
                tokens.append(token)
                await self.websocket.send_json(
                    {
                        "type": "llm_token",
                        "session_id": self.session_id,
                        "turn_id": turn_id,
                        "token": token,
                    }
                )

            assistant_text = "".join(tokens).strip()
            llm_end = time.monotonic()
            await self.websocket.send_json(
                {
                    "type": "llm_done",
                    "session_id": self.session_id,
                    "turn_id": turn_id,
                    "assistant_text": assistant_text,
                    "used_context": context_text,
                    "timestamp": time.time(),
                    "latency_ms": {
                        "stt": round(stt_latency_ms, 1),
                        "llm": round((llm_end - llm_start) * 1000, 1),
                    },
                }
            )

            await self._stream_tts(turn_id=turn_id, text=assistant_text, llm_latency_ms=(llm_end - llm_start) * 1000)
        except Exception as exc:  # noqa: BLE001
            logger.exception("LLM/TTS pipeline failed for session=%s: %s", self.session_id, exc)
            await self._send_error("pipeline_error", recoverable=False)
        finally:
            self._state = "listening"

    async def _stream_tts(self, turn_id: str, text: str, llm_latency_ms: float) -> None:
        metadata = self.providers.tts.metadata()
        tts_start = time.monotonic()
        await self.websocket.send_json(
            {
                "type": "tts_start",
                "session_id": self.session_id,
                "turn_id": turn_id,
                **metadata,
            }
        )

        chunk_count = 0
        async for chunk in self.providers.tts.stream_tts(text):
            if not chunk:
                continue
            chunk_count += 1
            if chunk_count > self._tts_max_chunks:
                await self._send_error("tts backlog exceeded; dropping audio", recoverable=False)
                break
            await self.websocket.send_bytes(chunk)
            await self._maybe_send_avatar_event(turn_id, chunk)

        tts_end = time.monotonic()
        await self.websocket.send_json(
            {
                "type": "tts_end",
                "session_id": self.session_id,
                "turn_id": turn_id,
                "timestamp": time.time(),
                "latency_ms": {
                    "llm": round(llm_latency_ms, 1),
                    "tts": round((tts_end - tts_start) * 1000, 1),
                },
            }
        )

    async def _maybe_send_avatar_event(self, turn_id: str, chunk: bytes) -> None:
        now = time.time()
        if now - self._last_avatar_event_at < 0.2:
            return
        self._last_avatar_event_at = now
        mouth_open = min(1.0, self._rms(chunk) / 30000)
        await self.websocket.send_json(
            {
                "type": "avatar_event",
                "session_id": self.session_id,
                "turn_id": turn_id,
                "mouth_open": round(mouth_open, 3),
                "timestamp": now,
            }
        )

    def _build_messages(self, user_text: str, context_text: str) -> list[ChatMessage]:
        system_prompt = (
            "You are a helpful VRM voice assistant. "
            "Use the provided context when it is relevant. "
            "If the context is empty, respond concisely."
        )
        messages: list[ChatMessage] = [
            ChatMessage(role="system", content=system_prompt),
        ]
        if context_text:
            messages.append(ChatMessage(role="system", content=f"Context:\n{context_text}"))
        messages.append(ChatMessage(role="user", content=user_text))
        return messages

    async def _send_error(self, message: str, recoverable: bool) -> None:
        await self.websocket.send_json(
            {"type": "error", "message": message, "recoverable": recoverable}
        )

    async def _decode_opus_chunk(self, data: bytes) -> bytes | None:
        if not data:
            return None
        if not self._ffmpeg_available:
            # ffmpeg が無い場合はそのまま PCM として扱う（入力が PCM 前提の簡易フォールバック）
            return data

        def _run_ffmpeg() -> bytes | None:
            try:
                # まずはフォーマット自動判別に任せる（WebM/OGG/Opus 生を許容）
                base_cmd = [
                    "ffmpeg",
                    "-i",
                    "pipe:0",
                    "-ac",
                    "1",
                    "-ar",
                    str(self._vad_sample_rate),
                    "-f",
                    "s16le",
                    "pipe:1",
                    "-loglevel",
                    "error",
                ]
                result = subprocess.run(
                    base_cmd,
                    input=data,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    check=True,
                )
                return result.stdout
            except subprocess.CalledProcessError:
                # フォーマット自動判別が失敗した場合は raw Opus とみなして再試行
                try:
                    result = subprocess.run(
                        [
                            "ffmpeg",
                            "-f",
                            "opus",
                            "-i",
                            "pipe:0",
                            "-ac",
                            "1",
                            "-ar",
                            str(self._vad_sample_rate),
                            "-f",
                            "s16le",
                            "pipe:1",
                            "-loglevel",
                            "error",
                        ],
                        input=data,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        check=True,
                    )
                    return result.stdout
                except subprocess.CalledProcessError as exc:  # noqa: PERF203
                    logger.warning("ffmpeg decode failed: %s", exc.stderr.decode("utf-8", "ignore"))
                    return None

        return await asyncio.to_thread(_run_ffmpeg)

    def _update_vad(self, pcm_chunk: bytes) -> bool:
        if not self._vad:
            return False

        self._pcm_buffer.extend(pcm_chunk)
        should_flush = False
        while len(self._pcm_buffer) >= self._vad_frame_bytes:
            frame = self._pcm_buffer[: self._vad_frame_bytes]
            del self._pcm_buffer[: self._vad_frame_bytes]
            is_speech = False
            try:
                is_speech = self._vad.is_speech(frame, self._vad_sample_rate)
            except Exception:  # noqa: BLE001
                is_speech = False

            if is_speech:
                self._consecutive_silence_ms = 0
            else:
                self._consecutive_silence_ms += self._vad_frame_ms
                if self._consecutive_silence_ms >= self.silence_flush_ms:
                    should_flush = True
                    break
        return should_flush

    def _rms(self, chunk: bytes) -> float:
        if not chunk:
            return 0.0
        samples = len(chunk) // 2
        if samples == 0:
            return 0.0
        total = 0.0
        for i in range(0, len(chunk), 2):
            sample = int.from_bytes(chunk[i : i + 2], "little", signed=True)
            total += sample * sample
        return math.sqrt(total / samples)
