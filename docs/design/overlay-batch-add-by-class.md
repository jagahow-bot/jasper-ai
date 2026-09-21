# Overlay「全部／整類」批次納入（Batch Add by Class）施工說明書

> **版本**: 0.2（§13 全部 8 項決議已鎖定）
> **狀態**: Draft — 全部 8 項決議已確認，可施工
> **日期**: 2026-09-21
> **讀者**: Web/BFF 工程師、RM 產品負責人
> **相關文件**:
> - [`docs/design/sellable-universe.md`](./sellable-universe.md)（可銷售目錄注入 L1、輸出硬過濾 L2、八條防線；本功能直接站在其肩膀上）
> - [`docs/design/overlay-defer-ticker-confirm.md`](./overlay-defer-ticker-confirm.md)（澄清完成後才露出建議標的；本功能的批次清單遵守同一時序閘）
> - [`docs/design/overlay-param-whitelist-expansion.md`](./overlay-param-whitelist-expansion.md)（give AI the actionable catalog 的同款哲學）
> **適用程式碼**: `apps/web`（Next.js BFF + Overlay UI）；**不動** `apps/api` 引擎
>
> 所有檔案路徑與行號均經實際代碼核對（2026-09-21 工作區狀態）；universe 統計數字為 `node` 實掃 `shared/etf-universe.json` 的結果。
> **v0.2 變更摘要**：鎖定 §13 Q1–Q8；取消單批硬上限 50 → 全量展開＋分頁呈現＋一次確認；展開不剔除 anchor／模型持有；無離線 rule-fallback；確認後可依 `bulk_id` 撤銷；摘要卡醒目標示「批次 N 檔」。

---

## 1. 目標與範圍

### 1.1 問題陳述

RM 在 overlay 對話中常有「整類納入」的需求：

- 「把基金池裡的 **AI 相關基金全部**加入」
- 「**債券類 ETF 都納入**」
- 「**另類資產全部**加進來」

現行系統對這類話語只有「精選」一條路：

1. Interpret prompt（`apps/web/src/app/api/overlay/interpret/route.ts:348`）明確指示主題需求「list **3–6** concrete candidates」，且 :350 明文「**Never** add large thematic ETF lists to supplement_tickers automatically」。
2. 客戶端主題合成上限 12 檔（`overlay-filter-proposals.ts:391-399` 的 `push` 守門與 :441 的 `slice(0, 12)`；併入時 `mergeFilterProposedIntoOverlay` :110 再 `slice(0, 12)`）。
3. 建議面板的「全選」（`OverlayChatTimeline.tsx:182-197`）只對那份 3–12 檔短名單有效——**「全選」≠「整類」**。

結果：RM 說「全部」，系統只給 3–6 檔，剩下的要 RM 自己到標的池頁翻找，或反覆追問補齊。可銷售目錄（394 檔）已注入 prompt，AI 看得到全量，卻沒有欄位可以表達「把這一段全部展開」。

### 1.2 目標（本功能要做的）

| # | 目標 | 說明 |
|---|---|---|
| G1 | **批次意圖識別** | Gemini 能分辨「全部／整類／都納入／all … in the pool」（batch intent）與「推薦幾檔／精選」（curated intent），前者以新的結構化欄位表達（§3.1、§4）。 |
| G2 | **目錄展開** | BFF 端依 `asset_class`／`category`／`product_type`／主題關鍵字，從**可銷售宇宙**（universe − `non_sellable_tickers`）確定性展開成**完整清單**（不硬截斷），掛進 `proposed_tickers`（§3.2、§3.3）。 |
| G3 | **全量＋分頁** | **不設單批硬上限**；展開結果以分頁呈現（軟 UI page size，建議 50／頁，僅顯示用）；**一次確認**即可（沿用現有建議標的確認，不分頁再確認）（§3.4、§6、§13 Q1）。 |
| G4 | **分組 UI** | 建議面板以 `bulk_id` 分組呈現（組標題＋檔數＋組內全選＋可摺疊／分頁），RM 可反選後一次確認（§6、§13 Q7）。 |
| G5 | **確認時序不變** | 批次清單與精選清單走同一條 `visibleProposedForUi` 閘：澄清未完成不露出 ticker；確認後才寫入 `supplement_tickers`（§3.6，對齊 overlay-defer-ticker-confirm）。澄清期間可顯示批次範圍標籤（§13 Q6）。 |
| G6 | **留痕與撤銷** | interpret response 新增 `bulk_report`（每組 matched/kept）；摘要卡醒目標示「批次 N 檔」（不擋流程、無 supervisor 閘）；確認後可依 `bulk_id`「撤銷此批次」（§3.5、§6、§8、§13 Q4／Q7）。 |

### 1.3 非目標（Explicit Non-Goals）

- N1：**不動引擎**（`apps/api`）。`universe_supplement_tickers` 引擎側本無長度上限（`apps/api/app/models.py:198-206`）；web schema 既有 `max(50)` 需伴隨本功能**放寬／移除**以承載全量展開（§3.4、§5）。
- N2：不改變既有「精選 3–6 檔」行為；curated 與 batch 並存，不是取代。
- N3：~~不做「已確認 supplement 的整批收回」UI~~ → **已決議做**：確認後可依 `bulk_id`「撤銷此批次」（§13 Q7）。
- N4：**不補規則 fallback**。無離線情境，一律走線上 AI；`interpretOverlayFallback` 不產生 `bulk_include`（§13 Q5）。
- N5：不做價格歷史預檢；資料不足標的維持引擎端 `excluded_late_listing` 後端呈現（§3.4、§13 Q8）。
- N6：不改標的池頁的 sellable 批次開關（那是管理可銷售狀態的功能；本功能只**消費**可銷售狀態）。

### 1.4 設計原則

與 sellable-universe §3.8 同一哲學——*give AI the actionable catalog*：AI 負責**辨識意圖與範圍**（「債券類 ETF」→ `{asset_class: "bond", product_type: "etf"}`；主題／category 由 Gemini 給），**枚舉交給確定性代碼**（BFF 端以靜態表／catalog filter 展開；對不上則澄清，§13 Q3）。AI 不再逐檔默寫整類 ticker（會漏、會幻覺、會超 token），只輸出範圍描述。展開結果**全量**物化，UI 以分頁消化可讀性，寫入前永遠一次 RM 確認閘。

---

## 2. 現況分析

### 2.1 Universe 資料現況（2026-09-21 實掃）

`shared/etf-universe.json`（version `1.2`，updated `2026-09-21`），共 **651 筆**；web 端經 `npm run sync-universe` 同步至 `apps/web/src/data/etf-universe.json`，由 `apps/web/src/lib/universe.ts:57-59` `getUniverseItems` 讀入。

| asset_class | 總數 | etf | fund | stock | 預設可銷售（etf+fund） |
|---|---|---|---|---|---|
| equity | 512 | 215 | 40 | 257 | **255** |
| bond | 81 | 74 | 7 | 0 | **81** |
| commodity | 24 | 24 | 0 | 0 | **24** |
| real_estate | 14 | 13 | 1 | 0 | **14** |
| alternative | 20 | 20 | 0 | 0 | **20** |
| **合計** | **651** | 346 | 48 | 257 | **394** |

- `alternative` 的 category 分佈：`income` 4、`credit_alt` 3、`alt_hedge` 4、`alt_managed_futures` 3、`preferred` 4、`multi_alt` 2 —— 「另類資產全部」= 20 檔，規模適合批次。
- 「債券類 ETF 都納入」= asset_class=bond ∧ product_type=etf = **74 檔** —— 全量展開進 proposed，UI 以分頁呈現（§3.4、§6；§13 Q1）。
- 「股票類全部」（預設可銷售 255 檔）同樣全量展開＋分頁；含糊範圍仍先澄清（§4 規則 4）。
- `ASSET_CLASSES`（`apps/web/src/lib/constants.ts:1-7`）僅五值 `equity/bond/commodity/real_estate/alternative`，**無 cash**；category keys 見 `CATEGORY_LABELS`（constants.ts:64-103，約 33 鍵）。

### 2.2 「全部／整類」在現行 prompt 的處理

`overlaySystemPrompt`（interpret/route.ts:290-453）相關規則：

