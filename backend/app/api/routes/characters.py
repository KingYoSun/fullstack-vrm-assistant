from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_db_session
from app.repositories.characters import CharacterRepository
from app.schemas.characters import CharacterCreate, CharacterResponse, CharacterUpdate

router = APIRouter()


@router.get("/characters", response_model=list[CharacterResponse])
async def list_characters(session: AsyncSession = Depends(get_db_session)) -> list[CharacterResponse]:
    repo = CharacterRepository(session)
    return await repo.list()


@router.get("/characters/{character_id}", response_model=CharacterResponse)
async def get_character(
    character_id: int, session: AsyncSession = Depends(get_db_session)
) -> CharacterResponse:
    repo = CharacterRepository(session)
    record = await repo.get(character_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="character not found")
    return record


@router.post("/characters", response_model=CharacterResponse, status_code=status.HTTP_201_CREATED)
async def create_character(
    body: CharacterCreate, session: AsyncSession = Depends(get_db_session)
) -> CharacterResponse:
    repo = CharacterRepository(session)
    try:
        return await repo.create(
            name=body.name, persona=body.persona, speaking_style=body.speaking_style
        )
    except IntegrityError as exc:  # pragma: no cover - db constraint guard
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="character name already exists"
        ) from exc


@router.put("/characters/{character_id}", response_model=CharacterResponse)
async def update_character(
    character_id: int,
    body: CharacterUpdate,
    session: AsyncSession = Depends(get_db_session),
) -> CharacterResponse:
    repo = CharacterRepository(session)
    record = await repo.get(character_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="character not found")
    try:
        return await repo.update(
            record,
            name=body.name,
            persona=body.persona,
            speaking_style=body.speaking_style,
        )
    except IntegrityError as exc:  # pragma: no cover - db constraint guard
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="character name already exists"
        ) from exc


@router.delete("/characters/{character_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_character(
    character_id: int, session: AsyncSession = Depends(get_db_session)
) -> None:
    repo = CharacterRepository(session)
    record = await repo.get(character_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="character not found")
    await repo.delete(record)
