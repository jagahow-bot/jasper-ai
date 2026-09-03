"""Scaffold a stage contribution seven-piece set (design §4.1).

Usage:
  python scripts/new_stage_contribution.py <stage> <implementation_id>
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRIB = ROOT / "apps" / "api" / "app" / "engine" / "stages" / "contrib"

STAGES = {
    "universe",
    "signals",
    "allocator",
    "constraints",
    "objective",
    "rebalance",
    "cash_schedule",
    "reporting",
}

FILES = {
    "implementation.py": '''"""(4) Main logic for {impl} ({stage})."""

from __future__ import annotations

from typing import Any

from app.engine.stages.base import StageCapabilityCard, StageIssue, StageKind, empty_card

STAGE: StageKind = "{stage}"
IMPLEMENTATION_ID = "{impl}"
VERSION = "0.1.0"


class {cls}:
    stage: StageKind = STAGE
    implementation_id: str = IMPLEMENTATION_ID
    version: str = VERSION

    def validate_config(self, config: dict[str, Any]) -> list[StageIssue]:
        # (2) validate_config — fill bounds checks
        del config
        return []

    def capability_card(self) -> StageCapabilityCard:
        from .card import build_card

        return build_card()


def build_{impl}() -> {cls}:
    return {cls}()
''',
    "config.py": '''"""(1) Schema fields for {impl}."""

from __future__ import annotations

from pydantic import BaseModel, Field


class {Cls}Config(BaseModel):
    """Tunables — attach bounds via Field(ge=..., le=...)."""

    placeholder: float = Field(default=0.0, ge=0.0, le=1.0)
''',
    "feasibility.py": '''"""(3) Mechanical feasibility for {impl}."""

from __future__ import annotations

from typing import Any

from app.engine.stages.base import StageIssue


def check_feasibility(config: dict[str, Any]) -> list[StageIssue]:
    del config
    return []
''',
    "attainment.py": '''"""(5) Reporting / needs_attainment hooks for {impl} (may be empty)."""

from __future__ import annotations

from typing import Any


def extra_attainment_checks(
    metrics: dict[str, Any],
    holdings: dict[str, float],
) -> dict[str, Any] | None:
    del metrics, holdings
    return None
''',
    "card.py": '''"""Capability card override for {impl}."""

from __future__ import annotations

from app.engine.stages.base import StageCapabilityCard, empty_card

from .locales import SUMMARY


def build_card() -> StageCapabilityCard:
    return empty_card(
        stage="{stage}",
        implementation_id="{impl}",
        version="0.1.0",
        summary=SUMMARY,
        invariants=[],
    )
''',
    "locales.py": '''"""(6) i18n strings for {impl} (keys: stage.{stage}.{impl}.*)."""

from __future__ import annotations

SUMMARY = {{
    "zh": "{impl}（草稿）",
    "en": "{impl} (draft)",
    "ko": "{impl} (초안)",
}}
''',
    "tests/test_unit.py": '''"""(7a) Unit tests for {impl}."""

from __future__ import annotations


def test_scaffold_imports() -> None:
    from app.engine.stages.contrib.{stage}.{impl}.implementation import build_{impl}

    stage = build_{impl}()
    assert stage.implementation_id == "{impl}"
''',
    "tests/test_properties.py": '''"""(7b) Property tests for {impl}."""

from __future__ import annotations


def test_property_placeholder() -> None:
    assert True
''',
    "tests/test_adversarial.py": '''"""(7c) Adversarial fixtures for {impl}."""

from __future__ import annotations


def test_adversarial_placeholder() -> None:
    assert True
''',
}


def to_class_name(impl: str) -> str:
    parts = [p for p in impl.replace("-", "_").split("_") if p]
    return "".join(p[:1].upper() + p[1:] for p in parts)


def main() -> int:
    parser = argparse.ArgumentParser(description="Scaffold stage contribution")
    parser.add_argument("stage", choices=sorted(STAGES))
    parser.add_argument("implementation_id")
    args = parser.parse_args()
    impl = args.implementation_id.strip()
    if not impl or not impl.replace("_", "").isalnum():
        print("implementation_id must be alphanumeric/underscore", file=sys.stderr)
        return 2
    dest = CONTRIB / args.stage / impl
    if dest.exists():
        print(f"Already exists: {dest}", file=sys.stderr)
        return 1
    cls = to_class_name(impl)
    ctx = {
        "stage": args.stage,
        "impl": impl,
        "cls": cls,
        "Cls": cls,
    }
    for rel, template in FILES.items():
        path = dest / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(template.format(**ctx), encoding="utf-8")
    init = dest / "__init__.py"
    init.write_text(
        f'"""Contrib: {args.stage}/{impl}."""\n',
        encoding="utf-8",
    )
    (dest / "tests" / "__init__.py").write_text("", encoding="utf-8")
    (CONTRIB / "__init__.py").write_text(
        '"""Stage contribution packages (AI/human drafts)."""\n',
        encoding="utf-8",
    )
    (CONTRIB / args.stage / "__init__.py").write_text("", encoding="utf-8")
    print(f"Scaffolded {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