| 座標 | 現行文案 | 對批次意圖的影響 |
|---|---|---|
| :348 | 主題／產業未給明確代號時「list **3–6** concrete candidates」於 `proposed_tickers` | 精選上限的直接來源（prompt 層） |
| :350 | 「**Never** add large thematic ETF lists to `supplement_tickers` automatically」 | 明確禁止 AI 自行枚舉大清單 |
| :349 | 有 clarifications 時偏好留空 `proposed_tickers` | defer-confirm 的 prompt 軟約束（本功能沿用） |
| :227-244（`buildSellableCatalogBlock` 規則段） | proposed/supplement 必須取自可銷售目錄、主題需求直接配基金/ETF | 只約束「從哪選」，沒有「選多少」的批次語義 |

結論：現行 prompt **沒有任何批次概念**；AI 聽到「全部」時只能 (a) 違心精選 3–6 檔，或 (b) 違規枚舉（會撞 :350 禁令與輸出長度）。

### 2.3 proposed → supplement 的現行資料流（已核對）

```
interpret 回傳 overlay.universe.proposed_tickers
  → client setOverlay(ensureProposedTickersForReview(...))   (OverlayConversationPanel.tsx:331-334)
  → proposedTickers memo = visibleProposedForUi(...)          (:699-705；澄清中一律 [])
  → ProposedTickersInline 面板                                (OverlayChatTimeline.tsx:436-445 渲染閘；:139-264 本體)
       ├─ 全選/全不選（:182-197，只對當前候選短名單）
       └─ [加入選取的 N 檔] → onConfirm([...selected])
  → confirmProposedTickers                                    (OverlayConversationPanel.tsx:626-668)
       ├─ uniqueTickers 合併進 universe.supplement_tickers    (:629-631)
       ├─ 從 proposed_tickers 移除已確認者                    (:633-635, :642)
       ├─ 聊天室追加 confirmMessage；非可銷售者加警告         (:650-666)
       └─ setNoAddsAckKey(null)                               (:648)
  → 簽核閘 isTickerReviewBlocking                             (overlay-filter-proposals.ts:466-490)
  → 簽核後 overlayToBacktestRequest → universe_supplement_tickers
       （locked 路徑 overlay-schema.ts:1464-1465；open-pool :1510-1512）
```

關鍵觀察：`confirmProposedTickers` 對**任意長度**的勾選清單都能工作（純字串合併），UI 面板才是瓶頸——平面 checkbox 列表在數十～數百檔時不可用，需要**分組＋分頁**（§6）。確認仍為**一次**（不分頁再確認，§13 Q1）。

### 2.4 可銷售過濾現況（本功能的展開基礎）

| 層 | 座標 | 說明 |
|---|---|---|
| L1 目錄注入 | interpret/route.ts `buildSellableCatalogBlock` :208-245；組裝 :550 | BFF 端以本地 universe JSON − body `non_sellable_tickers` 推導可銷售目錄，compact `TICKER\|name\|product_type` 注入 system prompt |
| L2 輸出硬過濾 | interpret/route.ts `applySellableOutputFilter` :247-288；呼叫 :665 | proposed 全濾、supplement 濾非明示點名者；回填 `sellable_blocked` |
| L3 主題合成過濾 | overlay-filter-proposals.ts `mapTickersToProposed` :339-361（:357 呼叫 `filterSellableProposed`） | client 純函式 |
| L5 universe filter route | universe/filter/route.ts `applySellableGate` :108-117 | AI/fallback 輸出皆過閘 |
| L6 resolve-overlay-universe | resolve-overlay-universe.ts :82-87（locked proposed）、:216-227（open-pool extras） | client |
| body 合約 | `non_sellable_tickers` 上送點：OverlayConversationPanel.tsx:266；resolve-overlay-universe.ts:56 | server 無 localStorage，由 client 算好補集上送 |

**本功能的展開直接在 BFF 端以同一個 `sellableCtx` + 本地 universe JSON 進行（§3.2），與 L1 目錄同源**，L2 硬過濾原樣保留為 safety net——雙層防禦語意與 sellable-universe §3.8.5 一致。

### 2.5 現行各層級的「量」的上限（釐清 3–6／12／50 三個數字）

| 上限 | 數值 | 座標 | 性質 |
|---|---|---|---|
| 精選建議（prompt 指示） | 3–6 | interpret/route.ts:348 | 軟指示 |
| 主題合成（client 補救） | 12 | overlay-filter-proposals.ts:391-399、:441；`mergeFilterProposedIntoOverlay` :110 | 程式硬截斷（**僅 curated／主題合成**；批次路徑不走此截斷） |
| `proposed_tickers` schema | 50（現行） | overlay-schema.ts:192（`max(MAX_DIRECT_INDEX_SLEEVE)`） | zod 硬上限 → **本功能須放寬／移除**以承載全量批次（§5） |
| `supplement_tickers` schema | 50（現行） | overlay-schema.ts:190（同上） | 同上 |
| `MAX_DIRECT_INDEX_SLEEVE` | 50 | direct-indexing.ts:33（註解稱對齊引擎 `max_holdings` le=50；現行引擎實為 le=150，models.py:235-239，**註解已過期**） | DI sleeve 常數；**不**作為批次上限 |
| 引擎 `universe_supplement_tickers` | **無上限** | models.py:198-206（僅語意描述，無 `max_items`） | — |

**決議（§13 Q1）**：批次**不設硬上限**；展開全量可銷售匹配結果；UI 以分頁（軟 page size，建議 50／頁）呈現；確認一次。web schema 的 50 收口僅保留給 DI／非批次語意時，需為批次路徑放寬（§5）。

### 2.6 可直接複用的現有機制

| 機制 | 位置 | 複用方式 |
|---|---|---|
| 可銷售目錄推導（排序規則） | interpret/route.ts :208-245（product_type 序 etf→fund→stock、再按 ticker 字母 :212-217） | 展開結果的**確定性排序照搬**，輸出穩定利於除錯 |
| `sellableCtxFromTickers` / `filterSellableProposed` / `splitBySellable` | sellable-overrides.ts:150-158 / :182-199 / :162-179 | 展開閘與 fail-open 慣例 |
| `analyzeUniverseFilterFallback` | universe-filter-fallback.ts:116-160（`opts.ctx` :119） | by=theme 匹配器的關鍵字表參考（不直接呼叫，見 §3.3） |
| `visibleProposedForUi` / `isTickerReviewBlocking` / `instrumentNeedsKey` / `clearProposedTickers` | overlay-filter-proposals.ts :60-67 / :466-490 / :308-336 / :116-126 | 確認時序閘整組沿用，僅擴充指紋與清除範圍（§3.6） |
| `applyDirectIndexingToExtract` | overlay-direct-index.ts:100-142 | DI 優先權的介入點（§11 E8） |
| `extractExplicitTickersFromTexts` | locked-universe.ts（被 interpret/route.ts:253 使用） | L2 明示點名豁免，不受影響 |
| i18n 三語 dict | i18n.tsx en `overlay.proposedTickers.*` :1237-1258、zh :3285-3304、ko :5320-5340 | §8 keys 掛同區段 |
| 測試慣例 | vitest，測試檔與被測檔同目錄（`overlay-filter-proposals.test.ts`） | §9 |

---

## 3. 核心設計

### 3.1 意圖識別：batch vs curated

**由 Gemini 在 interpret 時判斷**（prompt 規則全文見 §4），判斷結果以結構化欄位承載，client 不做 regex 猜測：

| RM 話語 | 意圖 | AI 輸出 |
|---|---|---|
| 「推薦幾檔 AI ETF」「精選 3 檔半導體」「挑一些配息基金」 | curated | 既有 `proposed_tickers`（3–6 檔，:348 規則不變） |
| 「AI 相關基金**全部**加入」「債券類 ETF **都納入**」「另類資產**全部**加進來」「**all** bond funds in the pool」 | batch | 新增 `universe.bulk_include`（§3.2 範圍描述），**不**逐檔枚舉 |
| 「AI 精選 3 檔，**另外**債券 ETF 全納入」 | 混用 | `proposed_tickers`（3 檔精選）＋ `bulk_include`（債券 ETF）並存（§11 E3） |
| 範圍含糊（「股票全部」可能是 255 檔可銷售基金或含個股） | 不明 | 出**一題**澄清，選項為具體範圍（§4 規則 4） |
| theme／category 對不上靜態表或 catalog | 不明 | 澄清（§13 Q3），不猜測大清單 |

