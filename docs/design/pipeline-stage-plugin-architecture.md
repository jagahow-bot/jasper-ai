# JASPER Pipeline-Stage Plugin 架構與模型路由設計書

> **版本**:0.2（Phase 0–3 已落地於 repo；本文件為設計真相來源）
> **狀態**:Implemented — L0/L1/L2 三層審核(§4.5)；deploy-on-merge(§5.1)
> **日期**:2026-09-03
> **讀者**:量化引擎工程師、Web/BFF 工程師、業務負責人(Product Owner)、合規/稽核
> **相關文件**:[`docs/jasper-ai-architecture.md`](../jasper-ai-architecture.md)、[`docs/Conversational-Overlay-Flow.md`](../Conversational-Overlay-Flow.md)
> **適用程式碼**:`apps/api`(FastAPI 量化引擎)、`apps/web`(Next.js 15 BFF + UI)

---

## 實作狀態快照（2026-09-03）

| Phase | 狀態 | 主要落點 |
|---|---|---|
| Phase 0 | ✅ | `apps/api/app/engine/stages/*`、accessors 全 8 stage 接線、`shared/stage-cards.json`、golden parity、`/docs/engine`、`check-stage-cards` |
| Phase 1 | ✅ | `capability_gaps` schema、`overlay-feasibility.ts`、`/gaps` API+UI、drift ≤0.6 RM / >0.6 supervisor |
| Phase 2 | ✅ | `LLM_TASK_ROUTING`、codegen 不靜默降級 Flash、七件套 scaffold、AST allowlist、semantic review route、Behavior Spec Card |
| Phase 3 | ✅ | `capability_approval` L1/L2、`capabilities_used`、提案「含待簽核能力」徽章 helper、`notify_capability_rm_confirmed`、**deploy-on-merge**（見 §5.1；熱重載僅 `api:dev:reload`） |

**§8 裁決落點**:
1. stage 歸屬 = LLM 填 + BFF `validateCapabilityGapStages`（非法 → clarifications）
2. drift override ≤0.6 RM 可決；>0.6 → `requires_supervisor` / pending supervisor
3. Behavior Spec Card canonical 集沿用 §2.7.2 五情境（smoke + stage parity）
4. semantic review `partial`/`mismatched` → `engineer_checklist` 強制欄位
5. API codegen 仍以 web BFF 為主；`settings.codegen_model` 預留

---

## 0. 設計目標與已確認決策

### 0.1 問題陳述

JASPER 是 RM(理專)財富管理 copilot。客戶透過 overlay 對話表達的需求,已開始超出目前可調參數的表達範圍。典型案例:

> 客戶要求「第二層配置:50% AI 成長袖珍組合 / 50% 避險袖珍組合,各自獨立子配置」——目前的 `customization_drift`(單層 L1 漂移上限,見 `apps/api/app/models.py` `BacktestRequest.customization_drift`,預設 0.5、範圍 [0,1])與單層 `allocator.py` 求解器都無法表達「兩層袖珍結構」這種**結構性新能力**。

目前的系統只能二選一:要么把需求**硬塞進錯誤的參數映射**(幻覺風險),要么**沉默地給出打折的答案**(RM 不知道系統其實做不到)。本設計引入第三條路:**能力缺口(capability gap)成為一等公民**——被明確偵測、記錄、排入 backlog、由 AI 起草實作、經 L0 機械閘門與 L1 RM 確認後成為可用能力,並由 L2 主管批次簽核完成最終核准(§4.5)。

### 0.2 已與使用者確認的三項決策(本文件不可違背)

1. **Pipeline-stage plugin 架構**:將回測管線重構為 8 個**有型別、有版本、可替換**的 stage,由 registry 管理:
   `宇宙建構(universe) → 訊號/因子(signals) → 配置器(allocator) → 約束(constraints) → 目標函數(objective) → 再平衡(rebalance) → 現金排程(cash schedule) → 回報(attainment/reporting)`。
   AI(或人類)只能透過 PR 提出**某個 stage 的新實作**;**絕不在 job runtime 執行未審核的程式碼**。介面(typed interface)本身就是安全邊界。
2. **三層審核(L0/L1/L2,2026-09-03 裁決,取代原雙層審查)**:
   - **L0 CI 機械閘門**(無人工):AST allowlist、property 測試、對抗 fixtures、效能預算、golden master、文件同步(§4.3)。
   - **L1 RM 確認**:RM 在對話中審閱 **Behavior Spec Card**(白話文:改了什麼、變數與上下界、canonical 情境前後對比回測);確認後能力即可用於回測,狀態 `rm_confirmed`。
   - **L2 主管批次簽核**:投資建議書(proposal)生成時,主管對該 proposal 用到的所有新能力**一次批次簽核**;簽核後狀態轉 `approved`,其他 RM 可直接重用(版本不變免再簽)。
   - **工程師不是逐 PR 的 blocking 審查者**;僅在 semantic review 判定 `partial` / `mismatched` 時走例外路徑,且須在 L1 之前完成簽核(§4.5.1)。
   Stage 的 **capability card** 由型別介面自動生成,成為永不過時的引擎文件,供 RM 與稽核查閱。
3. **模型路由(混合架構)**:
   - **Gemini Flash** 繼續負責高頻、低延遲的 overlay interpret/extract 對話回合。
   - **Kimi K3** 負責低頻、高風險工作:constraint-gap 推理草稿、PR 程式碼起草。
   - **語意複審(semantic re-review)由另一個模型家族執行**(Gemini 審 Kimi 的草稿),避免同家族盲點。

### 0.3 非目標(Explicit Non-Goals)

- 本文件**不包含實作**;僅為設計與 PR 拆分依據。
- 不改變既有回測數值結果(Phase 0 為純重構,以 golden master 保證 bit-for-bit 一致)。
- 不引入 runtime codegen / eval;AI 產出的程式碼一律走 PR + CI + 人工審核。
- 不替换 Optuna(見 `apps/api/app/engine/optimizer.py` `run_optuna_search`),而是把它包進 stage 邊界內。

---

## 1. 現況盤點(程式碼基礎)

### 1.1 引擎呼叫鏈

```
POST /jobs (apps/api/app/routers/jobs.py:29)
  → jobs.create_job(req) (apps/api/app/jobs.py:131)  # 背景 thread
  → run_backtest(req, job_id) (apps/api/app/engine/backtest.py:4574)
      └─ set_llm_audit_job_id(job_id) → _run_backtest_engine(...) → result.llm_logs = pop_llm_audit_logs(job_id)
```

`_run_backtest_engine`(同檔,約 2882 行起)依請求分流為四條路徑:

| 路徑 | 觸發條件 | 關鍵程式 |
|---|---|---|
| Static replay | `static_replay_holdings` 有值 | `_run_static_replay_backtest`(`backtest.py:2668`) |
| Constrained customization | `should_use_constrained_customization()`(`constrained_customization.py:69`)— 有 `anchor_weights` 且 universe 小(tradable ≤ 20 或 supplements ≤ 8) | `build_constrained_scenario_seeds` / `build_constrained_proposal_set`(`constrained_customization.py:349 / 536`),`SCENARIO_STYLES = ("anchor_close","full_drift","defensive","theme")` |
| Pro 收斂 | `optimization_mode = pro_auto` | `_run_iterative_search`(`backtest.py:549`)+ `refinement.py` + `ai_params.py`(Gemini round seeds) |
| 標準 Optuna | 預設 | `run_optuna_search`(`optimizer.py:214`) |

所有路徑共用底層原語:

- **因子/訊號**:`apps/api/app/engine/factors.py` — `FactorParams`(:100)、`score_assets`(:469)、`pick_top_n`(:548);內建 mom / reversal / value / lowvol / trend / drawdown / income 七族指標。
- **配置器**:`apps/api/app/engine/allocator.py` — `AllocatorParams`(:26,`mode ∈ {min_var, mean_variance, risk_parity, max_diversification}`)、`solve_weights`(:218,SLSQP + 解析 Jacobian,失敗退回 PGD)。
- **約束/權重原語**:`apps/api/app/engine/weights.py` — `project_max_weight`(:181,capped simplex 投影)、`min_holdings_for_cap`(:30)、`feasible_max_weight`(:48)、`audit_weight_cap`(:119)、`apply_max_holdings` / `apply_min_holding_weight` / `scale_invested_weights`;`apps/api/app/engine/customization.py` — `l1_turnover_distance`(:51,單向 0.5·‖w−a‖₁)、`project_anchor_l1_drift`(:126,硬性 L1 漂移球投影,**必須是每次再平衡的最後一道權重變換**)、`derive_must_include_tickers` / `pin_must_include_into_chosen` / `apply_must_include_floor` / `min_holdings_for_customization`(:62,機械可行性下界的現成先例)。
- **目標函數**:`apps/api/app/engine/objectives.py` — `compute_objective_score`(:32)、`compute_client_needs_penalty`(:220,soft penalty)、`needs_attainment`(:274,回報用硬性達標檢查)、`pick_pareto_proposals`(:491)。
- **模擬/再平衡/現金**:`apps/api/app/engine/portfolio.py` — `simulate_portfolio`(:1445)、`simulate_dynamic_portfolio`(:1457)、`deployment_fraction`(:41,DCA)、`_trading_day_rebalance_dates`(:432,QE/ME rule)、`_rebalance_schedule_dynamic`(:688)、`_apply_max_turnover`(:597)、`_estimate_mu_sigma`(:559)。
- **參數治理**:`apps/api/app/engine/param_taxonomy.py` — `SETUP_PARAM_KEYS`(:36)、`FACTOR_NUMERIC_KEYS` / `FACTOR_CATEGORICAL_KEYS`、`DEFAULT_FACTOR_BOUNDS`(:83)、`_PARAM_CATALOG_META`(overlay_eligible / bounds / description / client_hint)、`build_param_catalog()`(:275);`param_bounds.py` — `RunBlueprint`(:28)、`clamp_param_dict`(:171)。
- **請求/結果模型**:`apps/api/app/models.py` — `BacktestRequest`(:113)、`ClientContext`(:31)、`PortfolioCandidate.needs_attainment`(:495)、`ProposalCard`(:504)、`BacktestResult.proposal_set`(:591)與 `llm_logs`(:590)。
- **Spec**:`apps/api/app/engine/spec.py` — `BacktestSpec`(:6,frozen dataclass:benchmark / fee / rebalance_rule / holdings / cash_reserve_pct / deployment)。

