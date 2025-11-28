from app.db.models import ConversationLog
from sqlalchemy.ext.asyncio import AsyncSession


class ConversationLogRepository:
    def __init__(self, session: AsyncSession):
        self._session = session

    async def create(
        self,
        session_id: str,
        turn_id: str,
        user_text: str,
        assistant_text: str,
    ) -> ConversationLog:
        record = ConversationLog(
            session_id=session_id,
            turn_id=turn_id,
            user_text=user_text,
            assistant_text=assistant_text,
        )
        self._session.add(record)
        await self._session.commit()
        await self._session.refresh(record)
        return record
