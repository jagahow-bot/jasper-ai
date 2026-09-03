import json
from pathlib import Path

req = json.loads(Path(".tmp-fe0a-req.json").read_text(encoding="utf-8"))
res = json.loads(Path(".tmp-fe0a-result.json").read_text(encoding="utf-8"))

AI_TOKENS = ("AIQ", "BOTZ", "IRBO", "ROBO", "NVDA", "SMH", "SOXX", "QQQ", "WTAI", "CHAT", "THNQ", "IRBO")
BOND_TOKENS = ("TLT", "IEF", "AGG", "BND", "LQD", "HYG", "TIP", "GOVT", "SHY", "VGIT", "BIL", "SGOV", "BNDX", "VCIT", "VCSH", "MUB", "EMB")


def match(tickers, tokens):
    out = []
    for t in tickers:
        u = str(t).upper()
        if any(tok in u for tok in tokens):
            out.append(t)
    return out


print("=== REQUEST ===")
for k in [
    "scenario_id",
    "optimization_mode",
    "customization_drift",
    "max_holdings",
    "top_n",
    "trials",
    "asset_classes",
    "client_ref",
    "enforce_class_weights",
    "rebalance_freq",
    "objective",
]:
    print(f"{k}: {req.get(k)}")

ut = req.get("universe_tickers") or []
aw = req.get("anchor_weights") or {}
print(f"universe_tickers: {len(ut)}")
print(f"anchor_weights: {len(aw)}")
print("universe AI-like:", match(ut, AI_TOKENS))
print("universe bond-like:", match(ut, BOND_TOKENS))
print("anchor AI-like:", {k: aw[k] for k in match(aw, AI_TOKENS)})
print("anchor bond-like:", {k: aw[k] for k in match(aw, BOND_TOKENS)})

# not in anchor but in universe = supplements?
supp = [t for t in ut if t not in aw]
print(f"universe not in anchor (supplements?): {len(supp)}")
print("suppl AI-like:", match(supp, AI_TOKENS))
print("suppl bond-like:", match(supp, BOND_TOKENS))
print("suppl sample:", supp[:40])

pc = req.get("param_controls") or {}
print("param_controls relevant:")
for k, v in pc.items():
    if any(x in k for x in ("w_equity", "w_bond", "customization", "drift", "w_alternative")):
        print(f"  {k}: {v}")

# dump a few more request fields
for k in sorted(req.keys()):
    if k in {"universe_tickers", "anchor_weights", "param_controls", "client_context"}:
        continue
    val = req[k]
    if val is None or val == [] or val == {}:
        continue
    if isinstance(val, (str, int, float, bool)):
        print(f"req.{k}={val}")
    elif isinstance(val, list) and len(val) <= 20:
        print(f"req.{k}={val}")
    elif isinstance(val, dict) and len(val) <= 15:
        print(f"req.{k}={val}")

cands = res.get("candidates") or []
print(f"\n=== RESULT candidates={len(cands)} constrained={res.get('constrained_customization')} ===")
facts = res.get("narrative_facts") or {}
print("narrative keys sample:", list(facts.keys())[:30])
for c in cands[:8]:
    params = c.get("params") or {}
    style = c.get("scenario_style") or params.get("scenario_style")
    code = c.get("model_code")
    w = c.get("weights") or c.get("last_weights") or params.get("last_weights") or {}
    if not isinstance(w, dict):
        # try holdings
        w = c.get("holdings") or {}
    holdings = sorted(
        ((k, float(v)) for k, v in (w.items() if isinstance(w, dict) else []) if float(v) > 1e-4),
        key=lambda x: -x[1],
    )
    tickers = [h[0] for h in holdings]
    print(f"\n--- {code} style={style} n={len(holdings)} champ={c.get('is_champion')} rank={c.get('rank')} ---")
    print("top12:", holdings[:12])
    print("AI-like:", match(tickers, AI_TOKENS + ("META", "GOOGL", "MSFT", "AVGO", "AMD")))
    print("bond-like:", match(tickers, BOND_TOKENS))
    print("must_include in params:", params.get("must_include_tickers"))
    print("param_source:", params.get("param_source"))
    print("customization_drift_actual:", params.get("customization_drift_actual"))
    print("w_bond:", params.get("w_bond"), "w_equity:", params.get("w_equity"))

# Also check if result stores universe used
meta = res.get("meta") or res.get("run_meta") or {}
print("\nresult top-level keys:", sorted(res.keys()))
if "tradable_tickers" in res:
    print("tradable", len(res["tradable_tickers"]))