### 1.2 Overlay 鏈路

```
RM 對話 → POST /api/overlay/interpret (apps/web/src/app/api/overlay/interpret/route.ts:378)
  → overlaySystemPrompt(lang)(:179)+ param catalog 白名單區塊 overlayParamCatalogBlock()(:148)
  → defaultFlashModel()(Gemini Flash,:445)+ generateTextWithAudit
  → parseOverlayExtractFromGemini(apps/web/src/lib/overlay-gemini-parse.ts)
  → validateOverlayExtract(overlay-schema.ts:280,zod)
  → wrapExtractAsOverlay → ClientOverlay(OVERLAY_VERSION = "1.0",overlay-schema.ts:27)
  → (失敗時)interpretOverlayFallback(apps/web/src/lib/overlay-fallback.ts,規則降級)
RM 簽核 → signOffOverlay(overlay-schema.ts:983)
  → overlayToBacktestRequest(overlay-schema.ts:847)→ BacktestRequest → POST /quant-api/jobs
```

universe 篩選另走 `POST /api/universe/filter`(Flash),由 `apps/web/src/lib/resolve-overlay-universe.ts` 組裝。

### 1.3 現行模型路由(程式碼實況)

`apps/web/src/lib/ai-provider.ts` 已定義雙模型骨架:

```ts
// apps/web/src/lib/ai-provider.ts:24-28
export const DEFAULT_FLASH_MODEL_ID =
  process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";
export const KIMI_K3_MODEL_ID =
  process.env.MOONSHOT_MODEL?.trim() || "kimi-k3";
```

| Route | 模型 | 程式碼位置 |
|---|---|---|
| `/api/overlay/interpret` | Flash | `overlay/interpret/route.ts:445` `defaultFlashModel()` |
| `/api/universe/filter` | Flash | `universe/filter/route.ts:86` |
| `/api/scenario/analyze` | Flash | `scenario/analyze/route.ts:38` |
| `/api/param-seeds` | Flash | `param-seeds/route.ts:111` |
| `/api/goals/extract`、`/goals/segment`、`/goals/insights` | Flash | `goals/*/route.ts` |
| `/api/narrate` | Kimi K3 | `narrate/route.ts:76` `reasoningModel()`,附 `validateNarrative` 反幻覺校驗 + 模板降級 `buildFallbackNarrative` |
| `/api/talking-summary`、`/candidate-summary`、`/candidate-compare-summary` | Kimi K3 | 各 route.ts `reasoningModel()` |
| 後端 Pro round seeds / AI param seeds | Gemini Flash(`settings.gemini_model`) | `apps/api/app/engine/ai_client.py:26`、`ai_params.py` |

稽核:前端 `apps/web/src/lib/llm-audit.ts`(`generateTextWithAudit` / `generateObjectWithAudit` / `uploadLlmLogs` → `PATCH /quant-api/jobs/{job_id}/llm-logs`,見 `apps/api/app/routers/jobs.py:130`);後端 `apps/api/app/llm_audit.py`(`set_llm_audit_job_id` context manager)。**兩邊 entry schema 已對齊**,可直接擴充新任務類型。

### 1.4 治理現況( versioning 先例)

- `shared/param-catalog.json` 由 `scripts/export_param_catalog.py` 自 `build_param_catalog()` 生成,**檔頭含 `"version": 1`**;root `package.json` 有 `generate-param-catalog` / `sync-param-catalog` scripts(同步至 `apps/web/src/data/param-catalog.json`)。這是 capability card 自動生成的直接先例。
- `apps/api/app/scenario_fingerprint.py` `compute_scenario_fingerprint`(:105)以請求 canonical hash 支援跨 run champion 重用——job record 釘版的現成機制。
- **現況缺口**:job record(`.cache/jobs/*.json`)目前**未**釘 param catalog version,亦無 `constraint_catalog_version` 欄位。本設計的 `stage_catalog_version` 將補上此缺口(見 §2.5)。

---

## 2. Phase 0 — Stage 介面與 Registry(地基)

### 2.1 原則

1. **介面即安全邊界**:每個 stage 是一個 Python `Protocol`,輸入輸出皆為 typed dataclass / pydantic model / `numpy.ndarray` / `pd.DataFrame`。新實作只要滿足 Protocol + 通過 gates 即可替換,不需改 orchestrator。
2. **純重構、零行為變更**:Phase 0 只做「搬移 + 命名 + registry」,不做任何數值行為改變。以 golden master 保證(§2.7)。
3. **向後相容**:舊 `.cache/jobs/*.json` 無 stage 版本欄位,一律映射為 catalog `v0-legacy`(§2.5.3)。

### 2.2 八個 Stage 的 Protocol 定義

新模組根:`apps/api/app/engine/stages/`。共用型別置於 `apps/api/app/engine/stages/base.py`:

```python
# apps/api/app/engine/stages/base.py(新增)
from typing import Any, Protocol, runtime_checkable
import numpy as np
import pandas as pd

StageKind = Literal[
    "universe", "signals", "allocator", "constraints",
    "objective", "rebalance", "cash_schedule", "reporting",
]

@dataclass(frozen=True)
class StageContext:
    """跨 stage 唯讀上下文:請求、spec、anchor、client needs、價格面板。"""
    req: BacktestRequest
    spec: BacktestSpec                     # apps/api/app/engine/spec.py:6
    anchor_weights: dict[str, float] | None
    client_context: ClientContext | None   # apps/api/app/models.py:31
    prices: pd.DataFrame                   # 已對齊訓練/模擬窗口
    universe_meta: dict[str, dict[str, Any]]  # ticker → {asset_class, category, ...}
    seed: int                              # 決定性要求:一切隨機性必須由此派生

@dataclass(frozen=True)
class StageIssue:
    code: str            # 機讀,例如 "INFEASIBLE_DRIFT"
    message_zh: str; message_en: str; message_ko: str
    severity: Literal["error", "warning"]

class Stage(Protocol):
    """所有 stage 實作的共同介面。"""
    stage: StageKind
    implementation_id: str      # 例如 "l1_drift_v1"
    version: str                # semver,例如 "1.0.0"
    def validate_config(self, config: dict[str, Any]) -> list[StageIssue]: ...
    def capability_card(self) -> StageCapabilityCard: ...   # §2.6
```

各 stage 簽名(**語意**直接對應現有程式碼,見 §2.4 映射表):

