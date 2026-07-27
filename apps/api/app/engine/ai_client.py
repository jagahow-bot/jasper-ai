"""Unified AI client for Google Generative Language and Moonshot OpenAI APIs."""

from __future__ import annotations

import json
from typing import Any, Literal

import httpx

from app.config import settings
from app.engine.ai_json import prepare_gemini_json_text

GOOGLE_GENERATE_URL = "https://generativelanguage.googleapis.com/v1beta/models"


def resolve_ai_provider(model_id: str) -> Literal["google", "moonshot"]:
    """Pick a provider from the model id string."""
    m = model_id.lower()
    if m.startswith("kimi") or "moonshot" in m:
        return "moonshot"
    return "google"


def default_ai_model() -> str:
    """Default model for routine structured AI calls (Gemini 3.6 Flash)."""
    return settings.gemini_model


def reasoning_ai_model() -> str:
    """Default model for high-value reasoning tasks (Kimi K3)."""
    return settings.ai_reasoning_model


def model_has_api_key(model_id: str) -> bool:
    """Return True when the requested model's API key is configured."""
    provider = resolve_ai_provider(model_id)
    if provider == "moonshot":
        return bool(settings.moonshot_api_key)
    return bool(settings.gemini_api_key)


def _model_id(model: str | None) -> str:
    return (model or "").strip() or default_ai_model()


def _call_google(
    *,
    model_id: str,
    prompt: str,
    system: str | None,
    temperature: float,
    max_output_tokens: int,
    response_mime_type: str | None,
    response_schema: dict[str, Any] | None,
    extra_generation_config: dict[str, Any] | None,
    timeout: float,
) -> tuple[str, str]:
    key = settings.gemini_api_key
    if not key:
        raise RuntimeError("Google Generative AI API key is not configured")
    url = f"{GOOGLE_GENERATE_URL}/{model_id}:generateContent?key={key}"

    generation_config: dict[str, Any] = {
        "temperature": temperature,
        "maxOutputTokens": max_output_tokens,
    }
    if response_mime_type:
        generation_config["responseMimeType"] = response_mime_type
    if response_schema is not None:
        generation_config["responseSchema"] = response_schema
    if extra_generation_config:
        generation_config.update(extra_generation_config)

    body: dict[str, Any] = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": generation_config,
    }
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}

    res = httpx.post(url, json=body, timeout=timeout)
    res.raise_for_status()
    data = res.json()
    candidate = data.get("candidates", [{}])[0]
    finish_reason = candidate.get("finishReason", "")
    parts = candidate.get("content", {}).get("parts", [])
    text = "".join(p.get("text", "") for p in parts if isinstance(p, dict))
    return text, finish_reason


def _call_moonshot(
    *,
    model_id: str,
    prompt: str,
    system: str | None,
    temperature: float,
    max_output_tokens: int,
    response_mime_type: str | None,
    response_schema: dict[str, Any] | None,
    timeout: float,
) -> tuple[str, str]:
    key = settings.moonshot_api_key
    if not key:
        raise RuntimeError("Moonshot API key is not configured")
    base = (settings.moonshot_base_url or "https://api.moonshot.ai/v1").rstrip("/")
    url = f"{base}/chat/completions"

    messages: list[dict[str, str]] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    body: dict[str, Any] = {
        "model": model_id,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_output_tokens,
    }

    if response_mime_type == "application/json" or response_schema is not None:
        body["response_format"] = {"type": "json_object"}
        if response_schema is not None:
            schema_note = (
                "\n\nReturn strictly JSON matching this schema:\n"
                f"{json.dumps(response_schema, ensure_ascii=False)}"
            )
            if system:
                body["messages"][0]["content"] += schema_note
            else:
                body["messages"].insert(
                    0,
                    {
                        "role": "system",
                        "content": f"Return strictly JSON matching this schema:\n{json.dumps(response_schema, ensure_ascii=False)}",
                    },
                )

    res = httpx.post(
        url,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json=body,
        timeout=timeout,
    )
    res.raise_for_status()
    data = res.json()
    choice = data.get("choices", [{}])[0]
    finish_reason = choice.get("finish_reason", "")
    if finish_reason == "length":
        finish_reason = "MAX_TOKENS"
    message = choice.get("message", {})
    text = message.get("content", "") or ""
    return text, finish_reason


def generate_ai_text(
    *,
    model: str | None = None,
    prompt: str,
    system: str | None = None,
    temperature: float = 0.0,
    max_output_tokens: int,
    response_mime_type: str | None = None,
    response_schema: dict[str, Any] | None = None,
    extra_generation_config: dict[str, Any] | None = None,
    timeout: float = 45.0,
) -> tuple[str, str]:
    """Call the selected provider and return (text, finish_reason)."""
    model_id = _model_id(model)
    if not model_has_api_key(model_id):
        raise RuntimeError(f"No API key configured for model {model_id}")

    provider = resolve_ai_provider(model_id)
    if provider == "moonshot":
        return _call_moonshot(
            model_id=model_id,
            prompt=prompt,
            system=system,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
            response_mime_type=response_mime_type,
            response_schema=response_schema,
            timeout=timeout,
        )
    return _call_google(
        model_id=model_id,
        prompt=prompt,
        system=system,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        response_mime_type=response_mime_type,
        response_schema=response_schema,
        extra_generation_config=extra_generation_config,
        timeout=timeout,
    )


def generate_ai_json(
    *,
    model: str | None = None,
    prompt: str,
    system: str | None = None,
    temperature: float = 0.0,
    max_output_tokens: int,
    response_schema: dict[str, Any] | None = None,
    response_mime_type: str | None = "application/json",
    extra_generation_config: dict[str, Any] | None = None,
    timeout: float = 45.0,
) -> dict[str, Any]:
    """Call the selected provider and parse the response as JSON."""
    text, _finish_reason = generate_ai_text(
        model=model,
        prompt=prompt,
        system=system,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        response_mime_type=response_mime_type,
        response_schema=response_schema,
        extra_generation_config=extra_generation_config,
        timeout=timeout,
    )
    cleaned = prepare_gemini_json_text(text.strip())
    if not cleaned or cleaned in ("null", "None"):
        raise ValueError("empty_ai_response")
    return json.loads(cleaned)
