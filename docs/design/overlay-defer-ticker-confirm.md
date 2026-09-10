# Overlay「建議參考標的」延後至澄清完成後確認（Defer Ticker Confirm）施工說明書

> **版本**: 0.1（施工前設計定稿）
> **狀態**: Ready for implementation — 尚未落地
> **日期**: 2026-09-10
> **讀者**: Web/BFF 工程師、RM 產品負責人
> **相關文件**:
> - [`docs/design/sellable-universe.md`](./sellable-universe.md)（建議產生面 L2/L3/L8、可銷售過濾）
> - [`docs/design/overlay-drift-sync.md`](./overlay-drift-sync.md)（簽核連動；本功能不改 drift）
> - PR [#13](https://github.com/jagahow-bot/jasper-ai/pull/13)「覆疊確認前需確認建議標的」（已合併 2026-09-04）
> - PR [#3](https://github.com/jagahow-bot/jasper-ai/pull/3)「Dedupe overlay proposed tickers during clarify stage」（chip 層去重，已合併）
> **適用程式碼**: `apps/web`（Next.js BFF + Overlay UI）；**不動** `apps/api` 引擎
>
> 所有檔案路徑與行號均經實際代碼核對（2026-09-10 工作區狀態）。

---

## 1. 目標與範圍

### 1.1 問題陳述

Overlay 對話同一輪 interpret 後，UI **可同時**顯示：

1. **待澄清問題**（`clarifications` / chips）
2. **建議參考標的**面板（`proposed_tickers` →「加入選取」／「無新增標的」）

既有 chip 去重（`proposedTickersAfterClarificationDedup`）**只隱藏澄清選項文字裡有出現的 ticker**（例如 AIQ／BOTZ／SMH）。若澄清問的是風險偏好、存續期、配置比例等**不點名 ticker** 的問題，現金／債券／廣基 ETF（如 SGOV、BIL、BND、VOO）仍會出現在面板上，RM 可在答完澄清前就「加入選取」寫入 `supplement_tickers`。

典型事故路徑：

1. Gemini（或 client 端 `ensureProposedTickersForReview`）同輪產出 clarifications + proposed_tickers。
2. RM 中途把 SGOV／BIL 等加入 supplement（鎖定進池）。
3. 後續答完澄清 → re-interpret 改 themes／sleeve／prompts → `instrumentNeedsKey` 變、新建議再生。
4. **舊 supplement 仍在** → 與新答案／新建議矛盾；摘要與簽核狀態都看起來「已確認過標的」。

根因：**ticker 確認閘發生在澄清完成之前**，且確認會永久寫入 pool。

### 1.2 目標（本功能要做的）

| # | 目標 | 說明 |
|---|---|---|
| G1 | **澄清優先** | 只要 `hasPendingClarifications === true`，不對 RM 露出「建議參考標的」確認 UI（面板、摘要列、可點的加入／無新增）。 |
| G2 | **一次確認** | 全部澄清答完（pending = ∅）後，再顯示一次建議標的確認閘（加入選取／無新增標的）。 |
| G3 | **再簽核** | 維持 PR #13：主題／袖套需要標的時，簽核前必須完成 ticker 確認或「無新增標的」ack；澄清未完時不可跳過此閘去簽核。 |
| G4 | **資料層保留、UI 隱藏** | 澄清期間 **保留** store 內的 `proposed_tickers`（不強制清空），僅以 `visibleProposedForUi` 對 UI／閘道回傳 `[]`（決策見 §3.1）。 |
| G5 | **延後合成露出** | `ensureProposedTickersForReview` 的結果可在澄清中寫入 store，但**露出**必須等到澄清清空；或改為澄清清空後才呼叫合成（Phase B）。 |
| G6 | **Prompt 軟約束（可選）** | Phase C：interpret system prompt 建議「有 clarifications 時本輪勿填 proposed_tickers」；client 仍以 G1–G5 為準。 |

### 1.3 非目標（Explicit Non-Goals）

- **不改引擎**／`apps/api`。
- **不改變** sellable 八條防線的過濾時機（L2 仍在 interpret 輸出後；L8 仍在 RM 確認加入後 warn）。
- **不重做**澄清卡片 UX（`OverlayClarificationCards`）與 Q→A 送出格式。
- **不強制** server 硬刪同輪 `proposed_tickers`（Phase C 僅 soft prompt；硬刪為未來選項，見 §11）。
- **不改變**衝突卡（`conflicts`）優先於對話的現有行為。
- **不改變** `instrumentNeedsKey` 指紋演算法本身（僅消費既有 ack 語意）。

### 1.4 已確認決策

| 決策 | 選擇 | 理由 |
|---|---|---|
| 澄清期間 store 內 proposed | **保留，僅隱藏 UI**（Phase A+B） | 改動小；re-interpret 合併 prior proposed 的既有邏輯（`wrapExtractAsOverlay` :525-530）可繼續工作；澄清清空後立刻有清單可審 |
| Prompt 同輪不產 proposed | **Phase C 軟約束（可選）** | 減少雙軌輸出噪音；不以 server 為唯一閘門 |
| Chip 去重 | **保留作 defense-in-depth** | 主閘改為 clarifications-first hide-all；chip 去重仍避免答完後雙重勾選 |

---

## 2. 現況分析

### 2.1 現行資料流（澄清 × 建議標的）

```
RM 送出訊息／澄清回答
  → OverlayConversationPanel.interpret (OverlayConversationPanel.tsx:234-371)
  → POST /api/overlay/interpret (route.ts POST 主流程 ~:534+)
       ├─ L1 sellable catalog 注入 (route.ts:225-242 區塊；組裝 :546-549)
       ├─ Gemini / rules fallback
       ├─ L2 applySellableOutputFilter (route.ts:251-287)
       └─ wrapExtractAsOverlay (overlay-schema.ts) — phase=clarify 若有 pending
  → client: setOverlay(ensureProposedTickersForReview(...))  (:331-333)
       └─ 主題需求且 proposed 空 → synthesizeThemeProposedTickers (:360-426)
  → UI 同時可能渲染：
       ├─ OverlayClarificationCards (OverlayChatTimeline.tsx:424-432)
       ├─ ProposedTickersInline (OverlayChatTimeline.tsx:434-445)
       └─ formatOverlaySummary 摘要卡列「建議參考標的」(:386；schema :1701-1706)
```

### 2.2 關鍵座標（已核對）

#### 2.2.1 `OverlayConversationPanel.tsx`

| 座標 | 內容 | 與本功能關係 |
|---|---|---|
| :201-217 | `clarifications` / `hasPendingClarifications` | 澄清 pending 旗標來源 |
| :234-371 | `interpret` | 回傳後立刻 `ensureProposedTickersForReview`（:331-333），**不看** pending clarifications |
| :341 | `formatOverlayAssistantReply(interpretedOverlay)` | 目前僅回傳 `rationale`（見 §2.2.4）；聊天泡泡不直接列建議清單 |
| :431-497 | `handleConfirm` | 簽核前跑 `isTickerReviewBlocking`（:441-453）；有 pending conflicts 才 early-return，**澄清 pending 本身不 disable 按鈕**（按鈕靠 `tickerReviewRequired`） |
| :621-663 | `confirmProposedTickers` | **無** pending-clarification guard；立刻寫 `supplement_tickers` |
| :665-683 | `skipProposedNoAdds` | 設 `noAddsAckKey = instrumentNeedsKey` + `clearProposedTickers`；**無**澄清 guard |
| :694-709 | `proposedTickers` / `tickerReviewRequired` | 僅 chip 去重；pending 時若可見 proposed 非空 → 仍擋簽核**但不擋加入** |
| :816-838 | 簽核按鈕 | `disabled` 含 `tickerReviewRequired`；**不含** `hasPendingClarifications` |

#### 2.2.2 `OverlayChatTimeline.tsx`

| 座標 | 內容 | 與本功能關係 |
|---|---|---|
| :139-260 | `ProposedTickersInline` | 標題 i18n =「建議參考標的」；有候選或 `reviewRequired` 即顯示 |
| :379-387 | 摘要卡 | `formatOverlaySummary` — 澄清中仍可能列建議標的 |
| :424-432 | 澄清卡片 | 與 proposed 面板**並列**，無互斥 |
| :434-445 | 渲染 `ProposedTickersInline` | 條件僅 `!confirmed` |

#### 2.2.3 `overlay-filter-proposals.ts`

| 座標 | 內容 | 與本功能關係 |
|---|---|---|
| :17-37 | `tickersNamedInClarifications` | chip／題目中的 ticker 集合 |
| :43-52 | `proposedTickersAfterClarificationDedup` | **只**藏 chip 點名者；非點名澄清 → 全顯示（截圖路徑） |
| :102-111 | `clearProposedTickers` | 「無新增標的」／簽核後清 proposed |
| :153-215+ | `THEME_PROPOSAL_BUCKETS` | 主題合成桶 |
| :252-290 | `overlayNeedsNewInstruments` | 主題／sleeve／DI／asks 是否需要標的 |
| :293-320 | `instrumentNeedsKey` | 「無新增標的」ack 指紋 |
| :322-347 | `mapTickersToProposed` | sellable 過濾後映射 |
| :360-426 | `synthesizeThemeProposedTickers` | LLM 空 proposed 時合成 |
| :432-442 | `ensureProposedTickersForReview` | interpret 後立即補清單 |
| :452-476 | `isTickerReviewBlocking` | `visibleProposed.length > 0` → block；`hasPendingClarifications` 且可見空 → **不擋**（避免 mid-clarify 假「無新增」提示，但也讓簽核在「全被 chip 藏光」時可通過） |

#### 2.2.4 `overlay-schema.ts`

| 座標 | 內容 | 與本功能關係 |
|---|---|---|
| :369-382 | `inferPhaseFromExtract` | 有 clarifications → phase `clarify`；**不清除** proposed |
| :525-545 | `wrapExtractAsOverlay` universe merge | 本輪省略 proposed 時**保留 prior**（避免澄清後 ticker 閘消失） |
| :587-589 | `formatOverlayAssistantReply` | **現況 = `return overlay.rationale`**（不再組裝建議列） |
| :1652-1768 | `formatOverlaySummary` | zh :1701-1706 推 `建議參考標的：…`；en :1760-1764；ko :1734-1738 — **摘要卡洩漏路徑** |
| :1526-1546 | `signOffOverlay` | 清空 clarifications；不負責 ticker 閘 |

> **註**：先前規劃稿誤將「建議參考標的」列歸在 `formatOverlayAssistantReply`。核對後洩漏主路徑是 **`formatOverlaySummary`（摘要卡）** + **`ProposedTickersInline` 面板**；助理泡泡僅透傳 LLM `rationale`（模型若在 rationale 自由文寫出 ticker 名稱屬 soft 問題，Phase C prompt 可一併約束）。

#### 2.2.5 Interpret route + PR #13

| 座標／產物 | 內容 |
|---|---|
| `route.ts` :347-349 | Prompt 要求主題 → 填 `proposed_tickers` 3–6 檔，**未禁止**與 clarifications 同輪 |
| `route.ts` :225-242 | Sellable catalog 規則（含 clarifications 不得開個股路徑） |
| `route.ts` :251-287 | L2 `applySellableOutputFilter` |
| PR #13 | 簽核前必須確認建議標的或「無新增標的」；新增 synthesize／ensure／`isTickerReviewBlocking`／`instrumentNeedsKey`。**未做** clarifications-first 整塊隱藏 |

### 2.3 斷點（disconnect）

| 斷點 | 位置 | 現況 |
|---|---|---|
| D1 | `proposedTickers` memo (:694-700) | 澄清 pending 時仍可能非空（非 chip 點名） |
| D2 | `confirmProposedTickers` (:621) | 澄清未完可寫入 supplement |
| D3 | `skipProposedNoAdds` (:665) | 澄清未完可 ack + 清 proposed |
| D4 | `formatOverlaySummary` (:1701+) | 澄清中摘要仍列建議標的 |
| D5 | `ensureProposedTickersForReview` 呼叫點 (:332) | 澄清中即合成並寫入 store／露出 |
| D6 | `isTickerReviewBlocking` + 簽核按鈕 | pending 且可見空 → 不擋簽核；與「先確認標的再簽核」在 mid-clarify 下不一致 |
| D7 | Interpret prompt | 鼓勵同輪同時填 clarifications + proposed |

### 2.4 可直接複用的現有機制

| 機制 | 位置 | 複用方式 |
|---|---|---|
| `hasPendingClarifications` | OverlayConversationPanel.tsx:217 | Phase A 主開關 |
| `proposedTickersAfterClarificationDedup` | overlay-filter-proposals.ts:43 | 包進新 `visibleProposedForUi` 的第二層 |
| `isTickerReviewBlocking` | :452-476 | 調整 pending 語意：pending → 擋簽核（或面板層另擋） |
| `instrumentNeedsKey` / `noAddsAckKey` | :293-320；panel :145, :667 | 「無新增標的」ack 不變 |
| `ensureProposedTickersForReview` | :432-442 | Phase B 延後露出／延後呼叫 |
| Prior proposed merge | overlay-schema.ts:525-530 | 支援「store 保留、UI 隱藏」策略 |
| Sellable L2/L3/L8 | sellable-universe.md | 過濾時機不變 |
| i18n `overlay.proposedTickers.*` | i18n.tsx en:~1230、zh:~3183、ko:~5125 | 擴充 clarifications-pending hint |

---

## 3. 核心設計

### 3.1 原則：Clarifications-first

```
有 pending clarifications
    → visibleProposedForUi = []
    → 不渲染 ProposedTickersInline（或 candidates=[] 且不開 emptyNeedsHint）
    → 禁用 confirmProposed / skipNoAdds
    → 禁用（或 title 提示）Overlay 簽核
    → formatOverlaySummary 省略「建議參考標的」行（可選一行「待澄清後再建議」）

pending clarifications = ∅
    → visibleProposedForUi = proposedTickersAfterClarificationDedup(...)
    → 必要時 ensureProposedTickersForReview 露出／補合成
    → 一次 ticker 確認閘（PR #13）
    → 通過後才可簽核 Overlay
```

### 3.2 新函式 `visibleProposedForUi`

放在 `apps/web/src/lib/overlay-filter-proposals.ts`（與 dedupe／gate 同級）：

```ts
/**
 * UI / 簽核閘用的可見建議清單。
 * 澄清未完成時一律回傳 []（store 內 proposed_tickers 可仍保留）。
 * 澄清完成後套用既有 chip 去重。
 */
export function visibleProposedForUi(
  proposed: readonly OverlayProposedTicker[] | undefined,
  clarifications: readonly OverlayClarification[],
): OverlayProposedTicker[] {
  if (clarifications.length > 0) return [];
  return proposedTickersAfterClarificationDedup(proposed, clarifications);
}
```

**呼叫端統一改用此函式**（取代 panel 內直接呼叫 dedupe）：

- `proposedTickers` useMemo
- `handleConfirm` 的 `visibleForGate`
- （可選）測試與 timeline 文件註解

### 3.3 `isTickerReviewBlocking` 調整

現況（:461-462）：

```ts
if (opts.visibleProposed.length > 0) return true;
if (opts.hasPendingClarifications) return false; // mid-clarify 可見空 → 不擋
```

**目標語意**：

| 狀態 | 簽核是否阻擋 | 說明 |
|---|---|---|
| pending clarifications | **擋** | 先答完澄清（新 i18n hint） |
| 無澄清 + 可見 proposed > 0 | 擋 | 與現況相同（須確認加入或之後清掉） |
| 無澄清 + needs 標的 + 無 supplement + 無匹配 ack | 擋 | PR #13 空態「無新增標的」 |
| 無澄清 + 已 ack / 已有 supplement / 不需新標的 | 不擋 | 與現況相同 |

建議實作：

```ts
export function isTickerReviewBlocking(
  overlay: ClientOverlay,
  opts: {
    visibleProposed: readonly OverlayProposedTicker[];
    noAddsAckKey: string | null;
    hasPendingClarifications?: boolean;
  },
): boolean {
  // NEW: clarifications-first — never sign off while Qs remain.
  if (opts.hasPendingClarifications) return true;

  if (opts.visibleProposed.length > 0) return true;

  const needs = overlayNeedsNewInstruments(overlay);
  if (!needs) return false;

  if ((overlay.universe.supplement_tickers?.length ?? 0) > 0) {
    return false;
  }

  const needsKey = instrumentNeedsKey(overlay);
  if (opts.noAddsAckKey && opts.noAddsAckKey === needsKey) {
    return false;
  }
  return true;
}
```

> **測試遷移**：既有案例「does not block mid-clarify when proposals are chip-deduped」（`overlay-filter-proposals.test.ts`:335-344）改為 **expects `true`**（或拆成：pending 時 UI 隱藏 + 簽核擋；不再依賴「可見空 → 不擋」）。

### 3.4 延後 `ensureProposedTickersForReview` 露出（Phase B）

**推薦（與決策一致）— Store 可寫、UI 不露：**

1. Interpret 回傳後仍可呼叫 `ensureProposedTickersForReview`（維持 prior merge／後續一輪有貨）。
2. UI 一律走 `visibleProposedForUi` → pending 時看不到。
3. 澄清清空的那一輪 interpret 回來後，若仍空且 `overlayNeedsNewInstruments`，再確保合成一次（現有 ensure 已冪等）。

**替代（更乾淨清單）— 延後合成呼叫：**

```ts
const withReview =
  (interpretedOverlay.clarifications?.length ?? 0) > 0 ||
  (interpretedOverlay.clarification_questions?.length ?? 0) > 0
    ? interpretedOverlay
    : ensureProposedTickersForReview(interpretedOverlay, detectedLang);
setOverlay(withReview);
```

規格採 **前者為預設**（A+B）；後者可當實作時微調，但須保證：澄清清空後若 LLM 仍不給 proposed，合成仍會跑。

### 3.5 Guard：confirm / skip / sign-off

| 動作 | Guard |
|---|---|
| `confirmProposedTickers` | `if (hasPendingClarifications) return;` |
| `skipProposedNoAdds` | 同上 |
| 簽核按鈕 `disabled` | 既有 `tickerReviewRequired`（調整後 pending → true）即可；可再顯式 `\|\| hasPendingClarifications` 防回歸 |
| `handleConfirm` early-return | 可加 `hasPendingClarifications` 與現有 conflicts 並列 |

Timeline 層：`onSkipNoAdds` 僅在 `tickerReviewRequired && !hasPendingClarifications` 時傳入（或 pending 時根本不渲染面板）。

### 3.6 摘要列（`formatOverlaySummary`）

為 `formatOverlaySummary` 增加選配參數（或由呼叫端傳入 flag）：

```ts
export function formatOverlaySummary(
  overlay: ClientOverlay,
  lang: "zh" | "en" | "ko",
  opts?: { hideProposedTickers?: boolean },
): string
```

- `hideProposedTickers === true`（或偵測 `resolveClarifications(overlay).length > 0`）：**跳過** zh/en/ko 的建議標的行（:1701-1706 / :1734-1738 / :1760-1764）。
- OverlayChatTimeline 摘要卡、panel 寫入 `summaryHistory` 時，在 pending  Clarifications 期間傳 `hideProposedTickers: true`。
- 已摺疊的 `summaryHistory` 快照維持寫入當下的文字（歷史誠實）；不清空舊快照。

`formatOverlayAssistantReply` 維持 rationale-only；Phase C 用 prompt 約束模型勿在 rationale 提前列完整建議清單。

### 3.7 Phase C — Prompt 軟約束（可選）

在 `overlaySystemPrompt`（route.ts ~:347 附近 `universe.proposed_tickers` 規則）追加：

```
- If you emit any clarifications / clarification_questions this turn, PREFER
  leaving universe.proposed_tickers empty (or omit it). Concrete ticker
  candidates should wait until clarification answers are incorporated in a
  later turn. Client UI will hide proposals while clarifications are pending.
```

**不**在 server 硬刪 LLM 已填的 proposed（避免與 prior-merge、DI 例外糾纏）；client A+B 已足夠止血。

### 3.8 Direct Indexing（DI）附註

Prompt（route.ts:347、:364）允許 DI 把股票同時寫入 `proposed_tickers` **與** `supplement_tickers`。本功能：

- 澄清 pending 時：**仍隱藏** proposed 面板；不阻止 interpret 寫入的 supplement（若模型已寫入）。
- 建議 Phase C soft 文案對 DI 例外一句：「direct_index may still list sleeve stocks on proposed_tickers after clarifications are resolved; avoid locking large sleeves mid-clarify。」
- 不在本期改 DI 自動進 supplement 的引擎／schema 行為；若產品要求「澄清中也不自動進池」，另開議題（見 §11）。

---

## 4. UX 流程與線框

### 4.1 目標流程

```
┌─────────────────────────────────────────────────────────┐
│  RM 描述需求 → interpret                                 │
│                                                         │
│  ┌─ 有待澄清問題？ ─────────────────────────────────┐   │
│  │  YES：只顯示澄清卡 + 摘要（無建議標的列）          │   │
│  │       簽核 disabled（title: 請先回答澄清問題）      │   │
│  │       「加入選取／無新增標的」不可見／不可點         │   │
│  │  NO：↓                                            │   │
│  └───────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─ 建議參考標的（一次）────────────────────────────┐   │
│  │  ☐ SGOV  ☐ BIL  ☐ BND  ☐ VOO                     │   │
│  │  [加入選取的 N 檔]  [無新增標的]                    │   │
│  └───────────────────────────────────────────────────┘   │
│                                                         │
│  完成 ticker 閘 → [確認調整方案並簽核] 可點               │
└─────────────────────────────────────────────────────────┘
```

### 4.2 狀態對照

| 階段 | 澄清卡 | 建議面板 | 簽核鈕 |
|---|---|---|---|
| Discovery／無 overlay | — | — | 隱藏 |
| Clarify（pending > 0） | 顯示 | **隱藏** | disabled（先答澄清） |
| Confirm（pending = 0，有可見 proposed） | —／history | **顯示** | disabled（先確認標的） |
| Confirm（已加入／已 ack／不需標的） | — | 隱藏或空 | **enabled** |
| 已簽核 `confirmed` | — | 不渲染 | 「已確認」 |

### 4.3 無澄清捷徑

若首輪即 `clarifications = []`：行為與今日「立即顯示 proposed + PR #13 閘」相同（本功能零回歸）。

### 4.4 互動順序（快樂路徑）

1. RM 輸入「要加一點短債與股票核心…」→ 模型回 2 題澄清 +（store 內）proposed=[SGOV,BIL,BND,VOO]。
2. UI **只**見澄清卡；摘要無「建議參考標的」行。
3. RM 答完送出 → re-interpret → clarifications 空、proposed 更新。
4. 面板出現一次建議清單 → RM 加入選取或按「無新增標的」。
5. 簽核 Overlay → 既有 `onOverlayConfirm`／drift sync 等下游不變。

---

## 5. 檔案變更清單

| # | 檔案 | 變更 | 估計規模 |
|---|---|---|---|
| F1 | `apps/web/src/lib/overlay-filter-proposals.ts` | 新增 `visibleProposedForUi`；調整 `isTickerReviewBlocking` pending 語意；更新 JSDoc（:39-41、:444-450） | ~40 行 |
| F2 | `apps/web/src/lib/overlay-filter-proposals.test.ts` | 補 pending hide-all、簽核擋、答完顯示、無澄清立即顯示；改寫 mid-clarify 舊案例 | ~80 行 |
| F3 | `apps/web/src/components/OverlayConversationPanel.tsx` | `proposedTickers` 改走 `visibleProposedForUi`；`confirmProposed`／`skip` guard；簽核 disabled 對齊；（B）ensure 露出策略 | ~35 行 |
| F4 | `apps/web/src/components/OverlayChatTimeline.tsx` | pending 時不渲染 `ProposedTickersInline`（或由 candidates=[] + 不傳 skip）；摘要 `formatOverlaySummary(..., { hideProposedTickers })` | ~20 行 |
| F5 | `apps/web/src/lib/overlay-schema.ts` | `formatOverlaySummary` 支援隱藏建議列（三語分支 :1701 / :1734 / :1760） | ~25 行 |
| F6 | `apps/web/src/lib/i18n.tsx` | 新增 clarifications-pending／簽核 title keys（en/zh/ko） | ~15 行 |
| F7 | `apps/web/src/app/api/overlay/interpret/route.ts` | **Phase C**：prompt 軟約束一段 | ~8 行 |
| F8 | （可選）`overlay-schema`／summary 單元測試 | 隱藏列時字串不含「建議參考標的」／Suggested tickers | ~30 行 |

### 5.1 程式素描（F1）

```ts
// overlay-filter-proposals.ts

export function visibleProposedForUi(
  proposed: readonly OverlayProposedTicker[] | undefined,
  clarifications: readonly OverlayClarification[],
): OverlayProposedTicker[] {
  if (clarifications.length > 0) return [];
  return proposedTickersAfterClarificationDedup(proposed, clarifications);
}

export function isTickerReviewBlocking(/* ... */): boolean {
  if (opts.hasPendingClarifications) return true;
  if (opts.visibleProposed.length > 0) return true;
  // ... existing needs / supplement / noAddsAckKey logic
}
```

### 5.2 程式素描（F3）

```ts
const proposedTickers = useMemo(() => {
  if (confirmed || !overlay) return EMPTY_PROPOSED;
  return visibleProposedForUi(overlay.universe.proposed_tickers, clarifications);
}, [confirmed, overlay, clarifications]);

const confirmProposedTickers = (tickers: string[]) => {
  if (!overlay || tickers.length === 0 || hasPendingClarifications) return;
  // ... existing
};

const skipProposedNoAdds = () => {
  if (!overlay || hasPendingClarifications) return;
  // ... existing
};

// 簽核按鈕
disabled={
  confirmed || loading || confirming || hasPendingConflicts ||
  hasPendingClarifications || tickerReviewRequired
}
title={
  hasPendingClarifications
    ? t("overlay.proposedTickers.clarifyFirst")
    : tickerReviewRequired
      ? t("overlay.proposedTickers.reviewRequired")
      : undefined
}
```

### 5.3 程式素描（F5）

```ts
// 三語分支內，包一層：
if (
  overlay.universe.proposed_tickers?.length &&
  !opts?.hideProposedTickers
) {
  // push 建議參考標的 / Suggested tickers / 제안 종목
}
```

---

## 6. i18n（zh / en / ko）

新增 keys（`apps/web/src/lib/i18n.tsx` 三個 dict；插值語法不變）：

| Key | zh（繁中） | en | ko |
|---|---|---|---|
| `overlay.proposedTickers.clarifyFirst` | 請先回答上方澄清問題，完成後再確認建議標的。 | Answer the clarification questions first; ticker review unlocks afterward. | 먼저 위의 확인 질문에 답한 뒤 제안 종목을 검토하세요. |
| `overlay.proposedTickers.deferredHint` | 建議標的將於澄清完成後一次確認。 | Suggested tickers will be confirmed once after clarifications are done. | 제안 종목은 확인 질문이 끝난 뒤 한 번에 검토합니다. |
| `overlay.chat.confirmBlockedClarify` | 請先完成澄清問題 | Finish clarifications first | 확인 질문을 먼저 완료하세요 |

既有 keys **保留**（文案不變）：

- `overlay.proposedTickers.title` / `addSelected` / `skipNoAdds` / `reviewRequired` / `emptyNeedsHint` / `nonSellableWarn` / `sellableBlocked`
- `overlay.clarify.*`

`deferredHint` 可選：若摘要完全省略建議列即可不顯示；若產品希望摘要留一行提示，再用此 key。

---

## 7. 測試計畫

測試框架：vitest（`npx vitest run`；測試檔與被測檔同目錄）。

### 7.1 單元測試（`overlay-filter-proposals.test.ts`）

| # | 案例 | 斷言 |
|---|---|---|
| U1 | pending clarifications + proposed=[SGOV,BIL,BND,VOO]（**無** chip 點名） | `visibleProposedForUi` → `[]` |
| U2 | clarifications=[] + 同上 proposed | 回傳完整清單 |
| U3 | pending + chip 點名 AIQ/BOTZ | `visibleProposedForUi` → `[]`（整塊藏，不只 dedupe） |
| U4 | clarifications=[] + chip 歷史不影響（傳入空陣列） | 全顯示；既有 dedupe 案例仍綠 |
| U5 | `isTickerReviewBlocking` + `hasPendingClarifications: true` | **`true`**（取代舊「mid-clarify → false」） |
| U6 | pending 清除後 visible proposed 非空 | 仍 `true`（須確認標的） |
| U7 | 無澄清 + 無 needs | `false` |
| U8 | 無澄清 + needs + 匹配 `noAddsAckKey` | `false` |
| U9 | 無澄清 + needs + 已有 supplement | `false` |
| U10 | `ensureProposedTickersForReview` 在有 clarifications 的 overlay 上 | store 可含 synthesized **或** 依 Phase B 選擇不合成；若合成，U1 仍保證 UI 空 |

### 7.2 Summary 測試（可選新檔或掛既有 schema test）

| # | 案例 | 斷言 |
|---|---|---|
| S1 | `formatOverlaySummary(ov, "zh", { hideProposedTickers: true })` | 不含「建議參考標的」 |
| S2 | `hideProposedTickers` 省略／false | 含建議列（有 proposed 時） |
| S3 | en/ko 對稱 | 不含 `Suggested tickers` / `제안 종목` |

### 7.3 手動驗收（UI）

1. **截圖路徑**：澄清問風險／存續期（不點名 ticker）+ store 有 SGOV/BIL → **面板不可見**、無法加入、無法簽核。
2. 答完澄清 → 面板一次出現 → 加入選取 → 可簽核。
3. 答完後按「無新增標的」→ 可簽核；`noAddsAckKey` 生效。
4. **無澄清**首輪：面板立即出現（回歸 PR #13）。
5. Chip 點名 AI 主題：澄清中整塊藏；答完後若仍有非 chip 候選才顯示；全重疊則走 emptyNeedsHint／無新增。
6. Sellable：不可銷售仍由 L2 擋；確認後 warn 不變。
7. 三語切換：新 hint／title 正確。

---

## 8. 實作順序

| Phase | 內容 | 相依 | 完成判準 |
|---|---|---|---|
| **A** Client 閘道（最小止血） | F1、F2、F3、F4（隱藏面板 + guard + blocking）、F6 | 無 | U1–U9 綠；手動 #1 通過（中途無法加入） |
| **B** 摘要與合成露出 | F5、F3 ensure 策略、F8 | A | 摘要不清單提前洩漏；澄清清空後合成／露出；手動 #2–#4 |
| **C** Prompt 軟約束（可選） | F7 | A（B 可並行） | 抽樣 interpret：同輪有 clarifications 時 proposed 多為空；**即使模型仍填，A 仍正確** |
| **D** 回歸 | 綠債／ESG／AI、DI、sellable、「無新增」、needs 變更致 ack 失效 | A+B | §7.3 + 既有 `overlay-filter-proposals.test.ts` 全綠 |

**建議交付**：先合入 **A+B**；C 可同 PR 或 follow-up。

每個 Phase 可獨立 ship：僅合 A 即可修矛盾寫入；B 修資訊洩漏；C 降模型噪音。

---

## 9. 邊界案例

| # | 案例 | 預期行為 |
|---|---|---|
| E1 | **無澄清** | 立即 `visibleProposedForUi`；PR #13 閘照常；零回歸 |
| E2 | **中途清空澄清**（模型不再問） | 進入 ticker 閘；若 proposed 空且 needs → `ensureProposedTickersForReview` |
| E3 | **Re-interpret 再生 proposed** | 尚未確認：以最新 store proposed 為準，澄清空後一次露出；已確認 supplement：novel 再進閘；`instrumentNeedsKey` 變 → 舊 `noAddsAckKey` 自動失效 |
| E4 | **無新增標的** | 僅 `!hasPendingClarifications` 可按；ack 綁 needs key |
| E5 | **Store 有 proposed、UI 隱藏** | 澄清中 `overlay.universe.proposed_tickers` 可非空；面板／摘要／加入皆不可用 |
| E6 | **Sellable** | L2 過濾時機不變（interpret 輸出後）；延後顯示不改過濾 |
| E7 | **主題合成** | 可在澄清中寫入 store 但不露出；或澄清空後才 ensure（Phase B） |
| E8 | **DI** | 澄清中隱藏 proposed 面板；既有 supplement 自動寫入行為本期不改（§3.8） |
| E9 | **Chip 點名 ticker** | hide-all 優先；答完後 dedupe 仍可去掉已在選項出現的代號，避免雙重勾選 |
| E10 | **部分澄清未答就送出** | 現況允許只答部分；若回傳仍有 clarifications → 維持隱藏；若模型清空 → 進 ticker 閘 |
| E11 | **Pending conflicts** | 衝突卡仍優先（既有）；本功能不放寬 |
| E12 | **簽核後再改對話** | `confirmed` 重置邏輯既有；新一輪若再出 clarifications，再次 hide-all |
| E13 | **summaryHistory 舊快照** | 可能含當下未隱藏的建議列；僅影響歷史摺疊卡，可接受 |
| E14 | **LLM rationale 自由文提到 ticker** | 不解析泡泡；Phase C soft 約束；不以泡泡當確認閘 |

---

## 10. 與現有機制的關係

### 10.1 PR #13 Ticker Review Gate

| 面向 | PR #13（既有） | 本功能 |
|---|---|---|
| 時機 | 簽核前必須確認 proposed 或「無新增」 | **再往前**：確認閘本身延到澄清完成之後 |
| 合成 | `ensureProposedTickersForReview` | 延後**露出**（store 可先寫） |
| `isTickerReviewBlocking` | pending + 可見空 → 不擋 | pending → **一律擋簽核** |
| ack | `instrumentNeedsKey` | **不變** |

本功能是 PR #13 的時序修正，不是取代。

### 10.2 Chip dedupe（PR #3／`proposedTickersAfterClarificationDedup`）

改為 `visibleProposedForUi` 的第二層。主閘 = clarifications-first；dedupe = 答完後避免與澄清選項重複勾選。

### 10.3 Sellable 防線（`sellable-universe.md`）

| 層 | 影響 |
|---|---|
| L1 prompt catalog | 無；Phase C 只加 clarifications／proposed 時序句 |
| L2 輸出過濾 | 無（仍在 BFF 組裝後） |
| L3 主題合成 | 露出延後；`mapTickersToProposed` 過濾不變 |
| L8 確認 warn | 僅在澄清完成後的 `confirmProposedTickers` 觸發（更合理） |

### 10.4 `instrumentNeedsKey`／「無新增標的」

- 澄清期間不可 ack（guard）。
- 澄清後 needs 指紋若因回答改變 → 舊 ack 失效 → 須重新確認或再 ack（既有語意）。

### 10.5 Drift sync／衝突卡

不改動。簽核更晚發生時，drift hint 仍依當前 overlay 計算。

### 10.6 Prior proposed merge（`wrapExtractAsOverlay` :525-530）

與「store 保留、UI 隱藏」**相容且必要**：澄清輪若模型省略 proposed，prior 保留 → 答完後仍有清單可審，避免閘道憑空消失。

---

## 11. 風險與回滾

### 11.1 風險

| 風險 | 等級 | 緩解 |
|---|---|---|
| 澄清遲遲不清空 → RM 看不到建議、以為系統壞了 | 中 | i18n `clarifyFirst`／`deferredHint`；composer placeholder 已有 `overlay.clarify.composerPending` |
| Pending 時擋簽核過嚴（與「可只答部分問題」文案拉扯） | 低 | 產品已要求全部澄清答完再確認標的；sendHint 可後續改「建議答完再送」但不在本期 |
| DI 澄清中已寫入 supplement | 中 | 文件化例外；必要時 follow-up 禁止 mid-clarify DI supplement |
| Phase C soft prompt 無效 | 低 | Client A+B 為真實閘門 |
| 舊測試「mid-clarify 不擋」語意翻轉 | 低 | 明確改寫測試與 JSDoc |

### 11.2 回滾

- **Feature 無旗標**（改動面小、純前端時序）：回滾 PR／revert F1–F6 即可恢復「澄清與面板並存」。
- Phase C 可單獨 revert prompt 段落，不影響 A+B。
- 不涉及 localStorage schema、不涉及引擎 → 無資料遷移回滾成本。

### 11.3 開放問題（本期不定案）

1. 是否在 BFF **硬清除**同輪 `proposed_tickers`（當 clarifications 非空）？
2. DI 是否禁止澄清中寫入 `supplement_tickers`？
3. `overlay.clarify.sendHint` 是否改為「建議答完所有澄清再送出」以配合本流程？

---

## 12. 驗收清單（Definition of Done）

- [ ] `visibleProposedForUi` + 調整後 `isTickerReviewBlocking` 單測全綠
- [ ] 澄清 pending：面板隱藏、無法加入／無新增、無法簽核
- [ ] 澄清清空：一次出現建議確認 → 通過後可簽核
- [ ] 無澄清路徑與 PR #13 行為一致
- [ ] 摘要卡在 pending 時不列「建議參考標的」
- [ ] Chip 去重在澄清結束後仍有效
- [ ] Sellable／DI／「無新增」ack 回歸通過
- [ ] i18n 三語新 key 齊備
- [ ] （可選）Phase C prompt 已加 soft 約束

---

*本文件僅為施工說明書；實作與 commit 另開任務。*
