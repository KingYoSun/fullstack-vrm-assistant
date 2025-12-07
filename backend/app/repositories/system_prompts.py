from typing import Sequence

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import SystemPrompt


class SystemPromptRepository:
    def __init__(self, session: AsyncSession):
        self._session = session

    async def list(self) -> list[SystemPrompt]:
        result = await self._session.execute(
            select(SystemPrompt).order_by(SystemPrompt.id)
        )
        return list(result.scalars().all())

    async def get(self, prompt_id: int) -> SystemPrompt | None:
        return await self._session.get(SystemPrompt, prompt_id)

    async def get_active(self) -> SystemPrompt | None:
        result = await self._session.execute(
            select(SystemPrompt).where(SystemPrompt.is_active.is_(True)).limit(1)
        )
        return result.scalars().first()

    async def get_latest(self) -> SystemPrompt | None:
        result = await self._session.execute(
            select(SystemPrompt).order_by(SystemPrompt.updated_at.desc(), SystemPrompt.id.desc()).limit(1)
        )
        return result.scalars().first()

    async def has_active(self) -> bool:
        count = await self._session.scalar(
            select(func.count()).select_from(SystemPrompt).where(SystemPrompt.is_active.is_(True))
        )
        return bool(count and count > 0)

    async def _deactivate_others(self, exclude_id: int | None = None) -> None:
        stmt = update(SystemPrompt).where(SystemPrompt.is_active.is_(True))
        if exclude_id is not None:
            stmt = stmt.where(SystemPrompt.id != exclude_id)
        await self._session.execute(stmt.values(is_active=False))

    async def create(self, *, title: str, content: str, is_active: bool) -> SystemPrompt:
        record = SystemPrompt(title=title, content=content, is_active=False)
        should_activate = is_active or not await self.has_active()
        if should_activate:
            await self._deactivate_others()
            record.is_active = True
        self._session.add(record)
        await self._session.commit()
        await self._session.refresh(record)
        return record

    async def update(
        self,
        record: SystemPrompt,
        *,
        title: str | None = None,
        content: str | None = None,
        is_active: bool | None = None,
    ) -> SystemPrompt:
        if title is not None:
            record.title = title
        if content is not None:
            record.content = content
        if is_active is True:
            await self._deactivate_others(exclude_id=record.id)
            record.is_active = True
        elif is_active is False:
            record.is_active = False

        await self._session.commit()
        await self._session.refresh(record)
        if record.is_active:
            return record

        # If all prompts became inactive, try to activate the latest one.
        has_active = await self.has_active()
        if not has_active:
            latest = await self.get_latest()
            if latest:
                latest.is_active = True
                await self._session.commit()
                await self._session.refresh(latest)
                return latest
        return record

    async def delete(self, record: SystemPrompt) -> None:
        was_active = record.is_active
        await self._session.delete(record)
        await self._session.commit()
        if was_active:
            latest = await self.get_latest()
            if latest:
                latest.is_active = True
                await self._session.commit()
                await self._session.refresh(latest)

    async def upsert_many(self, prompts: Sequence[SystemPrompt]) -> None:
        for prompt in prompts:
            self._session.add(prompt)
        await self._session.commit()
