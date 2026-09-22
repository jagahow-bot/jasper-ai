# 還原完整多輪 AI 調參（客製化回測不再自動降級為受限情境模式）施工說明書

> **版本**:0.2（§12 Q1–Q7 已逐題鎖定）
> **狀態**:Implemented — 待上線驗收
> **日期**:2026-09-22
> **讀者**:API 引擎工程師、Web/BFF 工程師、RM 產品負責人、合規/稽核
> **相關文件**:[`docs/design/pipeline-stage-plugin-architecture.md`](./pipeline-stage-plugin-architecture.md)（§3.3 觸發條件表、§8 reporting）、[`docs/design/overlay-drift-sync.md`](./overlay-drift-sync.md)（drift 下限與滑桿同步）
> **施工執行版**:[`docs/design/restore-full-multiround-customization-implementation.md`](./restore-full-multiround-customization-implementation.md)（逐步 diff、測試、驗收）
> **適用程式碼**:`apps/api`（引擎、jobs、models）+ `apps/web`（RmRunPanel、結果頁、i18n）

---

## 0. 鎖定決策（§12 Q1–Q7）

| # | 決策 | 鎖定 |
|---|---|---|
| Q1 | 客製化一律預設開啟 Pro 多輪 | **B** — RM overlay／客製化路徑預設 `optimization_mode=pro_auto`；Pro toggle 預設開 |
| Q2 | 受限模式是否保留 | **C** — 對外永遠 `full`；`constrained` 僅內部／debug／測試可送 |
| Q3 | API 契約 | **A** — 新增 `customization_search_mode: "full" \| "constrained"`，預設 `"full"`；正式客戶端不送 |
| Q4 | 小宇宙（tradable ≤20）預算 | **B** — 仍走 `full` + Pro，自動降 `refinement_max_rounds`／`refinement_patience` |
| Q5 | UI 是否顯示搜尋模式 | **A** — 不顯示；無 RmRunPanel 下拉／advanced toggle |
| Q6 | 錨點客製文案 | **A** — 清掉「簡化／受限搜尋」誤導文案；改為客製化預設完整 Pro |
| Q7 | 回滾／feature flag | **B** — 無 env／預設值翻轉保底；回滾靠 git revert／hotfix |

**Phase 1 不做**（原草案 §12 其餘項，維持非目標／另案）：具名情境注入完整搜尋（Option C）、drift 重新進入搜尋空間、完整模式 needs-first champion 重選。

---

## 1. 目標與範圍

### 1.1 問題陳述

目前只要客製化回測同時滿足「有 `anchor_weights` + 宇宙夠小（tradable ≤ 20 或 must-include/supplements ≤ 8）」，引擎就**自動**進入「受限客製化模式」（Constrained Customization Mode），以 3–4 個具名情境（`anchor_close` / `full_drift` / `defensive` / `theme`）加每條 lane 的小額 Optuna 局部探索，**取代**完整的多輪 AI/Optuna 參數搜尋；即使 RM 在 RmRunPanel 明確開啟 Pro 多輪搜尋，也會被引擎強制關閉（`backtest.py:3234-3243` 的 `pro_mode = False`）。

當初引入此模式的論點是「標的已鎖定，更多調參差異不大」。但實務上：

1. 具名情境把 `allocator_mode` / `objective_mode` / `customization_drift_actual` / `rebalance_freq` **釘死**（`pin_scenario_controls`，`constrained_customization.py:173-193`），每條 lane 只剩因子權重與 lookback 可搜——搜尋空間遠小於完整模式。
2. RM 無法選擇退出：模式由引擎隱式判定，UI 沒有任何開關，Pro toggle 被靜默覆寫，「What will run」清單顯示的 Pro 狀態與實際執行不一致。
3. 小宇宙恰恰是最需要多輪學習的場景：單一 trial 成本低，champion-challenger 迭代能在相同 wall-clock 內做更多輪。

### 1.2 目標（本功能要做的）

| # | 目標 | 說明 |
|---|---|---|
| G1 | **客製化預設完整 Pro 多輪** | 每一個客製化回測（有 `anchor_weights` 的 locked-universe run）預設 `optimization_mode=pro_auto`，走 `_run_iterative_search`；不再自動降級為受限情境。 |
| G2 | **Pro 不再被靜默覆寫** | `optimization_mode=pro_auto` 時必須真的跑多輪；UI「What will run」與引擎一致。RM 仍可手動關閉 Pro（改走標準完整 AI+Optuna）。 |
| G3 | **受限模式僅內部／debug** | 保留 `constrained_customization.py`；僅當 request 顯式 `customization_search_mode="constrained"`（測試／內部）時觸發；正式 UI 永不送此值。 |
| G4 | **小宇宙自動降預算** | `tradable ≤ 20` 的客製化 Pro：仍走完整搜尋，但降 `refinement_max_rounds`／設 `refinement_patience`，避免空轉（§3.2）。 |
| G5 | **結果呈現一致** | proposals、leaderboard、`needs_attainment`、champion 敘述走既有 Pro／標準行為；舊受限歷史 job 仍可渲染。 |
| G6 | **文案與行為一致** | 清掉錨點／小宇宙「簡化搜尋」誤導文案；明示客製化預設完整 Pro。 |

### 1.3 非目標（Explicit Non-Goals）

