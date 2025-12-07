import argparse
import logging
from pathlib import Path

import httpx
from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.core.providers import load_providers_config
from app.core.settings import get_settings
from app.providers.embedding import EmbeddingClient

logger = logging.getLogger(__name__)


class RemoteEmbeddingsAdapter(Embeddings):
    def __init__(self, client: EmbeddingClient):
        self._client = client

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._client.embed(texts)

    def embed_query(self, text: str) -> list[float]:
        return self._client.embed([text])[0]


def load_documents(source_dir: Path) -> list[Document]:
    documents: list[Document] = []
    for path in source_dir.rglob("*"):
        if path.is_dir():
            continue
        suffix = path.suffix.lower()
        if suffix in {".md", ".txt"}:
            loader = TextLoader(str(path), autodetect_encoding=True)
            documents.extend(loader.load())
        elif suffix == ".pdf":
            loader = PyPDFLoader(str(path))
            documents.extend(loader.load())
    return documents


def split_documents(documents: list[Document]) -> list[Document]:
    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=80)
    return splitter.split_documents(documents)


def save_vector_store(store: FAISS, index_path: Path) -> None:
    index_dir = index_path.parent
    index_dir.mkdir(parents=True, exist_ok=True)
    store.save_local(str(index_dir), index_name=index_path.stem)
    logger.info("Saved FAISS index to %s", index_dir)


def ingest(source_dir: Path, providers_path: Path, index_path: Path) -> None:
    config = load_providers_config(providers_path)
    settings = get_settings()

    with httpx.Client(timeout=settings.request_timeout_sec) as sync_client:
        embedding_client = EmbeddingClient(
            config.embedding,
            http_client=None,
            sync_client=sync_client,
        )
        documents = split_documents(load_documents(source_dir))
        if not documents:
            resolved = source_dir.resolve()
            msg = f"No documents found under {resolved}"
            logger.error(msg)
            raise RuntimeError(msg)
        embeddings = RemoteEmbeddingsAdapter(embedding_client)
        fallback_before = embedding_client.fallback_count
        vector_store = FAISS.from_documents(documents, embeddings)
        if embedding_client.fallback_count > fallback_before:
            msg = (
                "Embedding provider fallback was used during ingest. "
                "Ensure the embedding service is running to avoid a mismatched FAISS index."
            )
            raise RuntimeError(msg)
        save_vector_store(vector_store, index_path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ingest local markdown/pdf files into FAISS index."
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("memories"),
        help="Directory to scan for .md/.txt/.pdf files (default: ./memories).",
    )
    parser.add_argument(
        "--providers",
        type=Path,
        default=get_settings().providers_config_path,
        help="Path to providers.yaml",
    )
    parser.add_argument(
        "--index",
        type=Path,
        default=get_settings().rag_index_path,
        help="Destination path for FAISS index (file name stem is used).",
    )
    return parser.parse_args()


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )
    args = parse_args()
    ingest(args.source, args.providers, args.index)


if __name__ == "__main__":
    main()
