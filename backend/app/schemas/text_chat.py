from pydantic import BaseModel, Field


class TextChatRequest(BaseModel):
    session_id: str = Field(..., description="Client session identifier")
    user_text: str = Field(..., description="User input text")
    turn_id: str | None = Field(
        default=None, description="Optional turn id. If omitted, server will generate."
    )
    top_k: int | None = Field(
        default=None, description="Override for RAG top_k. Defaults to provider config."
    )