- **不刪除 `constrained_customization.py`**：具名情境產生器、proposal 標籤、參數 rationale 文案全部保留，供內部 debug／測試與歷史 job 渲染使用。
- **不改 drift 滑桿與 overlay 同步機制**：`customization_drift` 上限、overlay-drift-sync 的 floor 提示、`customization_drift_actual` 的 fixed 釘定維持現況；**不**讓 drift 重新進入搜尋空間（Phase 1）。
- **不改 `needs_attainment` 檢核本身**：地板檢核照舊逐候選計算；**不加**完整模式 needs-first champion 重選層（Phase 1）。
- **不動 static replay 路徑**：`static_replay_holdings` 永不進入任一搜尋模式。
- **不改 Pro 模式內部演算法**：champion-challenger、learning context、early-stop 邏輯不變；本功能只改「誰能進入哪條路徑」、客製化預設 Pro、小宇宙預算。
- **不暴露搜尋模式 UI**：無 advanced toggle／下拉（Q5=A）。
- **不加 deploy-time feature flag**：不以 env 翻轉預設回舊行為（Q7=B）。

---

## 2. 現況分析（已對照程式碼驗證）

### 2.1 模式分岔點

引擎在 `_run_backtest_engine` 內以三向分支決定搜尋路徑（`apps/api/app/engine/backtest.py`）：

```
backtest.py:3226  pro_mode = _is_pro_mode(req)                       # optimization_mode==pro_auto 或 enable_iterative_refinement（:166-170）
backtest.py:3227  must_include_tickers = derive_must_include_tickers(tickers, req.anchor_weights)
backtest.py:3228  constrained_mode = should_use_constrained_customization(
                      req, tradable_count=len(tickers), must_include_count=len(must_include_tickers))
backtest.py:3234  if constrained_mode and pro_mode: pro_mode = False  # ← Pro 被靜默關閉

分支：
  constrained_mode → 具名情境 + 每 lane 小額 Optuna（:3336-3501）
  pro_mode         → _run_iterative_search 多輪 champion-challenger（:3502-3541，本體 :554+）
  else             → 標準 AI seeds + Optuna TPE 單次搜尋（:3542-3659）
```

### 2.2 受限模式觸發條件（`constrained_customization.py:67-122`）

全部成立才觸發：

| 條件 | 程式碼 | 值 |
|---|---|---|
| 非 static replay | `:80-81` | `static_replay_holdings` 為空 |
| 有錨點 | `:82-84` | `anchor_weights` 非空 |
| 宇宙小 | `:114-117` | `tradable ≤ 20`（`MAX_TRADABLE_FOR_CONSTRAINED`，`:39`）**或** `must_include ≤ 8`（`MAX_OVERLAY_SUPPLEMENTS_FOR_CONSTRAINED`，`:42`） |
| RM 訊號或純小宇宙 | `:119-122` | 有 `universe_tickers` / `client_ref` / `client_context` / `anchor_job_id` / `anchor_portfolio_id` 任一 → 直接 True；否則要求 `tradable ≤ 20` |

注意：**沒有任何 request 旗標**可控制此行為——RM 無法關閉，也無法對大宇宙開啟。

### 2.3 受限模式資料流

1. **情境種子**：`build_constrained_scenario_seeds`（`:347-484`）產生 3 個基礎情境（`anchor_close` ≈ 35% drift 預算、`full_drift` = 用滿上限、`defensive` = min_var + 55% 預算），有 must-include 時加第 4 個 `theme`（75% 預算，且用 `min_holdings_for_customization` 撐大 `max_holdings_actual`，`:469-481`）。
2. **預算分配**：`allocate_constrained_trial_budget(n_seeds, req.trials)`（`:161-170`）把 `max(情境數, trials)` 均分到各 lane（如 25 trials / 3 情境 → [9,8,8]）。
3. **逐 lane 搜尋**：每個情境以 `pin_scenario_controls`（`:173-193`）釘死 `allocator_mode` / `objective_mode` / `customization_drift_actual` / `rebalance_freq`，再呼叫 `run_optuna_search`（`backtest.py:3383-3461`）；lane 內探索 trial 繼承 `scenario_style`（`backtest.py:3473-3489`）。
4. **報表選拔**：`select_constrained_records_for_report`（`:196-248`）先取每個情境的最佳者，再按分數補滿 `top_models`。
5. **Champion**：`select_constrained_champion_code`（`:487-531`）以「地板全過 → needs_score → 目標值 → full_drift 優先」排序，**needs 優先於績效**。
6. **Proposals**：`build_constrained_proposal_set`（`:534-628`）最多 4 張卡，champion 標 `recommended`，其餘保留情境標籤（永不出現 `ALTERNATIVE_N`），按權重簽名去重。
7. **narrative_facts 標記**：`engine="constrained_scenarios"`、`optimization_mode="constrained_customization"`、`constrained_customization=True`、`constrained_scenarios=[styles]`（`backtest.py:4276-4291`）；`ai_param_generation.constrained_customization=True` + `scenario_styles`（`:4425-4432`）。
8. **Rationale**：`build_constrained_param_rationale`（`:692-843`）產生三語「參數為何這樣設定」文案，於 champion 決定後以 champion 的情境 metadata 重建（`backtest.py:3824-3843`）。

### 2.4 完整多輪路徑（Pro）與標準路徑

**Pro（`_run_iterative_search`，`backtest.py:554+`）**：

