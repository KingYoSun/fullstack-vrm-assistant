from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_db_session
from app.repositories.system_prompts import SystemPromptRepository
from app.schemas.system_prompts import (
    SystemPromptCreate,
    SystemPromptResponse,
    SystemPromptUpdate,
)

router = APIRouter()


@router.get("/system-prompts", response_model=list[SystemPromptResponse])
async def list_system_prompts(
    session: AsyncSession = Depends(get_db_session),
) -> list[SystemPromptResponse]:
    repo = SystemPromptRepository(session)
    return await repo.list()


@router.get(
    "/system-prompts/active", response_model=SystemPromptResponse | None, status_code=status.HTTP_200_OK
)
async def get_active_system_prompt(
    session: AsyncSession = Depends(get_db_session),
) -> SystemPromptResponse | None:
    repo = SystemPromptRepository(session)
    return await repo.get_active() or await repo.get_latest()


@router.get("/system-prompts/{prompt_id}", response_model=SystemPromptResponse)
async def get_system_prompt(
    prompt_id: int, session: AsyncSession = Depends(get_db_session)
) -> SystemPromptResponse:
    repo = SystemPromptRepository(session)
    record = await repo.get(prompt_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="system prompt not found")
    return record


@router.post("/system-prompts", response_model=SystemPromptResponse, status_code=status.HTTP_201_CREATED)
async def create_system_prompt(
    body: SystemPromptCreate, session: AsyncSession = Depends(get_db_session)
) -> SystemPromptResponse:
    repo = SystemPromptRepository(session)
    try:
        return await repo.create(
            title=body.title,
            content=body.content,
            is_active=body.is_active,
        )
    except IntegrityError as exc:  # pragma: no cover - db constraint guard
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="system prompt title already exists"
        ) from exc


@router.put("/system-prompts/{prompt_id}", response_model=SystemPromptResponse)
async def update_system_prompt(
    prompt_id: int,
    body: SystemPromptUpdate,
    session: AsyncSession = Depends(get_db_session),
) -> SystemPromptResponse:
    repo = SystemPromptRepository(session)
    record = await repo.get(prompt_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="system prompt not found")
    try:
        return await repo.update(
            record,
            title=body.title,
            content=body.content,
            is_active=body.is_active,
        )
    except IntegrityError as exc:  # pragma: no cover - db constraint guard
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="system prompt title already exists"
        ) from exc


@router.delete("/system-prompts/{prompt_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_system_prompt(
    prompt_id: int, session: AsyncSession = Depends(get_db_session)
) -> None:
    repo = SystemPromptRepository(session)
    record = await repo.get(prompt_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="system prompt not found")
    await repo.delete(record)
