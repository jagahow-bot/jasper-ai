# Overlay 確認連動客製化偏離滑桿（Drift Slider Sync）施工說明書

> **版本**:0.1（施工前設計定稿）
> **狀態**:Ready for implementation — 尚未落地
> **日期**:2026-09-04
> **讀者**:Web/BFF 工程師、RM 產品負責人、合規/稽核
> **相關文件**:[`docs/design/pipeline-stage-plugin-architecture.md`](./pipeline-stage-plugin-architecture.md)（§3.3 機械可行性預檢、§8 drift override 政策）
> **適用程式碼**:`apps/web`（Next.js 15 BFF + UI）；**不動** `apps/api` 引擎

---

## 1. 目標與範圍

### 1.1 問題陳述

`customization_drift` 滑桿（RM 設定的「客製化空間上限」）與 Overlay 對話捕捉到的結構化需求（`sleeve_targets`、`group_weight_band` asks）目前**各自獨立**。典型事故路徑：

1. RM 滑桿停在預設 50%（或更低，如 30%）。
2. 客戶在 Overlay 對話中要求「AI 衛星 45% + 避險 35%」——此配置相對錨點的單向 L1 偏離約需 40–80%。
3. Overlay 簽核通過（衝突卡只在 `attachMechanicalOverlayConflicts` 偵測到 AI+避險二層意圖時才出現；一般主題袖珍或 band ask **不一定觸發**衝突卡）。
4. 進入 RmRunPanel，滑桿仍是 30%。引擎在 30% 漂移球內求解，**靜默給出打折的答案**——袖珍目標達不到，RM 與客戶都不知道。

### 1.2 目標（本功能要做的）

| # | 目標 | 說明 |
|---|---|---|
| G1 | **確認時自動對齊** | Overlay 確認（`onOverlayConfirm`）時，用既有 `minL1DriftForTarget` 算出 `minRequiredDrift`；若滑桿值不足，自動調升至滑桿步進（5%）無條件進位值，並顯示通知。 |
| G2 | **對話中即時提示** | Overlay 對話進行中，摘要卡下方即時顯示「此 Overlay 至少需要 X% 偏離（目前 Y%）」。 |
| G3 | **滑桿視覺標記** | RmRunPanel 的 drift 滑桿軌道上標出 Overlay 最低需求位置與「不足區間」。 |
| G4 | **調降需確認** | RM 可自由調**升**；調**降至低於 Overlay 最低需求**時，需明確確認（不靜默、不阻擋）。 |
| G5 | **主管門檻一致** | 建議值 > 60%（`DRIFT_OVERRIDE_RM_MAX`）時沿用 §8 政策：標示「需主管核准留痕」、寫入 audit，但**不阻擋** RM 繼續（與現有衝突卡行為一致）。 |
| G6 | **留痕** | 簽核時把 drift 同步結果寫入 overlay audit（`drift_sync` 欄位），供稽核查閱。 |

### 1.3 非目標（Explicit Non-Goals）

- **不改引擎**：`apps/api` 的 `project_anchor_l1_drift`、`needs_attainment`、Optuna 路徑完全不動。本功能純前端/BFF。
- **不阻擋執行**：低於最低需求時只警告 + 要求確認，不 disable「開始試算」按鈕。
- **不實作主管審批工作流**：>60% 僅標示與留痕；真正的 supervisor sign-off 流程沿用既有 capability approval 機制，不在本範圍。
- **不改變 INFEASIBLE_DRIFT 衝突卡**的觸發條件與文案（§10.1 說明兩者分工）。
- **不自動調降**：滑桿高於需求時保持原值（RM 可能故意留 headroom），永不自動往下調。
- **不處理二層袖珍結構**本身（`UNSUPPORTED_TWO_LAYER` 仍是既有衝突卡的責任）。

---

## 2. 現況分析

### 2.1 現行資料流

```
RM 對話 → POST /api/overlay/interpret (apps/web/src/app/api/overlay/interpret/route.ts:378)
  → wrapExtractAsOverlay (overlay-schema.ts:451)
  → attachMechanicalOverlayConflicts (overlay-feasibility.ts:509)
      └─ declaredDrift = body.customization_drift（來自 OverlayConversationPanel prop）
      └─ 僅在「AI+避險二層意圖」或「顯式主題 sleeve_targets」且不可行時
         才推入 INFEASIBLE_DRIFT 衝突卡
RM 按「確認調整方案並簽核」
  → OverlayConversationPanel.handleConfirm (OverlayConversationPanel.tsx:400)
  → signOffOverlay (overlay-schema.ts:1231)
  → page.tsx onOverlayConfirm (apps/web/src/app/page.tsx:911)
      └─ resolveOverlayUniverse → overlayToBacktestRequest (overlay-schema.ts:1095)
           └─ 錨定客製化時把 customization_drift_actual 釘為
              { mode:"fixed", fixed: base.customization_drift ?? 0.5 }
              （overlay-schema.ts:1114-1130）
      └─ setRequest(resolved); setPhase("constraints")
RmRunPanel (constraints 階段)
  → drift 滑桿直接讀寫 request.customization_drift（RmRunPanel.tsx:131-155）
  → 與 overlay 內容無任何連動
```

### 2.2 斷點（disconnect 發生處）

| 斷點 | 位置 | 現況 |
|---|---|---|
| D1 | `onOverlayConfirm`（page.tsx:911-941） | 簽核後直接採用 `request.customization_drift` 現值；從不檢查 Overlay 目標需要多少漂移。 |
| D2 | RmRunPanel 滑桿（RmRunPanel.tsx:131-155） | 純 `input[type=range]`，無最低需求標記、無調降警告。 |
| D3 | 對話期間（OverlayChatTimeline.tsx:331-340 摘要卡） | 摘要卡只列 `formatOverlaySummary` 文字；RM 在簽核前看不到「此需求需要多少偏離」。 |
| D4 | 衝突卡覆蓋率 | `attachMechanicalOverlayConflicts` 只涵蓋二層 AI+避險與顯式主題 sleeve_targets；`group_weight_band` asks、`ticker_min`（must_include 類）需求**不會**觸發漂移衝突卡，是最常見的靜默打折來源。 |

### 2.3 可直接複用的現有機制

