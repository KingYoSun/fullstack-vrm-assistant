from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SystemPromptBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=128)
    content: str = Field(..., min_length=1, max_length=4000)
    is_active: bool = Field(default=False)


class SystemPromptCreate(SystemPromptBase):
    pass


class SystemPromptUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=128)
    content: str | None = Field(default=None, min_length=1, max_length=4000)
    is_active: bool | None = None

    @model_validator(mode="after")
    def _at_least_one(self) -> "SystemPromptUpdate":
        if self.title is None and self.content is None and self.is_active is None:
            raise ValueError("no fields to update")
        return self


class SystemPromptResponse(SystemPromptBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