```python
# 1) universe — apps/api/app/engine/stages/universe.py
class UniverseStage(Stage, Protocol):
    def build(self, ctx: StageContext) -> UniverseResult: ...
@dataclass(frozen=True)
class UniverseResult:
    tradable: list[str]                 # 可交易池(已套用白名單/排除/supplement)
    must_include: list[str]             # 對應 customization.derive_must_include_tickers
    excluded: list[str]
    benchmark_ticker: str
    provenance: dict[str, Any]          # 每檔標的進池原因(locked/model/supplement/filter)

# 2) signals — apps/api/app/engine/stages/signals.py
class SignalsStage(Stage, Protocol):
    def score(self, ctx: StageContext, date: pd.Timestamp,
              universe: UniverseResult, params: FactorParams) -> SignalResult: ...
@dataclass(frozen=True)
class SignalResult:
    scores: pd.Series                   # ticker → 綜合分(對應 factors.score_assets:469)
    details: dict[str, pd.Series]       # 各因子明細(score_assets_with_details:495)

# 3) allocator — apps/api/app/engine/stages/allocator.py
class AllocatorStage(Stage, Protocol):
    def solve(self, ctx: StageContext, *,
              mu: np.ndarray, cov: np.ndarray,   # 年化(對應 portfolio._estimate_mu_sigma)
              chosen: list[str],
              params: AllocatorParams,            # allocator.py:26
              w0: np.ndarray | None) -> np.ndarray: ...   # 對應 allocator.solve_weights:218
    # 契約:回傳長度 = len(chosen);元素 ∈ [0, max_weight];sum ≤ 1(現金由 cash_schedule 處理)

# 4) constraints — apps/api/app/engine/stages/constraints.py
class ConstraintsStage(Stage, Protocol):
    def feasibility(self, ctx: StageContext, universe: UniverseResult,
                    config: dict[str, Any]) -> list[StageIssue]: ...
        # 機械預檢:對應 customization.min_holdings_for_customization(:62)與 §3.3 L1 預檢
    def project(self, ctx: StageContext, w: np.ndarray, *,
                anchor: np.ndarray | None,
                must_include_idx: list[int],
                config: dict[str, Any]) -> np.ndarray: ...
        # 對應 weights.project_max_weight + customization.project_anchor_l1_drift
        # 契約:投影後 w ∈ capped simplex 且 L1(w, anchor) ≤ drift(最後一道,不可被後續步驟重開)

# 5) objective — apps/api/app/engine/stages/objective.py
class ObjectiveStage(Stage, Protocol):
    def score(self, metrics: dict[str, Any], ctx: StageContext) -> float: ...
        # 對應 objectives.compute_objective_score(:32)
    def needs_penalty(self, metrics: dict[str, Any], holdings: dict[str, float],
                      ctx: StageContext) -> float: ...
        # 對應 objectives.compute_client_needs_penalty(:220)

# 6) rebalance — apps/api/app/engine/stages/rebalance.py
class RebalanceStage(Stage, Protocol):
    def schedule(self, ctx: StageContext, index: pd.DatetimeIndex) -> list[pd.Timestamp]: ...
        # 對應 portfolio._trading_day_rebalance_dates(:432)/ _rebalance_schedule_dynamic(:688)
    def apply(self, w_new: np.ndarray, w_prev: np.ndarray, *,
              max_turnover: float, no_trade_tol: float) -> np.ndarray: ...
        # 對應 portfolio._apply_max_turnover(:597)

# 7) cash_schedule — apps/api/app/engine/stages/cash_schedule.py
class CashScheduleStage(Stage, Protocol):
    def invested_fraction(self, ctx: StageContext, date: pd.Timestamp,
                          t_index: int) -> float: ...
        # 對應 portfolio.deployment_fraction(:41)× spec.target_invested_frac(spec.py:23)
        # 契約:回傳 [0,1];1 − f 為該日現金袖珍

# 8) reporting — apps/api/app/engine/stages/reporting.py
class ReportingStage(Stage, Protocol):
    def attainment(self, metrics: dict[str, Any], holdings: dict[str, float],
                   ctx: StageContext) -> dict[str, Any] | None: ...
        # 對應 objectives.needs_attainment(:274)
    def proposal_cards(self, candidates: list[PortfolioCandidate],
                       ctx: StageContext) -> list[ProposalCard]: ...
        # 對應 constrained_customization.build_constrained_proposal_set(:536)
        #      與 objectives.pick_pareto_proposals(:491)
```

### 2.3 模組配置(新增 vs 保留)

```
apps/api/app/engine/
  stages/                      ← 新增 package
    base.py                    ← StageContext / StageIssue / Stage Protocol / StageCapabilityCard
    registry.py                ← StageRegistry + catalog version 計算(§2.5)
    universe.py                ← UniverseStage Protocol + 內建實作 etf_catalog_v1
    signals.py                 ← SignalsStage Protocol + 內建實作 factor_lib_v1(包 factors.py)
    allocator.py               ← AllocatorStage Protocol + 內建實作 slsqp_classic_v1(包 allocator.py)
    constraints.py             ← ConstraintsStage + 內建實作 l1_drift_v1(包 customization.py / weights.py)
    objective.py               ← ObjectiveStage + 內建實作 metrics_score_v1(包 objectives.py)
    rebalance.py               ← RebalanceStage + 內建實作 calendar_qe_v1(包 portfolio.py 排程)
    cash_schedule.py           ← CashScheduleStage + 內建實作 dca_v1(包 deployment_fraction)
    reporting.py               ← ReportingStage + 內建實作 needs_attainment_v1
  # 既有模組全部保留為「內建實作的實作細節」,公開入口改由 stages/* 轉接
```

`backtest.py` 的 `_run_backtest_engine` 改為 orchestrator:依 registry 解析 8 個 stage 實作,依序呼叫。**四條既有路徑(static replay / constrained / pro / standard)在 Phase 0 保持原樣**,只是其內部對原語的呼叫改經 stage 介面。

### 2.4 現有程式碼 → Stage 映射表

| Stage | 現有程式碼(來源) | 備註 |
|---|---|---|
| universe | `BacktestRequest.universe_tickers / universe_supplement_tickers / universe_filter_*`(`models.py:163-188`)、`apps/web/src/lib/locked-universe.ts`(`buildLockedCustomUniverse`)、`resolve-overlay-universe.ts`、`apps/api/app/engine/ai_universe.py`、`data.py` 價格面板載入 | Web 端的 universe filter(/api/universe/filter)屬 BFF;engine 端 stage 只收已解析的 ticker 集合 |
| signals | `factors.py` 全部(`score_assets:469`、`pick_top_n:548`)、`param_taxonomy.py` `FACTOR_*_KEYS` | 因子指標新增(例如新 momentum 變體)= signals stage 的新實作或新 tunable |
| allocator | `allocator.py` 全部(`AllocatorParams:26`、`solve_weights:218`)、`regime_policy*.py` 的 preset 切換 | regime-adaptive 是「依日期解析 AllocatorParams」的 wrapper 實作 |
| constraints | `customization.py` 全部 + `weights.py`(`project_max_weight:181`、`audit_weight_cap:119`、`apply_max_holdings`、`min_holdings_for_cap:30`、`feasible_max_weight:48`)、`models.py` 的 `_ensure_holdings_exceed_cap_floor`(:396) | 「50% AI / 50% hedge」案例若只是漂移不足 → 此 stage 的 feasibility 報 `INFEASIBLE_DRIFT`;若需二層袖珍結構 → 屬 allocator 新能力(§3) |
| objective | `objectives.py`(:32、:220)、`dynamic_objective.py`、`experimental_objective_switch.py` | `Objective` enum(`models.py:6-19`)即內建實作清單 |
| rebalance | `portfolio.py` `_trading_day_rebalance_dates:432`、`_rebalance_schedule_dynamic:688`、`_apply_max_turnover:597`;`BacktestRequest.rebalance_freq`(預設 `"QE"`) | |
| cash_schedule | `portfolio.py` `deployment_fraction:41`、`weights.py` `scale_invested_weights:469`、`spec.py` `BacktestSpec.cash_reserve_pct / target_invested_frac`、`BacktestRequest.cash_reserve_pct / deployment_months / deployment_tranches` | 現金報酬模式 `cash_return_mode`(risk_free/zero)亦屬此 stage 設定 |
| reporting | `objectives.py` `needs_attainment:274`、`constrained_customization.py` `build_constrained_proposal_set:536`、`objectives.py` `pick_pareto_proposals:491`、`analytics.py`、`backtest.py` 候選組裝(:1645 `_build_candidate`、:4485 附掛 `needs_attainment`) | |

### 2.5 Registry、Catalog Version 與 Job Record 釘版

#### 2.5.1 Registry

```python
# apps/api/app/engine/stages/registry.py(新增)
@dataclass(frozen=True)
class StageRegistration:
    stage: StageKind
    implementation_id: str
    version: str
    factory: Callable[[], Stage]
    status: Literal["active", "deprecated", "shadow"]  # shadow = 僅對照不生效
    source_pr: str | None          # 引入該實作的 PR 連結(稽核)
    approval_status: Literal["pending_rm_confirmation", "rm_confirmed", "approved"]  # §4.5.4
    pending_supervisor_signoff: bool   # True 直到 L2 主管批次簽核完成
    approved_by: dict[str, str]    # {"rm": "...", "supervisor": "...", "engineer": "...僅例外路徑"}(§4.5)

class StageRegistry:
    def resolve(self, stage: StageKind,
                implementation_id: str | None = None) -> Stage: ...
        # 未指定 → 回傳該 stage 的 active 預設實作
    def catalog(self) -> dict[str, list[StageRegistration]]: ...
    def catalog_version(self) -> str: ...
        # sha256(canonical_json({stage: f"{impl}@{version}" for active impls}))[:16]
        # 先例:scenario_fingerprint.compute_scenario_fingerprint 的 canonical hash 做法
```

#### 2.5.2 Job record 釘版

`BacktestRequest` 不變;在 job 建立時(`apps/api/app/jobs.py` `create_job:131`)由引擎附加:

```python
# BacktestResult(或獨立 job meta)新增欄位
stage_catalog_version: str                 # registry.catalog_version()
stage_implementations: dict[str, str]      # {"universe": "etf_catalog_v1@1.0.0", ...}
param_catalog_version: int                 # 來自 shared/param-catalog.json "version"(現況未釘,補釘)

# 本次 run 實際用到的「非內建」能力(新貢獻實作)逐筆記錄,供 L2 批次簽核與稽核(§4.5.3)
capabilities_used: list[CapabilityUsage]

class CapabilityUsage(BaseModel):
    stage: StageKind
    implementation_id: str
    version: str
    status: Literal["rm_confirmed", "approved"]   # 使用當下的核准狀態(§4.5.4)
    pending_supervisor_signoff: bool              # True = 尚待主管簽核,proposal 須亮徽章
```

