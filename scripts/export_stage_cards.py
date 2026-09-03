"""Export stage capability cards → shared/stage-cards.json (Phase 0 / §2.6.2).

Assembles cards from each active stage implementation's capability_card(), then
enriches inputs/outputs via inspect.signature on Protocol-facing methods.
"""

from __future__ import annotations

import inspect
import json
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any, get_type_hints

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from app.engine.stages import STAGE_KINDS, get_registry  # noqa: E402

# Method names consulted for signature auto-assembly (design §2.6.2).
_SIGNATURE_METHODS: dict[str, tuple[str, ...]] = {
    "universe": ("build",),
    "signals": ("score", "score_assets_with_details"),
    "allocator": ("solve", "solve_weights"),
    "constraints": ("feasibility", "project", "project_max_weight"),
    "objective": ("score", "compute_objective_score"),
    "rebalance": ("schedule", "apply", "trading_day_rebalance_dates"),
    "cash_schedule": ("invested_fraction", "deployment_fraction"),
    "reporting": ("attainment", "needs_attainment"),
}


def _type_name(annotation: Any) -> str:
    if annotation is inspect.Parameter.empty:
        return "Any"
    if isinstance(annotation, type):
        return annotation.__name__
    return str(annotation).replace("typing.", "")


def _signature_io(stage: Any, kind: str) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    inputs: list[dict[str, str]] = []
    outputs: list[dict[str, str]] = []
    seen_in: set[str] = set()
    for meth_name in _SIGNATURE_METHODS.get(kind, ()):
        meth = getattr(stage, meth_name, None)
        if meth is None or not callable(meth):
            continue
        try:
            sig = inspect.signature(meth)
            hints = get_type_hints(meth, include_extras=True)
        except (TypeError, NameError, ValueError):
            try:
                sig = inspect.signature(meth)
                hints = {}
            except (TypeError, ValueError):
                continue
        for name, param in sig.parameters.items():
            if name in ("self", "cls") or name in seen_in:
                continue
            seen_in.add(name)
            ann = hints.get(name, param.annotation)
            inputs.append(
                {
                    "name": name,
                    "type": _type_name(ann),
                    "meaning": f"{kind}.{meth_name} parameter",
                }
            )
        ret = hints.get("return", sig.return_annotation)
        if ret is not inspect.Parameter.empty:
            outputs.append(
                {
                    "name": f"{meth_name}_return",
                    "type": _type_name(ret),
                    "meaning": f"Return of {kind}.{meth_name}",
                }
            )
    return inputs, outputs


def enrich_card(card_dict: dict[str, Any], stage: Any, kind: str) -> dict[str, Any]:
    """Fill empty inputs/outputs from inspect.signature when the impl left them blank."""
    out = dict(card_dict)
    auto_in, auto_out = _signature_io(stage, kind)
    if not out.get("inputs"):
        out["inputs"] = auto_in
    if not out.get("outputs"):
        out["outputs"] = auto_out
    return out


def build_stage_cards_document() -> dict:
    registry = get_registry()
    cards = []
    for kind in STAGE_KINDS:
        stage = registry.resolve(kind)
        card = stage.capability_card()
        raw = asdict(card)
        cards.append(enrich_card(raw, stage, kind))
    return {
        "catalog_version": registry.catalog_version(),
        "stage_implementations": registry.active_labels(),
        "cards": cards,
    }


def main() -> None:
    doc = build_stage_cards_document()
    out = ROOT / "shared" / "stage-cards.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {out} (catalog_version={doc['catalog_version']}, "
        f"{len(doc['cards'])} cards)"
    )


if __name__ == "__main__":
    main()