- 第 0 輪 `refinement_batch_size`（預設 5）個 trials；之後每輪 `refinement_challengers_per_round`（預設 4）個 challenger + 現任 champion 重跑；最多 `refinement_max_rounds`（預設 8）輪；`refinement_patience` / `refinement_min_improvement`（預設 0.01）控制 early stop。
- 每輪呼叫 `generate_ai_round_seed` 取得 AI round setup（含 learning context：champion 參數、失敗 challenger、基準指標、client_needs），失敗時沿用上一輪 setup 或退回純 Optuna（`backtest.py:806-833`）。
- 產出 `convergence_history`、`per_round` records、`refinement_meta`（含 `final_champion_params`、`ai_rationales`、`continuation_snapshot`）；結果含 `pro_rounds` snapshots（`backtest.py:3847+`），前端以 `ProResultsWithTabs` 分輪頁籤 + `RoundSeedPanel` 呈現（`ProResultsWithTabs.tsx:197-330`）。
- 預估總 trials：`batch0 + (challengers+1) × (max_rounds−1)` = 5 + 5×7 = **40**（`jobs.py:123-127`）。

**標準（`backtest.py:3542-3659`）**：`generate_ai_param_sets` 產生至多 `trials//2` 組 AI 種子，餘額由 Optuna TPE 局部探索；AI 失敗 → 全量 Optuna。RM overlay 預設 `trials=25, top_models=5`（`overlay-schema.ts:1512-1513`）。

**兩條路徑共用的報表機制**（還原後受限宇宙也會走這裡）：

- `_oos_leaderboard`（`backtest.py:2393-2459`）：holdout 排名表，records + candidates 合併、按顯示數值去重；只在 `enable_oos` 且 val > 60 個交易日時輸出（`:4344-4352`）。
- `sample_metrics`：每個候選的 IS/OOS/full 三段指標，於 `_build_candidate` 組裝（`:1686`、`:1783`）。
- proposals：`pick_pareto_proposals(max_n=3, champion_code)`（`objectives.py:566+`），三軸 Pareto（objective、-|MDD|、needs_score），先以 `dedupe_proposal_candidates` 折疊近同組合；標籤為 `recommended` / `defensive` / `growth` / `alternative`。
- champion：標準模式 = rank 1（`backtest.py:3791-3794`）；Pro = AI champion / final_champion_params（`:3770-3790`）。**皆非 needs 優先**——這是與受限模式 champion 選擇的行為差異（§10.3）。

### 2.5 UI 差異（兩模式今日的分歧面）

| 面向 | 受限模式（現況預設） | 完整搜尋 / Pro（還原後） |
|---|---|---|
| RmRunPanel | Pro toggle 顯示開但引擎關閉（`RmRunPanel.tsx:92,116-122,264-293`） | toggle 與引擎一致 |
| 結果主視圖 | `ResultsDashboard`（無 `pro_rounds`）（`page.tsx:1546-1579`、`RmReportView.tsx:362-400`） | Pro → `ProResultsWithTabs` 分輪頁籤 + `RoundSeedPanel`；標準 → `ResultsDashboard` |
| Proposal 標籤 | `anchor_close` / `full_drift` / `defensive` / `theme`（i18n `results.proposalLabel.*`，`i18n.tsx:570-572` en / `:2682-2684` zh） | `recommended` / `defensive` / `growth` / `alternative`（同檔 `:566-569` / `:2678-2681`） |
| 「參數為何這樣設定」 | `buildConstrainedParamSetupRationale` 具名情境文案（`ResultsDashboard.tsx:472-517`、`constrained-param-rationale.ts:87-149`） | AI round rationale（`rationales_by_round` 串接） |
| 稽核面板 | `results.audit.scenarios`（`AuditRawDataPanel.tsx:257-261,451-460`） | `results.audit.proRounds` 輪次表（`AuditRawDataPanel.tsx:198-200,424-438`） |
| 參數摘要 | `scenario_style` 置頂 knob（`ai-params-disclosure.ts:242-248`） | 無 scenario knob（除非 Option C 保留） |
| 排程文案 | "Constrained customization job queued…"（`jobs.py:144`） | "Pro convergence job queued…" / "Backtest job queued…" |

### 2.6 相關 request 欄位（`apps/api/app/models.py`）

| 欄位 | 位置 | 說明 |
|---|---|---|
| `optimization_mode` | `:309-312` | `standard` / `pro_auto`（`OptimizationMode`，`:24-28`） |
| `enable_iterative_refinement` | `:313-316` | pro_auto 的 deprecated alias |
| `trials` | `:163-167` | 5–200，預設 50；RM overlay 預設 25 |
| `top_models` | `:168-173` | 1–20，預設 5 |
| `refinement_batch_size` / `refinement_challengers_per_round` / `refinement_max_rounds` / `refinement_patience` / `refinement_min_improvement` | `:318-344` | Pro 預算旋鈕（5 / 4 / 8 / None / 0.01） |
| `anchor_weights` / `customization_drift` | `:259-265` / `:247-258` | 錨點與漂移上限 |
| `universe_tickers` / `universe_supplement_tickers` | `:190-205` | locked 宇宙白名單與補充 |
| `client_ref` / `client_context` / `anchor_job_id` / `anchor_portfolio_id` | `:364-382` | RM 客製化訊號 |
| `continue_from_job_id` / `extra_refinement_rounds` / `extra_trials_per_round` / `extra_trials` | `:383-401` | 延續跑 |
| **（無受限模式旗標）** | — | 現況完全由引擎隱式判定 |

