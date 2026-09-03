"""(1) Schema fields for two_layer_sleeve_v1."""

from __future__ import annotations

from pydantic import BaseModel, Field


class TwoLayerSleeveV1Config(BaseModel):
    """Tunables — attach bounds via Field(ge=..., le=...)."""

    placeholder: float = Field(default=0.0, ge=0.0, le=1.0)
