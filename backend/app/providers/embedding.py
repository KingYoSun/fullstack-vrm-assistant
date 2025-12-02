import hashlib
import logging

import httpx

from app.core.providers import EmbeddingConfig

logger = logging.getLogger(__name__)


class EmbeddingClient:
    def __init__(
        self,
        config: EmbeddingConfig,
        http_client: httpx.AsyncClient | None,
        sync_client: httpx.Client | None = None,
    ):
        self.config = config
        self._http_client = http_client
        self._sync_client = sync_client
        self.fallback_count = 0
        endpoint = config.endpoint.rstrip("/")
        self._llama_server_mode = endpoint.endswith("/embedding")

    async def aembed(self, texts: list[str]) -> list[list[float]]:
        try:
            result = await self._request_async(texts)
            if result:
                return result
            self.fallback_count += 1
            logger.warning(
                "Embedding provider returned empty result; using fallback.",
                extra={"fallback": True},
            )
            return [self._fallback_embedding(text) for text in texts]
        except Exception as exc:
            self.fallback_count += 1
            logger.warning(
                "Embedding async request failed: %s",
                exc,
                extra={"fallback": True},
            )
            return [self._fallback_embedding(text) for text in texts]

    def embed(self, texts: list[str]) -> list[list[float]]:
        try:
            result = self._request_sync(texts)
            if result:
                return result
            self.fallback_count += 1
            logger.warning(
                "Embedding provider returned empty result; using fallback.",
                extra={"fallback": True},
            )
            return [self._fallback_embedding(text) for text in texts]
        except Exception as exc:
            self.fallback_count += 1
            logger.warning(
                "Embedding sync request failed: %s",
                exc,
                extra={"fallback": True},
            )
            return [self._fallback_embedding(text) for text in texts]

    async def _request_async(self, texts: list[str]) -> list[list[float]]:
        if self._llama_server_mode:
            return await self._request_llama_async(texts)

        payload = {"input": texts, "model": self.config.model}
        url = self._build_url("embeddings")
        if self._http_client is None:
            async with httpx.AsyncClient(timeout=self.config.timeout_sec) as client:
                response = await client.post(url, json=payload)
        else:
            response = await self._http_client.post(
                url, json=payload, timeout=self.config.timeout_sec
            )
        response.raise_for_status()
        return self._parse_response(response.json())

    def _request_sync(self, texts: list[str]) -> list[list[float]]:
        if self._llama_server_mode:
            return self._request_llama_sync(texts)

        payload = {"input": texts, "model": self.config.model}
        url = self._build_url("embeddings")
        if self._sync_client is None:
            with httpx.Client(timeout=self.config.timeout_sec) as client:
                response = client.post(url, json=payload)
        else:
            response = self._sync_client.post(url, json=payload)
        response.raise_for_status()
        return self._parse_response(response.json())

    async def _request_llama_async(self, texts: list[str]) -> list[list[float]]:
        url = self.config.endpoint.rstrip("/")
        embeddings: list[list[float]] = []
        client = self._http_client
        owns_client = False
        if client is None:
            client = httpx.AsyncClient(timeout=self.config.timeout_sec)
            owns_client = True
        try:
            for text in texts:
                response = await client.post(url, json={"content": text})
                response.raise_for_status()
                embedding = self._parse_llama_response(response.json())
                if embedding:
                    embeddings.append(embedding)
        finally:
            if owns_client:
                await client.aclose()
        return embeddings

    def _request_llama_sync(self, texts: list[str]) -> list[list[float]]:
        url = self.config.endpoint.rstrip("/")
        embeddings: list[list[float]] = []
        client = self._sync_client
        owns_client = False
        if client is None:
            client = httpx.Client(timeout=self.config.timeout_sec)
            owns_client = True
        try:
            for text in texts:
                response = client.post(url, json={"content": text})
                response.raise_for_status()
                embedding = self._parse_llama_response(response.json())
                if embedding:
                    embeddings.append(embedding)
        finally:
            if owns_client:
                client.close()
        return embeddings

    def _parse_response(self, data: dict) -> list[list[float]]:
        items = data.get("data") or []
        embeddings: list[list[float]] = []
        for item in items:
            embedding = item.get("embedding")
            if embedding is None:
                continue
            embeddings.append([float(x) for x in embedding])
        return embeddings

    def _parse_llama_response(self, data: dict) -> list[float]:
        embedding = data.get("embedding")
        if embedding is None:
            return []
        return [float(x) for x in embedding]

    def _fallback_embedding(self, text: str) -> list[float]:
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        # Simple deterministic embedding to keep the pipeline working when provider is absent.
        return [byte / 255.0 for byte in digest[:32]]

    def _build_url(self, path: str) -> str:
        base = self.config.endpoint.rstrip("/")
        return f"{base}/{path.lstrip('/')}"
