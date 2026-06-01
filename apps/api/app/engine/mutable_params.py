"""Canonical AI-mutable parameter keys (shared by learning context, prompts, dedup)."""

from __future__ import annotations

from app.engine.param_taxonomy import (
    ALLOCATOR_MODE_KEY,
    FACTOR_CATEGORICAL_KEYS,
    FACTOR_NUMERIC_KEYS,
    RUN_LEVEL_FIXED_KEYS,
    SETUP_PARAM_KEYS,
)

GEMINI_LEARNING_MUTABLE_FIELDS: tuple[str, ...] = (
    *SETUP_PARAM_KEYS,
    *FACTOR_NUMERIC_KEYS,
    *FACTOR_CATEGORICAL_KEYS,
)

# Stable signature for de-duplicating AI / seed param sets.
PARAM_DEDUP_KEYS: tuple[str, ...] = GEMINI_LEARNING_MUTABLE_FIELDS