觸發詞表（寫進 prompt 作為錨點，非窮舉）：`全部 / 整類 / 都納入 / 全加 / 全部納入 / 整個類別 / all / every / entire class`。反向錨點（curated）：`推薦 / 精選 / 幾檔 / 挑 / suggest a few / pick`。

### 3.2 展開策略：`universe.bulk_include`＋`proposed_tickers[].bulk_id`

**採用方案 B（獨立 `bulk_include` 區塊）**，不採在 `proposed_tickers` 條目上加 `expand_by`：

- `proposed_tickers` 條目語意是「一檔一筆候選」（`overlayProposedTickerSchema`，overlay-schema.ts:174-183）；把範圍描述塞進單檔條目會讓「這一筆到底是候選還是範圍」產生歧義，且破壞現有渲染與合併邏輯。
- 獨立區塊讓「意圖記錄」（audit／摘要／UI 分組標題／撤銷）與「物化結果」（proposed 清單）分離：區塊保留在 overlay 上供摘要與分組，物化的 ticker 走既有 proposed→confirm→supplement 管線；撤銷依 `bulk_id` 從 supplement 整批移除（§6.4）。

**Schema（詳 §5）**：`universe.bulk_include?: BulkInclude[]`（max 4），每筆為平面範圍描述：

```ts
{
  id: "bulk-1",
  label: "債券類 ETF 全部",        // RM-facing 短標籤（報表語言）
  asset_class: "bond",            // 可選；五值之一
  product_type: "etf",            // 可選；etf|fund|stock
  category: "us_thematic",        // 可選；catalog category key（Gemini 可直接給）
  theme: "AI 人工智慧"            // 可選；自由主題詞（BFF 靜態表展開）
}
```

四個 scope 欄位**至少一個存在**，多個並存時取**交集**（AND）——「債券類 ETF」= `{asset_class: "bond", product_type: "etf"}`。

**物化連結**：展開產生的 `proposed_tickers` 條目帶上 `bulk_id: "bulk-1"`（§5 對 `overlayProposedTickerSchema` 的唯一新增欄位），UI 據此分組；精選候選無 `bulk_id`，自成一組。確認寫入 supplement 時**保留 `bulk_id` 對應關係**（見 §5／§6.4），供撤銷使用。

### 3.3 展開函式：`apps/web/src/lib/overlay-bulk-include.ts`（新增）

```ts
import type { OverlayProposedTicker } from "@/lib/overlay-schema";
import type { SellableCtx } from "@/lib/sellable-overrides";

/** 軟 UI 分頁大小：僅顯示用，非展開截斷上限（§13 Q1）。 */
export const BULK_UI_PAGE_SIZE = 50;
/** 單次 interpret 最多接受的批次範圍數。 */
export const MAX_BULK_INCLUDE_GROUPS = 4;

export type BulkInclude = {
  id: string;
  label: string;
  asset_class?: string;
  product_type?: string;
  category?: string;
  theme?: string;
};

export type BulkGroupReport = {
  id: string;
  label: string;
  /** 可銷售目錄中符合範圍的總數（去重前）。 */
  matched: number;
  /** 實際列入 proposed 的檔數（去重後；= matched − 被 exclude／已確認／跨組重複剔除者）。 */
  kept: number;
  /** 主題／category 對不上靜態表或 catalog 時為 true → 應澄清，不物化。 */
  unresolved?: boolean;
};
```

```ts
export function expandBulkInclude(
  entries: readonly BulkInclude[],
  opts: {
    ctx?: SellableCtx;                       // 可銷售閘（server body / client store）
    lang: "en" | "zh" | "ko";                // rationale 語言
    excludeTickers?: ReadonlySet<string>;    // universe.exclude_tickers
    supplementTickers?: ReadonlySet<string>; // 已確認，不再列
    // 注意：不傳／不用 anchorTickers — 展開不剔除 anchor／模型持有（§13 Q2）
    priorProposedTickers?: ReadonlySet<string>;
  },
): { proposed: OverlayProposedTicker[]; reports: BulkGroupReport[] };
```

行為規格：

1. **逐組匹配**：對 `getUniverseItems()`（universe.ts:57-59）逐筆測試——`asset_class` 等值比對（須 ∈ `ASSET_CLASSES`，非法值整組跳過並記 report）；`product_type` 等值比對（缺欄視同 `"etf"`，對齊 universe.ts:12 註解與 catalog block :213 的預設）；`category` 等值比對（須 ∈ `CATEGORY_LABELS` keys）；`theme` 走關鍵字匹配器（下述）。多欄位取交集。
2. **theme／category 策略（§13 Q3）**：Gemini 給 `theme` 與／或 `category`；BFF 用靜態表展開。`matchThemeToUniverseItems(theme, items)`：新模組內建 `BULK_THEME_MATCHERS` 表（AI/人工智慧/機器人/半導體/ESG/綠能/潔淨能源/配息/黃金/能源/REIT/不動產/長天期債…→ regex，參考 `THEME_PROPOSAL_BUCKETS` 的 match 欄 overlay-filter-proposals.ts:168-232 與 fallback 的關鍵字表 universe-filter-fallback.ts:109-112），對 `name + category + asset_class` 小寫串做 regex；表外主題 fallback 為 theme 原文對 `name` 的子串比對。**對不上**（matched=0 且 theme／category 為主 scope）→ report `unresolved: true`，**不物化**，由 interpret／澄清路徑請 RM 縮小或改選具體範圍。**確定性、可單測**，不呼叫 LLM。
3. **可銷售閘**：匹配結果經 `filterSellableProposed(…, opts.ctx)`（sellable-overrides.ts:182-199），沿用 fail-open 慣例。仍僅 sellable-only。
4. **去重**：剔除 `excludeTickers`（RM 明確排除優先，§11 E5）、`supplementTickers`（已在池內不再建議）、`priorProposedTickers`、以及跨組重複（先前者優先）。**不剔除** anchor／模型持有（§13 Q2）——整類全列；若確認時該檔已在持倉／supplement，寫入無實質效果（idempotent merge）。
5. **確定性排序**：product_type 序（etf→fund→stock）→ ticker 字母序（照搬 catalog block :212-217）。
6. **不截斷**：`kept` 可為任意檔數（例如債券 ETF 74、股票基金 255）；**無** `MAX_BULK_INCLUDE_TICKERS` 硬上限。UI 以 `BULK_UI_PAGE_SIZE` 分頁呈現（§6）。
7. **rationale**：每檔帶本地化一句話，zh 如 `整類納入：{label}`，en `Batch include: {label}`，ko `일괄 포함: {label}`。
8. **條目 asset_class 欄**：直接落 catalog 的 `asset_class`（供 `universeSupplementMetaFromOverlay`（overlay-schema.ts:989-1030）下游使用，catalog row 在引擎端本來就優先，此為 belt-and-braces）。

**呼叫點（interpret route，BFF 端）**：在 parse 管線中插入，與現有轉換同級：

```
extract = validateOverlayExtract(...)            (:610)
extract = syncExtractClarifications(extract, lang)   (:611)
extract = applyDirectIndexingToExtract(extract, …)   (:612)
extract = expandBulkIncludeInExtract(extract, {      // NEW
  ctx: sellableCtx, lang,                            // sellableCtx 來自 :547-549
  // 不注入 anchorTickers（§13 Q2）
})
overlay = wrapExtractAsOverlay(...)              (:636)
… applySellableOutputFilter(overlay, sellableCtx, …) (:665, L2 原樣保留為 safety net)
```

