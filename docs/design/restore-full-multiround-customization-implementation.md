# 施工說明：還原客製化完整多輪 AI 調參（Phase 1）

> **版本**:1.0（施工執行版）
> **狀態**:Implemented — 待上線驗收
> **日期**:2026-09-22
> **設計定稿**:[`docs/design/restore-full-multiround-customization.md`](./restore-full-multiround-customization.md) v0.2（§0 Q1–Q7 已鎖定）
> **執行者**:API 引擎 + Web 工程師
> **預估工時**:P1 ≈ 0.5–1 天；P2 ≈ 0.5 天

---

## 0. 鎖定決策速查（施工時以此為準）

| # | 鎖定 | 對施工的含義 |
|---|---|---|
| Q1 | **B** 客製化預設 Pro | 客製化（有 `anchor_weights`）路徑預設 `optimization_mode=pro_auto`；RmRunPanel Pro toggle 預設開 |
| Q2 | **C** constrained 僅內部 | 正式 UI **永不**送 `customization_search_mode`；僅測試／內部客戶端可送 `"constrained"` |
| Q3 | **A** 新增 API 欄位 | `BacktestRequest.customization_search_mode: Literal["full","constrained"] = "full"` |
| Q4 | **B** 小宇宙降預算 | tradable ≤20 且客製化 Pro 且 request 未覆寫時：`refinement_max_rounds=5`、`refinement_patience=3` |
| Q5 | **A** 無搜尋模式 UI | **不**加下拉／advanced toggle |
| Q6 | **A** 清誤導文案 | 移除／改寫「錨點小宇宙走簡化搜尋」暗示；新增預設 Pro 文案 |
| Q7 | **B** 無 feature flag | 不加 env 開關；回滾靠 git revert |

**不做**：具名情境注入完整搜尋、drift 進搜尋空間、needs-first champion 重選。

---

## 1. 施工順序總覽

| Phase | 內容 | 可獨立 ship |
|---|---|---|
| **P1** | API：`customization_search_mode` 旗標 + 預設 `full`；小宇宙 Pro 降預算；jobs 預估；API 測試 | ✅ 可單獨上（UI 未改前，API 已接受旗標、預設行為正確） |
| **P2** | Web：客製化預設 Pro；i18n 文案；Web 測試 | 需 P1 先上（行為一致） |

建議分支：`feat/restore-full-multiround-customization`。P1、P2 可分兩個 PR 或同一 PR 兩 commit。

---

## 2. P1 — API 引擎

### 2.1 F1：`apps/api/app/models.py` — 新增欄位

**位置**：`BacktestRequest`，放在 `optimization_mode`（:309）附近。

```python
customization_search_mode: Literal["full", "constrained"] = Field(
    default="full",
    description=(
        "Anchored customization search strategy. 'full' (default) = standard "
        "AI+Optuna or Pro multi-round per optimization_mode; 'constrained' = "
        "legacy named-scenario lanes (internal/debug/tests only)."
    ),
)
```

- 檔案頂部確認 `from typing import Literal`（若無則加）。
- **不要**改 `OptimizationMode` enum（Q7 命名決策：獨立欄位，不擴充 enum）。

### 2.2 F2：`apps/api/app/engine/constrained_customization.py` — 旗標早退

**位置**：`should_use_constrained_customization`（:66）函式開頭，在 static_replay 檢查之前插入：

```python
def should_use_constrained_customization(
    req: Any,
    *,
    tradable_count: int | None = None,
    must_include_count: int | None = None,
) -> bool:
    """Legacy named-scenario mode — only when explicitly requested.

    Default is "full" search; "constrained" is internal/debug/tests only.
    """
    if str(getattr(req, "customization_search_mode", "full") or "full") != "constrained":
        return False
    if getattr(req, "static_replay_holdings", None):
        return False
    # …其餘現況不變…
```

- 模組 docstring 更新為「legacy mode for internal/debug/tests」。
- `estimate_constrained_trial_count`（:148）**不需改**：它內部呼叫 `should_use_constrained_customization`，旗標早退後預設自動回 `None`。

### 2.3 F3：`apps/api/app/engine/backtest.py` — 註解更新（零邏輯改動）

**位置**：:3226–3243。把 `# Small locked client books: skip Pro / large AI search for named scenarios.` 改為：

```python
# Legacy constrained mode only when customization_search_mode="constrained"
# (internal/debug). Default "full" → constrained_mode=False, Pro not suppressed.
```

邏輯一行不動。

### 2.4 F11：`apps/api/app/engine/backtest.py` — 小宇宙 Pro 降預算

**位置**：`_run_backtest_engine` 內，`pro_mode = _is_pro_mode(req)`（:3226）與 constrained 分支**之後**、進入 `_run_iterative_search` 之前；或在 `_run_iterative_search`（:554+）開頭讀取 `req.refinement_max_rounds`／`req.refinement_patience`（:581-582）處。

**建議做法**（集中、好測）：新增 helper，於 `_run_iterative_search` 開頭套用：

