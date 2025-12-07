import asyncio
import logging
from pathlib import Path
from typing import Optional

from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings

from app.core.providers import RagConfig
from app.providers.embedding import EmbeddingClient

logger = logging.getLogger(__name__)


class DummyEmbeddings(Embeddings):
    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [[0.0] * 1 for _ in texts]

    def embed_query(self, text: str) -> list[float]:
        return [0.0]


class RagService:
    def __init__(
        self,
        rag_config: RagConfig,
        embedding_client: EmbeddingClient,
    ):
        self._config = rag_config
        self._embedding_client = embedding_client
        self._vector_store: Optional[FAISS] = None
        self._index_path = Path(rag_config.index_path)
        self._index_dir = self._index_path.parent
        self._index_name = self._index_path.stem
        self._loaded = False
        logger.info(
            "RAG service configured: provider=%s, index=%s",
            rag_config.provider,
            self._index_path,
        )

    async def load(self) -> None:
        self._loaded = False
        faiss_file = self._index_dir / f"{self._index_name}.faiss"
        store_file = self._index_dir / f"{self._index_name}.pkl"
        if not faiss_file.exists() or not store_file.exists():
            logger.info("FAISS index not found at %s. Skipping load.", faiss_file)
            return

        self._vector_store = FAISS.load_local(
            folder_path=str(self._index_dir),
            embeddings=DummyEmbeddings(),
            index_name=self._index_name,
            allow_dangerous_deserialization=True,
        )
        self._loaded = True
        logger.info("Loaded FAISS index from %s", faiss_file)

    async def search(self, query: str, top_k: Optional[int] = None) -> list[Document]:
        if not query.strip():
            return []
        if self._vector_store is None:
            logger.info("Vector store is not loaded. Returning empty search result.")
            return []

        fallback_before = getattr(self._embedding_client, "fallback_count", 0)
        vectors = await self._embedding_client.aembed([query])
        fallback_used = getattr(self._embedding_client, "fallback_count", 0) > fallback_before
        if not vectors:
            logger.warning(
                "Embedding returned no vectors for RAG search.",
                extra={"fallback_used": fallback_used},
            )
            return []
        query_vector = vectors[0]
        index_dim = getattr(getattr(self._vector_store, "index", None), "d", None)
        provider_name = getattr(getattr(self._embedding_client, "config", None), "provider", None)
        if index_dim is not None and len(query_vector) != index_dim:
            logger.error(
                "RAG search vector dimension mismatch: query_dim=%s index_dim=%s provider=%s fallback_used=%s",
                len(query_vector),
                index_dim,
                provider_name,
                fallback_used,
            )
            raise ValueError(
                f"embedding dimension mismatch (query={len(query_vector)}, index={index_dim})"
            )
        k = top_k or self._config.top_k
        results = await asyncio.to_thread(
            self._vector_store.similarity_search_by_vector, query_vector, k
        )
        return results

    def context_as_text(self, docs: list[Document]) -> str:
        parts: list[str] = []
        for idx, doc in enumerate(docs, start=1):
            meta = doc.metadata or {}
            source = meta.get("source") or "unknown"
            parts.append(f"[{idx}] ({source}) {doc.page_content}")
        return "\n\n".join(parts)

    @property
    def is_loaded(self) -> bool:
        return self._loaded