- `expandBulkIncludeInExtract` 為 route 內小 wrapper：讀 `extract.universe.bulk_include`，呼叫 `expandBulkInclude`，把結果**附加**到 `extract.universe.proposed_tickers`（精選在前、批次在後），空組（matched=0 或 kept=0、非 unresolved）保留在 `bulk_include` 由 report 呈現「無符合標的」（§6.3）；`unresolved` 組觸發／附帶澄清而非物化。
- **DI 護欄**：`extract.universe.construction === "direct_index"` 時整輪跳過展開、丟棄 `bulk_include` 並 `console.info`（§11 E8）。
- response 新增 `bulk_report?: BulkGroupReport[]`（比照 `sellable_blocked` 的條件式回傳，interpret/route.ts:672-674 模式）。
- **規則 fallback 路徑**（`runFallback` :554-565）：**不補**批次偵測（§13 Q5）；`interpretOverlayFallback` 不產生 `bulk_include`，展開自然為 no-op。無離線情境，一律走線上 AI。

### 3.4 安全與規模閘

| 閘 | 值／規則 | 理由 |
|---|---|---|
| 單批檔數硬上限 | **無**（§13 Q1） | 全量展開可銷售匹配結果；引擎 supplement 無長度上限 |
| UI 分頁（軟） | **`BULK_UI_PAGE_SIZE = 50`**（僅顯示） | 大清單可讀性；**不分頁再確認**——勾選狀態跨頁保留，一次確認 |
| 單輪批次組數 | **4**（schema `max(4)`） | 防止 AI 一次把五大類全展開成五組；實務上 RM 一句話 1–2 組 |
| 必須可銷售 | 展開源 = universe − `non_sellable_tickers`（與 L1 目錄同源）＋ L2 硬過濾保留 | 雙層防禦，同 sellable-universe §3.8.5 |
| 必須在 catalog | 展開本來就從 `getUniverseItems()` 出發 | 構造上保證；合成 stub／CASH 永不可能被展開（§11 E12） |
| web schema 容量 | `proposed_tickers`／`supplement_tickers` 為批次路徑**放寬或移除**既有 `max(50)`（§5） | 否則全量展開會撞 zod |
| 價格資料 | **本期不預檢**（§13 Q8）；資料不足者由引擎 `excluded_late_listing`（apps/api/app/engine/data.py:514-515）在回測端排除並呈現 | 預檢需跨層查價格快取，不做 |
| 範圍合法性 | 非法 `asset_class`／空 scope 的組整組跳過；theme／category 對不上 → unresolved＋澄清（§13 Q3） | 容錯在展開層，不讓單組壞資料炸掉整輪 interpret（§5 取舍） |

### 3.5 確認後的狀態清理（prune）與撤銷錨點

`bulk_include` 是「意圖記錄」，其生命週期：

| 事件 | 處理 |
|---|---|
| AI 新輪**省略** `bulk_include` | `wrapExtractAsOverlay` 的 `mergedUniverse` 以 spread 合併（overlay-schema.ts:533-534），prior 值**自動保留**——分組標題不因 LLM 省略而消失（與 `mergedProposed` :528-532 的保留哲學一致） |
| AI 明確回 `bulk_include: []` | 清除（spread 以新值覆蓋）；prompt 指示「每輪重發完整欲保留清單，或回 [] 清空」（§4） |
| RM 確認（`confirmProposedTickers`） | 現有邏輯已把已確認者移出 proposed（OverlayConversationPanel.tsx:633-635）；**新增**：`bulk_include` 過濾為「仍有成員留在 proposed」的組（整組確認完畢 → 組記錄自 pending 消失）；同時把該組 `bulk_id` → 確認 ticker 清單寫入 **`confirmed_bulk_batches`**（或等效結構，§5／§6.4），供「撤銷此批次」 |
| RM「撤銷此批次」（§13 Q7） | 依 `bulk_id` 自 `supplement_tickers`（及 meta）移除該批寫入的 ticker；清除對應 `confirmed_bulk_batches` 條目；聊天室追加撤銷訊息 |
| RM 按「無新增標的」（`skipProposedNoAdds` :670-688 → `clearProposedTickers`） | `clearProposedTickers`（overlay-filter-proposals.ts:116-126）**連帶清 `bulk_include`**（不影響已確認批次） |
| 簽核 | 既有路徑經 `decideFilterProposalInterrupt` → `clearProposedTickers`（:148-151），同上連帶清除 pending |

### 3.6 確認時序（對齊 defer-ticker-confirm）

- 批次物化的 proposed ticker 與精選 proposed **同閘**：澄清 pending 時 `visibleProposedForUi`（overlay-filter-proposals.ts:60-67）一律回 `[]`，面板不露出 ticker、不可確認、不可簽核（`isTickerReviewBlocking` :466-490 現行語意不變）。
- **摘要卡批次範圍標籤**在澄清期間**仍顯示**（不含具體 ticker，§13 Q6）——讓 RM 預期「等一下會有一整組要審」。
- `instrumentNeedsKey`（:308-336）指紋**加入批次簽名**：`(bulk_include ?? []).map(b => [b.id, b.asset_class, b.category, b.product_type, b.theme].filter(Boolean).join(":")).sort()`——批次意圖改變時舊「無新增標的」ack 自動失效。
- `overlayNeedsNewInstruments`（:268-305）新增：`bulk_include?.length > 0 → true`。涵蓋「展開後 0 檔」（例如整類皆非可銷售）仍需 RM 以「無新增標的」ack 收尾的路徑。

---

## 4. Prompt 更新（interpret route）

在 `overlaySystemPrompt`（interpret/route.ts:290-453）的 universe 規則段（:348-350 附近）之後新增 BATCH INCLUDE 段；並在 `buildSellableCatalogBlock`（:208-245）規則段尾追加一行 category keys（供 by=category 使用，約 33 鍵、一行可容納）。規則本文用英文以省 token（沿用 §3.8.2 慣例）：

```
BATCH INCLUDE (「全部 / 整類 / 都納入 / 全加 / all … / entire class」):
1. When the RM asks to include an ENTIRE class / product type / category /
   theme from the sellable catalog — e.g. "把基金池裡的 AI 相關基金全部加入",
   "債券類 ETF 都納入", "另類資產全部加進來" — emit universe.bulk_include
   entries instead of enumerating tickers:
     { "id": "bulk-1", "label": "<RM-facing short label, report language>",
       "asset_class"?: "equity"|"bond"|"commodity"|"real_estate"|"alternative",
       "product_type"?: "etf"|"fund"|"stock",
       "category"?: "<one of the catalog CATEGORY KEYS below>",
       "theme"?: "<the RM's theme phrase as-is, e.g. \"AI 人工智慧\">" }
   - Prefer a catalog CATEGORY KEY when the ask maps cleanly; otherwise
     pass theme and let the server expand via its static matcher.
   - At least one scope field per entry; multiple fields are ANDed
     ("債券類 ETF" → {"asset_class":"bond","product_type":"etf"}).
   - Max 4 entries per turn. Re-emit the FULL still-wanted list every turn
     (omitted key keeps prior entries; emit [] to clear them).
2. The SERVER expands each entry into the FULL matching sellable list
   (no hard ticker cap). NEVER enumerate the batch tickers yourself in
   proposed_tickers or supplement_tickers — you may still emit a few
   curated proposed_tickers for a DIFFERENT, curated need in the same turn.
3. Curated asks (「推薦幾檔」「精選」「挑 N 檔」"suggest a few") keep the
   existing 3–6 proposed_tickers behavior — do NOT use bulk_include for them.
4. If the scope is ambiguous (e.g. "股票全部" could mean all sellable equity
   funds or also individual stocks), OR the theme/category cannot be mapped
   confidently, ask ONE clarification with concrete scoped options instead
   of guessing a huge batch.
5. bulk_include respects direct_index: never emit it for the stock sleeve of
   a direct-indexing brief (the N-stock sleeve rule already applies).
```

Category keys 注入（catalog block 規則段尾，一行）：

```
CATEGORY KEYS (for bulk_include.category): us_broad, us_growth, us_size, us_factor, us_sector, us_industry, us_thematic, us_esg, intl_developed, …  (自 CATEGORY_LABELS keys 動態列出)
```

**Token 預算**：BATCH INCLUDE 段約 350 tokens；category keys 一行約 120 tokens。對照 §3.8.4（sellable-universe）既有 system 端 8k–11k tokens 的估算，增幅 <6%，可接受。既有 :350「Never add large thematic ETF lists」規則保留——批次現在走 `bulk_include`，不是解禁 AI 自行枚舉。

