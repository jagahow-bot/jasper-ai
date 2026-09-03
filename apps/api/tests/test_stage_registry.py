"""Phase 0: stage registry and catalog version."""

from __future__ import annotations

from app.engine.stages import (
    STAGE_KINDS,
    get_registry,
    reset_registry_for_tests,
    stage_pin_fields,
)
from app.engine.stages.base import LEGACY_CATALOG_VERSION, LEGACY_IMPLEMENTATIONS_MARKER
from app.engine.stages.registry import apply_legacy_stage_defaults


def setup_function() -> None:
    reset_registry_for_tests()


def test_registry_resolves_all_eight_builtin_stages() -> None:
    reg = get_registry()
    for kind in STAGE_KINDS:
        stage = reg.resolve(kind)
        assert stage.stage == kind
        assert stage.implementation_id
        assert stage.version
        card = stage.capability_card()
        assert card.stage == kind
        assert card.implementation_id == stage.implementation_id


def test_catalog_version_is_stable_16_hex() -> None:
    reg = get_registry()
    v1 = reg.catalog_version()
    v2 = reg.catalog_version()
    assert v1 == v2
    assert len(v1) == 16
    int(v1, 16)  # raises if not hex


def test_stage_pin_fields_include_param_catalog_version() -> None:
    pins = stage_pin_fields()
    assert pins["stage_catalog_version"]
    assert isinstance(pins["stage_implementations"], dict)
    assert set(pins["stage_implementations"]) == set(STAGE_KINDS)
    assert pins["param_catalog_version"] in (1, None) or isinstance(
        pins["param_catalog_version"], int
    )


def test_legacy_job_defaults() -> None:
    out = apply_legacy_stage_defaults({"job_id": "x"})
    assert out["stage_catalog_version"] == LEGACY_CATALOG_VERSION
    assert out["stage_implementations"] == LEGACY_IMPLEMENTATIONS_MARKER
