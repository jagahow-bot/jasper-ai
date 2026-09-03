"""Capability approval L1/L2 state machine."""

from __future__ import annotations

from app.capability_approval import (
    confirm_rm,
    proposal_pending_capabilities,
    set_approval_status,
)
from app.engine.stages.registry import StageRegistration, get_registry, reset_registry_for_tests


def setup_function() -> None:
    reset_registry_for_tests()


def test_rm_confirm_sets_pending_supervisor() -> None:
    reg = get_registry()
    # Register a contrib-like capability awaiting L1.
    from app.engine.stages.allocator import build_slsqp_classic_v1

    reg.register(
        StageRegistration(
            stage="allocator",
            implementation_id="two_layer_sleeve_v1",
            version="0.1.0",
            factory=build_slsqp_classic_v1,
            status="active",
            source_pr="local-draft",
            approval_status="pending_rm_confirmation",
            pending_supervisor_signoff=False,
        ),
        default=False,
    )
    snap = confirm_rm(
        "allocator",
        "two_layer_sleeve_v1",
        rm_id="rm-alice",
        summary="二層袖珍",
        missing_capability="two_layer_sleeve_allocation",
    )
    assert snap["approval_status"] == "rm_confirmed"
    assert snap["pending_supervisor_signoff"] is True

    pending = proposal_pending_capabilities(
        [
            {
                "stage": "allocator",
                "implementation_id": "two_layer_sleeve_v1",
                "version": "0.1.0",
                "status": "rm_confirmed",
                "pending_supervisor_signoff": True,
            }
        ]
    )
    assert len(pending) == 1

    approved = set_approval_status(
        "allocator",
        "two_layer_sleeve_v1",
        "approved",
        actor="sup-bob",
        role="supervisor",
    )
    assert approved["approval_status"] == "approved"
    assert approved["pending_supervisor_signoff"] is False
