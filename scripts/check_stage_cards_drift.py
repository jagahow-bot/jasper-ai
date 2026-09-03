"""CI drift check: shared/stage-cards.json must match live registry export.

Exit 0 when in sync; exit 1 with a short diff summary when drifted.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))
sys.path.insert(0, str(ROOT / "scripts"))

from export_stage_cards import build_stage_cards_document  # noqa: E402


def main() -> int:
    expected = build_stage_cards_document()
    path = ROOT / "shared" / "stage-cards.json"
    if not path.exists():
        print(f"MISSING {path} — run: npm run generate-stage-cards && npm run sync-stage-cards")
        return 1
    actual = json.loads(path.read_text(encoding="utf-8"))
    if actual.get("catalog_version") != expected.get("catalog_version"):
        print(
            "DRIFT catalog_version: "
            f"file={actual.get('catalog_version')} live={expected.get('catalog_version')}"
        )
        return 1
    if actual.get("stage_implementations") != expected.get("stage_implementations"):
        print("DRIFT stage_implementations map differs from live registry")
        return 1
    if len(actual.get("cards") or []) != len(expected.get("cards") or []):
        print(
            f"DRIFT card count: file={len(actual.get('cards') or [])} "
            f"live={len(expected.get('cards') or [])}"
        )
        return 1
    # Compare canonical JSON (ignore key order / whitespace).
    a = json.dumps(actual, sort_keys=True, ensure_ascii=False)
    b = json.dumps(expected, sort_keys=True, ensure_ascii=False)
    if a != b:
        print("DRIFT stage-cards.json content differs from live export")
        return 1
    print(f"OK stage-cards.json in sync (catalog_version={expected['catalog_version']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
