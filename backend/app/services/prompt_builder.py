from app.db.models import CharacterProfile
from app.providers.llm import ChatMessage

MAX_ASSISTANT_CHARACTERS = 150

DEFAULT_SYSTEM_PROMPT = (
    "あなたは音声対応の VRM アシスタントです。ユーザーと自然な会話をするように口語で話し、"
    "本文は150文字以内にまとめてください。要点だけを端的に返し、一息で読み上げられる長さを維持します。"
    "提供されたコンテキストは関連する部分だけ取り込み、無い場合は簡潔に答えてください。"
)


def build_system_prompt(
    character: CharacterProfile | None, base_prompt: str | None = None
) -> str:
    parts = [base_prompt or DEFAULT_SYSTEM_PROMPT]
    if character:
        persona_lines = [f"キャラクター名: {character.name}", f"人物像・役割: {character.persona}"]
        if character.speaking_style:
            persona_lines.append(f"話し方のヒント: {character.speaking_style}")
        parts.append("\n".join(persona_lines))
    return "\n\n".join(parts)


def build_chat_messages(
    user_text: str, context_text: str, character: CharacterProfile | None, system_prompt: str | None
) -> list[ChatMessage]:
    messages: list[ChatMessage] = [
        ChatMessage(role="system", content=build_system_prompt(character, system_prompt)),
    ]
    if context_text:
        messages.append(ChatMessage(role="system", content=f"コンテキスト:\n{context_text}"))
    messages.append(ChatMessage(role="user", content=user_text))
    return messages


def clamp_response_length(text: str, limit: int = MAX_ASSISTANT_CHARACTERS) -> str:
    cleaned = text.strip()
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit].rstrip() + "…"
