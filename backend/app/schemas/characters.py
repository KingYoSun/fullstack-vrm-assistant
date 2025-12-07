from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CharacterBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    persona: str = Field(..., min_length=1, max_length=4000)
    speaking_style: str | None = Field(default=None, max_length=4000)


class CharacterCreate(CharacterBase):
    pass


class CharacterUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    persona: str | None = Field(default=None, min_length=1, max_length=4000)
    speaking_style: str | None = Field(default=None, max_length=4000)

    @model_validator(mode="after")
    def _at_least_one(self) -> "CharacterUpdate":
        if self.name is None and self.persona is None and self.speaking_style is None:
            raise ValueError("no fields to update")
        return self


class CharacterResponse(CharacterBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
