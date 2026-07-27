from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[3]
PROFILES_PATH = ROOT / "shared" / "strategy-profiles.json"
UNIVERSE_PATH = ROOT / "shared" / "etf-universe.json"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(
            str(ROOT / "apps" / "api" / ".env"),
            str(ROOT / "apps" / "web" / ".env.local"),
        ),
        extra="ignore",
    )

    api_cors_origins: str = (
        "http://localhost:3000,http://localhost:3001,http://localhost:3002,"
        "http://127.0.0.1:3000,http://127.0.0.1:3001,http://127.0.0.1:3002"
    )
    gemini_model: str = Field(
        default="gemini-3.6-flash",
        validation_alias=AliasChoices("gemini_model", "GEMINI_MODEL"),
    )
    gemini_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "gemini_api_key",
            "GEMINI_API_KEY",
            "GOOGLE_GENERATIVE_AI_API_KEY",
        ),
    )
    ai_reasoning_model: str = Field(
        default="kimi-k3",
        validation_alias=AliasChoices(
            "ai_reasoning_model",
            "AI_REASONING_MODEL",
            "moonshot_model",
            "MOONSHOT_MODEL",
        ),
    )
    moonshot_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("moonshot_api_key", "MOONSHOT_API_KEY"),
    )
    moonshot_base_url: str = Field(
        default="https://api.moonshot.ai/v1",
        validation_alias=AliasChoices("moonshot_base_url", "MOONSHOT_BASE_URL"),
    )
    gemini_max_output_tokens: int = Field(
        default=6144,
        validation_alias=AliasChoices(
            "gemini_max_output_tokens",
            "GEMINI_MAX_OUTPUT_TOKENS",
        ),
    )
    gemini_round_seed_max_output_tokens: int = Field(
        default=14336,
        ge=512,
        le=16384,
        validation_alias=AliasChoices(
            "gemini_round_seed_max_output_tokens",
            "GEMINI_ROUND_SEED_MAX_OUTPUT_TOKENS",
        ),
    )
    gemini_round_seed_thinking_level: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "gemini_round_seed_thinking_level",
            "GEMINI_ROUND_SEED_THINKING_LEVEL",
        ),
    )
    gemini_round_seed_learning_max_chars: int = Field(
        default=7000,
        ge=800,
        le=12000,
        validation_alias=AliasChoices(
            "gemini_round_seed_learning_max_chars",
            "GEMINI_ROUND_SEED_LEARNING_MAX_CHARS",
        ),
    )
    gemini_param_seed_max_retries: int = Field(
        default=3,
        validation_alias=AliasChoices(
            "gemini_param_seed_max_retries",
            "GEMINI_PARAM_SEED_MAX_RETRIES",
        ),
    )
    gemini_param_seed_temperature: float = Field(
        default=0.65,
        ge=0.0,
        le=1.0,
        validation_alias=AliasChoices(
            "gemini_param_seed_temperature",
            "GEMINI_PARAM_SEED_TEMPERATURE",
        ),
    )
    gemini_round_seed_temperature: float = Field(
        default=0.55,
        ge=0.0,
        le=1.0,
        validation_alias=AliasChoices(
            "gemini_round_seed_temperature",
            "GEMINI_ROUND_SEED_TEMPERATURE",
        ),
    )
    ai_param_seed_batch_threshold: int = Field(
        default=10,
        ge=1,
        le=200,
        validation_alias=AliasChoices(
            "ai_param_seed_batch_threshold",
            "AI_PARAM_SEED_BATCH_THRESHOLD",
        ),
    )
    ai_param_seed_max_count: int = Field(
        default=8,
        ge=1,
        le=40,
        validation_alias=AliasChoices(
            "ai_param_seed_max_count",
            "AI_PARAM_SEED_MAX_COUNT",
        ),
    )
    ai_param_seed_batch_size: int = Field(
        default=8,
        ge=1,
        le=20,
        validation_alias=AliasChoices(
            "ai_param_seed_batch_size",
            "AI_PARAM_SEED_BATCH_SIZE",
        ),
    )
    gemini_learning_context_mode: str = Field(
        default="auto",
        validation_alias=AliasChoices(
            "gemini_learning_context_mode",
            "GEMINI_LEARNING_CONTEXT_MODE",
        ),
    )
    gemini_thinking_level: str = Field(
        default="off",
        validation_alias=AliasChoices(
            "gemini_thinking_level",
            "GEMINI_THINKING_LEVEL",
        ),
    )
    gemini_thinking_level_full: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "gemini_thinking_level_full",
            "GEMINI_THINKING_LEVEL_FULL",
        ),
    )
    use_mock_engine: bool = False
    optuna_trials: int = 50

    # --- Email notifications (optional) ---------------------------------------
    # When SMTP_HOST is set, completed/failed backtest jobs that carry a
    # notify_email will trigger a best-effort email. All fields are optional so
    # the feature stays fully disabled until an operator configures a provider.
    smtp_host: str | None = Field(
        default=None,
        validation_alias=AliasChoices("smtp_host", "SMTP_HOST"),
    )
    smtp_port: int = Field(
        default=587,
        validation_alias=AliasChoices("smtp_port", "SMTP_PORT"),
    )
    smtp_user: str | None = Field(
        default=None,
        validation_alias=AliasChoices("smtp_user", "SMTP_USER"),
    )
    smtp_password: str | None = Field(
        default=None,
        validation_alias=AliasChoices("smtp_password", "SMTP_PASSWORD"),
    )
    smtp_from: str | None = Field(
        default=None,
        description="From address; falls back to SMTP_USER when unset.",
        validation_alias=AliasChoices("smtp_from", "SMTP_FROM"),
    )
    smtp_starttls: bool = Field(
        default=True,
        description="Use STARTTLS (typical for port 587). Ignored when SMTP_SSL is on.",
        validation_alias=AliasChoices("smtp_starttls", "SMTP_STARTTLS"),
    )
    smtp_ssl: bool = Field(
        default=False,
        description="Use implicit TLS/SSL (typical for port 465).",
        validation_alias=AliasChoices("smtp_ssl", "SMTP_SSL"),
    )
    # Public base URL of the web app, used to build a deep link to results in
    # the notification email (e.g. https://jasper-ai-web.onrender.com).
    public_web_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "public_web_url",
            "PUBLIC_WEB_URL",
            "WEB_APP_URL",
        ),
    )
    ai_universe_pick_representatives_per_category: bool = Field(
        default=False,
        validation_alias=AliasChoices(
            "ai_universe_pick_representatives_per_category",
            "AI_UNIVERSE_PICK_REPRESENTATIVES_PER_CATEGORY",
        ),
    )


settings = Settings()