| 機制 | 位置 | 複用方式 |
|---|---|---|
| `minL1DriftForTarget(anchor, targetSleeves, sleeveMembership, declaredDrift)` | overlay-feasibility.ts:83 | 核心 L1 計算，原樣呼叫。 |
| `anchorWeightsFromPositions(positions)` | overlay-feasibility.ts:306 | 從 `{ticker, weightLabel}` 解析錨點權重（對話面板已有此資料形狀）。 |
| `DRIFT_OVERRIDE_RM_MAX = 0.6` / `driftOverrideApproval()` | overlay-feasibility.ts:13, 281 | 主管門檻判定，不重複定義。 |
| `groupWeightBandsFromOverlay(overlay)` | overlay-schema.ts:879 | 把 signed band asks + 主題 sleeve_targets 編譯成 `GroupWeightBand[]`（含主題→ticker 解析）；需加 `includeUnsigned` 選項供對話期間使用（§5.6）。 |
| `bandTargetFromAsk(ask)` | overlay-schema.ts:870 | ask → 目標 pct 的既有規則（target → (min+max)/2 → min → max）；需 export。 |
| `onRaiseDrift` prop 鏈 | page.tsx:1182 → OverlayConversationPanel | 衝突卡「提高偏離」已會回寫 `request.customization_drift`；自動調升走同一欄位。 |
| `createJob` 剝除 UI-only 欄位 | api.ts:131-141 | `top_n` / `refinement_patience` 先例；新 UI-only 欄位比照刪除。 |

---

## 3. 核心計算邏輯

### 3.1 新模組 `apps/web/src/lib/overlay-drift-sync.ts`

純函式、無 React、無 LLM——與 `overlay-feasibility.ts` 同級的 deterministic 模組。

### 3.2 型別定義

```ts
import type { ClientOverlay } from "@/lib/overlay-schema";
import type { AnchorPositionLike } from "@/lib/overlay-feasibility";

/** RmRunPanel / ConstraintsPanel 滑桿步進（5%）。 */
export const DRIFT_SLIDER_STEP = 0.05;

/** must_include 類 ask 未給 pct 時，每檔新標的的保守漂移估計（見 3.3.4）。 */
export const MUST_INCLUDE_DRIFT_ESTIMATE = 0.01;

export type OverlayDriftSourceKind =
  | "sleeve_targets"
  | "group_weight_band"
  | "must_include"
  | "narrative";

export type OverlayDriftSource = {
  kind: OverlayDriftSourceKind;
  /** 袖珍 key、ask id、或 ticker（顯示用）。 */
  ref: string;
  /** 該來源「單獨」所需的單向 L1 漂移（0..1，顯示用；總值 ≠ 加總，見 3.3.6）。 */
  requiredDrift: number;
};

export type OverlayDriftHints = {
  /** 表達此 Overlay 所需的原始單向 L1 下限（0..1）。 */
  minRequiredDrift: number;
  /** minRequiredDrift 對滑桿步進無條件進位（0..1）— 自動調升使用的值。 */
  suggestedDrift: number;
  /** suggestedDrift + 一個步進的最佳化 headroom，上限 1（顯示建議用）。 */
  headroomDrift: number;
  /** currentDrift 是否已 ≥ minRequiredDrift（含 1e-9 容差）。 */
  feasible: boolean;
  /** 貢獻來源，依 requiredDrift 降冪；narrative 或無需求時為 []。 */
  sources: OverlayDriftSource[];
  /** suggestedDrift > DRIFT_OVERRIDE_RM_MAX（§8 主管門檻）。 */
  requiresSupervisor: boolean;
};
```

### 3.3 `computeOverlayDriftHints()` 函式規格

```ts
export function computeOverlayDriftHints(
  overlay: ClientOverlay | null | undefined,
  opts: {
    /** 錨點權重（優先）。RmRunPanel 由 anchorPortfolio.holdings 直接組。 */
    anchorWeights?: Record<string, number> | null;
    /** 錨點持倉（次要，走 anchorWeightsFromPositions 解析 weightLabel）。 */
    anchorPositions?: AnchorPositionLike[] | null;
    /** 目前滑桿值；預設 0.5（與 buildDefaultRequest 一致）。 */
    currentDrift?: number;
  } = {},
): OverlayDriftHints;
```

#### 3.3.1 前置處理

1. `overlay` 為 null/undefined → 回傳零值 hints（`minRequiredDrift: 0, suggestedDrift: 0, headroomDrift: DRIFT_SLIDER_STEP, feasible: true, sources: [], requiresSupervisor: false`）。
2. 錨點解析：`anchorWeights` 優先；否則 `anchorWeightsFromPositions(anchorPositions)`。解析後 `Object.keys(anchor).length === 0` → 同樣回傳零值 hints（無錨點時漂移約束本就不啟動，提示無意義）。
3. `currentDrift` 正規化：`Number.isFinite` 否則 0.5，再 clamp 到 [0,1]。

#### 3.3.2 優先序 waterfall（重要：取第一個有訊號的層級，不跨層加總）

依序評估，**第一個算出正需求（>0）的層級即為 `minRequiredDrift` 的依據**，不再往下評估：

| 優先 | 來源 | 觸發條件 |
|---|---|---|
| 1 | `sleeve_targets` | `overlay.allocation.sleeve_targets` 有非 `w_` 前綴且 >0 的主題 key |
| 2 | `group_weight_band` | 有帶 pct 的 band ask（含未簽核，`includeUnsigned: true`） |
| 3 | `must_include` 估計 | `ticker_min` / `direct_index` ask 帶 tickers |
| 4 | `narrative` | 以上皆無 → `minRequiredDrift = 0`、`sources = []` |

**為什麼是 waterfall 而非取 max**：`groupWeightBandsFromOverlay` 本身已把主題 `sleeve_targets` 編譯進 bands（overlay-schema.ts:933-948）；若兩層都算再取 max，同一意圖會被重複計算。waterfall 保證每個客戶意圖只貢獻一次。

#### 3.3.3 層級 1：`sleeve_targets`

從 `attachMechanicalOverlayConflicts`（overlay-feasibility.ts:556-580）抽出共用 helper（§3.4），邏輯不變：