---

## 5. Schema 變更（`apps/web/src/lib/overlay-schema.ts`）

```ts
/** Batch-include scope from「全部／整類」intent (design: overlay-batch-add-by-class). */
export const overlayBulkIncludeSchema = z
  .object({
    id: z.string().min(1).max(40),
    /** RM-facing short label (report language), e.g. "債券類 ETF 全部". */
    label: z.string().min(1).max(80),
    asset_class: z.enum(ASSET_CLASSES).optional(),
    product_type: z.enum(["etf", "fund", "stock"]).optional(),
    /** Catalog category key (CATEGORY_LABELS). */
    category: z.string().min(1).max(40).optional(),
    /** Free-text theme phrase; server-side keyword matcher expands it. */
    theme: z.string().min(1).max(60).optional(),
  })
  .strip();

export type OverlayBulkInclude = z.infer<typeof overlayBulkIncludeSchema>;

/** Confirmed batch ledger for revoke-by-bulk_id (§13 Q7). */
export const overlayConfirmedBulkBatchSchema = z
  .object({
    bulk_id: z.string().min(1).max(40),
    label: z.string().min(1).max(80),
    tickers: z.array(z.string().min(1)).min(1),
    confirmed_at: z.string().min(1).optional(),
  })
  .strip();
```

1. `universeRuleOverlaySchema`（:187-195）新增：
   `bulk_include: z.array(overlayBulkIncludeSchema).max(4).optional(),`
   ——extract 與 client overlay 共用此 schema（:319、:340），一次新增兩端生效；`wrapExtractAsOverlay` 不需改（spread 自動保留／覆蓋語意，§3.5）。
2. `overlayProposedTickerSchema`（:174-183）新增：
   `bulk_id: z.string().max(40).optional(),`（JSDoc：links to `universe.bulk_include[].id`；精選候選省略）。
3. **放寬容量（§13 Q1）**：`proposed_tickers`／`supplement_tickers` 既有 `max(50)` **對批次路徑不可再卡死**——實作時改為足夠大的上限（例如對齊可銷售宇宙上限 ~400，或與引擎 `max_holdings` le=150／全可銷售目錄取合理值），或改為無 max 並在 UI／產品層靠確認閘把關。DI sleeve 仍可用 `MAX_DIRECT_INDEX_SLEEVE` 約束，勿與批次共用同一個硬 50。
4. Client overlay 新增 `confirmed_bulk_batches?: ConfirmedBulkBatch[]`（或掛在 `universe` 下），供 §6.4 撤銷；不需上送引擎。

**取舍說明**：`asset_class`／`product_type` 用嚴格 enum（與 proposed 條目的 `asset_class` :179 一致）；非法值會使整輪 extract parse 失敗——此風險與現況相同，可接受。`category`／`theme` 用寬鬆 string，合法性在展開層判定；對不上則 unresolved＋澄清（§13 Q3），避免單組壞資料炸掉整輪（§12 R6）。

---

## 6. UI/UX

### 6.1 面板分組與分頁（`ProposedTickersInline` 擴充，OverlayChatTimeline.tsx:139-264）

候選含 `bulk_id` 時改為**分組＋分頁**渲染（無 `bulk_id` 者維持現行平面渲染，零回歸）：

```
┌─ 建議參考標的 ──────────────────────────── 全選（94 檔）／全不選 ┐
│ 精選建議                                                        │
│   ☑ AIQ — Global X 人工智慧 ETF   AI／科技主題 ETF               │
│   ☑ BOTZ — 機器人與人工智慧       AI／科技主題 ETF               │
│                                                                 │
│ ▼ 債券類 ETF（全部 74 檔）                        [全選本組]     │
│   ☑ AGG — 美國綜合債券                                          │
│   ☑ BND — Vanguard 總體債券                                     │
│   …（本頁最多 50 檔）                                            │
│   [‹ 上一頁]  第 1／2 頁  [下一頁 ›]                             │
│                                                                 │
│ ▶ 另類資產（全部 20 檔）                          [全選本組]     │
│                                                                 │
│ [加入選取的 94 檔標的]            [無新增標的]                    │
└──────────────────────────────────────────────────────────────────┘
```

行為細節：

1. **分組**：純函式 `groupProposedByBulk(proposed, bulkInclude, bulkReports)`（放 `overlay-filter-proposals.ts` 或新模組）回傳有序組陣列；精選組（`bulk_id` 空）固定在最前，標題 i18n `bulkCuratedLabel`。
2. **組標題列**：`label`（來自 `bulk_include[].label`）＋組內檔數＋組內全選／全不選切換；組 >8 檔時**預設摺疊**（▶）。
3. **分頁（§13 Q1）**：組內超過 `BULK_UI_PAGE_SIZE`（50）時分頁呈現；**勾選狀態跨頁保留**；**不分頁再確認**——確認鈕對「目前所有已勾選」一次生效。
4. **整體全選**：既有 :182-197 的切換保留，label 帶總數（`allWithCount`）；全選＝全組全量，不只本頁。
5. **反選（§13 Q7）**：確認前可任意反選單檔／清組／全不選。
6. **空組／unresolved**：`kept === 0` 且非 unresolved → dim 提示（`bulkEmpty`）；`unresolved` → 走澄清，不渲染 checkbox。
7. **確認鈕**：沿用 `addSelected {count}`（:248-250），不變。

### 6.2 確認與訊息（OverlayConversationPanel.tsx）

- `confirmProposedTickers`（:626-668）主流程不變；新增：
  - **訊息文案**：勾選 >10 檔時，assistant 確認訊息改用計數版 `confirmMessageBulk`（「已將 94 檔標的加入投資標的池」），不串接完整 ticker 清單（≤10 檔維持現行列舉版 `confirmMessage`）。
  - **prune**：依 §3.5 過濾 pending `bulk_include`；寫入 `confirmed_bulk_batches`。
  - **不再**因「合併 >50」硬截斷批次確認結果（§13 Q1）；schema 已放寬。若未來產品要軟提示「檔數偏多」可另加，不做硬擋。
- interpret response 的 `bulk_report` 存進 panel state（比照 `sellableBlocked` :291-294、:345-353 的處理模式），傳給 timeline 供 §6.1。
- `skipProposedNoAdds`（:670-688）經 `clearProposedTickers` 連帶清 pending `bulk_include`（§3.5）。

### 6.3 摘要卡（`formatOverlaySummary`，overlay-schema.ts:1657-1776）

在三語分支的「建議參考標的」行（zh :1709-1714／ko :1742-1747／en :1767-1772）後新增**批次範圍行**，並**醒目標示檔數**（§13 Q4）：

- zh：`批次納入（待確認）：債券類 ETF 全部（74 檔）、另類資產全部（20 檔）` — 或以獨立醒目行 `批次 94 檔`
- en：`Batch include (pending confirm): All bond ETFs (74), All alternatives (20)` / `Batch: 94 tickers`
- ko：`일괄 포함(확인 대기): …` / `배치 N개`

**決策（§13 Q4／Q6）**：

- 醒目標示「批次 N 檔」；**不擋流程、無 supervisor 閘**。
- 此行**不受** `hideProposedTickers` 影響——澄清期間隱藏的是具體 ticker 清單（defer-doc §3.6），範圍標籤不含 ticker、可讓 RM 預期「等一下會有一整組要審」。

### 6.4 撤銷此批次（§13 Q7）

確認後，在對話／摘要／建議區提供「**撤銷此批次**」動作（依 `bulk_id`）：

1. 從 `confirmed_bulk_batches` 查該 `bulk_id` 的 ticker 清單。
2. 自 `universe.supplement_tickers`（及相關 meta）移除那些 ticker（僅移除本批寫入者；RM 之後又手動／其他批次加回的同 ticker 以 ledger 語意為準——建議 ledger 記「本批寫入時的集合」，撤銷只移該集合與當前 supplement 的交集）。
3. 移除 ledger 條目；assistant 訊息：`revokeBulkMessage`（「已撤銷批次「{label}」（{count} 檔）」）。
4. 確認前的反選已涵蓋於 §6.1；撤銷僅針對**已確認**批次。

---

## 7. 檔案變更清單

