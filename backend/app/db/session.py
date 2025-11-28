from collections.abc import AsyncIterator
from typing import Optional

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.db.base import Base

engine: AsyncEngine | None = None
SessionLocal: Optional[async_sessionmaker[AsyncSession]] = None


def init_engine(database_url: str) -> tuple[AsyncEngine, async_sessionmaker[AsyncSession]]:
    global engine, SessionLocal
    if engine is None:
        engine = create_async_engine(
            database_url,
            echo=False,
            pool_pre_ping=True,
            future=True,
        )
        SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
    assert engine is not None and SessionLocal is not None
    return engine, SessionLocal


async def init_db(database_url: str) -> None:
    db_engine, _ = init_engine(database_url)
    async with db_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_session() -> AsyncIterator[AsyncSession]:
    if SessionLocal is None:
        raise RuntimeError("SessionLocal is not initialized. Call init_db first.")
    async with SessionLocal() as session:
        yield session