### 2.7 移除/改預設會波及的資產

- API 測試：`apps/api/tests/test_constrained_customization.py` 全檔（觸發、種子、預算、釘定、champion、proposals、rationale 共 14 個測試）。
- Web 測試：`constrained-param-rationale.test.ts`（5 個）、`proposal-set.test.ts:321-323`（標籤保留）、`ai-params-disclosure.test.ts:72-74`（scenario knob 置頂）。
- i18n：`results.proposalLabel.anchor_close/full_drift/theme`、`results.championWhyParamsConstrained*`（10 keys）、`results.audit.scenarios`、`params.info.scenario_style`、`pro.param.scenario_style`（三語各一份）。
- 文件：`pipeline-stage-plugin-architecture.md:81,268,303` 的觸發條件與 reporting 對照表。
- jobs 預估：`jobs.py:117-128` 的 `_estimated_trials_total` 以受限估計優先於 Pro 估計。

---

## 3. 核心設計

### 3.1 設計選項

#### Option A — 完全移除受限模式，一律完整搜尋

- 刪除 `should_use_constrained_customization` 的早期觸發；`constrained_mode` 恆 False。
- 優點：路徑單一、行為最可預測。
- 缺點：具名情境 proposal 標籤與 rationale 文案成死碼；歷史受限 job 的渲染路徑（`isConstrainedParamSetupContext`）仍需保留；14 個 API 測試全數作廢需重寫；萬一完整搜尋在小宇宙上出現 runtime 或品質問題，**沒有退路**。

#### Option B — 預設完整搜尋 + API 旗標；受限僅內部（**已鎖定**）

新增 request 旗標，預設關閉受限模式；正式 UI 永不送 `constrained`（Q2=C、Q3=A、Q5=A）：

```python
# models.py — BacktestRequest
customization_search_mode: Literal["full", "constrained"] = Field(
    default="full",
    description=(
        "Anchored customization search strategy. 'full' (default) = standard AI+Optuna "
        "or Pro multi-round per optimization_mode; 'constrained' = legacy named-scenario "
        "lanes (internal/debug/tests only)."
    ),
)
```

引擎改動最小化：

```python
# constrained_customization.py — should_use_constrained_customization 開頭新增
if str(getattr(req, "customization_search_mode", "full") or "full") != "constrained":
    return False
```

- 預設 `full` → 客製化走完整搜尋；再配合 Q1：客製化路徑預設 `pro_auto`。
- 顯式 `constrained` → 沿用現況具名情境路徑（僅測試／內部客戶端）。
- 歷史 job 無此欄位 → 預設 `full`；**歷史結果渲染**只看 `narrative_facts` 舊標記（G5）。
- 回滾 = git revert／hotfix（Q7=B），不以預設值翻轉當產品保底。

#### Option C — 完整搜尋 + 具名情境作為額外候選（**Phase 1 不做**）

把 4 個具名情境種子注入 AI seed 佇列、proposals 沿用情境標籤——需 per-seed param_controls override；另案評估。

**決議：Phase 1 = Option B + 客製化預設 Pro（Q1）+ 小宇宙降預算（Q4）。**

### 3.2 小宇宙的預算調節（G4，Q4=B）

對外仍是 `full` + Pro；tradable ≤ 20 時**自動降輪數／patience**，避免小池子空轉：

| 模式 | 大宇宙／一般 | 小宇宙（tradable ≤20 且有錨點客製化） |
|---|---|---|
| 標準（RM 關 Pro） | `trials`（RM overlay 預設 25） | 不變 |
| Pro（客製化預設） | batch0=5、challengers=4、max_rounds=8、patience=None → ≈40 trials + ≤8 AI | **max_rounds=5**、**patience=3**（request 未顯式覆寫時引擎套用）→ ≈5+5×4=25 trials + ≤5 AI |

- 僅在 request **未**顯式設定對應 refinement 欄位時套用降預算（尊重手動覆寫）。
- `trials` 下限 5 不變；`refinement_min_improvement=0.01` 不變。
- jobs `_estimated_trials_total` 需反映小宇宙降後公式（測試 A6 更新）。

### 3.3 Proposals / leaderboard / champion 在完整模式下的行為

| 機制 | 還原後行為 | 與受限模式差異 |
|---|---|---|
| `proposal_set` | `pick_pareto_proposals(max_n=3)`（`backtest.py:4575-4581`），標籤 `recommended/defensive/growth/alternative` | 少一張卡（4→3）；無情境標籤；近同組合被 Pareto 折疊（受限模式保留權重相異情境） |
| champion | 標準 = rank 1；Pro = AI champion | 不再「needs 優先」；needs 透過 client_context 軟懲罰與 proposal 卡上的 `needs_attainment` 呈現（§10.3） |
| `_oos_leaderboard` | 不變（records + candidates 合併去重） | 受限模式的 records 含 lane 探索 trial，完整模式同樣含 TPE 探索 trial，形狀一致 |
| `sample_metrics` | 不變（逐候選 IS/OOS/full） | — |
| `ai_param_generation` | `model="ai+iterative"`（Pro）或 AI seeds 摘要（標準） | `constrained_customization` / `scenario_styles` 欄位為 None/False |
| 延續跑 | 標準 snapshot（`build_standard_snapshot_from_champion`）或 Pro snapshot；`extra_trials` / `extra_refinement_rounds` 沿用 | 現況受限 job 也存標準 snapshot，但續跑會再觸發受限；還原後續跑走完整搜尋（§9 E8） |