| # | 檔案 | 變更 | 估計規模 |
|---|---|---|---|
| F1 | `apps/web/src/lib/overlay-schema.ts` | §5：`overlayBulkIncludeSchema`＋`universeRuleOverlaySchema.bulk_include`＋`overlayProposedTickerSchema.bulk_id`＋`confirmed_bulk_batches`；放寬 `proposed`／`supplement` max；`formatOverlaySummary` 三語批次行（含醒目 N 檔） | ~70 行 |
| F2 | `apps/web/src/lib/overlay-bulk-include.ts` | **新增**：`BULK_UI_PAGE_SIZE`／`BulkGroupReport`／`BULK_THEME_MATCHERS`／`matchThemeToUniverseItems`／`expandBulkInclude`（全量、不剔 anchor）（§3.3） | ~180 行 |
| F3 | `apps/web/src/lib/overlay-bulk-include.test.ts` | **新增**：§9.1 測試 | ~200 行 |
| F4 | `apps/web/src/app/api/overlay/interpret/route.ts` | §4 prompt 段＋category keys 行；`expandBulkIncludeInExtract` wrapper 插入 parse 管線（:612 之後）；DI 護欄；response 加 `bulk_report`（:669-675 區）；**不**改 fallback 偵測（§13 Q5） | ~60 行 |
| F5 | `apps/web/src/lib/overlay-filter-proposals.ts` | `instrumentNeedsKey`（:308-336）加批次簽名；`overlayNeedsNewInstruments`（:268-305）加 bulk 條件；`clearProposedTickers`（:116-126）連帶清 bulk；新增 `groupProposedByBulk` | ~50 行 |
| F6 | `apps/web/src/components/OverlayChatTimeline.tsx` | `ProposedTickersInline`（:139-264）分組渲染、組內全選、摺疊、**分頁**、空組提示 | ~140 行 |
| F7 | `apps/web/src/components/OverlayConversationPanel.tsx` | `bulk_report` state；`confirmProposedTickers`（:626-668）計數版訊息＋prune＋寫入 `confirmed_bulk_batches`；**撤銷此批次** handler（依 `bulk_id`）；`skipProposedNoAdds` 路徑不變（經 F5 自動生效） | ~80 行 |
| F8 | `apps/web/src/lib/overlay-filter-proposals.test.ts` | §9.2 測試 | ~60 行 |
| F9 | `apps/web/src/lib/i18n.tsx` | §8 全部 keys（en :1237 區、zh :3285 區、ko :5320 區）含分頁／撤銷 | ~3×14 行 |
| F10 | `apps/web/src/app/api/overlay/interpret/route.test.ts`（或同目錄新測試檔） | §9.3 route 層測試 | ~90 行 |

> 註：不動 `apps/api`；不動 `resolve-overlay-universe.ts`（批次 ticker 確認後即一般 supplement，L6 既有路徑自然涵蓋）；不動 `universe/filter/route.ts`；**不新增** `interpretOverlayFallback` 批次關鍵字偵測（§13 Q5）。

---

## 8. i18n 文案

新增 keys（`i18n.tsx` 三 dict 各一份，掛 `overlay.proposedTickers.*` 區段；插值用既有 `{name}` 語法）：

| Key | zh（繁中） | en | ko |
|---|---|---|---|
| `overlay.proposedTickers.allWithCount` | 全選（{count} 檔） | Select all ({count}) | 모두 선택 ({count}개) |
| `overlay.proposedTickers.bulkCuratedLabel` | 精選建議 | Curated picks | 엄선된 제안 |
| `overlay.proposedTickers.bulkGroupAll` | 全選本組 | Select group | 그룹 전체 선택 |
| `overlay.proposedTickers.bulkGroupNone` | 全不選本組 | Clear group | 그룹 선택 해제 |
| `overlay.proposedTickers.bulkExpandMore` | 展開其餘 {count} 檔 | Show {count} more | 나머지 {count}개 펼치기 |
| `overlay.proposedTickers.bulkCollapse` | 收合 | Collapse | 접기 |
| `overlay.proposedTickers.bulkPage` | 第 {page}／{total} 頁 | Page {page} of {total} | {page}/{total} 페이지 |
| `overlay.proposedTickers.bulkPrevPage` | 上一頁 | Previous | 이전 |
| `overlay.proposedTickers.bulkNextPage` | 下一頁 | Next | 다음 |
| `overlay.proposedTickers.bulkEmpty` | 「{label}」在可銷售目錄中無符合標的（可能全數不可銷售或不在標的池） | No sellable catalog instruments matched "{label}" (all non-sellable or out of universe) | "{label}"에 해당하는 판매 가능 종목이 없습니다 |
| `overlay.proposedTickers.confirmMessageBulk` | 已將 {count} 檔標的加入投資標的池。 | Added {count} tickers to the investment pool. | {count}개 종목을 유니버스에 추가했습니다. |
| `overlay.proposedTickers.revokeBulk` | 撤銷此批次 | Revoke this batch | 이 배치 취소 |
| `overlay.proposedTickers.revokeBulkMessage` | 已撤銷批次「{label}」（{count} 檔）。 | Revoked batch "{label}" ({count} tickers). | "{label}" 배치({count}개)를 취소했습니다. |
| `overlay.summary.bulkInclude` | 批次納入（待確認）：{labels} | Batch include (pending confirm): {labels} | 일괄 포함(확인 대기): {labels} |
| `overlay.summary.bulkCountBadge` | 批次 {count} 檔 | Batch: {count} tickers | 배치 {count}개 |

既有 keys（`title`／`all`／`none`／`addSelected`／`skipNoAdds`／`reviewRequired`／`clarifyFirst`／`nonSellableWarn`／`sellableBlocked`）沿用不變。**移除**原設計中的 `bulkTruncated`／`supplementCapped`（硬上限／合併截斷已廢止，§13 Q1）。

---

## 9. 測試計畫

測試框架：vitest（`npx vitest run`；測試檔與被測檔同目錄，比照 `overlay-filter-proposals.test.ts` 風格）。

### 9.1 單元測試（`overlay-bulk-include.test.ts`）

| # | 案例 | 斷言 |
|---|---|---|
| U1 | `{asset_class:"alternative"}`（預設可銷售態） | 展開恰 20 檔（對齊 §2.1），全帶 `bulk_id`、catalog `asset_class`、本地化 rationale |
| U2 | `{asset_class:"bond", product_type:"etf"}` 交集 | **恰 74 檔全量**，`report.matched=74, kept=74`；**無 truncated**；排序 etf→fund→stock 再字母序 |
| U3 | `{product_type:"stock"}`＋個股全數預設不可銷售 | matched=257、kept=0；override 2 檔個股為可銷售後 kept=2 |
| U4 | `{category:"alt_hedge"}` | 恰 4 檔（§2.1） |
| U5 | `{theme:"AI"}`／`{theme:"人工智慧"}` | 命中 catalog 內 AI 相關 ETF（如 AIQ/BOTZ 等實際 name 含關鍵字者）；表外主題走 name 子串；完全對不上 → `unresolved` |
| U6 | 去重：`supplementTickers`／`excludeTickers`／`priorProposedTickers` 各含 1 檔；另設 anchor 命中 1 檔 | exclude／supplement／prior 剔除；**anchor 命中檔仍保留在結果**（§13 Q2） |
| U7 | 非法 `asset_class:"crypto"`、空 scope `{}` | 整組跳過不 throw，report matched=0 |
| U8 | server ctx（`{nonSellable: Set(["AGG"])}`） | ctx 生效且不需 localStorage（SSR 安全） |
| U9 | 閘門例外 | fail-open 回未過濾結果＋console.warn（比照 sellable 慣例） |
| U10 | 確定性 | 同輸入兩次展開結果序列完全一致 |

### 9.2 既有模組擴充測試（`overlay-filter-proposals.test.ts`）

