"""Stage registry and catalog version (Phase 0)."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Literal

from app.engine.stages.base import (
    LEGACY_CATALOG_VERSION,
    LEGACY_IMPLEMENTATIONS_MARKER,
    STAGE_KINDS,
    ApprovalStatus,
    RegistrationStatus,
    Stage,
    StageKind,
)

ROOT = Path(__file__).resolve().parents[5]
PARAM_CATALOG_PATH = ROOT / "shared" / "param-catalog.json"


@dataclass(frozen=True)
class StageRegistration:
    stage: StageKind
    implementation_id: str
    version: str
    factory: Callable[[], Stage]
    status: RegistrationStatus = "active"
    source_pr: str | None = None
    approval_status: ApprovalStatus = "approved"
    pending_supervisor_signoff: bool = False
    approved_by: dict[str, str] = field(default_factory=dict)

    @property
    def labeled(self) -> str:
        return f"{self.implementation_id}@{self.version}"


class StageRegistry:
    """Resolve active stage implementations and compute catalog version."""

    def __init__(self) -> None:
        self._regs: dict[StageKind, dict[str, StageRegistration]] = {
            kind: {} for kind in STAGE_KINDS
        }
        self._defaults: dict[StageKind, str] = {}

    def register(
        self,
        registration: StageRegistration,
        *,
        default: bool = False,
    ) -> None:
        stage = registration.stage
        self._regs[stage][registration.implementation_id] = registration
        if default or stage not in self._defaults:
            if registration.status == "active":
                self._defaults[stage] = registration.implementation_id

    def resolve(
        self,
        stage: StageKind,
        implementation_id: str | None = None,
    ) -> Stage:
        """Return an instance. Unspecified id → active default for that stage."""
        impl_id = implementation_id or self._defaults.get(stage)
        if not impl_id:
            raise KeyError(f"No default registration for stage {stage!r}")
        bucket = self._regs.get(stage) or {}
        reg = bucket.get(impl_id)
        if reg is None:
            raise KeyError(f"Unknown implementation {impl_id!r} for stage {stage!r}")
        if reg.approval_status == "pending_rm_confirmation":
            raise PermissionError(
                f"Stage {stage}/{impl_id} awaits L1 RM confirmation and cannot be used"
            )
        if reg.status == "shadow":
            raise PermissionError(
                f"Stage {stage}/{impl_id} is shadow-only and cannot drive a job"
            )
        return reg.factory()

    def catalog(self) -> dict[str, list[StageRegistration]]:
        return {
            kind: list(self._regs[kind].values())
            for kind in STAGE_KINDS
        }

    def active_labels(self) -> dict[str, str]:
        """Map stage → ``implementation_id@version`` for active defaults."""
        out: dict[str, str] = {}
        for kind in STAGE_KINDS:
            impl_id = self._defaults.get(kind)
            if not impl_id:
                continue
            reg = self._regs[kind].get(impl_id)
            if reg is None or reg.status != "active":
                continue
            out[kind] = reg.labeled
        return out

    def catalog_version(self) -> str:
        """sha256(canonical_json({stage: impl@version}))[:16]."""
        payload = self.active_labels()
        canonical = json.dumps(
            payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]

    def capabilities_used(self) -> list[dict[str, Any]]:
        """Snapshot of non-built-in capabilities (empty in Phase 0 builtins)."""
        used: list[dict[str, Any]] = []
        for kind, impl_id in self._defaults.items():
            reg = self._regs[kind].get(impl_id)
            if reg is None:
                continue
            # Built-ins ship approved; only surface contrib / pending for L2.
            if reg.approval_status == "approved" and not reg.pending_supervisor_signoff:
                continue
            if reg.source_pr is None and reg.approval_status == "approved":
                continue
            used.append(
                {
                    "stage": kind,
                    "implementation_id": reg.implementation_id,
                    "version": reg.version,
                    "status": reg.approval_status
                    if reg.approval_status in ("rm_confirmed", "approved")
                    else "rm_confirmed",
                    "pending_supervisor_signoff": bool(reg.pending_supervisor_signoff),
                }
            )
        return used


_REGISTRY: StageRegistry | None = None


def get_registry() -> StageRegistry:
    """Process-wide default registry (lazy bootstrap of built-ins)."""
    global _REGISTRY
    if _REGISTRY is None:
        _REGISTRY = StageRegistry()
        from app.engine.stages import _bootstrap  # noqa: WPS433

        _bootstrap.register_builtins(_REGISTRY)
    return _REGISTRY


def reset_registry_for_tests() -> None:
    """Clear the process registry (tests only)."""
    global _REGISTRY
    _REGISTRY = None
    try:
        from app.engine.stages.accessors import reset_accessor_cache_for_tests

        reset_accessor_cache_for_tests()
    except Exception:  # noqa: BLE001
        pass


def read_param_catalog_version() -> int | None:
    """Load ``version`` from shared/param-catalog.json when present."""
    try:
        raw = json.loads(PARAM_CATALOG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(raw, dict):
        return None
    ver = raw.get("version")
    try:
        return int(ver) if ver is not None else None
    except (TypeError, ValueError):
        return None


def stage_pin_fields(registry: StageRegistry | None = None) -> dict[str, Any]:
    """Fields to attach on BacktestResult / job meta."""
    reg = registry or get_registry()
    return {
        "stage_catalog_version": reg.catalog_version(),
        "stage_implementations": reg.active_labels(),
        "param_catalog_version": read_param_catalog_version(),
        "capabilities_used": reg.capabilities_used() or None,
    }


def apply_legacy_stage_defaults(result_data: dict[str, Any]) -> dict[str, Any]:
    """Map pre-refactor job JSON missing stage fields → v0-legacy markers."""
    out = dict(result_data)
    if not out.get("stage_catalog_version"):
        out["stage_catalog_version"] = LEGACY_CATALOG_VERSION
    if not out.get("stage_implementations"):
        out["stage_implementations"] = LEGACY_IMPLEMENTATIONS_MARKER
    return out


LegacyImplementations = Literal["legacy-monolith"]