### 3.4 引擎／Web 改動點（鎖定後）

1. `models.py`：新增 `customization_search_mode`（預設 `"full"`）。
2. `constrained_customization.py`：`should_use_constrained_customization` 開頭非 `constrained` 即 False。
3. `backtest.py`：旗標預設 `full` → Pro 不再被關；顯式 `constrained` 時現況保留。小宇宙客製化 Pro：未覆寫時套用 max_rounds=5、patience=3（§3.2）。
4. `jobs.py`：受限預估僅在顯式 `constrained` 時生效；小宇宙 Pro 預估用降後公式；排程文案回 Pro／標準。
5. Web `types.ts`：`customization_search_mode?: "full" | "constrained"`（型別齊全；正式 UI 不送）。
6. Web 客製化預設 Pro：`overlay-schema`／RmRunPanel 客製化路徑預設 `optimization_mode=pro_auto`、Pro toggle 預設開（Q1）；**不加**搜尋模式下拉／advanced toggle（Q5）。
7. i18n：清掉簡化／受限誤導文案，改為客製化預設完整 Pro（Q6）。

---

## 4. UX 流程

### 4.1 RM 客製化主流程（還原後）

```
Overlay 簽核 → RmRunPanel（constraints 階段）
  ├─ Pro toggle：**預設開啟**（optimization_mode=pro_auto）
  ├─ 「What will run」：Pro 狀態 = 實際執行（修復靜默覆寫）
  │     ├─ Pro on（預設）→ 多輪 champion-challenger
  │     │     ├─ 大宇宙：≈8 輪 / 40 trials
  │     │     └─ 小宇宙（≤20）：自動降為 ≈5 輪 / 25 trials、patience=3
  │     └─ Pro off（手動關）→ 標準完整 AI+Optuna（trials=25）
  ├─ **無**搜尋模式 UI／advanced「受限情境」toggle（Q5）
  └─ 執行 → "Pro convergence job queued…"（預設）或關 Pro 時 "Backtest job queued…"
```

### 4.2 結果頁

- **Pro 多輪（客製化預設）**：`ProResultsWithTabs` + `RoundSeedPanel` + 收斂歷史。
- **標準完整搜尋**（手動關 Pro）：`ResultsDashboard`，Pareto 三卡 + AI rationale。
- **內部 constrained**：僅 API／測試可觸發；呈現沿用現況具名情境卡。
- **歷史受限 job**：`narrative_facts.constrained_customization=True` 仍走既有渲染路徑（不刪前端邏輯）。

### 4.3 進度回報

- 受限模式的 "Constrained customization: N named scenarios…" 進度訊息（`backtest.py:3352-3359`）只在 opt-in 時出現。
- 完整模式沿用現有訊息：標準的 "AI done: N seed sets queued…" / Pro 的 "Pro round X/Y: …"。

---

## 5. 檔案變更清單

| # | 檔案 | 變更 | 估計規模 |
|---|---|---|---|
| F1 | `apps/api/app/models.py` | `BacktestRequest` 新增 `customization_search_mode: Literal["full","constrained"] = "full"` | ~10 行 |
| F2 | `apps/api/app/engine/constrained_customization.py` | `should_use_constrained_customization` 開頭加旗標早退；模組 docstring 更新為「opt-in legacy mode」 | ~15 行 |
| F3 | `apps/api/app/engine/backtest.py` | `:3228-3243` 註解更新（行為由旗標驅動）；無邏輯改動 | ~5 行（註解） |
| F4 | `apps/api/app/jobs.py` | 無邏輯改動（`estimate_constrained_trial_count` 經 F2 自動失效）；排程文案分支保留 | 0 行 |
| F5 | `apps/api/tests/test_constrained_customization.py` | 觸發類測試改為顯式 `customization_search_mode="constrained"`；新增「預設 full 不觸發」「Pro 不再被壓制」測試 | ~40 行 |
| F6 | `apps/api/tests/test_customization_search_mode.py` | **新增**：旗標預設值、jobs 預估 trials、Pro+錨點小宇宙走 `_run_iterative_search` 的整合測試 | ~120 行 |
| F7 | `apps/web/src/lib/types.ts` | `BacktestRequest` 加 `customization_search_mode` | ~4 行 |
| F8 | `apps/web/src/components/RmRunPanel.tsx` + overlay 組 request 處 | 客製化路徑 Pro toggle／`optimization_mode` **預設開**；**不**加搜尋模式 UI | ~30 行 |
| F9 | `apps/web/src/lib/i18n.tsx` | 清誤導文案 + §6 新 keys（三語）；既有受限 keys 保留供歷史 job | ~3×8 行 |
| F10 | `docs/design/pipeline-stage-plugin-architecture.md` | 觸發條件改為「僅顯式 constrained／內部」 | ~10 行 |
| F11 | `apps/api/app/engine/backtest.py`（預算） | 小宇宙客製化 Pro 未覆寫時套用 max_rounds=5、patience=3 | ~25 行 |
| F12 | （另案 Option C）具名情境注入完整搜尋 | Phase 1 不做 | — |

