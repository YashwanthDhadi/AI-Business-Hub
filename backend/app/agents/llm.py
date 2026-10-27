"""
The language models.

Every provider we use speaks the OpenAI API format, so one class - ChatOpenAI -
reaches all of them. Only the API key and the base URL change. That is why
adding Google meant adding two settings, not a new dependency.

    provider          used for                     format
    ----------------  ---------------------------  --------------------------
    openrouter        every capability's answers   OpenAI-compatible
    google (Gemini)   the supervisor's routing     OpenAI-compatible endpoint
    groq              speech to text only          its own REST call, see
                                                   app/channels/speech.py

Ask for a model by PURPOSE, not by name:

    get_model("router")     the supervisor
    get_model("booking")    the model that answers booking messages
    get_model()             the default

Purposes with nothing configured fall back to the default model, so an empty
CAPABILITY_MODELS means "everything behaves exactly as it did before".
"""

from __future__ import annotations

import logging
from functools import lru_cache

from langchain_openai import ChatOpenAI

from app.config import settings

logger = logging.getLogger("aibh.llm")

DEFAULT_PURPOSE = "default"
ROUTER_PURPOSE = "router"


class ProviderNotConfigured(RuntimeError):
    """A model was asked for, but that provider has no API key in .env."""


def provider_credentials(provider: str) -> tuple[str, str]:
    """The API key and base URL for one provider. Raises if the key is missing."""
    table = {
        "openrouter": (settings.openrouter_api_key, settings.llm_base_url),
        "google": (settings.google_api_key, settings.google_base_url),
    }
    if provider not in table:
        raise ProviderNotConfigured(
            f"Unknown provider '{provider}'. Known providers: {', '.join(sorted(table))}."
        )
    key, base_url = table[provider]
    if not key:
        variable = "OPENROUTER_API_KEY" if provider == "openrouter" else "GOOGLE_API_KEY"
        raise ProviderNotConfigured(f"{variable} is not set in backend/.env")
    return key, base_url


def resolve(purpose: str) -> tuple[str, str]:
    """
    Which (provider, model) serves this purpose.

    Resolution order, first match wins:
      1. purpose == "router"        -> router_provider / router_model
      2. CAPABILITY_MODELS[purpose] -> whatever that says
      3. the default                -> openrouter / llm_model
    """
    if purpose == ROUTER_PURPOSE:
        return settings.router_provider, settings.router_model

    override = settings.capability_model_map.get(purpose) or {}
    if override.get("model"):
        return override.get("provider") or "openrouter", override["model"]

    return "openrouter", settings.llm_model


@lru_cache(maxsize=16)
def _build(provider: str, model: str, temperature: float, timeout: float, retries: int) -> ChatOpenAI:
    """
    Build one client and reuse it. Cached on its arguments, so a hundred
    customer messages share one HTTP connection pool instead of opening a
    hundred.
    """
    key, base_url = provider_credentials(provider)
    logger.info("Building model=%s provider=%s temperature=%s", model, provider, temperature)

    # OpenRouter-only: if the primary model is rate-limited or offline it tries
    # these in order, transparently. Free endpoints fail often enough that this
    # is the difference between an agent that works and one that half-works.
    # Gemini has no such feature, so the supervisor handles its own fallback.
    extra_body = None
    default_headers = None
    if provider == "openrouter":
        extra_body = {"models": settings.llm_fallback_list} if settings.llm_fallback_list else None
        default_headers = {
            "HTTP-Referer": settings.openrouter_site_url,
            "X-Title": settings.openrouter_app_name,
        }

    return ChatOpenAI(
        model=model,
        extra_body=extra_body,
        api_key=key,
        base_url=base_url,
        temperature=temperature,
        # The router passes 0: it has a deadline, and a retry would blow it.
        max_retries=retries,
        # Free endpoints queue behind paid traffic and are slower than a
        # dedicated provider. 30s was too tight; 60s is realistic.
        timeout=timeout,
        default_headers=default_headers,
    )


def get_model(
    purpose: str = DEFAULT_PURPOSE,
    *,
    temperature: float | None = None,
    timeout: float = 60.0,
    retries: int = 2,
) -> ChatOpenAI:
    """A chat model for this purpose. See the module docstring."""
    provider, model = resolve(purpose)
    temp = settings.llm_temperature if temperature is None else temperature
    return _build(provider, model, temp, timeout, retries)


def get_llm(temperature: float | None = None) -> ChatOpenAI:
    """
    The default chat model.

    Kept because the agent loop, the health check and several scripts already
    call it. It is now a thin wrapper over get_model().
    """
    return get_model(DEFAULT_PURPOSE, temperature=temperature)


def ping_llm(prompt: str = "Reply with exactly: pong") -> str:
    """Smoke test used by /health/llm."""
    response = get_model(temperature=0).invoke(prompt)
    return str(response.content).strip()


def describe_error(exc: Exception) -> str:
    """
    Turn a provider failure into something you can act on.

    These are the ones you will actually meet on free tiers.
    """
    text = str(exc).lower()

    if "no endpoints found" in text or "not a valid model" in text:
        return (
            f"OpenRouter has no endpoint for '{settings.llm_model}'. Check the exact id "
            "at https://openrouter.ai/models, or run: python scripts\\check_models.py"
        )
    if "no allowed providers" in text or "data policy" in text:
        return (
            "Your OpenRouter privacy settings block every provider for this model. "
            "Open https://openrouter.ai/settings/privacy and allow training-free "
            "providers, or pick a different model."
        )
    if "401" in text or "no auth credentials" in text or "invalid api key" in text:
        return "The API key for this provider is wrong or missing. Check backend/.env."
    if "402" in text or "insufficient" in text or "credits" in text:
        return (
            "Out of OpenRouter credits. Free models still need a model id ending in "
            "':free', and free accounts are capped per day."
        )
    if "503" in text or "high demand" in text or "unavailable" in text:
        return (
            "The provider is overloaded right now (503). This is common on free "
            "tiers. The supervisor falls back automatically; for chat, wait or "
            "switch model."
        )
    if "429" in text or "rate limit" in text:
        # Deliberately provider-neutral: this message is shown for Gemini as
        # well as OpenRouter, and naming the wrong provider sends you looking
        # in the wrong place. Both free tiers sit around 15-20 a minute.
        return (
            "Rate limited by the model provider. Free tiers allow roughly 15-20 "
            "requests a minute and a limited number per day. Wait a moment, or "
            "switch model."
        )
    if "timed out" in text or "timeout" in text:
        return "The provider did not answer in time. Free endpoints can be very slow."
    if "does not support tools" in text or ("tool" in text and "support" in text):
        return (
            f"'{settings.llm_model}' cannot do tool calling, which this agent requires. "
            "Run: python scripts\\check_models.py to list models that can."
        )
    return str(exc)