- 取 `sleeve_targets` 中非 `w_` 前綴、數值 >0 的 entries 作為 `targetSleeves`。
- `membership[key]` = 錨點以外的 supplement + proposed + band-ask tickers（`uniqTickers` 後過濾 anchor）；若池為空則退回 `Object.keys(anchor)`（與現況一致）。
- 呼叫 `minL1DriftForTarget(anchor, targetSleeves, membership, currentDrift)`，取 `minRequiredDrift`（即 `oneWayTurnover`）。
- `sources`：對每個袖珍 key 各呼叫一次 `minL1DriftForTarget`（單袖珍）取得 `requiredDrift`，`ref` = 袖珍 key。

#### 3.3.4 層級 2：`group_weight_band`

- `bands = groupWeightBandsFromOverlay(overlay, { includeUnsigned: true })`（§5.6 新增選項；預設行為不變）。
- 每個 band → 一個袖珍：`targetSleeves[band.group_id ?? `band-${i}`] = band.target_pct ?? (min+max)/2 ?? min ?? max`（即 `bandTargetFromAsk` 規則；`groupWeightBandsFromOverlay` 已保證 target 存在且 >0），`membership[...] = band.tickers`。
- 同 3.3.3 呼叫 `minL1DriftForTarget`；`sources` 的 `ref` = `band.group_id ?? ask.id`。

#### 3.3.5 層級 3：`must_include` 估計

引擎的 must_include floor 是「極小正權重」（`apps/api/app/engine/customization.py:190` `apply_must_include_floor`，floor ≈ `min_weight`，預設 0.005）。因此估計規則：

```
對每個 kind ∈ {ticker_min, direct_index} 且帶 tickers 的 ask：
  對每個 ticker ∉ anchor：
    w = ask.min_pct ?? ask.target_pct ?? MUST_INCLUDE_DRIFT_ESTIMATE  // 0.01
    累加 w
minRequiredDrift = min(1, 累加值)
```

原理：加入一檔錨點外權重 w 的標的，單向 L1 漂移恰好 = w（新增質量 = 需移除的錨點質量）。`sources` 的 `ref` = ticker，`requiredDrift` = 該 ticker 的 w。

#### 3.3.6 層級 4：`narrative`

純敘述（themes / narrative_summary / rationale）無法機械量化 → `minRequiredDrift = 0`、`sources = []`。文件化此限制：**narrative-only 的需求不會產生提示**，RM 需自行判斷（與現況相同，不退化）。

#### 3.3.7 取整、headroom、旗標

```ts
const minRequired = Math.min(1, Math.max(0, rawMin));
const suggestedDrift =
  minRequired <= 0
    ? 0
    : Math.min(1, Math.ceil((minRequired - 1e-9) / DRIFT_SLIDER_STEP) * DRIFT_SLIDER_STEP);
const headroomDrift = Math.min(1, suggestedDrift + DRIFT_SLIDER_STEP);
const feasible = current + 1e-9 >= minRequired;
const { requiresSupervisor } = driftOverrideApproval(suggestedDrift);
```

- **為什麼進位到 5% 而非 1%**：滑桿 `step={5}`（RmRunPanel.tsx:142）；自動調升到非步進值會讓滑桿顯示與實值不一致。注意 `buildInfeasibleDriftConflict`（overlay-feasibility.ts:127）用 1% 進位是給衝突卡文案的，兩者用途不同，**不統一**（§10.1）。
- `requiresSupervisor` 一律由 `driftOverrideApproval(suggestedDrift)` 得出，不重寫門檻邏輯。

### 3.4 `overlay-feasibility.ts` 抽出的共用 helper

把 `attachMechanicalOverlayConflicts` 內 556-580 行的主題袖珍計畫邏輯抽出 export，**行為不變**（既有測試 overlay-feasibility.test.ts 全數維持通過）：

```ts
export type ThemeSleevePlan = {
  targetSleeves: Record<string, number>;
  membership: Record<string, string[]>;
};

/** 從 overlay 的顯式主題 sleeve_targets（非 w_*）建立 L1 計畫；無則 null。 */
export function themeSleevePlanFromOverlay(overlay: ClientOverlay): ThemeSleevePlan | null;
```

`attachMechanicalOverlayConflicts` 的 `else if` 分支（overlay-feasibility.ts:556）改呼叫此 helper。

### 3.5 同步決策 helper

```ts
export type DriftSyncAction =
  | { kind: "none" }                                  // 滑桿已 ≥ suggested
  | { kind: "raise"; from: number; to: number; requiresSupervisor: boolean };

/** 確認 Overlay 時呼叫：只升不降。 */
export function driftSyncActionForConfirm(
  hints: OverlayDriftHints,
  currentDrift: number,
): DriftSyncAction;
```

- `hints.suggestedDrift > currentDrift + 1e-9` → `{ kind: "raise", from, to: hints.suggestedDrift, requiresSupervisor }`
- 否則 `{ kind: "none" }`（**永不回傳調降**——G6/非目標）。

---

## 4. UX 流程

### 4.1 對話中：即時提示（OverlayConversationPanel / OverlayChatTimeline）

**觸發**：每次 `overlay` state 更新（每個 interpret 回合後）。
**計算**：`useMemo(() => computeOverlayDriftHints(overlay, { anchorPositions, currentDrift: customizationDrift }), [overlay, anchorPositions, customizationDrift])`。
**呈現**：摘要卡（OverlayChatTimeline.tsx:331-340）下方插入提示列；`minRequiredDrift <= 0` 時不渲染。

```
┌─ OVERLAY 摘要 ─────────────────────────────────┐
│ 市場觀點：偏多 — AI 成長搭配避險…                │
│ 槽位目標：主題 45% · 防禦 35%                    │
│ 信心度：82%                                      │
├──────────────────────────────────────────────────┤
│ ⚠ 偏離需求：此 Overlay 至少需要 45% 客製化偏離    │
│   （目前上限 30%）— 確認時將自動調升至 45%        │   ← feasible=false，琥珀色
└──────────────────────────────────────────────────┘

（已足夠時改顯示綠色一行）
│ ✓ 偏離上限已足夠（需求 25% ≤ 目前 30%）          │

（suggestedDrift > 60% 時追加）
│ ⚠ 建議值 65% 超過 60%，需主管核准留痕             │
```

