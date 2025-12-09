from fastapi import APIRouter, Depends, HTTPException

from app.api.dependencies import get_app_settings, get_provider_registry
from app.core.settings import AppSettings
from app.providers.registry import ProviderRegistry
from app.schemas.motion import MotionGenerateRequest, MotionGenerateResponse

router = APIRouter()


def _resolve_url(result: MotionGenerateResponse, settings: AppSettings) -> str:
    if result.url:
        return result.url
    if "/data/" in result.output_path:
        suffix = result.output_path.split("/data/", 1)[1]
        base = settings.data_mount_path.rstrip("/") or "/data"
        return f"{base}/{suffix}"
    return result.output_path


@router.post("/motion/generate", response_model=MotionGenerateResponse)
async def generate_motion(
    body: MotionGenerateRequest,
    providers: ProviderRegistry = Depends(get_provider_registry),
    settings: AppSettings = Depends(get_app_settings),
) -> MotionGenerateResponse:
    prompt = body.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt is empty.")
    request = body.model_copy(update={"prompt": prompt})
    result = await providers.motion.generate(request)
    resolved_url = _resolve_url(result, settings)
    return result.model_copy(update={"url": resolved_url})
