"""Export param capability catalog → shared/param-catalog.json."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from app.engine.param_taxonomy import build_param_catalog  # noqa: E402


def main() -> None:
    catalog = build_param_catalog()
    out = ROOT / "shared" / "param-catalog.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    eligible = catalog.get("overlay_eligible_keys") or []
    print(f"Wrote {out} ({len(catalog['params'])} params, {len(eligible)} overlay-eligible)")


if __name__ == "__main__":
    main()