### 4.2 確認 Overlay 時：自動調升 + 通知（page.tsx `onOverlayConfirm`）

逐步：

1. `signOffOverlay` → `onConfirm(signed)` 進入 page.tsx `onOverlayConfirm`（page.tsx:911）。
2. `resolveOverlayUniverse` 回傳 `resolved` 後：
   a. `anchorWeights = Object.fromEntries(anchorPortfolio.holdings.filter(h => h.weight > 0).map(h => [h.ticker.toUpperCase(), h.weight]))`。
   b. `hints = computeOverlayDriftHints(finalized, { anchorWeights, currentDrift: resolved.customization_drift ?? 0.5 })`。
   c. `action = driftSyncActionForConfirm(hints, resolved.customization_drift ?? 0.5)`。
   d. `action.kind === "raise"` 時：
      - `resolved.customization_drift = action.to`
      - **關鍵**：若 `resolved.param_controls?.customization_drift_actual?.mode === "fixed"`，同步把 `fixed` 改為 `action.to`——否則 `overlayToBacktestRequest` 釘的 fixed 值（overlay-schema.ts:1122-1129）會蓋過調升（§10.4）。
      - `resolved.overlay_drift_floor = hints.minRequiredDrift`（新 UI-only 欄位，§5.8）。
      - `setDriftSyncNotice({ from: action.from, to: action.to, requiresSupervisor: action.requiresSupervisor })`。
   e. `finalized = attachDriftSyncAudit(finalized, hints, resolved.customization_drift)`（§5.6 留痕）。
3. `setRequest(resolved); setPhase("constraints")`（既有行為）。
4. 進入 RmRunPanel，頂部顯示可關閉通知條：

```
┌──────────────────────────────────────────────────────────┐
│ ✓ 已依 Overlay 需求將客製化偏離從 30% 自動調升至 45%。     │
│   （來源：主題袖珍 45%）                            [×]   │
└──────────────────────────────────────────────────────────┘
（requiresSupervisor 時改琥珀色：「…調升至 65%。超過 60%，
  需主管核准留痕。」）
```

### 4.3 RmRunPanel 限制階段：滑桿標記 + 警告 + 調降確認

**計算**：`hints = useMemo(() => computeOverlayDriftHints(overlay, { anchorWeights, currentDrift: request.customization_drift ?? 0.5 }), [overlay, anchorPortfolio, request.customization_drift])`。

**滑桿標記**（`hints.minRequiredDrift > 0` 時渲染）：滑桿下方加一條「尺規」列，避免跨瀏覽器 `input[type=range]` track 偽元素樣式問題：

```
客製化空間（上限）：45%
├─────────────────────●──────────────────────────┤  ← 原生滑桿（不動）
╺━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╸  ← 尺規列（新增 div）
          ▲ Overlay 最低需求 45%
          └ 0→45% 區段以琥珀色底標示
```

尺規實作：`relative` 容器 div（`h-1.5 rounded bg-[var(--border)]`），內含：
- 不足區間：`absolute inset-y-0 left-0`、寬度 `minRequiredDrift*100%`、`bg-amber-300/60`（feasible 時改 `bg-emerald-300/50`）。
- 標記線：`absolute -top-1 -bottom-1 w-0.5 bg-amber-500`，`left: calc(X% )` + `transform: translateX(-50%)`。
- 標籤：`text-[10px] text-dim`，`t("rm.run.driftFloorMarker", { pct })`。

**低於下限警告**（`!hints.feasible` 時，滑桿下方）：

```
⚠ 目前上限 30% 低於 Overlay 最低需求 45%——主題袖珍 45% 等目標將無法完整達成。
```

**調降確認**：滑桿 `onChange` 攔截——新值 `< hints.minRequiredDrift - 1e-9` 且舊值 ≥ 下限時，不立即 `onChange`，改設 `pendingLowerValue` state，滑桿下方顯示行內確認列：

```
┌──────────────────────────────────────────────────────────┐
│ 調降至 25% 將低於 Overlay 最低需求 45%，部分配置目標會      │
│ 無法達成。確定要調降嗎？                                   │
│                                    [確定調降] [取消]       │
└──────────────────────────────────────────────────────────┘
```

- 「確定調降」→ `onChange({ ...request, customization_drift: pendingLowerValue })`、清空 state。
- 「取消」→ 清空 state，滑桿維持原值。
- 已在下限以下繼續往下拖（新舊值都 < 下限）→ 不再重複詢問，直接放行（避免連拖連彈）。

**主管徽章**：`hints.requiresSupervisor` 時在滑桿 label 右側顯示 `pixel-badge pixel-badge-warn`：`t("rm.run.driftSupervisorBadge")`（「>60% 需主管核准」）。

---

## 5. 檔案變更清單

| # | 檔案 | 變更 | 估計規模 |
|---|---|---|---|
| F1 | `apps/web/src/lib/overlay-drift-sync.ts` | **新增**：§3 全部 | ~200 行 |
| F2 | `apps/web/src/lib/overlay-drift-sync.test.ts` | **新增**：§7 測試 | ~250 行 |
| F3 | `apps/web/src/lib/overlay-feasibility.ts` | 抽出並 export `themeSleevePlanFromOverlay`（§3.4）；`attachMechanicalOverlayConflicts` 改呼叫之 | +30 / −25 行 |
| F4 | `apps/web/src/lib/overlay-schema.ts` | ① `groupWeightBandsFromOverlay` 加 `opts?: { includeUnsigned?: boolean }`；② export `bandTargetFromAsk`；③ audit schema 加 `drift_sync` + `attachDriftSyncAudit()` | ~60 行 |
| F5 | `apps/web/src/lib/types.ts` | `BacktestRequest` 加 `overlay_drift_floor?: number \| null`（UI-only） | ~6 行 |
| F6 | `apps/web/src/lib/api.ts` | `createJob` 剝除 `overlay_drift_floor`（比照 `top_n` 先例） | ~2 行 |
| F7 | `apps/web/src/app/page.tsx` | `onOverlayConfirm` 自動調升 + `driftSyncNotice` state + 傳給 RmRunPanel | ~45 行 |
| F8 | `apps/web/src/components/OverlayConversationPanel.tsx` | 計算 hints、傳 `driftHint` 給 timeline | ~15 行 |
| F9 | `apps/web/src/components/OverlayChatTimeline.tsx` | 新增 `driftHint` prop、摘要卡下渲染提示列 | ~35 行 |
| F10 | `apps/web/src/components/RmRunPanel.tsx` | 通知條、尺規標記、低於下限警告、調降確認列、主管徽章 | ~120 行 |
| F11 | `apps/web/src/components/ConstraintsPanel.tsx` | 新增可選 `driftFloorHint?: OverlayDriftHints \| null` prop；有值且滑桿可見時渲染同款尺規（非 RM 路徑一致性） | ~40 行 |
| F12 | `apps/web/src/lib/i18n.tsx` | §6 全部文案（en/zh/ko 三處） | ~3×15 行 |

