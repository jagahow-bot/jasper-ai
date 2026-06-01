import json
from collections import Counter
from pathlib import Path

u = json.loads(Path("shared/etf-universe.json").read_text(encoding="utf-8"))["universe"]
print("total", len(u))
print("asset_class", dict(Counter(x["asset_class"] for x in u)))
print("categories", len(Counter(x.get("category") for x in u)))
print("category_breakdown", dict(Counter(x.get("category") for x in u)))
