from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import CharacterProfile


class CharacterRepository:
    def __init__(self, session: AsyncSession):
        self._session = session

    async def list(self) -> list[CharacterProfile]:
        result = await self._session.execute(
            select(CharacterProfile).order_by(CharacterProfile.id)
        )
        return list(result.scalars().all())

    async def get(self, character_id: int) -> CharacterProfile | None:
        return await self._session.get(CharacterProfile, character_id)

    async def create(
        self, *, name: str, persona: str, speaking_style: str | None
    ) -> CharacterProfile:
        record = CharacterProfile(
            name=name,
            persona=persona,
            speaking_style=speaking_style,
        )
        self._session.add(record)
        await self._session.commit()
        await self._session.refresh(record)
        return record

    async def update(
        self,
        record: CharacterProfile,
        *,
        name: str | None = None,
        persona: str | None = None,
        speaking_style: str | None = None,
    ) -> CharacterProfile:
        if name is not None:
            record.name = name
        if persona is not None:
            record.persona = persona
        if speaking_style is not None:
            record.speaking_style = speaking_style

        await self._session.commit()
        await self._session.refresh(record)
        return record

    async def delete(self, record: CharacterProfile) -> None:
        await self._session.delete(record)
        await self._session.commit()