> 註：F9（OverlayChatTimeline.tsx）是摘要卡的實際渲染處，原規劃清單未列出但無法避免——提示列要「長在摘要卡下方」就必須改它。

### F3 — overlay-feasibility.ts 細節

```ts
// 新增 export（邏輯自 attachMechanicalOverlayConflicts 556-580 行原樣抽出）
export function themeSleevePlanFromOverlay(
  overlay: ClientOverlay,
): ThemeSleevePlan | null {
  const sleeves = overlay.allocation.sleeve_targets;
  if (!sleeves) return null;
  const themeEntries = Object.entries(sleeves).filter(
    ([k, v]) => !k.startsWith("w_") && Number(v) > 0,
  );
  if (!themeEntries.length) return null;
  // membership 解析邏輯與現況相同（supplement ∪ proposed ∪ band-ask tickers，
  // 過濾 anchor；空池退回 anchor keys）
  ...
}
```

`attachMechanicalOverlayConflicts` 的 `else if (overlay.allocation.sleeve_targets && ...)` 分支改為：

```ts
} else if (Object.keys(anchor).length > 0) {
  const plan = themeSleevePlanFromOverlay(overlay);
  if (plan) {
    const check = minL1DriftForTarget(anchor, plan.targetSleeves, plan.membership, declaredDrift);
    if (!check.feasible && !hasCode("INFEASIBLE_DRIFT")) {
      conflicts.push(buildInfeasibleDriftConflict(check, { lang }));
    }
  }
}
```

### F4 — overlay-schema.ts 細節

```ts
// ① includeUnsigned（預設 false → 引擎路徑行為完全不變）
export function groupWeightBandsFromOverlay(
  overlay: ClientOverlay,
  opts?: { includeUnsigned?: boolean },
): GroupWeightBand[] {
  const signedOff = Boolean(overlay.audit.rm_sign_off);
  const includeUnsigned = opts?.includeUnsigned ?? false;
  ...
  for (const ask of overlay.asks ?? []) {
    if (ask.kind !== "group_weight_band") continue;
    if (!includeUnsigned && !signedOff && ask.status !== "signed") continue;  // 原條件加 includeUnsigned 短路
    ...
  }
}

// ② export 既有函式
export function bandTargetFromAsk(ask: OverlayAsk): number | null { ... }  // 870-876 行原樣加 export

// ③ audit 留痕
export const overlayDriftSyncAuditSchema = z.object({
  min_required_drift: z.number().min(0).max(1),
  applied_drift: z.number().min(0).max(1),
  auto_raised: z.boolean(),
  requires_supervisor: z.boolean(),
  sources: z.array(z.object({
    kind: z.enum(["sleeve_targets", "group_weight_band", "must_include", "narrative"]),
    ref: z.string().max(80),
    required_drift: z.number().min(0).max(1),
  })).max(12).optional(),
  synced_at: z.string(),
}).strip();

// overlaySessionAuditSchema 內加：
//   drift_sync: overlayDriftSyncAuditSchema.optional(),

export function attachDriftSyncAudit(
  overlay: ClientOverlay,
  hints: OverlayDriftHints,
  appliedDrift: number,
): ClientOverlay;  // 寫入 audit.drift_sync + 更新 updated_at；auto_raised = appliedDrift > 確認前滑桿值
```

zod object 預設 strip unknown keys，舊的已存 overlay（localStorage 歷史）沒有 `drift_sync` 也能正常 parse（optional）。

### F5 / F6 — types.ts 與 api.ts

```ts
// types.ts — BacktestRequest 內，customization_drift 註解區塊下方：
/**
 * UI-only：Overlay 確認時算出的最低漂移需求（供 RmRunPanel 標記/稽核檢視）。
 * 不送往引擎——createJob 會剝除（比照 top_n）。
 */
overlay_drift_floor?: number | null;
```

```ts
// api.ts createJob：
delete payload.top_n;
delete payload.refinement_patience;
delete payload.overlay_drift_floor;   // 新增
```

### F7 — page.tsx 細節

```ts
const [driftSyncNotice, setDriftSyncNotice] = useState<{
  from: number; to: number; requiresSupervisor: boolean;
} | null>(null);

// onOverlayConfirm 內，resolveOverlayUniverse 之後、setRequest 之前：
const anchorWeights = Object.fromEntries(
  anchorPortfolio.holdings
    .filter((h) => h.weight > 0)
    .map((h) => [h.ticker.toUpperCase(), h.weight]),
);
let finalized = clearProposedTickers(overlay);
const hints = computeOverlayDriftHints(finalized, {
  anchorWeights,
  currentDrift: resolved.customization_drift ?? 0.5,
});
const action = driftSyncActionForConfirm(hints, resolved.customization_drift ?? 0.5);
if (action.kind === "raise") {
  resolved.customization_drift = action.to;
  const driftCtl = resolved.param_controls?.customization_drift_actual;
  if (driftCtl?.mode === "fixed") {
    resolved.param_controls = {
      ...resolved.param_controls,
      customization_drift_actual: { ...driftCtl, fixed: action.to },
    };
  }
  resolved.overlay_drift_floor = hints.minRequiredDrift;
  setDriftSyncNotice({ from: action.from, to: action.to, requiresSupervisor: action.requiresSupervisor });
} else {
  setDriftSyncNotice(null);
}
finalized = attachDriftSyncAudit(finalized, hints, resolved.customization_drift ?? 0.5);
```

