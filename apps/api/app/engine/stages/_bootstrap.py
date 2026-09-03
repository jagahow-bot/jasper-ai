"""Register built-in stage implementations on a StageRegistry."""

from __future__ import annotations

from app.engine.stages.allocator import IMPLEMENTATION_ID as ALLOC_ID
from app.engine.stages.allocator import VERSION as ALLOC_VER
from app.engine.stages.allocator import build_slsqp_classic_v1
from app.engine.stages.cash_schedule import IMPLEMENTATION_ID as CASH_ID
from app.engine.stages.cash_schedule import VERSION as CASH_VER
from app.engine.stages.cash_schedule import build_dca_v1
from app.engine.stages.constraints import IMPLEMENTATION_ID as CONS_ID
from app.engine.stages.constraints import VERSION as CONS_VER
from app.engine.stages.constraints import build_l1_drift_v1
from app.engine.stages.objective import IMPLEMENTATION_ID as OBJ_ID
from app.engine.stages.objective import VERSION as OBJ_VER
from app.engine.stages.objective import build_metrics_score_v1
from app.engine.stages.rebalance import IMPLEMENTATION_ID as REB_ID
from app.engine.stages.rebalance import VERSION as REB_VER
from app.engine.stages.rebalance import build_calendar_qe_v1
from app.engine.stages.registry import StageRegistration, StageRegistry
from app.engine.stages.reporting import IMPLEMENTATION_ID as REP_ID
from app.engine.stages.reporting import VERSION as REP_VER
from app.engine.stages.reporting import build_needs_attainment_v1
from app.engine.stages.signals import IMPLEMENTATION_ID as SIG_ID
from app.engine.stages.signals import VERSION as SIG_VER
from app.engine.stages.signals import build_factor_lib_v1
from app.engine.stages.universe import IMPLEMENTATION_ID as UNI_ID
from app.engine.stages.universe import VERSION as UNI_VER
from app.engine.stages.universe import build_etf_catalog_v1


def register_builtins(registry: StageRegistry) -> None:
    """Register the eight Phase 0 built-in implementations as active defaults."""
    builtins = (
        ("universe", UNI_ID, UNI_VER, build_etf_catalog_v1),
        ("signals", SIG_ID, SIG_VER, build_factor_lib_v1),
        ("allocator", ALLOC_ID, ALLOC_VER, build_slsqp_classic_v1),
        ("constraints", CONS_ID, CONS_VER, build_l1_drift_v1),
        ("objective", OBJ_ID, OBJ_VER, build_metrics_score_v1),
        ("rebalance", REB_ID, REB_VER, build_calendar_qe_v1),
        ("cash_schedule", CASH_ID, CASH_VER, build_dca_v1),
        ("reporting", REP_ID, REP_VER, build_needs_attainment_v1),
    )
    for stage, impl_id, version, factory in builtins:
        registry.register(
            StageRegistration(
                stage=stage,  # type: ignore[arg-type]
                implementation_id=impl_id,
                version=version,
                factory=factory,
                status="active",
                approval_status="approved",
                pending_supervisor_signoff=False,
                approved_by={"system": "phase0-builtin"},
            ),
            default=True,
        )