```python
SMALL_UNIVERSE_PRO_MAX_ROUNDS = 5
SMALL_UNIVERSE_PRO_PATIENCE = 3

def _effective_pro_budget(req: BacktestRequest, tradable_count: int) -> tuple[int, int | None]:
    """Small locked-universe customization: lower default Pro budget (Q4).

    Only applies when the request did NOT explicitly override the knobs.
    """
    max_rounds = int(req.refinement_max_rounds)
    patience = req.refinement_patience
    is_customization = bool(getattr(req, "anchor_weights", None))
    if not (is_customization and tradable_count <= 20):
        return max_rounds, patience
    # models.py defaults: max_rounds=8, patience=None → treat as "not overridden"
    if max_rounds == 8:
        max_rounds = SMALL_UNIVERSE_PRO_MAX_ROUNDS
    if patience is None:
        patience = SMALL_UNIVERSE_PRO_PATIENCE
    return max_rounds, patience
```

在 `_run_iterative_search` 內把 `max_rounds = int(req.refinement_max_rounds)`／`patience = req.refinement_patience` 換成呼叫 `_effective_pro_budget(req, len(tickers))`。

> **注意**：呼叫端要拿得到 `tickers`（tradable 數）。若 `_run_iterative_search` 簽名沒有，從 `_run_backtest_engine` 傳入，或在呼叫前算好再傳。以「request 未顯式覆寫才降」為準——用預設值比對（8 / None）判斷即可，因 models.py 預設固定。

### 2.5 F4：`apps/api/app/jobs.py` — 預估 trials 與排程文案

- `_estimated_trials_total`（:117）：`estimate_constrained_trial_count(req)` 預設回 `None`（F2 生效後自動），Pro 分支走 `req.refinement_max_rounds`——**這裡要用降預算後的值**才能讓進度條準確。做法：把 `_effective_pro_budget` 搬到可共用處（例如 `constrained_customization.py` 或新 helper 模組），jobs.py 在 Pro 分支呼叫它：

```python
if _is_pro_mode(req):
    batch0 = int(req.refinement_batch_size)
    challengers = int(req.refinement_challengers_per_round)
    max_rounds, _patience = _effective_pro_budget_for_estimate(req)
    return batch0 + (challengers + 1) * max(0, max_rounds - 1)
```

  `_effective_pro_budget_for_estimate` 內部用 `_locked_universe_count(req)`（constrained_customization 已有）推 tradable；無法推時回 request 原值（保守不降）。

- 排程文案（:139-150）：分支結構不變；`estimate_constrained_trial_count` 預設 None → 自動落到 "Pro convergence job queued…"／"Backtest job queued…"。**零文案改動**。

### 2.6 F5：更新 `apps/api/tests/test_constrained_customization.py`

全檔 14 個測試目前依賴「隱式觸發」。逐一在 request fixture 加 `customization_search_mode="constrained"`，斷言不變（種子／預算／釘定／champion／proposals／rationale 邏輯零回歸）。

### 2.7 F6：新增 `apps/api/tests/test_customization_search_mode.py`

| # | 案例 | 斷言 |
|---|---|---|
| A1 | 錨點+小宇宙+RM 訊號，**無**旗標 | `should_use_constrained_customization` False；`estimate_constrained_trial_count` None |
| A2 | 同 A1 + 顯式 `"constrained"` | True；估計 = `max(情境數, trials)` |
| A3 | 同 A1 + 顯式 `"full"` | False |
| A4 | `pro_auto` + 錨點小宇宙（無旗標） | mock `_run_iterative_search` 被呼叫；結果含 `pro_rounds`；`narrative_facts.engine == "optuna+pandas+pro"` |
| A5 | `pro_auto` + 顯式 `"constrained"` | 走受限路徑、`pro_mode` 被關；`narrative_facts.optimization_mode == "constrained_customization"` |
| A6 | jobs 預估：小宇宙 Pro 無旗標 | `_estimated_trials_total` = 5+(4+1)×(5−1)=**25**；大宇宙 Pro = 40 |
| A7 | 排程文案：無旗標 | "Pro convergence job queued…"／"Backtest job queued…"；顯式 constrained 時 "Constrained customization job queued…" |
| A8 | F5 更新後全綠 | 14 測試通過 |
| A9 | 完整模式 proposals：錨點小宇宙標準搜尋 | `pick_pareto_proposals`，≤3 卡，標籤 ∈ {recommended, defensive, growth, alternative} |
| A10 | 完整模式 champion + client_context | 每候選有 `needs_attainment`；champion = rank 1 |
| A11 | 舊受限 job（無旗標 request）`extra_trials` 續跑 | 走標準完整搜尋；standard snapshot 載入正常 |
| A12 | 3 檔 locked + must-include | 完整搜尋 ≥1 可行 trial；`apply_must_include_floor` 生效；無 max_holdings 錯誤 |

### 2.8 F10：`docs/design/pipeline-stage-plugin-architecture.md`