相依性：`onOverlayConfirm` 的 `useCallback` deps 加 `anchorPortfolio`（已在）。`onSkipOverlay` / 重新進入 overlay 階段時 `setDriftSyncNotice(null)`。

### F10 — RmRunPanel 細節

新 props：

```ts
type Props = {
  // ...既有
  driftSyncNotice?: { from: number; to: number; requiresSupervisor: boolean } | null;
  onDismissDriftSyncNotice?: () => void;
};
```

元件內：

```ts
const anchorWeights = useMemo(
  () => Object.fromEntries(
    anchorPortfolio.holdings.filter((h) => h.weight > 0)
      .map((h) => [h.ticker.toUpperCase(), h.weight]),
  ),
  [anchorPortfolio],
);
const driftHints = useMemo(
  () => computeOverlayDriftHints(overlay, {
    anchorWeights,
    currentDrift: request.customization_drift ?? 0.5,
  }),
  [overlay, anchorWeights, request.customization_drift],
);
const [pendingLowerDrift, setPendingLowerDrift] = useState<number | null>(null);

const onDriftSliderChange = (next: number) => {
  const floor = driftHints.minRequiredDrift;
  const cur = request.customization_drift ?? 0.5;
  if (floor > 0 && next < floor - 1e-9 && cur >= floor - 1e-9) {
    setPendingLowerDrift(next);   // 跨過下限 → 要求確認
    return;
  }
  onChange({ ...request, customization_drift: next });
};
```

渲染順序（drift 卡片內）：label（+主管徽章）→ 原生滑桿 → 尺規列 → 低於下限警告 → 調降確認列。通知條放在 `rm.run.title` 面板頂部。ConstraintsPanel（advanced）以 `driftFloorHint={driftHints}` 傳入。

---

## 6. i18n 文案

新增 keys（`i18n.tsx` 三個 dict 各一份；插值用既有 `{name}` 語法）：

| Key | zh（繁中） | en | ko |
|---|---|---|---|
| `overlay.driftHint.need` | 此 Overlay 至少需要 {pct}% 客製化偏離（目前上限 {current}%）— 確認時將自動調升至 {suggested}% | This overlay needs at least {pct}% customization drift (current cap {current}%) — it will auto-raise to {suggested}% on confirm | 이 오버레이는 맞춤화 편차가 최소 {pct}% 필요합니다(현재 상한 {current}%) — 확인 시 {suggested}%로 자동 상향됩니다 |
| `overlay.driftHint.ok` | 偏離上限已足夠（需求 {pct}% ≤ 目前 {current}%） | Drift cap is sufficient (need {pct}% ≤ current {current}%) | 편차 상한이 충분합니다(필요 {pct}% ≤ 현재 {current}%) |
| `overlay.driftHint.supervisor` | 建議值 {pct}% 超過 60%，需主管核准留痕 | Suggested {pct}% exceeds 60% — supervisor approval will be recorded | 권장값 {pct}%가 60%를 초과하여 관리자 승인이 기록됩니다 |
| `overlay.driftHint.title` | 偏離需求 | Drift requirement | 편차 요구량 |
| `overlay.driftSync.raised` | 已依 Overlay 需求將客製化偏離從 {from}% 自動調升至 {to}%。 | Customization drift auto-raised from {from}% to {to}% to match the overlay. | 오버레이에 맞춰 맞춤화 편차가 {from}%에서 {to}%로 자동 상향되었습니다. |
| `overlay.driftSync.raisedSupervisor` | 已自動調升至 {to}%；超過 60%，需主管核准留痕。 | Auto-raised to {to}%; above 60% — supervisor approval will be recorded. | {to}%로 자동 상향되었으며, 60% 초과로 관리자 승인이 기록됩니다. |
| `overlay.driftSync.sourceLine` | 來源：{sources} | Sources: {sources} | 출처: {sources} |
| `rm.run.driftFloorMarker` | Overlay 最低需求 {pct}% | Overlay minimum {pct}% | 오버레이 최소 요구 {pct}% |
| `rm.run.driftBelowFloorWarning` | 目前上限 {current}% 低於 Overlay 最低需求 {pct}%——部分配置目標將無法完整達成。 | Current cap {current}% is below the overlay minimum {pct}% — some allocation targets cannot be fully met. | 현재 상한 {current}%가 오버레이 최소 {pct}%보다 낮아 일부 배분 목표를 완전히 충족할 수 없습니다. |
| `rm.run.driftLowerConfirmTitle` | 確定要調降嗎？ | Lower anyway? | 낮추시겠습니까? |
| `rm.run.driftLowerConfirmBody` | 調降至 {to}% 將低於 Overlay 最低需求 {pct}%，部分配置目標會無法達成。 | Lowering to {to}% goes below the overlay minimum {pct}%; some targets will not be met. | {to}%로 낮추면 오버레이 최소 {pct}%보다 낮아 일부 목표를 달성할 수 없습니다. |
| `rm.run.driftLowerConfirmOk` | 確定調降 | Lower anyway | 낮추기 |
| `rm.run.driftLowerConfirmCancel` | 取消 | Cancel | 취소 |
| `rm.run.driftSupervisorBadge` | >60% 需主管核准 | >60% needs supervisor | 60% 초과 관리자 승인 필요 |

`sourceLine` 的 `{sources}` 由呼叫端把 `hints.sources` 前 3 個 `ref` 以「、」/「, 」join 後帶入。

---

## 7. 測試計畫

測試框架：vitest（`apps/web/vitest.config.ts`；無 npm script，直接 `npx vitest run`）。測試檔與被測檔同目錄，比照 `overlay-feasibility.test.ts` 風格（`describe`/`it`/`expect`、`baseOverlay()` fixture）。

### 7.1 單元測試（`overlay-drift-sync.test.ts`）