使用 `rm_confirmed` 狀態能力的 job 照常產出回測結果(L1 已確認可用);`pending_supervisor_signoff=true` 會隨 job 彙整進 proposal 簽核頁(§4.5.3);主管簽核後翻轉 registry 狀態,歷史 job record 保留使用當下快照、不回寫。

重跑/續跑(`continue_job`,`jobs.py:180`)時:若請求未指定 `stage_implementations`,預設**沿用原 job 釘版**而非最新 active,保證可重現;RM 明確選擇「用最新引擎重跑」才切換(§5.3 一鍵重跑)。

#### 2.5.3 舊 job 相容

`.cache/jobs/*.json` 既有紀錄無上述欄位 → 讀取時(`jobs.py` `_load_completed_job:170` / job_history)視為:

```json
{ "stage_catalog_version": "v0-legacy",
  "stage_implementations": "legacy-monolith" }
```

報告頁顯示「此報告由重構前引擎產出」標記;不嘗試以新 stage 重放舊 job(避免偽造可比性)。

### 2.6 Stage Capability Card(永不過時的引擎文件)

#### 2.6.1 Schema

```python
# stages/base.py(新增)
@dataclass(frozen=True)
class TunableSpec:
    key: str
    kind: Literal["numeric", "categorical", "boolean"]
    bounds: tuple[float, float] | None
    choices: list[str] | None
    default: Any
    overlay_eligible: bool              # 沿用 param_taxonomy 的語意
    description: dict[str, str]         # {"zh": ..., "en": ..., "ko": ...}

@dataclass(frozen=True)
class StageCapabilityCard:
    stage: StageKind
    implementation_id: str
    version: str
    summary: dict[str, str]             # i18n 白話描述
    inputs: list[dict[str, str]]        # [{"name": "mu", "type": "np.ndarray (n,)", "meaning": ...}]
    outputs: list[dict[str, str]]
    tunables: list[TunableSpec]
    invariants: list[str]               # 例如 "sum(w)==1"、"L1(w,anchor)≤drift"、"deterministic given seed"
    since_pr: str | None
```

#### 2.6.2 自動生成

完全沿用 param catalog 的既定管線:

- 生成器:`scripts/export_stage_cards.py`(新增;對照 `scripts/export_param_catalog.py`),用 `inspect.signature` + `typing.get_type_hints` + docstring(`Args:/Returns:/契約` 區段)組裝 `StageCapabilityCard`;tunables 由實作類別的 dataclass 欄位 + `field(metadata={"bounds": ..., "overlay_eligible": ...})` 推得,並與 `_PARAM_CATALOG_META`(`param_taxonomy.py:98`)交叉驗證。
- 產物:`shared/stage-cards.json`(含 `catalog_version`);root `package.json` 新增 `generate-stage-cards` / `sync-stage-cards`(對照現行 `generate-param-catalog` / `sync-param-catalog`),同步至 `apps/web/src/data/stage-cards.json`。
- CI 檢查:若 `stage-cards.json` 與程式碼漂移(PR 改了介面卻沒重新生成)→ CI fail(防止文件過時)。
- 展示位置:
  - 工程/量化頁:`apps/web/src/app/models`(現有模型/引擎區)新增「Engine Capabilities」區塊,逐 stage 顯示卡片。
  - RM 文件頁:新增 `apps/web/src/app/docs/engine/page.tsx`(或整合進 settings/docs 區),zh/en/ko 三語,詞彙對齊 `apps/web/src/lib/i18n.tsx`。

### 2.7 重構順序與 Golden Master 測試

#### 2.7.1 順序(由最自含到最糾纏)

| 次序 | Stage | 理由 |
|---|---|---|
| 1 | **constraints** | `customization.py` / `weights.py` 已是純函式、有完整單測(`apps/api/tests/test_customization_must_include_drift.py`、`test_class_weight_enforcement.py`),最易抽換 |
| 2 | **allocator** | `allocator.py` 介面已乾淨(`solve_weights:218`),已有 `test_allocator_solvers.py` |
| 3 | **objective** | `objectives.py` 純函式;`test_client_needs.py` 護航 |
| 4–8 | reporting → cash_schedule → rebalance → signals → universe | 依序解開 `portfolio.py` / `backtest.py` 的糾纏;universe 最後,因牽涉 web 端 filter 鏈 |

#### 2.7.2 Golden Master(行為不變性保證)

- 測試前置:**重構前**先建立 `apps/api/tests/golden/`(新增):對一組 canonical 請求(見下)記錄 `BacktestResult` 的決定性切片——候選 `weights`(以 `round_weights_largest_remainder` 同精度)、`sharpe/cagr/max_drawdown`、`needs_attainment`、`proposal_set` labels、`stage` 無關欄位。價格資料用既有 fixtures / bundled prices(參考 `test_bundled_prices.py`、`apps/api/tests/fixtures/`)。
- Canonical 請求集:
  1. 標準 Optuna 小型 run(固定 `trials=5`、固定 seed 路徑);
  2. Constrained customization(locked universe + anchor,觸發 `SCENARIO_STYLES` 四情境);
  3. Static replay(`static_replay_holdings`);
  4. 含 `client_context` 全 floor 的 run(觸發 `needs_attainment` 全部分支);
  5. DCA + `cash_reserve_pct > 0` 的 run(對齊 `test_cash_dca.py`)。
- 每抽換一個 stage,跑 `pytest apps/api/tests/golden -k <stage>` 必須全綠才准 merge。
- 決定性注意:Optuna sampler 需固定 seed;AI seed 路徑在 golden 測試中以錄製的 seed pack 取代(參考既有 `test_ai_params_tokens.py` 的離線做法)。

### 2.8 遷移風險計畫

| 風險 | 緩解 |
|---|---|
| 抽換介面時隱性改變數值行為 | golden master(§2.7.2)+ 每 PR 只動一個 stage |
| `backtest.py`(約 4600 行)過大,orchestrator 化過程引入迴歸 | 先加「facade 層」:stage 實作內部仍呼叫原函式,orchestrator 與舊碼並存一個 PR,以 feature flag(`settings.engine_stages_enabled`)切換,對照兩路徑輸出一致後再刪舊路徑 |
| 舊 job 報告頁讀取新欄位崩壞 | §2.5.3 的 `v0-legacy` 映射 + `BacktestResult` 新欄位全部 optional(pydantic 預設 None) |
| 團隊對 8 stage 邊界認知不一 | §2.4 映射表進 repo;capability card 自動生成後,以 RM 文件頁為單一事實來源 |

---

## 3. Phase 1 — Gap 偵測與 Backlog(尚無 AI codegen)

### 3.1 `capability_gap` schema(overlay extract 擴充)

在 `apps/web/src/lib/overlay-schema.ts` 新增(對 `overlayExtractSchema`,:231,為 **optional**,不用時整鍵省略——沿用現有「不確定就省略」政策):

```ts
export const CAPABILITY_GAP_STAGES = [
  "universe", "signals", "allocator", "constraints",
  "objective", "rebalance", "cash_schedule", "reporting",
] as const;

export const capabilityGapSchema = z.object({
  stage: z.enum(CAPABILITY_GAP_STAGES),
  kind: z.enum(["unsupported_lever", "infeasible_combination", "bounds_exceeded"]),
  missing_capability: z.string().min(3).max(80),   // 機讀 key,例如 "two_layer_sleeve_allocation"
  summary: z.string().min(8).max(600),             // RM 可讀,report language
  requested: z.record(z.unknown()),                // 客戶原始需求的結構化摘錄
  nearest_supported: z.record(z.unknown()).optional(), // 目前引擎最接近的可表達方案
  severity: z.enum(["blocking", "degradable"]),
});
// overlayExtractSchema 增加:capability_gaps: z.array(capabilityGapSchema).max(5).optional()
```

同步更新 `overlaySystemPrompt`(`overlay/interpret/route.ts:179`)加入明確出口規則:

> 若客戶需求**無法**用上方白名單欄位(param_adjustments / allocation / universe / optimization)誠實表達,**禁止**硬塞近似映射;改於 `capability_gaps` 發出一筆缺口,並在 `rationale` 以白話說明「目前系統能做到的最接近方案」。

這是「明確退出 vs 強行錯誤映射」的政策落點:**結構性需求缺欄位 → emit gap;只是數值超出 bounds → 先走 §3.3 機械預檢 + 衝突卡,只有 RM 確認仍要才轉 gap(`bounds_exceeded`)**。

### 3.2 何時該 emit(判定樹)