> 註：行為切換收斂在 F2 旗標早退 + F8 預設 Pro + F11 小宇宙預算；回滾靠 git revert（Q7=B）。

---

## 6. i18n 文案

既有受限 keys（`results.proposalLabel.anchor_close/full_drift/theme`、`results.championWhyParamsConstrained*`、`results.audit.scenarios`）**全部保留**供歷史 job。**刪除或改寫**任何暗示「錨點／小宇宙會走簡化搜尋」的文案（Q6=A）。新增／調整：

| Key | zh（繁中） | en | ko |
|---|---|---|---|
| `rm.run.searchMode.fullNote` | 預設：每次客製化都執行完整 Pro 多輪 AI 調參。 | Default: every customization runs full Pro multi-round AI tuning. | 기본값: 모든 맞춤화가 전체 Pro 멀티라운드 AI 튜닝을 실행합니다. |
| `rm.run.proSearchOnNote` | 已開啟 Pro 多輪搜尋——將對此客製化執行完整多輪調參。 | Pro multi-round search is on — this customization gets full multi-round tuning. | Pro 멀티라운드 탐색이 켜져 있습니다 — 이 맞춤화에 전체 멀티라운드 튜닝이 적용됩니다. |
| `rm.run.proSearchOffNote` | 已關閉 Pro：改為標準完整 AI+Optuna 搜尋（非受限情境模式）。 | Pro is off: standard full AI+Optuna search (not constrained scenario mode). | Pro 꺼짐: 표준 전체 AI+Optuna 탐색(제한 시나리오 모드 아님). |

不新增 `rm.run.searchMode.constrainedTitle/Hint`（無 UI）。「What will run」在 Pro 預設開時明示引擎**確實**跑多輪。

---

## 7. 測試計畫

### 7.1 API 單元/整合測試（pytest，`apps/api/tests/`）

| # | 案例 | 斷言 |
|---|---|---|
| A1 | 預設旗標：錨點 + 小宇宙 + RM 訊號，無 `customization_search_mode` | `should_use_constrained_customization` 回 False；`estimate_constrained_trial_count` 回 None |
| A2 | 顯式 `constrained`：同 A1 條件 + 旗標 | 回 True；估計 = `max(情境數, trials)`（沿用既有斷言） |
| A3 | 顯式 `full`：同 A1 條件 | 回 False |
| A4 | Pro 不再被壓制：`optimization_mode=pro_auto` + 錨點小宇宙（預設旗標） | `_run_backtest_engine` 走 `_run_iterative_search`（mock 斷言被呼叫）；結果含 `pro_rounds`；`narrative_facts.engine == "optuna+pandas+pro"` |
| A5 | Pro + 顯式 constrained | 仍走受限路徑且 `pro_mode` 被關（現況行為保留）；`narrative_facts.optimization_mode == "constrained_customization"` |
| A6 | jobs 預估：預設旗標的錨點小宇宙 Pro 請求 | `_estimated_trials_total` = 降預算公式（≈25），不再回受限估計；大宇宙 Pro 仍 ≈40 |
| A7 | 排程文案：預設旗標 | "Pro convergence job queued…" / "Backtest job queued…"；顯式 constrained 時仍為 "Constrained customization job queued…" |
| A8 | 既有 `test_constrained_customization.py` 全數更新為顯式旗標後通過 | 14 個測試全綠（種子/預算/釘定/champion/proposals/rationale 邏輯零回歸） |
| A9 | 完整模式 proposals：錨點小宇宙標準搜尋 | `proposal_set` 走 `pick_pareto_proposals`，≤3 張卡，標籤 ∈ {recommended, defensive, growth, alternative} |
| A10 | 完整模式 champion 與 needs：有 client_context 地板時 | 每候選仍有 `needs_attainment`；champion = rank 1（行為變更已文件化，§10.3） |
| A11 | 延續跑：舊受限 job（無旗標 request）以 `extra_trials` 續跑 | 走標準完整搜尋；continuation snapshot mode="standard" 正常載入 |
| A12 | 小宇宙可行性：3 檔 locked 宇宙 + must-include | 完整搜尋產生 ≥1 個可行 trial；`apply_must_include_floor` 生效；無 `max_holdings` 不足錯誤 |

### 7.2 Web 測試（vitest）

| # | 案例 | 斷言 |
|---|---|---|
| W1 | 既有 `constrained-param-rationale.test.ts` / `proposal-set.test.ts` / `ai-params-disclosure.test.ts` | 全數維持通過（渲染路徑不動） |
| W2 | RmRunPanel 客製化預設 | 預設送 `optimization_mode=pro_auto`；**不**送 `customization_search_mode`；無 advanced 受限 toggle |
| W3 | i18n key parity | §6 新／改寫 key 三語齊全；誤導「簡化搜尋」文案已移除 |
| W4 | 歷史受限 job 渲染 | `narrative_facts.constrained_customization=true` 的 fixture 仍顯示具名情境 rationale（regression） |

### 7.3 手動驗收

