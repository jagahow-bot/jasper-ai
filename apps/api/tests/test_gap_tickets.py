"""Gap ticket store + fingerprint reuse."""

from __future__ import annotations

import tempfile
from pathlib import Path

import app.gap_tickets as gaps


def test_upsert_bumps_reuse_count(monkeypatch) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        monkeypatch.setenv("GAP_TICKETS_DIR", tmp)
        t1 = gaps.upsert_gap(
            stage="allocator",
            kind="unsupported_lever",
            missing_capability="two_layer_sleeve_allocation",
            summary="需要二層袖珍配置",
            requested={"ai": 0.5, "hedge": 0.5},
            overlay_session_id="ovl-1",
        )
        assert t1.reuse_count == 1
        assert Path(tmp, f"{t1.ticket_id}.json").exists()
        t2 = gaps.upsert_gap(
            stage="allocator",
            kind="unsupported_lever",
            missing_capability="two_layer_sleeve_allocation",
            summary="需要二層袖珍配置",
            requested={"ai": 0.5, "hedge": 0.5},
            overlay_session_id="ovl-2",
        )
        assert t2.ticket_id == t1.ticket_id
        assert t2.reuse_count == 2
        listed = gaps.list_tickets()
        assert listed[0].ticket_id == t1.ticket_id
        patched = gaps.patch_ticket(t1.ticket_id, {"status": "triaged"})
        assert patched.status == "triaged"
