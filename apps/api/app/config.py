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
        default="gemini-3.5-flash",
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
    gemini_max_output_tokens: int = Field(
        default=4096,
        validation_alias=AliasChoices(
            "gemini_max_output_tokens",
            "GEMINI_MAX_OUTPUT_TOKENS",
        ),
    )
    gemini_round_seed_max_output_tokens: int = Field(
        default=8192,
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
        default=3200,
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
    ai_universe_pick_representatives_per_category: bool = Field(
        default=False,
        validation_alias=AliasChoices(
            "ai_universe_pick_representatives_per_category",
            "AI_UNIVERSE_PICK_REPRESENTATIVES_PER_CATEGORY",
        ),
    )


settings = Settings()