1. RM 客製化（5 檔 locked 宇宙）預設執行 → Pro 開、進度多輪；小宇宙套用降預算；結果有分輪頁籤；無「約束情境」稽核。
2. 手動關 Pro → 標準完整 AI+Optuna；Pareto 三卡；仍非受限模式。
3. API／測試顯式 `customization_search_mode=constrained` → 具名情境行為（內部驗證）。
4. 歷史受限 job → 渲染不變。
5. 三語切換 → 無「簡化搜尋」誤導；Pro 預設文案正確。

---

## 8. 實作順序

| Phase | 內容 | 相依 | 完成判準 |
|---|---|---|---|
| **P1** 引擎旗標 + 小宇宙預算 | F1、F2、F3、F4、F5、F6、F10、F11 | 無 | pytest 相關檔全綠；A1–A12 通過 |
| **P2** 客製化預設 Pro + 文案 | F7、F8、F9 | P1 | W1–W4 通過；手動驗收 1–5 |

P1 單獨可 ship（預設 `full` + 小宇宙降預算）。P2 把客製化 UI 預設打成 Pro 並清誤導文案。Option C 另案，不在本 Phase 承諾。

---

## 9. 邊界案例

| # | 案例 | 預期行為 |
|---|---|---|
| E1 | **極小宇宙（3 檔）** | 完整搜尋可行：`max_holdings` 由 overlay-schema 設為 locked 數（`overlay-schema.ts:1514-1518`），`feasible_max_weight` 放寬等權重上限；25 trials 在小矩陣上快速完成。Pro 亦同。 |
| E2 | **must-include 釘定** | `derive_must_include_tickers` + `apply_must_include_floor`（`customization.py:12,190`）與搜尋模式無關，完整模式下照舊生效；受限模式 `theme` 情境特有的 `max_holdings` 撐大（`constrained_customization.py:469-481`）在完整模式不需要——`max_holdings = locked.length` 已涵蓋。 |
| E3 | **drift 下限（overlay-drift-sync）** | `customization_drift` 滑桿 ≥ floor 的同步不變；完整模式下 `customization_drift_actual` 仍被釘為滑桿值（`optimizer.py:289-302`），floor 保證不被搜尋穿越。若未來 Option C 讓 drift 進入搜尋，下界必須是 floor 而非 0（§12 Q5）。 |
| E4 | **runtime 失控** | 小宇宙 Pro 降為 max_rounds=5、patience=3（§3.2）。AI 失敗既有 fallback 不變。 |
| E5 | **Pro + 顯式 constrained（僅內部）** | 受限優先，`pro_mode` 被關——與現況一致，A5 鎖定；正式 UI 不會送 constrained。 |
| E6 | **static replay** | 永不進入任一搜尋（`constrained_customization.py:80-81` 與 `_is_static_replay` 不變）。 |
| E7 | **無錨點的開放宇宙回測** | 本就不受影響（`anchor_weights` 為空 → 受限模式不觸發）；行為完全不變。 |
| E8 | **舊受限 job 的延續跑** | 舊 request 無旗標 → 預設 `full` → 續跑走標準完整搜尋；`build_standard_snapshot_from_champion` snapshot（`backtest.py:4529-4534`）mode="standard" 可正常載入，champion 暖啟沿用。 |
| E9 | **歷史結果渲染** | 舊 job 的 `narrative_facts.constrained_customization=True` 仍在 → 前端走既有具名情境渲染；新 job 不再有該標記（除非 opt-in）。兩者並存無衝突。 |
| E10 | **`top_models` > 可行 trial 數** | 完整模式沿用 `top_n_models = min(req.top_models, trials_feasible)`（`backtest.py:3665`）；無新模式特定風險。 |
| E11 | **AI 種子全失敗（標準模式）** | 既有 fallback：全量 Optuna（`backtest.py:3597-3603`）；小宇宙不影響。 |
| E12 | **API 客戶端送未知字串** | Pydantic `Literal["full","constrained"]` 422 拒絕；舊客戶端不送欄位 → 預設 `full`。 |

---

## 10. 與既有機制的關係

### 10.1 `constrained_customization.py`（保留為內部／歷史）

模組完整保留。唯一行為改動是觸發器開頭的旗標早退（F2）。docstring 改述為「legacy mode for internal/debug/tests」。`SCENARIO_STYLES` 與 i18n 標籤繼續服務歷史 job 與內部驗證。

### 10.2 Proposals（`objectives.py`）

完整模式回歸 `pick_pareto_proposals`（`:566+`）：Pareto 三軸 + 近同折疊。與受限模式的差異（卡數 3 vs 4、標籤詞彙、折疊策略）屬**預期行為變更**，在 §3.3 與 §6 文件化。`dedupe_proposal_candidates` / `weights_signature` 兩模式共用，不變。

### 10.3 `needs_attainment` 與 champion 選擇（行為變更，需產品確認）

- 地板檢核本身不變：逐候選計算（`backtest.py:1839`）、proposal 卡照常顯示。
- **champion 選擇哲學改變**：受限模式 `select_constrained_champion_code` 是 needs-first（地板全過 → needs_score → 績效）；完整模式標準 = rank 1 績效、Pro = AI champion。client_context 的軟懲罰（drawdown/concentration/cash/income）在完整模式的 trial 評分中已生效，AI learning context 也帶 `client_needs`（`backtest.py:749-753`），因此 needs 並非被忽略，而是從「硬排序」變「軟引導」。
- 完整模式 needs-first champion 重選：**Phase 1 不做**（§0）。