:81 觸發條列、:268／:303 reporting 對照，改述為「僅當 request 顯式 `customization_search_mode="constrained"`（內部／測試）時觸發；預設 full」。

### 2.9 P1 驗收

```powershell
cd apps/api
python -m pytest tests/test_constrained_customization.py tests/test_customization_search_mode.py -q
```

全綠才可進 P2。

---

## 3. P2 — Web

### 3.1 F7：`apps/web/src/lib/types.ts`

`BacktestRequest`（:134 附近）加：

```ts
/** Internal/debug only; production UI never sends this. */
customization_search_mode?: "full" | "constrained";
```

### 3.2 F8：客製化預設 Pro

兩個層面都要改，擇一為主、另一個兜底：

1. **`overlay-schema.ts`**（:1509-1510，locked 客製化分支）：`optimization_mode` 預設改為 `"pro_auto"`：

```ts
optimization_mode: (opt.optimization_mode ??
  base.optimization_mode ??
  "pro_auto") as OptimizationMode,
```

   同分支若 `enable_iterative_refinement` 有預設，同步預設 `true`。

2. **`RmRunPanel.tsx`**：元件掛載時若 `request.optimization_mode` 為空且屬客製化（有 anchor／locked universe），呼叫 `onChange` 補 `pro_auto`；或在上層 `page.tsx` 組 request 時預設。**擇一實作，避免雙寫入迴圈**——建議在 overlay-schema 組 request 時處理（單一來源），RmRunPanel 只反映狀態。

- Pro toggle 本身保留（RM 可手動關 → 標準完整搜尋）。
- **不加**任何搜尋模式 UI（Q5）。

### 3.3 F9：`apps/web/src/lib/i18n.tsx`

- 新增／改寫三語 keys（見 design §6）：`rm.run.searchMode.fullNote`、`rm.run.proSearchOnNote`、`rm.run.proSearchOffNote`。
- 全域搜尋含「簡化」「受限情境」「constrained」「named scenario」且會誤導「預設走簡化」的 RM 面向文案，改寫或移除。**保留** `results.proposalLabel.anchor_close/full_drift/theme`、`results.championWhyParamsConstrained*`、`results.audit.scenarios`（歷史 job 用）。
- RmRunPanel「What will run」：Pro on 時顯示 `proSearchOnNote`（明示確實跑多輪）。

### 3.4 Web 測試

| # | 案例 | 斷言 |
|---|---|---|
| W1 | 既有 `constrained-param-rationale.test.ts`／`proposal-set.test.ts`／`ai-params-disclosure.test.ts` | 全綠（渲染路徑不動） |
| W2 | RmRunPanel 客製化預設 | request 預設 `optimization_mode="pro_auto"`；**不**送 `customization_search_mode`；無受限 toggle |
| W3 | i18n parity | 新 keys 三語齊全；誤導文案已移除 |
| W4 | 歷史受限 job fixture | 仍顯示具名情境 rationale |

### 3.5 P2 驗收

```powershell
cd apps/web
npx vitest run
```

---

## 4. 手動驗收（上線前）

1. RM 客製化（5 檔 locked）預設執行 → Pro 開、多輪進度；小宇宙降預算（≤5 輪）；結果有分輪頁籤；無「約束情境」稽核。
2. 手動關 Pro → 標準完整 AI+Optuna；Pareto 三卡；非受限模式。
3. API 直送 `customization_search_mode="constrained"` → 具名情境行為（內部驗證）。
4. 歷史受限 job → 渲染不變。
5. 三語切換 → 無「簡化搜尋」誤導；Pro 預設文案正確。

---

## 5. 回滾（Q7=B）

1. **單次 run**：RM 手動關 Pro（仍非舊受限模式）。
2. **完全回復舊隱式受限**：git revert 本功能 commit；**不**提供 env 開關。

---

## 6. 檔案變更清單（對照 design §5）

| # | 檔案 | 變更 |
|---|---|---|
| F1 | `apps/api/app/models.py` | `customization_search_mode` 欄位 |
| F2 | `apps/api/app/engine/constrained_customization.py` | 旗標早退 + docstring |
| F3 | `apps/api/app/engine/backtest.py` | 分岔註解（零邏輯） |
| F11 | `apps/api/app/engine/backtest.py` | `_effective_pro_budget` 小宇宙降預算 |
| F4 | `apps/api/app/jobs.py` | Pro 預估用降後 rounds |
| F5 | `apps/api/tests/test_constrained_customization.py` | 加顯式旗標 |
| F6 | `apps/api/tests/test_customization_search_mode.py` | 新增 A1–A12 |
| F10 | `docs/design/pipeline-stage-plugin-architecture.md` | 觸發描述 |
| F7 | `apps/web/src/lib/types.ts` | 型別 |
| F8 | `apps/web/src/lib/overlay-schema.ts` + `RmRunPanel.tsx` | 客製化預設 Pro |
| F9 | `apps/web/src/lib/i18n.tsx` | 文案 |