| # | 案例 | 斷言 |
|---|---|---|
| P1 | `instrumentNeedsKey`：bulk_include 增／改 | 指紋改變（舊「無新增標的」ack 失效） |
| P2 | `overlayNeedsNewInstruments`：僅 bulk_include、無 themes/sleeves | `true` |
| P3 | `clearProposedTickers` | proposed 與 bulk_include 一併清除（不影響 confirmed_bulk_batches） |
| P4 | `groupProposedByBulk`：精選 2 檔＋兩組批次 | 精選組在前；組序穩定；無 `bulk_id` 對應記錄的孤兒條目歸精選組 |
| P5 | prune 邏輯（確認整組後） | 該組自 pending `bulk_include` 移除；寫入 `confirmed_bulk_batches`；部分確認時組保留 |
| P6 | 撤銷依 `bulk_id` | supplement 移除該批 ticker；ledger 清除 |

### 9.3 Route 層測試（interpret route）

| # | 案例 | 斷言 |
|---|---|---|
| R1 | mock AI 回 `bulk_include:[{id:"bulk-1",label:"債券類 ETF",asset_class:"bond",product_type:"etf"}]` | response overlay 的 proposed 含 **74** 檔帶 `bulk_id`；`bulk_report[0]` = `{matched:74, kept:74}`（無 truncated） |
| R2 | body 帶 `non_sellable_tickers` 含某檔命中標的 | 展開結果不含該檔（與 L1 目錄同源） |
| R3 | mock AI 同時回精選 proposed 3 檔＋bulk 1 組 | 精選在前、批次在後；兩者並存 |
| R4 | `construction:"direct_index"` 且 AI 誤回 bulk_include | 展開跳過、`bulk_include` 被丟棄、console.info 留痕（§11 E8） |
| R5 | AI 完全不回 bulk_include | response 無 `bulk_report` 欄位，行為與現況逐 byte 一致（回歸） |
| R6 | 送往 AI 的 system prompt | 含 BATCH INCLUDE 段與 CATEGORY KEYS 行 |
| R7 | fallback 路徑 | 無 bulk_include、無批次關鍵字偵測（§13 Q5） |

### 9.4 整合與手動驗收

1. 「債券類 ETF 都納入」→ 面板出現分組、**74 檔全量**、超過 50 時分頁 → 可跨頁勾選／反選 → **一次**確認 → supplement 寫入全量已勾選、聊天室出計數版確認訊息。
2. 「另類資產全部加進來」→ 20 檔整組確認 → pending `bulk_include` 消失、ledger 有該批 →「撤銷此批次」→ supplement 還原。
3. 「AI 相關基金全部加入，另精選 2 檔黃金」→ 精選組＋批次組並存。
4. 澄清未完成時下批次指令 → ticker 面板不露出（defer 閘）；摘要仍見批次範圍標籤（§13 Q6）；答完後一次出現。
5. 「無新增標的」ack 後再說「債券也全加」→ 指紋變、閘重新要求確認。
6. 個股全關狀態下「個股全部納入」→ 空組提示，引導至標的池頁批次開啟（沿用 `pool.sellable.diHint` 路徑）。
7. 含糊／對不上的 theme → 澄清，不灌清單（§13 Q3）。
8. 摘要卡醒目「批次 N 檔」，流程可繼續、無 supervisor 擋（§13 Q4）。
9. 三語切換：§8 keys 全部正確（key-parity 測試）。

---

## 10. 實作順序

### Phase 1 — 本期 ship（web 為主，引擎不動）

1. **S1（F1、F2、F3）**：schema（含放寬 max、confirmed_bulk_batches）＋展開函式＋單元測試。獨立可驗，無 UI 依賴。
2. **S2（F4、F10）**：interpret route prompt 段＋展開插入＋`bulk_report`＋route 測試。依賴 S1。**不**做 fallback 批次偵測。
3. **S3（F5、F8）**：filter-proposals 三處擴充＋`groupProposedByBulk`＋撤銷相關純函式測試。依賴 S1。
4. **S4（F6、F7、F9）**：面板分組／分頁 UI＋panel 整合（確認＋撤銷）＋i18n。依賴 S1、S3。
5. **S5**：§9.4 手動驗收＋全量 `npx vitest run` 回歸。

相依：S2／S3 可平行；S4 依賴 S3；建議 S1→S2→S3→S4 按序送審。

### Phase 2 — deferred（僅記錄預留點；非本期）

- **P1** ~~規則 fallback 批次偵測~~ → **不做**（§13 Q5 已鎖定：無離線情境，一律走線上 AI）。
- **P2 theme 匹配器升級**：進一步強化 prompt 引導選 category keys；靜態表仍為 BFF 展開真相來源（§13 Q3 已採「Gemini 給 theme／category＋靜態表」）。
- **P3** ~~價格歷史預檢~~ → **本期不做**（§13 Q8）；若未來要做另開需求。
- **P4** ~~上限調整~~ → **已決議無硬上限**（§13 Q1）；僅保留 UI 軟分頁常數可調。
- **P5** ~~整批收回 UI~~ → **已納入本期**（§13 Q7／§6.4）。

---

## 11. 邊界案例

| # | 案例 | 處理 |
|---|---|---|
| E1 | **整類大清單**（債券 ETF 74／股票基金 255） | **全量展開**＋UI 分頁（`BULK_UI_PAGE_SIZE`）；一次確認；schema 已放寬（§13 Q1） |
| E2 | **整類皆非可銷售**（個股全關時 `{product_type:"stock"}`） | matched>0、kept=0 → 空組 dim 提示；proposed 空但 needs=true（§3.6），RM 以「無新增標的」ack 收尾，或至標的池頁批次開啟後重試 |
| E3 | **與主題精選混用**（「AI 精選 3 檔，債券全納入」） | 精選 proposed＋bulk 物化並存，精選組在前；確認一次合併寫入 |
| E4 | **與 must-include／既有 supplement 重疊** | 展開去重（§3.3-4），已在池內者不再列；must_include 語意不變（RM 明示者本就走 supplement，不受影響） |
| E5 | **與 exclude_tickers 衝突** | exclude 優先：展開時剔除（RM 明確排除意圖 > 批次意圖）；被剔除數反映在 report（matched 含、kept 不含） |
| E6 | **anchor／模型持有已在帳上** | **不剔除**（§13 Q2）：整類全列；確認寫入時若已持有／已在 supplement，merge 無實質效果 |
| E7 | **澄清未完成** | `visibleProposedForUi` 隱藏 ticker（§3.6）；摘要仍顯示批次範圍標籤（§13 Q6）；store 內 proposed／bulk_include 保留，澄清清空後一次露出 |
| E8 | **direct_index 同輪** | DI 優先（`applyDirectIndexingToExtract` 會改寫 proposed/supplement，overlay-direct-index.ts:137-141）；server 護欄跳過展開並丟棄 bulk_include＋console.info；prompt 規則 5 事前防範 |
| E9 | **確認後大額 supplement** | 允許全量寫入（schema 已放寬）；引擎 `max_holdings` le=150 仍約束最終持倉數，多餘為可選池語意 |
| E10 | **AI 新輪省略 bulk_include** | prior 自動保留（spread 語意，§3.5）；AI 回 `[]` 才清除 |
| E11 | **規則 fallback（無 API key）** | **不補**批次偵測（§13 Q5）；不產生 bulk_include → 展開 no-op；產品假設一律線上 AI |
| E12 | **CASH／合成 stub** | 不在 universe catalog → 構造上不可能被展開（對齊 sellable-universe §9 E4/E5） |
| E13 | **批次確認後改口** | 確認前可反選；確認後「撤銷此批次」（依 `bulk_id`，§13 Q7／§6.4）；亦可新一輪批次指令重開確認閘 |
| E14 | **主題 sleeve band 綁定** | 批次確認後的 supplement 天然進入 `groupWeightBandsWithDiagnostics` 的 class 綁定池（overlay-schema.ts:1106-1116 的 `poolTickersInClass`）；與 sellable-universe §10.4 的「band 成員天然 sellable-filtered」銜接一致 |
| E15 | **theme／category 對不上** | report `unresolved`＋澄清一題，不物化大清單（§13 Q3） |

---

## 12. 風險與回滾