| # | 案例 | 斷言 |
|---|---|---|
| U1 | null/undefined overlay | 零值 hints、`feasible: true`、`sources: []` |
| U2 | 空錨點（無 anchorWeights/anchorPositions） | 零值 hints |
| U3 | 層級 1：主題 sleeve_targets（ai 0.45 + hedge 0.35，supplements 提供 membership）vs SPY=1 錨點 | `minRequiredDrift ≈ 0.8`（0.45+0.35 全為新質量）；`sources` 含兩袖珍；kind = `sleeve_targets` |
| U4 | 層級 1 優先於層級 2：sleeve_targets 與 band ask 同時存在 | 結果只反映 sleeve_targets；不雙算 |
| U5 | 層級 2：band ask（target 0.4，tickers 全在錨點外）vs SPY=1 | `minRequiredDrift ≈ 0.4`；`sources[0].kind = "group_weight_band"` |
| U6 | 層級 2：band ask 未簽核 + `includeUnsigned` | 未簽核 ask 仍計入（對比 `groupWeightBandsFromOverlay` 預設排除——為該函式加一個 regression test） |
| U7 | 層級 3：ticker_min ask 2 檔新標的、無 pct | `minRequiredDrift = 0.02`（2 × 0.01）；kind = `must_include` |
| U8 | 層級 3：ticker_min 帶 min_pct 0.05 的 1 檔新標的 | `= 0.05` |
| U9 | 層級 4：只有 themes/narrative | `minRequiredDrift = 0`、`sources: []` |
| U10 | 取整：raw 0.42 → `suggestedDrift = 0.45`；raw 0.45 → 0.45（不進位）；raw 0.451 → 0.5 | 步進語意正確 |
| U11 | headroom：`suggestedDrift + 0.05`，0.95 → cap 1.0 | 邊界正確 |
| U12 | 主管門檻：suggested 0.6 → `requiresSupervisor: false`；0.65 → `true`（對齊 `driftOverrideApproval`） | §8 一致 |
| U13 | feasible 容差：current 0.45 vs min 0.45+1e-12 | `feasible: true` |
| U14 | `driftSyncActionForConfirm`：低於 → `raise`；等於/高於 → `none`（永不調降） | 只升不降 |
| U15 | membership 空池退回 anchor keys（與現行衝突卡同邏輯） | 不 NaN、不 throw |
| U16 | `attachDriftSyncAudit`：寫入 `audit.drift_sync`、更新 `updated_at`、舊 overlay 無此欄位可 parse | schema 相容 |

### 7.2 整合測試

| # | 案例 | 驗證點 |
|---|---|---|
| I1 | 既有 `overlay-feasibility.test.ts` 全數通過 | F3 抽 helper 無行為變更 |
| I2 | `overlayToBacktestRequest` 後 fixed drift pin 被自動調升同步更新（F7 的 param_controls 分支） | `customization_drift` 與 `param_controls.customization_drift_actual.fixed` 一致 |
| I3 | RM 在 advanced 把 `customization_drift_actual` 設為顯式 search range（min/max） | 自動調升只改 `customization_drift` 上限，**不覆寫** search range（`overlayToBacktestRequest` 的 `explicitDriftSearch` 分支不受影響） |
| I4 | `createJob` payload 不含 `overlay_drift_floor` | API 契約不變 |
| I5 | i18n：三語 dict 的 §6 keys 皆存在（可用現有 i18n 測試模式或簡單 key-parity 斷言） | 無 fallback 到 key 字串 |

### 7.3 手動驗收（UI）

1. 客戶 + 錨點啟動 → 對話輸入「45% AI 主題 / 35% 避險」→ 摘要卡下出現琥珀色提示（4.1）。
2. 確認 Overlay → 進入 RmRunPanel → 通知條顯示「30% → 45%」、滑桿已在新值、尺規標記在 45%。
3. 拖滑桿到 45% 以下 → 出現確認列 → 取消 → 值不變；確定 → 值改 + 警告列出現。
4. 需求 >60%（如 50/50 二層）→ 徽章 + 通知條琥珀色 + overlay audit 有 `drift_sync.requires_supervisor: true`。
5. 切換語言（EN/繁中/한국어）→ 所有新文案正確。

---

## 8. 實作順序

| Phase | 內容 | 相依 | 完成判準 |
|---|---|---|---|
| **P1** 核心計算 | F1、F2、F3、F4、F5、F6、F12（i18n keys 先全上） | 無 | `npx vitest run src/lib/overlay-drift-sync.test.ts src/lib/overlay-feasibility.test.ts` 全綠；`tsc` 無誤 |
| **P2** 確認時同步 | F7（page.tsx 自動調升 + notice state） | P1 | 手動驗收 #2 前半：確認後 request 值正確、audit 留痕 |
| **P3** 對話即時提示 | F8、F9 | P1 | 手動驗收 #1 |
| **P4** RmRunPanel 標記與守門 | F10、F11 | P1、P2（notice props） | 手動驗收 #2–#5 全部 |

P3 與 P4 互不相依，可平行；P2 必須在 P4 之前（通知條 props 由 P2 定義）。每個 Phase 獨立可 ship：P1 單獨合入不影響任何現有行為（純新增 + 行為不變的重構）。

---

## 9. 邊界案例

| # | 案例 | 預期行為 |
|---|---|---|
| E1 | 錨點為「目前持倉」（`CURRENT_HOLDINGS_ANCHOR_ID`）且 RM 改了 scope 群組 | `anchorPortfolio` 改變 → `useMemo` 重算 hints；標記位置即時更新 |
| E2 | Overlay 已簽核後 RM 回頭改對話 | 提示一律以**當前 overlay state** 計算；簽核後 RmRunPanel 以 `signedOverlay` 為準 |
| E3 | 滑桿值恰好 = 下限 | `feasible: true`（1e-9 容差），不顯示警告 |
| E4 | `minRequiredDrift` 接近 1（如 50/50 全新袖珍 vs 單一 ETF 錨點 → ≈1.0） | clamp 到 1；suggested = 1.0；滑桿到頂；`requiresSupervisor: true` |
| E5 | 需求 >60% | 自動調升**仍執行**（不阻擋），但通知條/徽章標示主管核准 + audit 留痕——與衝突卡「警告但不阻擋」一致 |
| E6 | RM 調低於下限後直接執行 | 允許執行；引擎端 `needs_attainment.within_customization_drift` 照舊以 cap 檢核，報告如實呈現 |
| E7 | 重複確認（results → 回 overlay → 再確認） | 冪等：只升不降；第二次確認若值已足夠 → `action.kind = "none"`、不重複顯示通知 |
| E8 | 「略過 AI 需求摘要」（`onSkipOverlay`） | 無 overlay → 零值 hints → 無標記、無通知；同時清掉 `driftSyncNotice` |
| E9 | 歷史 job 還原（`presentResult`） | 直接進 results 階段，不經 RmRunPanel → 無影響 |
| E10 | band ask 的 tickers 經主題分類後解析為空 | `groupWeightBandsFromOverlay` 的 `pushBand` 本就丟棄空 tickers band → 該層無訊號 → 落到下一層級 |
| E11 | `weightLabel` 解析失敗的錨點持倉 | `anchorWeightsFromPositions` 跳過該列；全部失敗 → 空錨點 → 零值 hints（U2） |
| E12 | `sleeve_targets` 只有 `w_*` keys（資產類別權重） | 非主題袖珍 → 層級 1 無訊號 → 往下評估（`w_*` 走的是 param_controls 固定權重路徑，不屬漂移需求） |
| E13 | 多個 band asks 指向重疊 tickers | L1 在合併後的 targetWeights 上計算（`minL1DriftForTarget` 內部先展平再加總），不雙算重疊質量 |
| E14 | `customizationDrift` prop 為 undefined（面板預設） | 正規化為 0.5，與 `buildDefaultRequest` 一致 |
| E15 | 滑桿已在下限以下，RM 繼續往下拖 | 不再彈確認（新舊值皆 < 下限），避免連拖連彈；警告列持續顯示 |