```
LLM 萃取後,逐條 ask / 意圖檢查:
1. 能映射到白名單欄位且值在 bounds 內 → 正常映射,無 gap
2. 能映射但值超界(例:max_single_position_pct 要求 60% > 0.40 上界)
   → 不靜默截斷;先由 §3.3 產生衝突卡;RM 選「仍要」→ gap(kind=bounds_exceeded, stage=constraints)
3. 數學上與其他已確認欄位互斥(例:50/50 二層袖珍 vs customization_drift=0.30)
   → §3.3 預檢判定 INFEASIBLE → 衝突卡;RM 選「提交缺口」→ gap(kind=infeasible_combination)
4. 白名單中根本無對應欄位(例:兩層袖珍各自獨立子配置、個股選擇權覆蓋)
   → 直接 emit gap(kind=unsupported_lever),由 LLM 填 stage + missing_capability + nearest_supported
```

### 3.3 機械式可行性預檢(deterministic,不用 LLM)

新增 `apps/web/src/lib/overlay-feasibility.ts`(BFF 端,純函式,可單測),在 interpret 回傳前對「已確認欄位 + 新需求」做數值預檢。核心案例的數學:

`customization_drift` 語意為單向 L1:`0.5·‖w − anchor‖₁`(見 `customization.py` `l1_turnover_distance:51`)。對「50% AI 袖珍 / 50% 避險袖珍,且兩袖珍與 anchor 完全不重疊」的需求:

```
required_drift = 0.5 · (‖移除的 anchor 質量‖₁ + ‖新增的目標質量‖₁)
              = 0.5 · (1.0 + 1.0) = 1.0        # anchor 為單一 SPY 時
required_drift (1.0) > customization_drift (0.30) → 必然不可行
```

一般化預檢函式:

```ts
// 回傳 minRequiredDrift 與可行性判定
export function minL1DriftForTarget(
  anchor: Record<string, number>,          // 來自 base BacktestRequest.anchor_weights
  targetSleeves: Record<string, number>,   // 需求袖珍目標(0–1,Σ=1)
  sleeveMembership: Record<string, string[]>,
): { minRequiredDrift: number; feasible: boolean; declaredDrift: number }
```

其他現成預檢直接複用 engine 邏輯(在 API 端暴露或在 web 端移植):
- `min_holdings_for_customization`(`customization.py:62`):must-include 數 × cap × drift 的持股數下界;
- `min_holdings_for_cap`(`weights.py:30`)/ `feasible_max_weight`(:48):cap 與持股數的可行性;
- `BacktestRequest._ensure_holdings_exceed_cap_floor`(`models.py:396`):請求層級的既有先例。

### 3.4 RM 衝突對話卡(Conflict Dialog)

預檢失敗時,interpret 回應在 overlay 上附 `conflicts[]`(新欄位,結構同 `clarifications`,見 `overlay-clarifications.ts`),前端渲染為衝突卡:

| 欄位 | 內容(以 50/50 vs drift=30% 為例) |
|---|---|
| 標題 | 「目前的客製化幅度上限無法達成此配置」 |
| 白話說明 | 「您要求與基準完全不同的兩個袖珍(50% AI / 50% 避險),至少需要約 **100%** 的偏離幅度;目前上限為 **30%**,最多只能表達約三成的差異。」 |
| 選項 chips | (a) 提高偏離上限至 100%(本次 run 生效,寫入 `param_controls.customization_drift_actual`);(b) 縮小配置差異(給出 `nearest_supported` 的 30% 版本預覽);(c) 提交「二層配置」能力缺口工單(轉 gap ticket) |
| 鐵律 | **不靜默給半套答案**:三選一之前,該需求不進 `BacktestRequest` |

### 3.5 Gap Ticket 儲存與 Backlog UI

- 儲存:`apps/api/app/gap_tickets.py`(新增),持久化至 `apps/api/.cache/gaps/<ticket_id>.json` + `index.json`(完全比照 jobs cache 的既有模式,見 `.cache/jobs/index.json`)。
- Ticket schema:

```python
class GapTicket(BaseModel):
    ticket_id: str
    fingerprint: str          # sha256(stage + missing_capability + canonical(requested)) → 去重/計數
    stage: StageKind
    kind: Literal["unsupported_lever", "infeasible_combination", "bounds_exceeded"]
    missing_capability: str
    summary_i18n: dict[str, str]
    requested: dict[str, Any]
    nearest_supported: dict[str, Any] | None
    rm_id: str | None
    client_ref: str | None
    overlay_session_id: str
    status: Literal["open", "triaged", "drafted", "in_review", "merged", "rejected"]
    reuse_count: int = 1      # 同 fingerprint 再出現即 +1 → backlog 排序鍵
    created_at / updated_at: str
    linked_pr: str | None     # Phase 2 回填
    behavior_spec_card: dict[str, Any] | None   # Phase 2 回填(§4.5)
```

- API:`POST /gaps`、`GET /gaps?status=&stage=`、`PATCH /gaps/{id}`(狀態機:`open → triaged → drafted → in_review → merged | rejected`;merge 後的能力核准生命週期 `pending_rm_confirmation → rm_confirmed → approved` 記於 registry,見 §4.5.4,不在 ticket 狀態機內),掛於 `apps/api/app/routers/`(新增 `gaps.py`,比照 `routers/jobs.py` 風格)。
- Backlog UI:`apps/web/src/app/gaps/page.tsx`(新增):列表(stage 篩選、`reuse_count` 優先級排序、狀態 badge)、詳情(原始需求、`nearest_supported` 對照、關聯 overlay session 連結)。
- **RM 在對話中看到的**(取代沉默半答案):overlay 摘要卡上出現「⚠ 此需求已記錄為能力缺口 #GAP-XXXX(stage:配置器)。目前的替代方案:……。缺口進入產品 backlog,上線後將通知您。」

---

## 4. Phase 2 — AI 起草 PR(Kimi K3 起草,Gemini 複審)

### 4.1 Stage 貢獻模板:固定檔案配置與「七件套」

每一筆 stage 新實作貢獻(無論 AI 或人類起草)**必須**遵循固定 layout,否則 CI 拒收:

```
apps/api/app/engine/stages/contrib/<stage>/<implementation_id>/
  ├── implementation.py      # (4) 主邏輯:實作對應 Stage Protocol
  ├── config.py              # (1) schema 欄位:pydantic BaseModel,欄位附 bounds/metadata
  ├── feasibility.py         # (3) 機械預檢:回傳 list[StageIssue](對齊 constraints.feasibility 契約)
  ├── attainment.py          # (5) 回報掛鉤:此實作特有的 needs_attainment 補充檢查(可為空)
  ├── card.py                # capability card 覆寫:i18n summary / tunables 說明
  ├── locales.py             # (6) i18n:zh/en/ko 字串,key 前綴 stage.<stage>.<impl>.*
  └── tests/
      ├── test_unit.py       # (7a) 單元測試
      ├── test_properties.py # (7b) property 測試(§4.3)
      └── test_adversarial.py# (7c) 對抗 fixtures(§4.3)
```

「七件套」= (1) schema 欄位、(2) `validate_config`、(3) feasibility、(4) compile/run 主邏輯、(5) attainment 回報、(6) i18n、(7) 測試三件套。模板由 `scripts/new_stage_contribution.py <stage> <impl_id>`(新增)生成骨架;AI 起草時亦以同一骨架為 prompt 上下文,**只准填實作,不准改骨架外的檔案**(diff allowlist,見 §4.3)。

範例:針對「50% AI / 50% hedge」缺口,貢獻為 `stages/contrib/allocator/two_layer_sleeve_v1/`——外層指定袖珍目標權重,內層各袖珍獨立呼叫內建 `slsqp_classic_v1`,最後由 `constraints` stage 的 `project` 做全組合投影(契約不變:L1 漂移仍為最後一道)。

### 4.2 AST Allowlist Sandbox(靜態檢查,非 runtime exec)

新增 `apps/api/tools/ast_policy.py`(或 `scripts/ast_policy.py`):

- 以 `ast.parse` 走訪貢獻程式碼,**允許**:`numpy`、`pandas`、`math`、`dataclasses`、`typing`、engine 公開原語(`app.engine.weights`、`app.engine.stages.base`)。
- **禁止**(命中即 CI fail):`import os/sys/subprocess/socket/requests/httpx`、`open(`、`exec/eval/__import__/compile`、`getattr/setattr` 於 dunder、`while True` 無 break 上界、`random`(隨機性必須來自 `StageContext.seed`)、`scipy` 以外的新第三方依賴(新依賴需另開 PR 審)。
- 不在 job runtime 載入任何 contrib 程式碼:只有 merge 進 main、隨 API 部署後,registry 才看得見新實作(呼應決策 1)。

### 4.3 CI Gates(需新建 CI;repo 目前無 `.github/workflows`)

依序全綠才進入人工審查:

