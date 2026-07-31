"""Unified AI client for Google Generative Language and Moonshot OpenAI APIs."""

from __future__ import annotations

import json
import time
from typing import Any, Literal

import httpx

from app.config import settings
from app.engine.ai_json import prepare_gemini_json_text
from app.llm_audit import append_llm_audit_entry, build_audit_entry

GOOGLE_GENERATE_URL = "https://generativelanguage.googleapis.com/v1beta/models"


def resolve_ai_provider(model_id: str) -> Literal["google", "moonshot"]:
    """Pick a provider from the model id string."""
    m = model_id.lower()
    if m.startswith("kimi") or "moonshot" in m:
        return "moonshot"
    return "google"


def default_ai_model() -> str:
    """Default model for routine structured AI calls (Gemini Flash / GEMINI_MODEL)."""
    return settings.gemini_model


def reasoning_ai_model() -> str:
    """Kimi K3 for non-interactive / heavy reasoning (not real-time overlay)."""
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
) -> dict[str, Any]:
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
    usage_raw = data.get("usageMetadata") or {}
    usage = {
        "prompt_tokens": usage_raw.get("promptTokenCount"),
        "completion_tokens": usage_raw.get("candidatesTokenCount"),
        "total_tokens": usage_raw.get("totalTokenCount"),
    }
    return {"text": text, "finish_reason": finish_reason, "usage": usage}


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
) -> dict[str, Any]:
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
    usage_raw = data.get("usage") or {}
    usage = {
        "prompt_tokens": usage_raw.get("prompt_tokens"),
        "completion_tokens": usage_raw.get("completion_tokens"),
        "total_tokens": usage_raw.get("total_tokens"),
    }
    return {"text": text, "finish_reason": finish_reason, "usage": usage}


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
    _call_type: str = "text",
) -> tuple[str, str]:
    """Call the selected provider and return (text, finish_reason).

    Every call is logged to the active LLM audit buffer (job-bound) for later
    inclusion in the backtest report. API keys are never logged.
    """
    model_id = _model_id(model)
    if not model_has_api_key(model_id):
        raise RuntimeError(f"No API key configured for model {model_id}")

    provider = resolve_ai_provider(model_id)
    start = time.perf_counter()
    try:
        if provider == "moonshot":
            result = _call_moonshot(
                model_id=model_id,
                prompt=prompt,
                system=system,
                temperature=temperature,
                max_output_tokens=max_output_tokens,
                response_mime_type=response_mime_type,
                response_schema=response_schema,
                timeout=timeout,
            )
        else:
            result = _call_google(
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
        duration_ms = (time.perf_counter() - start) * 1000
        text = str(result.get("text", ""))
        finish_reason = str(result.get("finish_reason", ""))
        append_llm_audit_entry(
            build_audit_entry(
                provider=provider,
                model_id=model_id,
                call_type=_call_type,
                prompt=prompt,
                system=system,
                temperature=temperature,
                max_output_tokens=max_output_tokens,
                response_mime_type=response_mime_type,
                raw_response=text,
                finish_reason=finish_reason,
                usage=result.get("usage"),
                duration_ms=duration_ms,
            )
        )
        return text, finish_reason
    except Exception as exc:
        duration_ms = (time.perf_counter() - start) * 1000
        append_llm_audit_entry(
            build_audit_entry(
                provider=provider,
                model_id=model_id,
                call_type=_call_type,
                prompt=prompt,
                system=system,
                temperature=temperature,
                max_output_tokens=max_output_tokens,
                response_mime_type=response_mime_type,
                raw_response="",
                finish_reason="error",
                usage=None,
                duration_ms=duration_ms,
                error=str(exc),
            )
        )
        raise


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
        _call_type="json",
    )
    cleaned = prepare_gemini_json_text(text.strip())
    if not cleaned or cleaned in ("null", "None"):
        raise ValueError("empty_ai_response")
    return json.loads(cleaned)