### 10.4 Drift 同步（overlay-drift-sync）

`customization_drift` 滑桿、floor 尺規、調降確認、主管徽章全部不變。完整模式下 drift 仍釘定於滑桿值（見 §9 E3），因此「滑桿即承諾」的語意在完整模式下反而**更強**（受限模式的 `anchor_close` 情境只會用 35% 預算，與滑桿承諾有落差）。

### 10.5 延續跑 / champion registry

`lookup_champion` 暖啟、`record_champion` 寫入、continuation snapshot 兩模式共用，不變。Pro 客製化現在可正常使用 `extra_refinement_rounds` 續跑（現況受限模式把 Pro 關掉，Pro 續跑對小宇宙客製化形同虛設）。

### 10.6 文件同步

`pipeline-stage-plugin-architecture.md:81` 的觸發條列、`:268` 與 `:303` 的 reporting 對照，更新為「僅顯式 constrained／內部」描述（F10）。

---

## 11. 風險與回滾

| 風險 | 等級 | 緩解 |
|---|---|---|
| 客製化預設 Pro 使面談等待變長 | 中 | Q4 小宇宙降預算；RM 可手動關 Pro；AI 失敗 fallback |
| RM 習慣具名情境卡，對 Pareto／Pro 分輪陌生 | 低 | §6 文案；歷史 job 仍可看舊卡 |
| needs-first champion 消失引發合規疑慮 | 中 | §10.3 文件化；重選層另案 |
| 歷史 job 渲染回歸 | 低 | 前端渲染路徑零刪除；W4 |
| 無 env 保底回滾（Q7=B） | 中 | 準備好 hotfix revert PR；監控 p95 job 時長 |

**回滾方案（Q7=B）**：

1. **單次 run**：RM 手動關 Pro → 標準完整搜尋（仍非舊受限模式）。
2. **完全回復舊隱式受限行為**：git revert 本功能相關 commit／hotfix 還原 `should_use_constrained_customization` 隱式觸發——**不以** env 或預設值翻轉當產品機制。

---

## 12. 待討論事項（已鎖定）

見 §0。摘要：

| # | 鎖定 |
|---|---|
| Q1 | **B** — 客製化一律預設 Pro |
| Q2 | **C** — constrained 僅內部／debug／測試 |
| Q3 | **A** — 新增 `customization_search_mode`，預設 `full` |
| Q4 | **B** — 小宇宙 full+Pro，自動降 rounds／patience |
| Q5 | **A** — UI 不顯示搜尋模式 |
| Q6 | **A** — 清誤導文案，改為預設完整 Pro |
| Q7 | **B** — 無 feature flag；回滾靠 revert／hotfix |

**本 Phase 明確不做**：具名情境注入（原 Option C）、drift 進搜尋空間、needs-first champion 重選。

---

## 附錄 A：關鍵程式碼座標速查

| 符號 | 位置 |
|---|---|
| 模式分岔（三向分支） | `apps/api/app/engine/backtest.py:3226-3243` |
| 受限模式觸發器 | `apps/api/app/engine/constrained_customization.py:67-122` |
| 觸發閾值（20 / 8） | `constrained_customization.py:39,42` |
| 具名情境種子 | `constrained_customization.py:347-484` |
| 情境 identity 釘定 | `constrained_customization.py:173-193` |
| 受限 champion（needs-first） | `constrained_customization.py:487-531` |
| 受限 proposals（具名標籤） | `constrained_customization.py:534-628` |
| 受限 rationale（三語） | `constrained_customization.py:692-843` |
| Pro 多輪本體 | `backtest.py:554+`（`_run_iterative_search`） |
| 標準 AI+Optuna 分支 | `backtest.py:3542-3659` |
| 受限 lane 迴圈 | `backtest.py:3336-3501` |
| records 選拔分岔 | `backtest.py:3715-3725` |
| proposals 分岔 | `backtest.py:4568-4581` |
| narrative_facts 模式標記 | `backtest.py:4276-4291,4425-4432` |
| `_oos_leaderboard` | `backtest.py:2393-2459`（呼叫於 `:4344-4352`） |
| jobs trials 預估 / 排程文案 | `apps/api/app/jobs.py:117-128,139-150` |
| drift 釘定（引擎安全網） | `apps/api/app/engine/optimizer.py:289-302` |
| drift 釘定（web overlay） | `apps/web/src/lib/overlay-schema.ts:1466-1475` |
| RM overlay 預設（trials=25, top_models=5） | `overlay-schema.ts:1512-1513` |
| RmRunPanel Pro toggle | `apps/web/src/components/RmRunPanel.tsx:92,116-122,264-293` |
| 結果頁 pro_rounds 分岔 | `apps/web/src/app/page.tsx:1546-1579`、`RmReportView.tsx:362-400` |
| RoundSeedPanel | `apps/web/src/components/ProResultsWithTabs.tsx:197-330` |
| 前端受限 rationale 判定 | `apps/web/src/lib/constrained-param-rationale.ts:45-63`、`ResultsDashboard.tsx:472-517` |
| 稽核面板「約束情境」 | `apps/web/src/components/AuditRawDataPanel.tsx:257-261,451-460` |
| scenario_style 參數 knob | `apps/web/src/lib/ai-params-disclosure.ts:242-248` |
| API 受限測試 | `apps/api/tests/test_constrained_customization.py`（全檔） |