| Gate | 內容 | 既存基礎 |
|---|---|---|
| G1 型別與骨架 | API:`mypy`(或 pyright)對 `stages/**` strict;diff allowlist:只准動 `stages/contrib/<stage>/<impl>/**` 與 registry 註冊檔;Web:`tsc --noEmit` + `next lint`(現有 scripts) | web `lint` script;API 需裝 mypy config |
| G2 單元測試 | `pytest apps/api/tests`(全量)+ contrib 自帶 `test_unit.py` | 既有 60+ 測試檔 |
| G3 自動 property 測試 | 以 hypothesis 對**任何** allocator/constraints 貢獻自動生成:`w_i ∈ [0, cap]`、`sum(w) == 1 ± ε`、`L1(w, anchor) ≤ drift + ε`、`len(nonzero) ≤ max_holdings`、**決定性**(同 seed 兩次輸出逐位相等) | `weights.is_feasible:383`、`audit_weight_cap:119` 可作 oracle |
| G4 對抗 fixtures | 空價格表、單一標的、上市日晚於 start_date、所有 tunable 取極端 bounds、anchor 全零、drift=0 與 drift=1 | 既有測試已有部分案例(如 `test_buy_and_hold_drift.py`) |
| G5 效能預算 | 在 150 檔標的 × 10 年日線的基準面板上,`solve` 單次 < 500ms、整體 canonical run 時間不得超過基線 +20% | `memory_budget.py` 的預算精神延伸 |
| G6 Golden master | §2.7.2 的 canonical 集不得因新實作加入而改變(新實作預設 inactive) | §2.7.2 |
| G7 文件同步 | `stage-cards.json` 重新生成且無漂移(§2.6.2) | `export_param_catalog.py` 先例 |

### 4.4 語意審查迴圈(跨家族複審)

```
GapTicket(status=triaged)
  → [codegen_draft] Kimi K3:依 §4.1 骨架產出七件套 + Behavior Spec Card 草稿
  → [CI G1–G7](即 L0,無人工)失敗 → [codegen_repair] Kimi K3 自修(附 CI log),**上限 3 輪**,仍敗 → status=blocked_ci,退回人類
  → [semantic_review] Gemini Flash:以 gap 的「意圖陳述 + requested 結構」對照 diff 與 spec card,
       輸出報告(intention_alignment: aligned|partial|mismatched + 逐點理由)
       —— aligned:無需工程師介入,直接 merge;partial / mismatched:**例外路徑**,
          須工程師簽核後方可 merge 並進入 L1(§4.5.1)。常態 blocking 閘門仍全是機械 gate(L0)
  → merge(deploy-on-merge,§5.1)→ registry 註冊 active,approval_status=pending_rm_confirmation
  → L1 RM 確認(§4.5.2)→ rm_confirmed + pending_supervisor_signoff=true,可用於回測
  → L2 主管批次簽核(§4.5.3)→ approved,其他 RM 免簽重用
```

### 4.5 三層審核 UX(L0 / L1 / L2)

> **2026-09-03 裁決**:取代原「業務 + 工程雙層、逐 PR blocking」設計。工程師**不再**是每個 PR 的 blocking 審查者——程式碼品質由 L0 機械閘門保證,語意把關由跨家族 semantic review 加工程師例外路徑處理,業務把關由 L1 RM 確認與 L2 主管批次簽核完成。

| 層 | 誰 | 審什麼 | 時點 | 性質 |
|---|---|---|---|---|
| **L0** | 無人(CI) | AST allowlist、property 測試、對抗 fixtures、效能預算、golden master、文件同步(G1–G7,§4.3) | PR 上 | 全機械 blocking |
| **L1** | RM(對話中) | Behavior Spec Card(白話,零程式碼) | merge 部署後、能力啟用前 | blocking:確認後才能用於回測 |
| **L2** | 主管(批次) | 該 proposal 用到的所有新能力 | proposal 生成時 | blocking:簽核前 proposal 亮「含待簽核能力」徽章且不得對客戶送出 |
| 例外 | 工程師 | semantic review 判定 `partial` / `mismatched` 的 PR | merge 前 | 僅例外觸發,非常態 |

#### 4.5.1 L0 機械閘門與工程師例外路徑

- L0 = §4.3 的 G1–G7,全機械、無人工;常態 blocking 閘門全部在此層,避免「AI 審 AI」或「人審程式碼」成為單點。
- semantic review(§4.4)判定:
  - `aligned` → **不需工程師**,直接 merge(deploy-on-merge,§5.1),registry 註冊 `approval_status = pending_rm_confirmation`。
  - `partial` / `mismatched` → **例外路徑**:指定工程師依下列 checklist 審查並簽核,完成前不得 merge、不得進入 L1;簽核紀錄寫入 `approved_by.engineer`。
- 工程師例外審查 checklist(貢獻模板自動附於 PR body):
  - [ ] 符合 AST allowlist(G1 已驗,人工抽查)
  - [ ] 無 runtime IO / network / 隨機性外源
  - [ ] `validate_config` / `feasibility` 對所有 bounds 邊界有分支
  - [ ] attainment 掛鉤不會在 `client_context=None` 時改變既有輸出
  - [ ] i18n key 前綴正確且三語齊全
  - [ ] 效能 profile 截圖/數字附於 PR
  - [ ] Gemini semantic review 報告的 partial/mismatched 項已逐點處理

#### 4.5.2 L1 — RM 確認(Behavior Spec Card,對話中)

能力 merge 部署後**不自動生效**:registry 中為 `pending_rm_confirmation`,orchestrator 拒絕解析給 job 使用。由原 gap 提出 RM(或業務負責人指定之 RM)在 overlay 對話中審閱 Behavior Spec Card 並確認:

| 區塊 | 內容 |
|---|---|
| 需求來源 | 關聯 gap ticket、RM、客戶 ref、原話摘錄 |
| 改了什麼 | 「配置器新增『兩層袖珍配置』能力:可先指定 50% AI / 50% 避險,各袖珍內再各自最佳化」 |
| 變數與上下界 | `sleeve_targets`(各 0–1,Σ=1)、`inner_objective`(enum)、沿用 `max_weight ∈ [0,1]`、`customization_drift ∈ [0,1]` |
| 不變式 | 權重和恆為 1;單一持股不超過上限;偏離基準不超過漂移上限 |
| 前後對比 | canonical 情境表:同一 `BacktestRequest` 在「無此能力 / 有此能力」下的 Sharpe、CAGR、MaxDD、`needs_attainment` 差異(由 CI 自動跑出並嵌入確認畫面) |

RM 確認後:
- registry:`approval_status → rm_confirmed`、`pending_supervisor_signoff = true`、`approved_by.rm` 記名(含時間與版本);
- 能力**立即可用於回測**(job 可解析該實作);
- 每個用到它的 job record 於 `capabilities_used` 逐筆記錄 `status: "rm_confirmed"`、`pending_supervisor_signoff: true`(§2.5.2)。

#### 4.5.3 L2 — 主管批次簽核(proposal 生成時)

- 投資建議書(proposal)生成時,系統收集其所有關聯 job 的 `capabilities_used` 中 `pending_supervisor_signoff = true` 的能力,彙整成**單一簽核頁**:逐能力列出 Behavior Spec Card 摘要、使用次數、涉及 RM/客戶、semantic review 結果。
- 主管**一次批次簽核全部**;簽核後這些能力 `approval_status → approved`、`pending_supervisor_signoff → false`、`approved_by.supervisor` 記名。
- 簽核完成前,proposal 頁面持續顯示「**含待簽核能力**」徽章(列出能力數與名稱);徽章不阻擋 RM 檢視回測結果,但 proposal 不得對客戶送出/匯出(政策開關 `settings.proposal_requires_supervisor_signoff`,預設開)。
- `approved` 的能力**其他 RM 可直接重用,不需再簽**;唯版本變更(同 `implementation_id`、`version` 提升)時重置為 `pending_rm_confirmation`,重走 L1 → L2。

#### 4.5.4 能力核准狀態轉移

```
[PR merged] → pending_rm_confirmation(不可用於 job)
   ──(L1:RM 對話確認 spec card)──▶ rm_confirmed(pending_supervisor_signoff=true,可用於回測)
   ──(L2:主管於 proposal 批次簽核)──▶ approved(其他 RM 免簽重用)
   ──(version 變更)──▶ pending_rm_confirmation(重走 L1 → L2)
semantic review = partial / mismatched → merge 前插入工程師例外簽核,否則不得 merge
```

- 能力核准生命週期記於 **registry**(§2.5.1),不進 gap ticket 狀態機(§3.5);ticket 的 `merged` 僅表示程式碼已進 main。
- 核准紀錄(誰、何時、哪一版)寫入 `StageRegistration.approved_by / source_pr`;job 層級的使用快照見 `capabilities_used`(§2.5.2),歷史快照不因後續簽核而回寫。

### 4.6 模型路由實作(落點:`ai-provider.ts`)

在 `apps/web/src/lib/ai-provider.ts` 新增**任務路由表**(現行 route 各自硬編 `defaultFlashModel()` / `reasoningModel()`,收斂為單一表):