| # | 風險 | 緩解 |
|---|---|---|
| R1 | **AI 誤判意圖**：把「這幾檔全選」聽成「整類全部」，瞬間灌整類 | prompt 規則 3 對比錨點；含糊／對不上先澄清（規則 4、§13 Q3）；**寫入前永遠有 RM 確認閘**（可反選）；確認後可撤銷（§13 Q7） |
| R2 | **大清單認知負荷**：RM 以為要逐頁確認 | UI 明示分頁僅瀏覽；全選＝全組；**一次確認**；摘要醒目「批次 N 檔」（§13 Q1／Q4） |
| R3 | **大額 supplement 對回測的影響**：持倉數／權重稀釋 | 引擎 `max_holdings` 上限 150（models.py:235-239）可容納最終持倉；supplement 是「可選池」非「必配」；DI floor 邏輯（overlay-schema.ts:1499-1504）不受影響。大額批次由 RM 確認閘＋可撤銷把關 |
| R4 | **prompt 膨脹** | §4 估算 <500 tokens，佔既有 system 端 <6%；category keys 動態一行 |
| R5 | **stale bulk_include 殘留**（組已清空、記錄還在） | §3.5 prune＋`clearProposedTickers` 連帶清＋AI `[]` 指令三路收口 |
| R6 | **嚴格 enum 使整輪 interpret 落 fallback** | 與既有 proposed `asset_class`（:179）相同風險級別；`category`／`theme` 刻意寬鬆、展開層容錯／澄清（§5）；fallback **不**補批次語意（§13 Q5） |
| R7 | **新建議面日後繞過** | 展開只有單一入口 `expandBulkInclude`；物化後走既有 L2／L8 防線，無新繞道 |
| R8 | **撤銷語意歧義**（同 ticker 後又手動加回） | ledger 記本批寫入集合；撤銷只移交集；文件化於 §6.4 |

**回滾**：

1. 全部 schema 變更為 additive optional 欄位（bulk／ledger）——舊 client／舊 overlay 物件不受影響；`proposed`／`supplement` max 放寬為向後相容（舊短清單仍通過）。
2. 緊急停用 AI 批次行為：移除 §4 prompt 段即可（展開無輸入即 no-op）；程式面 revert 本功能 PR 完全還原。
3. 引擎零改動，無需回滾引擎；localStorage 無新 key（若 ledger 僅掛 overlay state）。

---

## 13. 已確認決議（原「待討論事項」）

> **v0.2**：下列 8 項全部鎖定，可據此施工。

| # | 問題 | **決議** | 設計影響 |
|---|---|---|---|
| Q1 | 單批上限 50？「股票類全部」255 檔？ | **C**：不設硬上限；展開結果**分頁**呈現；**一次確認**即可（沿用現有建議標的確認，不分頁再確認）。User：「c，不需要再確認」。 | 廢 `MAX_BULK_INCLUDE_TICKERS`；加 `BULK_UI_PAGE_SIZE=50`（僅顯示）；放寬 schema max；§3.4／§6.1 |
| Q2 | anchor／模型持有是否自展開剔除？ | **C**：展開**不剔除** anchor／模型持有；整類全列；已持有寫入無實質效果。 | 展開 opts 不用 `anchorTickers`；§3.3-4／E6 |
| Q3 | by=theme：靜態表 vs Gemini 直接回 category？ | **C**：Gemini 給 theme／category，BFF 用**靜態表**展開；對不上則**澄清**。 | §3.3-2／§4 規則 4／E15 |
| Q4 | 整類納入是否需更高留痕／supervisor？ | **B**：摘要卡**醒目標示「批次 N 檔」**；不擋流程、**無 supervisor 閘**。 | §6.3／`bulkCountBadge` |
| Q5 | 規則 fallback 離線 demo 要不要補「全部」偵測？ | **不補規則 fallback**：無離線情境，一律走線上 AI。 | 刪 Phase 2 P1；E11／F4 註記 |
| Q6 | 摘要卡澄清期間是否顯示批次範圍標籤？ | **A**：澄清期間**顯示**批次範圍標籤（**不含**具體 ticker）。 | §3.6／§6.3；不受 `hideProposedTickers` |
| Q7 | 批次加錯如何整批收回？ | **C**：確認前可**反選**；確認後可「**撤銷此批次**」（依 `bulk_id`）。 | §6.4／`confirmed_bulk_batches`／F7／i18n revoke keys |
| Q8 | 是否需要價格歷史預檢？ | **A**：本期**不做**價格歷史預檢；靠引擎 `excluded_late_listing`。 | 維持 N5／§3.4；不做 P3 |

---

## 附錄 A：關鍵程式碼座標速查

| 主題 | 座標 |
|---|---|
| Universe JSON 現況 | `shared/etf-universe.json` v1.2（2026-09-21）／651 筆；§2.1 表 |
| `UniverseItem`／`getUniverseItems`／`getUniverseMeta` | `apps/web/src/lib/universe.ts:4-24`／:57-59／:113-141 |
| `ASSET_CLASSES`／`CATEGORY_LABELS` | `apps/web/src/lib/constants.ts:1-7`／:64-103 |
| 精選 3–6 prompt 規則 | `apps/web/src/app/api/overlay/interpret/route.ts:348`（禁大清單 :350） |
| 可銷售目錄注入（L1） | 同檔 `buildSellableCatalogBlock` :208-245；組裝 :550 |
| 輸出硬過濾（L2） | 同檔 `applySellableOutputFilter` :247-288；呼叫 :665 |
| Parse 管線插入點 | 同檔 :610-612（validate→syncClarif→DI）→ :636 wrap → :665 L2 |
| `InterpretBody`（含 `non_sellable_tickers`／`anchor_positions`） | 同檔 :65-86（:85／:78）；展開**不**用 anchor 剔除（§13 Q2） |
| 主題合成上限 12 | `apps/web/src/lib/overlay-filter-proposals.ts:391-399`、:441；`mergeFilterProposedIntoOverlay` :99-113（:110）——僅 curated |
| 確認時序閘 | 同檔 `visibleProposedForUi` :60-67；`isTickerReviewBlocking` :466-490；`instrumentNeedsKey` :308-336；`clearProposedTickers` :116-126 |
| Schema 上限 50（現行，批次須放寬） | `apps/web/src/lib/overlay-schema.ts:190`/`:192`；`MAX_DIRECT_INDEX_SLEEVE` `apps/web/src/lib/direct-indexing.ts:33`（DI 專用，非批次上限） |
| `overlayProposedTickerSchema`／`universeRuleOverlaySchema` | overlay-schema.ts:174-183／:187-195 |
| `wrapExtractAsOverlay` 合併語意 | overlay-schema.ts:485-587（mergedProposed :528-532；mergedUniverse spread :533-550） |
| 摘要卡三語建議行 | overlay-schema.ts:1709-1714（zh）／:1742-1747（ko）／:1767-1772（en）；`hideProposedTickers` :1661-1662（批次範圍行不受影響，§13 Q6） |
| 建議面板 | `apps/web/src/components/OverlayChatTimeline.tsx:139-264`（全選 :182-197；渲染閘 :436-445） |
| 確認／略過／撤銷 | `apps/web/src/components/OverlayConversationPanel.tsx:626-668`／:670-688；proposed memo :699-705；interpret body :249-268（`non_sellable_tickers` :266）；撤銷 handler 新增（§6.4） |
| Sellable store | `apps/web/src/lib/sellable-overrides.ts`（`resolveNonSellableSet` :134-147；`splitBySellable` :162-179；`filterSellableProposed` :182-199；gate-off :8/:20-27） |
| DI 轉換 | `apps/web/src/lib/overlay-direct-index.ts:100-142`（proposed/supplement 改寫 :137-141） |
| 主題關鍵字參考 | `THEME_PROPOSAL_BUCKETS` overlay-filter-proposals.ts:168-232；`analyzeUniverseFilterFallback` universe-filter-fallback.ts:116-160（僅參考關鍵字表，不啟用離線批次 fallback） |
| 引擎 supplement（無長度上限）／`max_holdings` le=150 | `apps/api/app/models.py:198-206`／:235-239 |
| 引擎 late-listing 排除 | `apps/api/app/engine/data.py:514-515`（§13 Q8） |
| i18n dicts | `apps/web/src/lib/i18n.tsx`（`overlay.proposedTickers.*` en :1237-1258／zh :3285-3304／ko :5320-5340） |

---

*本文件 v0.2 已鎖定 §13 全部 8 項決議，可施工；實作與 commit 另開任務。*
