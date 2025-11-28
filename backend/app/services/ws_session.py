import asyncio
import json
import logging
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from app.providers.registry import ProviderRegistry
from app.services.rag_service import RagService

logger = logging.getLogger(__name__)


class WebSocketSession:
    def __init__(
        self,
        session_id: str,
        websocket: WebSocket,
        providers: ProviderRegistry,
        rag_service: RagService,
        idle_timeout_sec: float = 60.0,
    ):
        self.session_id = session_id
        self.websocket = websocket
        self.providers = providers
        self.rag_service = rag_service
        self.idle_timeout_sec = idle_timeout_sec

    async def run(self) -> None:
        await self.websocket.accept()
        await self.websocket.send_json(
            {"type": "ready", "session_id": self.session_id}
        )
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

    async def _handle_text(self, text: str) -> None:
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            await self._send_error("invalid JSON", recoverable=True)
            return

        msg_type = payload.get("type")
        if msg_type == "ping":
            await self.websocket.send_json({"type": "pong"})
        elif msg_type in {"flush", "resume"}:
            await self.websocket.send_json({"type": "ack", "ack": msg_type})
        else:
            await self._send_error(f"unsupported type: {msg_type}", recoverable=True)

    async def _handle_binary(self, data: bytes) -> None:
        # Placeholder: actual implementation will decode Opus chunks and feed STT.
        logger.debug(
            "Received binary payload len=%s for session_id=%s",
            len(data),
            self.session_id,
        )
        await self.websocket.send_json(
            {
                "type": "binary_received",
                "session_id": self.session_id,
                "bytes": len(data),
            }
        )

    async def _send_error(self, message: str, recoverable: bool) -> None:
        await self.websocket.send_json(
            {"type": "error", "message": message, "recoverable": recoverable}
        )