```ts
export type LlmTask =
  | "interpret" | "chat_extract" | "universe_filter" | "scenario_analyze"
  | "param_seeds" | "goals_extract" | "narrate" | "talking_summary"
  | "gap_reasoning" | "codegen_draft" | "codegen_repair" | "semantic_review";

export const LLM_TASK_ROUTING: Record<LlmTask, { modelId: string; jsonMode?: boolean }> = {
  interpret:          { modelId: DEFAULT_FLASH_MODEL_ID, jsonMode: true },
  chat_extract:       { modelId: DEFAULT_FLASH_MODEL_ID, jsonMode: true },
  universe_filter:    { modelId: DEFAULT_FLASH_MODEL_ID, jsonMode: true },
  scenario_analyze:   { modelId: DEFAULT_FLASH_MODEL_ID },
  param_seeds:        { modelId: DEFAULT_FLASH_MODEL_ID, jsonMode: true },
  goals_extract:      { modelId: DEFAULT_FLASH_MODEL_ID, jsonMode: true },
  narrate:            { modelId: KIMI_K3_MODEL_ID },
  talking_summary:    { modelId: KIMI_K3_MODEL_ID },
  gap_reasoning:      { modelId: KIMI_K3_MODEL_ID },              // 高風險推理 → Kimi
  codegen_draft:      { modelId: KIMI_K3_MODEL_ID },              // PR 起草 → Kimi
  codegen_repair:     { modelId: KIMI_K3_MODEL_ID },
  semantic_review:    { modelId: DEFAULT_FLASH_MODEL_ID, jsonMode: true }, // 跨家族複審 → Gemini
};

export function modelForTask(task: LlmTask): LanguageModel { /* env override: LLM_MODEL_<TASK> */ }
```

- 設定/env:沿用 `GEMINI_MODEL` / `MOONSHOT_MODEL` / `MOONSHOT_REASONING_EFFORT`;新增可選的 per-task override `LLM_MODEL_GAP_REASONING` 等;API 端(`apps/api/app/config.py`)對應新增 `codegen_model`(預設 `ai_reasoning_model`,即 kimi-k3)。
- 成本與稽核:所有新任務一律走 `generateTextWithAudit` / `generateObjectWithAudit`(`llm-audit.ts:111/144`)。codegen 發生在 backtest job 之外 → **gap ticket 自帶 `llm_logs` 陣列**(沿用 `LlmAuditEntry` schema),merge 進 ticket JSON;相關 job(例如驗證用 canonical run)仍走 `/jobs/{id}/llm-logs` 既有通道(`routers/jobs.py:130`)。
- 新增 web routes:`/api/gaps/reason`(Kimi,gap 白話推理草稿)、`/api/gaps/[id]/draft`(觸發 codegen 流程)、`/api/gaps/[id]/semantic-review`(Gemini)。

### 4.7 Kimi K3 整合細節與降級

- Provider:web 端走 `@ai-sdk/moonshotai`(`ai-provider.ts:52-56`),`reasoningEffort` 沿用 `KIMI_K3_REASONING_EFFORT`(預設 `"max"`);API 端走 `ai_client.py` 的 moonshot 路徑(`resolve_ai_provider:18`、`moonshot_base_url` 於 `config.py:49`)。
- Token 上限:`codegen_draft` 輸出為完整七件套,需高上限(建議 16k–32k,新 env `MOONSHOT_CODEGEN_MAX_OUTPUT_TOKENS`);`gap_reasoning` 4k;`semantic_review` 走 `FLASH_MAX_OUTPUT_TOKENS`。
- **降級政策(重要,與 narrate 的靜默模板降級不同)**:
  - `codegen_draft` / `codegen_repair`:Kimi 不可用 → **絕不靜默降級 Flash**(高風險產物必須維持指定模型);ticket 轉 `blocked_model_unavailable`,通知業務負責人,恢復後自動重排。
  - `gap_reasoning`:Kimi 不可用 → 以**決定性模板**產生草稿(比照 `narrate/route.ts` `buildFallbackNarrative:90` 的先例),並在 ticket 標記 `draft_source: "template"`,待 Kimi 恢復可重新生成。
  - `semantic_review`:Gemini 不可用 → 佇列等待,不改用 Kimi 自審(避免同家族自審,這是決策 3 的核心)。

---

## 5. Phase 3 — Hot Reload 與迴圈閉合

### 5.1 Catalog hot-reload vs deploy-on-merge —— 建議:**deploy-on-merge**

| 面向 | Hot reload(merge 後 API 動態載入) | Deploy-on-merge(merge → 重新部署生效) |
|---|---|---|
| 可重現性 | 同一 catalog version 可能在不同時間解析到不同程式碼(風險) | catalog version ↔ 部署映像 1:1 |
| 稽核 | 需額外記錄「哪個 process 載入了哪版」 | job record 釘版即充分(§2.5.2) |
| 安全 | 動態 import 擴大攻擊面 | 無 runtime 載入路徑 |
| 速度 | 快(分鐘) | 慢(部署管線,本 repo 規模約 10–20 分鐘) |

**建議 deploy-on-merge**,理由:本產品的 gap→上線週期以「天」計即可接受,而可重現性與稽核是金融情境硬需求。輔助措施:(a) `api:dev:reload`(root `package.json` 既有)在開發環境提供事實上的 hot reload;(b) 生產環境提供「fast-track deploy」runbook,壓縮 merge→deploy 至 < 30 分鐘。

### 5.2 RM 通知與一鍵重跑

- 狀態推播:能力達 `rm_confirmed`(L1 確認完成,§4.5.2)時,以既有 `apps/api/app/notifications.py`(SMTP)寄送 + web 端 RM inbox(badge):「您回報的客戶需求『{summary}』已可表達——能力 `{missing_capability}` 已於引擎版本 {catalog_version} 上線。」(L2 主管簽核狀態不影響 RM 使用,僅影響 proposal 徽章,§4.5.3)
- 一鍵重跑:通知內嵌 deep link → 以原 overlay session 重建 `BacktestRequest`(`overlayToBacktestRequest`,`overlay-schema.ts:847`),`stage_implementations` 釘到新 catalog,走 `POST /jobs` 新 run(而非 `continue`,因能力結構已變);報告頁自動並列「缺口提交時的 nearest_supported 結果 vs 新能力結果」。

### 5.3 重用分析 → 晉升一等公民 UI

- `reuse_count` 與 merged 貢獻的實際使用次數(由 job record 的 `stage_implementations` 回算)進 backlog 儀表板。
- 晉升規則:某貢獻在 N 個不同 RM / M 個 run 中被使用 → 提案晉升為內建 tunable:進 `_PARAM_CATALOG_META`(`param_taxonomy.py:98`,`overlay_eligible=True`)→ 出現在 overlay 白名單與 param catalog → RM 不再走 gap 流程。晉升同樣走 L1 RM 確認 + L2 主管簽核(§4.5)。

---

## 6. 跨階段設計

### 6.1 反幻覺防線總表(哪道閘門攔哪種失敗)

| 失敗模式 | 防線(依序) |
|---|---|
| LLM 憑空發明參數 key / 欄位 | `validateOverlayExtract`(zod,`overlay-schema.ts:280`)+ param catalog 白名單(`overlayParamCatalogBlock`,`interpret/route.ts:148`)|
| LLM 把做不到的需求硬映射到錯參數 | §3.1 明確出口政策 + §3.3 機械預檢 + 衝突卡(人類決策) |
| LLM 憑空發明 ticker | `universe.proposed_tickers` 僅為建議,RM 確認才進池(`interpret/route.ts` system prompt 既有規則);`resolveLockedAddsForOverlay`(`overlay-schema.ts:803`)|
| 敘事數字造假 | `validateNarrative`(`apps/web/src/lib/narrative-validate.ts`)+ 模板降級(narrate route) |
| AI 起草程式碼通過測試但背離意圖 | §4.4 跨家族 semantic review:`partial`/`mismatched` 觸發工程師例外簽核;§4.5 L1 RM 確認 + L2 主管批次簽核 |
| 同家族模型共同盲點 | 決策 3:Gemini 審 Kimi;反向亦適用(若未來 Flash 起草) |
| 新實作數值不穩/不可重現 | G3 property 測試(決定性)+ G6 golden master |
| 新實作拖慢引擎 | G5 效能預算 |
| 文件與實作漂移 | G7 stage-cards 漂移檢查 |
| 舊報告被新引擎「洗版」 | §2.5.2 job 釘版 + §2.5.3 v0-legacy 標記 |

### 6.2 稽核 / 合規故事

- 每個 job record 釘:`stage_catalog_version`、逐 stage `implementation@version`、`param_catalog_version`、`capabilities_used` 逐筆狀態(§2.5.2);llm_logs 全量保留(前後端 schema 已對齊,§1.3)。
- 每個 stage 實作釘:`source_pr`、`approval_status`、`approved_by{rm, supervisor, engineer(僅例外)}`、capability card 版本(§2.5.1、§2.6)。
- 每個 gap ticket 釘:原始 overlay session、requested 結構、codegen 全流程 llm_logs、CI 結果、semantic review 報告、RM 確認與主管簽核紀錄(例外路徑含工程師簽核)。
- 每個 proposal 釘:所用能力的簽核狀態快照(由 `capabilities_used` 彙整),含「含待簽核能力」徽章期間的留存紀錄(§4.5.3)。
- 合規問答可直接從資料回答:「這份報告用了哪些引擎能力、哪個版本、誰核准的、AI 在哪些環節參與」。

### 6.3 失敗模式與緩解

