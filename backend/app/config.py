"""
Application configuration.

Every secret and every tunable value enters the program here and nowhere else.
Import `settings` from this module; never read os.environ elsewhere.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/config.py -> backend/app -> backend
BACKEND_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BACKEND_DIR / ".env"


class Settings(BaseSettings):
    """Typed view of backend/.env, validated once at import time."""

    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ------------------------------------------------------------- general
    app_env: str = "development"
    log_level: str = "INFO"
    cors_origins: str = "http://localhost:3000"

    # ------------------------------------------------------------ Supabase
    supabase_url: str
    supabase_service_role_key: str

    # ------------------------------------------------- LLM (via OpenRouter)
    # OpenRouter speaks the OpenAI API format, so llm_base_url + llm_model also
    # work unchanged for Groq, Together or OpenAI. Only the key is provider
    # specific.
    openrouter_api_key: str
    llm_base_url: str = "https://openrouter.ai/api/v1"
    llm_model: str = "google/gemma-4-31b-it:free"
    # Tried in order if the primary is rate-limited or down. Free endpoints drop
    # out constantly, so one model is a single point of failure.
    llm_fallback_models: str = (
        "nvidia/nemotron-3-super-120b-a12b:free,"
        "nex-agi/nex-n2.5-pro:free,"
        "openrouter/free"
    )
    # Sent as HTTP-Referer and X-Title. OpenRouter only; harmless elsewhere.
    openrouter_site_url: str = "http://localhost:3000"
    # Where the frontend lives. Payment links sent to customers point here.
    public_site_url: str = "http://localhost:3000"
    openrouter_app_name: str = "AI Business Hub"
    llm_temperature: float = 0.3
    agent_max_steps: int = 6

    # ------------------------------------------------- which model does what
    # The supervisor only classifies a sentence, so it wants the fastest model
    # available, not the cleverest. Set router_enabled=false to go back to the
    # behaviour before the supervisor existed: every capability, every message.
    router_enabled: bool = True
    router_provider: str = "google"
    router_model: str = "gemini-3.5-flash-lite"
    # If the router has not answered in this long, stop waiting and use the
    # fallback. A router that takes 37 seconds is worse than no router.
    router_timeout_seconds: float = 6.0
    # How many earlier turns the router sees. Enough for "6 pm works" to make
    # sense, small enough to stay cheap and to limit what leaves our server.
    router_history_turns: int = 4
    # Per-capability model overrides, as JSON. Empty means "everything uses
    # llm_model on OpenRouter". Example:
    #   CAPABILITY_MODELS={"payment": {"provider": "google", "model": "gemini-3.5-flash-lite"}}
    capability_models: str = "{}"

    # -------------------------------------------- Google AI Studio (Gemini)
    # Gemini publishes an OpenAI-compatible endpoint, so it is reached with the
    # same ChatOpenAI class as OpenRouter - only the key and base_url differ.
    # No new dependency. Optional: nothing uses it until the supervisor lands.
    google_api_key: str = ""
    google_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai/"

    # ------------------------------------------------ speech to text (Groq)
    # Chat moved to OpenRouter; transcription stays on Groq's free Whisper.
    # Optional, so the server still starts before you reach Part 6.
    groq_api_key: str = ""
    groq_stt_model: str = "whisper-large-v3-turbo"

    # --------------------------------------------------------- public chat
    chat_session_ttl_days: int = 7
    chat_max_message_chars: int = 1000
    chat_rate_window_seconds: int = 300
    chat_rate_limit_per_session: int = 20
    chat_rate_limit_per_ip: int = 40
    voice_rate_limit_per_session: int = 8
    voice_max_upload_mb: int = 8
    ip_hash_salt: str = "change-me"

    # ----------------------------------------------------------- dashboard
    dashboard_api_key: str = "change-me"

    # ---------------------------------------------------------------- demo
    demo_chat_slug: str = "pulse-fitness"

    # ------------------------------------------------------------ helpers
    @property
    def cors_origin_list(self) -> list[str]:
        """CORS_ORIGINS is a comma-separated string; FastAPI wants a list."""
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def capability_model_map(self) -> dict[str, dict]:
        """
        CAPABILITY_MODELS is JSON. A typo must not stop the server booting, so
        anything unreadable is treated as "no overrides" and logged once.
        """
        import json
        import logging

        try:
            parsed = json.loads(self.capability_models or "{}")
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            logging.getLogger("aibh.config").warning(
                "CAPABILITY_MODELS is not valid JSON; ignoring it and using %s for everything",
                self.llm_model,
            )
            return {}

    @property
    def llm_fallback_list(self) -> list[str]:
        """LLM_FALLBACK_MODELS is comma-separated; OpenRouter wants a list."""
        return [m.strip() for m in self.llm_fallback_models.split(",") if m.strip()]

    @property
    def voice_max_upload_bytes(self) -> int:
        return self.voice_max_upload_mb * 1024 * 1024

    @property
    def is_development(self) -> bool:
        return self.app_env.lower() in {"development", "dev", "local"}

    def masked(self) -> dict[str, object]:
        """Safe-to-log view. Used by /health — never leaks a secret."""

        def mask(value: str) -> str:
            if not value:
                return "MISSING"
            if len(value) <= 8:
                return "set"
            return f"{value[:4]}...{value[-4:]}"

        return {
            "app_env": self.app_env,
            "supabase_url": self.supabase_url,
            "supabase_service_role_key": mask(self.supabase_service_role_key),
            "openrouter_api_key": mask(self.openrouter_api_key),
            "llm_model": self.llm_model,
            "llm_base_url": self.llm_base_url,
            "llm_fallback_models": self.llm_fallback_list,
            "google_api_key": mask(self.google_api_key),
            "groq_api_key": mask(self.groq_api_key),
            "groq_stt_model": self.groq_stt_model,
            "dashboard_api_key": mask(self.dashboard_api_key),
            "ip_hash_salt": mask(self.ip_hash_salt),
            "cors_origins": self.cors_origin_list,
            "demo_chat_slug": self.demo_chat_slug,
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Build Settings once and reuse it for the life of the process."""
    return Settings()


# Module-level singleton, imported everywhere as: from app.config import settings
settings = get_settings()