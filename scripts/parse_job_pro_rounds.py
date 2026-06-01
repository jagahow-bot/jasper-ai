"""Parse job result pro_rounds for cross-round leaks."""
import json
import sys

path = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\jaga1\.cursor\projects\c-Users-jaga1-Projects-ai-quant-assistant\agent-tools\4aa76d6d-9e72-488f-afb9-60a7839e3ea7.txt"
with open(path, encoding="utf-8") as f:
    data = json.load(f)

pro = data.get("pro_rounds") or []
print("pro_rounds count:", len(pro))
prev_winner = None
for i, r in enumerate(pro):
    nf = r.get("narrative_facts") or {}
    pool = r.get("pool_model_codes") or nf.get("model_codes") or []
    incoming = r.get("incoming_champion_model_code") or nf.get("incoming_champion_model_code")
    winner = r.get("round_winner_model_code") or nf.get("round_winner_model_code")
    chal = r.get("round_challenger_model_codes") or nf.get("round_challenger_model_codes") or []
    cands = r.get("candidates") or []
    cand_codes = [
        str((c.get("params") or {}).get("model_code") or c.get("model_code") or "")
        for c in cands
    ]
    cand_codes = [c for c in cand_codes if c]
    print(f"\nRound {i+1} (round={r.get('round')})")
    print("  incoming:", incoming, "winner:", winner)
    print("  pool_model_codes:", pool)
    print("  challengers:", chal)
    print("  candidate codes:", sorted(set(cand_codes)))
    roles = {}
    for c in cands:
        code = (c.get("params") or {}).get("model_code") or c.get("model_code")
        role = (c.get("params") or {}).get("pro_round_role")
        if code:
            roles[str(code)] = role
    print("  roles:", roles)
    if i > 0 and prev_winner:
        allowed = {prev_winner, incoming} | set(chal or [])
        leaks = set(cand_codes) - allowed - {None, ""}
        if leaks:
            print("  LEAK (candidates not from prev winner/incoming/new challengers):", sorted(leaks))
    prev_winner = winner or prev_winner