| 模式 | 徵兆 | 緩解 |
|---|---|---|
| Stage 爆炸(實作過多難以維護) | 單一 stage > 5 個 active 實作 | 每 stage active ≤ 3 的軟上限;舊實作轉 `deprecated`;晉升內建後歸檔 contrib |
| 模板剛性(七件套裝不下新想法) | 貢獻者要求改骨架 | 骨架版本化;例外走「Pro-only 自訂 stage」,此類貢獻一律強制工程師簽核(視同 semantic review 恆為 `partial`,不受豁免) |
| 效能迴歸 | canonical run 時間上升 | G5 擋 PR;merged 後以 nightly canonical 基準監控 |
| Flash/Kimi 模型版本漂移 | 同 prompt 輸出分佈改變 | 路由表集中管理模型 id(§4.6);`gap_reasoning` / `semantic_review` 保留 golden prompt 集,升版前先對比;llm-audit 提供 diff 材料 |
| Gap 流程被濫用(什麼都提缺口) | open ticket 暴增 | triage SLA + 業務負責人每週審視;`reuse_count=1` 且 90 天無動靜自動轉 rejected 候選 |
| Kimi 長期不可用 | codegen 停擺 | `blocked_model_unavailable` 佇列可見;允許人類工程師直接接手同一骨架(PR 路徑不變) |

### 6.4 Rollout Checklist 與 PR 拆分(粗估 scope)

> 順序即依賴順序;每個 PR 可獨立 review、獨立 revert。

| PR | 內容 | 粗略 scope | 依賴 |
|---|---|---|---|
| PR-0 | Golden master 基礎:`apps/api/tests/golden/` + canonical 集錄製 | M(測試 only) | — |
| PR-1 | `stages/base.py` + `registry.py` + catalog version + job record 釘版欄位(optional)+ `v0-legacy` 映射 | M | PR-0 |
| PR-2 | constraints stage 抽換(`customization.py`/`weights.py` 包入)+ feature flag | L | PR-1 |
| PR-3 | allocator stage 抽換 | M | PR-2 |
| PR-4 | objective stage 抽換 | M | PR-3 |
| PR-5 | capability card schema + `scripts/export_stage_cards.py` + `sync-stage-cards` + 工程頁/RM 文件頁 | M | PR-1 |
| PR-6 | `capability_gap` schema + system prompt 出口規則 + `overlay-feasibility.ts` 預檢 + 衝突卡 UI | L | 無(可與 PR-2 併行)|
| PR-7 | `gap_tickets.py` + `.cache/gaps` + `/gaps` router + backlog 頁 | M | PR-6 |
| PR-8 | `LLM_TASK_ROUTING` 收斂 + per-task env override + ticket 級 llm_logs | M | PR-7 |
| PR-9 | 七件套骨架生成器 + AST allowlist + CI workflow 建立(G1–G7) | L | PR-1, PR-8 |
| PR-10 | codegen_draft / repair / semantic_review routes + 自修迴圈(上限 3)+ L1 RM 確認 UX(對話式 spec card)+ 工程師例外簽核路徑 | L | PR-9 |
| PR-10b | job record `capabilities_used` + proposal 主管批次簽核頁 + 「含待簽核能力」徽章(§4.5.3) | M | PR-10 |
| PR-11 | merged 通知 + 一鍵重跑 | S | PR-10 |
| PR-12 | 重用分析 + 晉升內建流程 | S | PR-11 |
| PR-13 | 其餘 stage(reporting/cash/rebalance/signals/universe)抽換 + 刪舊路徑與 feature flag | XL(可再拆) | PR-4 |

Checklist(上線前):golden master 全綠 / CI 七道 gate 實測過一次完整貢獻 / RM 確認、主管簽核與工程師例外路徑的帳號與權限設定 / Kimi 不可用演練(降級行為符合 §4.7)/ 稽核問答演練(§6.2 四問皆能從資料回答)。

---

## 7. 模型路由全覽(現行 flow 明確映射 + 理由 + 降級)

| Flow | 位置 | 模型 | 理由(latency / cost / quality) | 失敗降級 |
|---|---|---|---|---|
| overlay interpret(萃取) | `apps/web/src/app/api/overlay/interpret/route.ts:445` | **Gemini Flash** | RM 對話迴圈內,延遲敏感;JSON mode 結構化輸出品質穩;高頻呼叫成本敏感 | `interpretOverlayFallback` 規則降級(`overlay-fallback.ts`,需 `allowOverlayRulesFallback`)或回傳分類錯誤(`overlay-interpret-errors.ts`)|
| overlay chat 後續回合 | 同上(messages 陣列) | **Gemini Flash** | 同上;prior overlay 增量更新屬短推理 | 同上 |
| universe filter | `apps/web/src/app/api/universe/filter/route.ts:86` | **Gemini Flash** | 互動式篩選,需即時回應 | 規則降級(`universe-filter-fallback.ts`)|
| scenario analyze | `apps/web/src/app/api/scenario/analyze/route.ts:38` | **Gemini Flash** | 互動預覽 | 錯誤回傳 |
| param-seeds(web) | `apps/web/src/app/api/param-seeds/route.ts:111` | **Gemini Flash** | 結構化種子,JSON 輸出 | 錯誤回傳 |
| goals extract / segment / insights | `apps/web/src/app/api/goals/*/route.ts` | **Gemini Flash** | 對話式萃取,延遲敏感 | 各 route 既有降級 |
| narrate(回測解讀) | `apps/web/src/app/api/narrate/route.ts:76` | **Kimi K3** | 非互動、長文、推理重(`reasoningEffort=max`);`validateNarrative` 把關數字 | 重試 1 次 → 模板 `buildFallbackNarrative`(標 `source:"template"`)|
| talking-summary / candidate-summary / candidate-compare-summary | 各 route.ts | **Kimi K3** | 非互動摘要類,品質優先 | 模板/錯誤回傳(依各 route)|
| 後端 Pro round seeds / AI param seeds | `apps/api/app/engine/ai_params.py` 經 `ai_client.py` | **Gemini Flash**(`settings.gemini_model`) | 引擎迴圈內,每輪多次呼叫,延遲與成本敏感;`ai-provider.ts` 註記「Kimi 不進即時 overlay confirm 路徑」 | `gemini_param_seed_max_retries`(`config.py:85`)|
| **gap_reasoning**(新) | `/api/gaps/reason`(新增) | **Kimi K3** | 低頻高風險:要把客戶需求推理成缺口結構與 spec card 草稿 | 決定性模板草稿 + `draft_source:"template"`(§4.7)|
| **codegen_draft / codegen_repair**(新) | `/api/gaps/[id]/draft`(新增) | **Kimi K3** | 最高風險產物(程式碼),用推理最強者;高 token 上限 | **不靜默降級**;ticket `blocked_model_unavailable`(§4.7)|
| **semantic_review**(新) | `/api/gaps/[id]/semantic-review`(新增) | **Gemini Flash** | 跨家族複審(決策 3);`aligned` 免工程師、`partial`/`mismatched` 觸發例外簽核(§4.5.1);不需最強推理,JSON 報告穩定即可 | 佇列等待,不改由 Kimi 自審 |

路由表集中於 `apps/web/src/lib/ai-provider.ts`(§4.6),模型 id 由 env 可覆寫,所有呼叫經 `llm-audit.ts` 留痕。

---

## 8. 開放問題(待使用者裁決)

1. **`capability_gap` 的 stage 歸屬判定**:由 LLM 在 extract 時填 `stage` 欄位(可能判錯),還是由 web 端規則依 `missing_capability` 映射?建議:LLM 填 + 規則校驗(不在 8 個 stage 列舉內 → 退回 `clarifications` 追問)。
2. **衝突卡選項 (a)「本次提高漂移上限」是否需要第二人核准**:單一 RM 即可覆蓋 `customization_drift` 至 1.0,或超過某閾值(如 0.6)需主管核准留痕?涉及合規政策,需業務負責人決定。
3. **Behavior Spec Card 的 canonical 情境集**:§2.7.2 五個情境是否足夠代表 RM 客戶書的常見形態?建議由業務負責人補 2–3 個真實客戶案例(去識別化)。
4. ~~**semantic_review 的 advisory 定位**~~ **已裁決(2026-09-03)**:semantic review 不再只是 advisory——`aligned` 時無需工程師介入;`partial` / `mismatched` 時**強制工程師簽核**,完成前不得 merge、不得進入 L1(§4.5.1)。同次裁決將原「業務 + 工程雙層逐 PR 審查」改為 **L0 機械閘門 → L1 RM 確認 → L2 主管批次簽核**(§4.5),工程師不再是逐 PR blocking 審查者。
5. **API 端是否也要引入 Kimi codegen**:Phase 2 的 codegen 全部走 web BFF 發起。若未來要讓 API 在 nightly 自動對 backlog 起草,需要 `ai_client.py` 補上與 web 對齊的任務路由(目前只有 `default_ai_model` / `reasoning_ai_model` 兩檔)。
6. **stage-cards 的 ko 語系來源**:自動生成只能產出英文骨架,zh/ko 需人工或 LLM 補譯;翻譯是否也需走審核(它們是 RM/稽核可見文件)?