---

## 10. 與現有機制的關係

### 10.1 INFEASIBLE_DRIFT 衝突卡（overlay-feasibility.ts:120）

| 面向 | 衝突卡（既有） | 本功能（新增） |
|---|---|---|
| 時機 | interpret 回合（BFF，簽核**前**） | 對話中即時（提示）、確認時（同步）、constraints 階段（守門） |
| 性質 | **阻擋**：有衝突時無法 confirm | **非阻擋**：提示/通知/確認列 |
| 覆蓋 | 僅二層 AI+避險、顯式主題 sleeve_targets | 補上 band asks 與 must_include（斷點 D4） |
| 取整 | 1% 進位（文案建議值） | 5% 進位（滑桿步進對齊） |

兩者**並存不衝突**：衝突卡的 `raise-drift` 選項走 `onRaiseDrift` 直接改 request；本功能的自動調升在確認時補齊「衝突卡沒涵蓋到、或 RM 選了 accept-nearest 但 sleeve_targets 仍需要空間」的落差。上線後預期 INFEASIBLE_DRIFT 出現率下降（因為對話中提示讓 RM 更早調高滑桿，`declaredDrift` 傳入 interpret 時已較高）。

### 10.2 raise-drift 流程（OverlayConversationPanel.tsx:472-499）

既有路徑：`onRaiseDrift(drift)` → page.tsx 回寫 `request.customization_drift`，同時在 overlay `param_adjustments.customization_drift_actual` 釘 fixed。本功能的自動調升（F7）**鏡像同一組寫入**（request 欄位 + fixed pin），保證兩條路徑結果一致；差異只在觸發點（衝突卡按鈕 vs 確認時自動）。

### 10.3 DRIFT_OVERRIDE_RM_MAX / 主管核准（§8）

不重寫門檻：`requiresSupervisor` 一律由 `driftOverrideApproval(suggestedDrift)` 推得。語意沿用現況——`OverlayConflictDialog` 對 >60% 也是「顯示主管留痕文案但可按鈕繼續」，本功能同。真正的批次簽核走既有 capability approval（`proposal-capability-badge.ts`），不在本範圍。

### 10.4 `overlayToBacktestRequest` 的 drift fixed 釘定（overlay-schema.ts:1114-1130）

錨定客製化時，overlay 會把 `customization_drift_actual` 釘為 `{ mode:"fixed", fixed: base.customization_drift }`。**這是自動調升最容易漏掉的一點**：只改 `request.customization_drift` 而不改這個 fixed pin，引擎實際用的漂移會被 pin 回舊值。F7 明確要求同步更新（§5 F7 程式碼），I2 測試鎖定此行為。若 RM 在 advanced 自行設了 search range（`explicitDriftSearch`），overlay 本就不釘 fixed，自動調升也不覆寫其 range（E/I3）。

### 10.5 引擎端 attainment（不變）

`needs_attainment.customization_drift_cap / customization_drift_l1 / within_customization_drift`（types.ts:276-278）以 request 的 cap 如實檢核。本功能讓 cap 與 Overlay 需求對齊，等於讓 attainment 檢核**更有意義**——RM 看到的是「需求 45%、cap 45%、實際 41% ✓」，而不是「cap 30%、實際 30% ✓ 但袖珍目標根本沒達成」的假象。

---

## 附錄 A：關鍵程式碼座標速查

| 符號 | 位置 |
|---|---|
| `minL1DriftForTarget` | `apps/web/src/lib/overlay-feasibility.ts:83` |
| `DRIFT_OVERRIDE_RM_MAX` / `driftOverrideApproval` | `apps/web/src/lib/overlay-feasibility.ts:13, 281` |
| `anchorWeightsFromPositions` | `apps/web/src/lib/overlay-feasibility.ts:306` |
| `attachMechanicalOverlayConflicts` | `apps/web/src/lib/overlay-feasibility.ts:509` |
| `groupWeightBandsFromOverlay` / `bandTargetFromAsk` | `apps/web/src/lib/overlay-schema.ts:879, 870` |
| `overlayToBacktestRequest`（drift fixed 釘定） | `apps/web/src/lib/overlay-schema.ts:1095`（釘定於 1114-1130） |
| `signOffOverlay` | `apps/web/src/lib/overlay-schema.ts:1231` |
| `onOverlayConfirm` / `onRaiseDrift` | `apps/web/src/app/page.tsx:911, 1182` |
| RmRunPanel drift 滑桿 | `apps/web/src/components/RmRunPanel.tsx:131-155` |
| ConstraintsPanel drift 滑桿（RM 模式隱藏） | `apps/web/src/components/ConstraintsPanel.tsx:281-301` |
| 摘要卡渲染處 | `apps/web/src/components/OverlayChatTimeline.tsx:331-340` |
| `createJob`（剝除 UI-only 欄位先例） | `apps/web/src/lib/api.ts:131-141` |
| 引擎 must_include floor | `apps/api/app/engine/customization.py:190` |
