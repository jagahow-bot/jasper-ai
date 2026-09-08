# 標的池可銷售旗標（Sellable Universe）施工說明書

> 版本：v1.3（2026-09-08）
> 狀態：設計確認，待施工。Phase 2（引擎硬閘門／伺服器端儲存）仍為 deferred 開放問題，本文僅定義介面與預留點。
> 參考：`docs/design/auto-reminders.md`、`docs/design/needs-driven-weight-bounds.md`、`docs/design/overlay-drift-sync.md`、`docs/design/overlay-param-whitelist-expansion.md`
> v1.1 新增 §12：overlay 參數白名單擴充（配套變更，已實作）。
> v1.2：L1 軟指示由「不可銷售 blocklist 文案」改為「**可銷售清單注入**」正向目錄設計（新增 §3.8，含澄清問題路由規則與 token 預算）；§12 遷出為獨立文件 `docs/design/overlay-param-whitelist-expansion.md`，原節改為指向連結。
> v1.3：§10.4 補記——主題 sleeve 成員應優先取可銷售標的（band tickers 來自 RM 確認後的 supplement 清單，天然經本文件閘門過濾）；與 `overlay-param-whitelist-expansion.md` §11 的「主題比例走 band + 顯式 tickers」規則銜接。

本文件為「可銷售（sellable）」旗標功能的實作規格。所有檔案路徑與行號均經實際代碼核對（2026-09-08 工作區狀態）。

---

## 1. 目標與範圍

### 1.1 問題陳述

目前標的池（universe）對所有商品一視同仁：只要 ticker 存在於 `shared/etf-universe.json`，AI overlay 解讀、主題建議、規則 fallback、universe filter 等所有「建議產生面」都可能把它推到 RM 面前。實務上，私銀對不同商品有不同適售性（suitability）控管——例如個股需逐檔審核、僅基金類商品可直接向客戶建議。現行系統沒有任何欄位可表達「此標的目前不可銷售」，RM 只能在事後人工剔除，既沒效率也不利留痕。

已確認的使用者決策：

1. **初始狀態：基金類商品預設可銷售**——`product_type` 為 `etf` / `fund` 者 `sellable=true`；個股（`stock`）及其他類型預設 `false`（可在標的池頁手動或批次開啟）。
2. **篩選後批次全選**：標的池頁必須支援「先下篩選條件 → 一鍵把篩選結果全部設為可銷售（或取消）」的批次操作。
3. Phase 2（optimizer 硬閘門）與伺服器端 store 維持 deferred，本期不定案，但 BFF body 介面要先預留。

### 1.2 目標（本功能要做的）

- G1：`shared/etf-universe.json` schema 增加選配 `sellable` 欄位；缺欄位時以 `product_type` 預設規則決定初始值（§3.1）。
- G2：RM 層級覆寫存放於瀏覽器 localStorage（新模組 `sellable-overrides.ts`），三層解析：RM override > JSON 明示值 > product_type 預設（§3.2）。
- G3：單一閘門函式 `filterSellableProposed`／`splitBySellable`，八條防線全部收口到同一入口（§3.4、§3.6）。
- G4：標的池頁新增「可銷售」欄、可銷售篩選器、**篩選結果批次全選**操作（§4.1）。
- G5：pool CSV 匯入／匯出支援 `sellable` 欄（§5 F6–F8）。
- G6：BFF routes（`/api/overlay/interpret`、`/api/universe/filter`）body 合約增加 `non_sellable_tickers?: string[]`，由 client 自 localStorage 計算上送（§3.5）。
- G7：不可銷售標的**仍可回測**——anchor、benchmark、既有持有、RM 明確加入者不受閘門阻擋；閘門只擋「AI 主動建議面」（§3.7、§9）。
- G8：interpret prompt 注入**可銷售清單正向目錄**（compact `TICKER|name|product_type`，每輪對話由 BFF 端推導）：AI 的 proposed/supplement 一律自該目錄選取，主題需求直接配可銷售基金／ETF、不主動開個股路徑；L2 硬過濾保留為 safety net（§3.8）。

### 1.3 非目標（Explicit Non-Goals）

- N1：不做伺服器端 sellable store（跨裝置／全公司一致生效）——Phase 2 開放問題。
- N2：不在 Phase 1 動引擎 optimizer／universe stage 的 tradable 集合——不可銷售標的本期**不影響回測可交易池**（§8 Phase 2 僅給預留設計）。
- N3：不改變 pool `enabled` 旗標語意（§10.1），兩者獨立。
- N4：不做權限系統（誰能改 sellable）——demo 階段任何 RM 均可改，僅留 localStorage 軌跡。
- N5：不對 CASH 偽標的、benchmark 做可銷售控管（§9 E5/E6）。

---

## 2. 現況分析

### 2.1 Universe 資料現況（已掃描驗證）

`shared/etf-universe.json`（version `1.2`，updated `2026-08-27`）：

- 頂層 keys：`version, updated, criteria, universe`；`universe` 共 **651 筆**。
- 每筆 keys：`ticker, name, asset_class, region, category, product_type, sector`。
- **目前無任何一筆帶 `sellable` 欄位**（0 / 651）——預設規則即初始狀態，無遷移包袱。
- `product_type` 分佈（實測）：

| product_type | 筆數 | 預設 sellable（§3.1 規則） |
|---|---|---|
| `etf` | 346 | ✅ true（基金類） |
| `fund` | 48 | ✅ true（基金類） |
| `stock` | 257 | ❌ false（個股，需逐檔或批次開啟） |
| 其他／缺值 | 0 | ❌ false（保守） |

- 同步鏈路：root `package.json:15` `sync-universe` script 以 `copyFileSync` 將 `shared/etf-universe.json` 複製到 `apps/web/src/data/etf-universe.json`；引擎端 `apps/api/app/config.py:8` `UNIVERSE_PATH` 直接指向 `shared/etf-universe.json`（不需同步）。Web 端由 `apps/web/src/lib/universe.ts:1` `import universeFile from "@/data/etf-universe.json"` 讀入。

### 2.2 Web 端 universe / pool 模組

| 模組 | 關鍵座標 | 現況 |
|---|---|---|
| `apps/web/src/lib/universe.ts` | `UniverseItem` :4-13（`product_type?` :12-13）；`getUniverseItems` :30-32；`getUniverseMap` :16-22；`filterUniverse` :35-53；`getUniverseMeta` :86-101（含 `product_type_breakdown` :97-100） | 型別尚無 `sellable`；meta 已有 product_type breakdown 可複用 |
| `apps/web/src/lib/investment-pool.ts` | storage key `jasper_investment_pool_v3` :4；`PoolItem` :9-16（`ticker/name/asset_class/region/product_type/enabled`）；`buildFullUniversePool` :60-69；`normalizeItem` :71-92；`readInvestmentPool` :94-108；`writeInvestmentPool` :110-117；`getEnabledPoolTickers` :119-124；`setPoolItemEnabled` :126-138；`importPoolFromCsv` :146-209（`enabled` 欄解析 :187-192）；`poolToCsv` :239-246（header :240） | pool 為 localStorage 全量快照；CSV header 固定六欄 |
| `apps/web/src/lib/types.ts` | `BacktestRequest.universe_tickers` :111、`universe_supplement_tickers` :113、`universe_supplement_meta` :115、`universe_filter_text` :116 | 尚無 `non_sellable_tickers` |
| `apps/web/src/lib/model-portfolios-store.ts` | `getEnabledPoolTickers(pool)` 用於 :82、:116、:292；`withConflicts`（conflict_tickers 計算）:60-77 | 「enabled」是模型衝突檢測的唯一依據 |

### 2.3 八條建議產生面（防線現況盤點）

下表為本次要插入 sellable 閘門的八個點位（「類型」為現況）：

| # | 點位 | 檔案與座標 | 類型 |
|---|---|---|---|
| L1 | Overlay 解讀 system prompt（軟指示） | `apps/web/src/app/api/overlay/interpret/route.ts` `overlaySystemPrompt` :190-350（universe 規則 :241-249；param catalog block :153-188）；`InterpretBody` :57-75 | BFF server，無 localStorage |
| L2 | Overlay 解讀輸出後過濾 | 同檔 POST 主流程（:401 之後，overlay 組裝完成處） | BFF server |
| L3 | 主題建議合成 | `apps/web/src/lib/overlay-filter-proposals.ts` `mapTickersToProposed` :319-337；呼叫端 `synthesizeThemeProposedTickers` :351-416（bucket 表 `THEME_PROPOSAL_BUCKETS` :150-215）；`ensureProposedTickersForReview` :423-432 | client 純函式 |
| L4 | 規則 fallback | `apps/web/src/lib/universe-filter-fallback.ts` `analyzeUniverseFilterFallback` :113-148（universe 存在性過濾 :116-118；DI 分支 :123-125） | client + server 雙棲（被 L5 route import） |
| L5 | `/api/universe/filter` route | `apps/web/src/app/api/universe/filter/route.ts` `FilterBody` :25-33；`supplementSystem` prompt :53-77；`runFallback` :109-122；AI 路徑 + `mergeSupplementTickers` :129-145 | BFF server |
| L6 | overlay → backtest universe 解析 | `apps/web/src/lib/resolve-overlay-universe.ts` `fetchUniverseSupplements`（POST body :44-51）；locked 路徑 :106-170（`novel` 計算 :137-140、DI 子分支 :141-150、`mapTickersToProposed` :151-152）；open-pool 自動併入 :172-215（`extras` → `universe_supplement_tickers` :203-212）；local `mapTickersToProposed` :60-75 | client |
| L7 | 直接指數化選股 | `apps/web/src/lib/direct-indexing.ts` `stockTickerSet` :171-181；`filterTickersForDirectIndex` :270-282；`pickFromPrefer` :288-314；`pickDirectIndexStocks` :321-336；`proposedTickersForDirectIndex` :346-366 | client 純函式 |
| L8 | RM 手動確認加入 | `apps/web/src/components/OverlayConversationPanel.tsx` `confirmProposedTickers` :600-635、`skipProposedNoAdds` :637-655；候選面板 `OverlayChatTimeline.tsx` `ProposedTickersPanel` :140-250（全選/全不選 :181-194、確認鈕 :226-236）；interpret fetch 呼叫端 `OverlayConversationPanel.tsx` :245 | client UI |

### 2.4 BFF / 引擎鏈路現況

- Web → 引擎為透明代理：`apps/web/src/app/quant-api/[[...path]]/route.ts` :19-86 原樣轉發 body；browser 端 base 為 `/quant-api`（`apps/web/src/lib/api.ts:18-26`）。**任何 `BacktestRequest` 新欄位只要在 web 型別與引擎 model 兩端都加上即可穿透，proxy 不需改。**
- 引擎 BacktestRequest：`apps/api/app/models.py` `universe_tickers` :189-197、`universe_supplement_tickers` :198-201——尚無 `non_sellable_tickers`。
- 引擎 universe 建構：`apps/api/app/engine/stages/universe.py` `EtfCatalogUniverseV1.build` :73-87 目前為 request tickers passthrough（Phase 0 scaffold）；`UniverseResult` :21-27。
- 引擎 universe 讀取與 pin：`apps/api/app/profiles.py` `get_universe` :33-83；`_PSEUDO_TICKERS = {"CASH"}` :86；合成 stub `_synthetic_supplement_item` :116-146（帶 `overlay_synthetic: True`）；`_union_supplement_items` :149-206；`pin_guaranteed_supplements` :208-232；白名單防泄漏 `assert_locked_universe` :265-298。
- 引擎 pool CSV 驗證：`apps/api/app/routers/settings.py` `validate_pool_csv` :112-181（必要欄僅 `ticker,name` :120），驗證過的 CSV 會存檔（`_save_audit` :106-109）並可由 `GET /settings/pool` :252-260 取回。Web 端經 `apps/web/src/lib/api.ts` `validatePoolCsv` :301-306 呼叫。
- 引擎唯讀 universe API：`apps/api/app/routers/universe.py` `GET /universe` :8-13、`GET /universe/meta` :15-17。

### 2.5 可直接複用的現有機制

- `getUniverseMeta().product_type_breakdown`（universe.ts :97-100）——pool 頁可銷售統計徽章的現成資料形狀。
- `normalizeItem` 的布林字串解析模式（investment-pool.ts :78-83）——CSV `sellable` 欄照搬同套寬鬆解析。
- `extractExplicitTickersFromTexts`（`apps/web/src/lib/locked-universe.ts`，被 overlay-filter-proposals.ts :1-4 使用）——L2 後過濾時判定「RM 文字明示點名」。
- localStorage store 模式：investment-pool.ts 整檔即範本（try/catch quota、SSR guard :95、:111）。
- i18n 三語 dict：`apps/web/src/lib/i18n.tsx` en :30、zh :2049、ko :3934；pool 區段現況 en :1978-2008、zh :3865-3893、ko :5816 起；`translate` :5905。
- 測試：vitest，測試檔與被測檔同目錄（如 `overlay-filter-proposals.test.ts`、`direct-indexing.test.ts`），`npx vitest run` 執行。

---

## 3. 核心設計

### 3.1 資料模型與預設規則

**JSON schema（向後相容的選配欄位）**——`shared/etf-universe.json` 每筆新增：

```json
{ "ticker": "ACWI", "name": "全球股票", "asset_class": "equity", "product_type": "etf", "sellable": true }
```

- `sellable?: boolean`，**省略時**套用 product_type 預設規則。651 筆現況全部省略 → 初始狀態完全由預設規則決定（§2.1 表：394 檔可銷售 / 257 檔個股不可銷售）。
- 公司層級若要調整初始態（例如業務含直接指數化、個股預設開放），直接在 JSON 標明示值即可，不必動代碼——**JSON 明示值優先於預設規則**。
- 編輯後需跑 `npm run sync-universe`（package.json:15）同步到 `apps/web/src/data/etf-universe.json`。

**預設規則（factory default）**：

```ts
/** product_type → 初始可銷售。基金類（etf/fund）預設可銷售；其餘保守預設不可。 */
const SELLABLE_DEFAULT_BY_PRODUCT_TYPE: Record<string, boolean> = {
  etf: true,
  fund: true,
  stock: false,
  structured: false,
  bond: false,
  other: false,
};

export function defaultSellableForProductType(productType?: string): boolean {
  return SELLABLE_DEFAULT_BY_PRODUCT_TYPE[(productType ?? "").trim().toLowerCase()] ?? false;
}
```

**三層解析優先序**（高 → 低）：

1. RM override（localStorage `jasper_sellable_overrides_v1`，§3.2）
2. JSON 明示 `sellable` 欄位（公司預設）
3. product_type 預設規則（factory default）

`UniverseItem`（universe.ts :4-13）加 `sellable?: boolean` 欄位與 JSDoc。

### 3.2 Override store：`apps/web/src/lib/sellable-overrides.ts`（新增）

採 **diff-based**（只存與預設不同的覆寫），不採 pool 的全量快照模式，理由：JSON 會隨 `sync-universe` 更新，diff-based 讓「JSON 明示值／預設規則變更」對未覆寫標的即時生效，且儲存量極小。

```ts
import { getUniverseItems, getUniverseMap } from "@/lib/universe";

export const SELLABLE_OVERRIDES_STORAGE_KEY = "jasper_sellable_overrides_v1";

/** ticker(UPPER) → 覆寫值。缺 key = 無覆寫。 */
export type SellableOverrides = Record<string, boolean>;

/** 伺服器端（BFF route）無 localStorage，由 body 帶入的 ctx 解析。 */
export type SellableCtx = { nonSellable?: ReadonlySet<string> };

export function readSellableOverrides(): SellableOverrides;
export function writeSellableOverrides(map: SellableOverrides): void;
export function setSellableOverride(ticker: string, sellable: boolean): SellableOverrides;
export function setSellableBulk(tickers: readonly string[], sellable: boolean): SellableOverrides;
export function clearSellableOverride(ticker: string): SellableOverrides;   // 回復預設
export function clearAllSellableOverrides(): void;

/** CASH 偽標的恆豁免（§9 E5）。 */
export const SELLABLE_EXEMPT_TICKERS: ReadonlySet<string> = new Set(["CASH"]);

/** 三層解析：override → JSON 明示 → product_type 預設。豁免清單恆 true。 */
export function isSellableTicker(ticker: string, ctx?: SellableCtx): boolean;

/** 目前有效的不可銷售集合（client：全 universe 掃描；server：ctx 提供）。 */
export function resolveNonSellableSet(ctx?: SellableCtx): Set<string>;

/** 單一閘門：字串版。 */
export function splitBySellable(
  tickers: readonly string[],
  ctx?: SellableCtx,
): { kept: string[]; blocked: string[] };

/** 單一閘門：proposed 物件版（保留 name/category/rationale）。 */
export function filterSellableProposed<P extends { ticker: string }>(
  items: readonly P[],
  ctx?: SellableCtx,
): { kept: P[]; blocked: P[] };
```

行為細節：

- `isSellableTicker`：先查 `SELLABLE_EXEMPT_TICKERS` → `ctx.nonSellable`（server 路徑，命中即 false）→ localStorage override → JSON `sellable` → `defaultSellableForProductType`。**不在 universe 內的 ticker（含合成 stub，§9 E4）預設 false**。
- 所有公開寫入函式回傳新 map（比照 `setPoolItemEnabled` :126-138 回傳新陣列的慣例），並 `try/catch` localStorage quota。
- SSR guard：`typeof window === "undefined"` 時 `readSellableOverrides` 回 `{}`、`resolveNonSellableSet()` 回空集（= 不過濾，fail-open，見 §11）。
- 跨分頁同步：`window.addEventListener("storage", …)` 由 pool 頁自行訂閱（比照現有面板慣例）。

### 3.3 Pool 頁狀態與批量操作 API

pool 頁不直接改 JSON，一律經 §3.2 store。頁面持有 `overrides` state（`SellableOverrides`），列渲染時計算 `effective = isSellableTicker(ticker)`（此時 store 已是最新，直接讀即可；為效能可在 effect 內預算一次 `Map<string, boolean>`）。

批量操作（關鍵需求）：

```ts
/** 目前篩選結果 → 批次設為可銷售／取消。回傳新 overrides 供 setState。 */
setSellableBulk(filteredTickers, true);   // 全選篩選結果
setSellableBulk(filteredTickers, false);  // 批次取消
```

注意：批次「設為可銷售」對「本來就預設 true」的列寫入 `true` 覆寫是多餘的——`setSellableBulk` 內部應比對有效值，**值相同則刪除覆寫 key**（保持 diff-based 最小化）；值不同才寫入。批次「設為不可銷售」同理。

### 3.4 單一閘門 `filterSellableProposed` 與八條防線接法

原則：**AI 主動建議面硬過濾；RM 明示意圖放行但警告（allow + warn）**。`blocked` 清單用於 UI 提示與 dev log，不靜默吞掉。

| # | 點位 | 接法 | ctx 來源 | 行為 |
|---|---|---|---|---|
| L1 | interpret system prompt（interpret/route.ts :190-350） | POST 收到 `non_sellable_tickers` 後，route 端以本地 universe JSON 推導**可銷售目錄**，在 system prompt 尾端附加「可銷售目錄 + 路由規則」動態區塊（§3.8——v1.2 起以正向目錄取代 blocklist 文案） | body + server 端 universe JSON | 軟指示（正向目錄） |
| L2 | interpret 輸出後過濾 | overlay 組裝後對 `universe.proposed_tickers` 跑 `filterSellableProposed(…, ctx)`；`universe.supplement_tickers` 中**未被 RM 文字明示點名**者（用 `extractExplicitTickersFromTexts` 判斷）一併過濾；被過濾者寫入 response 新欄位 `sellable_blocked?: string[]` 供 client 提示 | body | 硬過濾（明示點名豁免） |
| L3 | 主題合成（overlay-filter-proposals.ts `mapTickersToProposed` :319-337） | 在既有「存在於 universe」過濾（:327-328）後串接 `filterSellableProposed`；bucket 建議（:150-215）與 fallback 補充（:403-414）自動生效 | client store | 硬過濾 |
| L4 | 規則 fallback（universe-filter-fallback.ts `analyzeUniverseFilterFallback` :113-148） | 回傳前對 `tickers` 跑 `splitBySellable`；函式簽名加 `opts?: { ctx?: SellableCtx }` | client store / server body（雙棲） | 硬過濾 |
| L5 | `/api/universe/filter` route | `FilterBody`（:25-33）加 `non_sellable_tickers?: string[]`；組 `ctx` 傳入 L4 與 AI 路徑輸出（:134-145 `mergeSupplementTickers` 之後）的 `splitBySellable`；`supplementSystem` prompt（:53-77）附加不可銷售清單軟指示；response 加 `sellable_blocked` | body | 軟指示 + 硬過濾 |
| L6 | resolve-overlay-universe | locked 路徑：`novel`（:137-140）計算後、`mapTickersToProposed`（:60-75 / :151-152）內串閘門；DI 子分支 `proposedTickersForDirectIndex`（:146-150）由 L7 把關。open-pool：`extras`（:187-201）併入 `universe_supplement_tickers`（:203-212）**之前** `splitBySellable`，blocked 記 console.info | client store | 硬過濾 |
| L7 | 直接指數化 | `pickFromPrefer`（:288-314）與 `pickDirectIndexStocks`（:321-336）的候選在回傳前 `splitBySellable`；`proposedTickersForDirectIndex`（:346-366）同。若全數被擋 → 回空陣列，由 L6/L8 UI 顯示「個股尚未開放可銷售」提示（§4.2） | client store | 硬過濾（見 §9 E7 的 DI 特別說明） |
| L8 | RM 手動確認 | `confirmProposedTickers`（OverlayConversationPanel.tsx :600-635）照常加入 `supplement_tickers`（**不擋**），但確認後若含不可銷售標的，追加一則 assistant 警告訊息（i18n `overlay.proposedTickers.nonSellableWarn`）；`ProposedTickersPanel`（OverlayChatTimeline.tsx :140-250）對不可銷售候選列加 ⚠ 徽標（正常情況已被 L2/L3 擋下，此為 defense-in-depth） | client store | allow + warn |

L1 的 prompt 注入設計——可銷售清單正向目錄的推導方式、compact 格式、路由規則（含澄清問題不得開個股路徑）、token 預算——詳見 **§3.8**。

### 3.5 BFF body 合約（`non_sellable_tickers`）

- `FilterBody`（universe/filter/route.ts :25-33）與 `InterpretBody`（interpret/route.ts :57-75）各加：

```ts
/** Client-computed non-sellable tickers (UPPER). Server has no localStorage. */
non_sellable_tickers?: string[];
```

- Client 上送點：`fetchUniverseSupplements`（resolve-overlay-universe.ts :44-51 的 body）與 interpret 呼叫端（OverlayConversationPanel.tsx :245 的 body）各加 `non_sellable_tickers: [...resolveNonSellableSet()]`。
- 大小寫：route 端一律 `.toUpperCase()` 後建 `Set`。
- **v1.2 補充（目錄推導）**：body 仍只上送補集 `non_sellable_tickers`；可銷售目錄由 route 端以本地 universe JSON 推導（§3.8.1），client **不上送** 394 檔全量清單。
- **Phase 2 預留**：`BacktestRequest`（web types.ts :110-116 區段）與引擎 `models.py`（:198 區段）同名欄位 `non_sellable_tickers?: string[] | null`。proxy（quant-api route :19-86）透明轉發，不需改。Phase 1 不加此欄位、引擎完全不动。

### 3.6 閘門的失敗模式

所有防線呼叫點以 try/catch 包住，閘門例外時 **fail-open**（放行 + `console.warn`）——demo 階段寧可漏擋不可斷流程；公司級硬控管屬 Phase 2（server store + 引擎硬閘門）範疇，屆時改 fail-closed。

### 3.7 引擎行為（Phase 1：不變）

不可銷售標的**仍可回測**：anchor／模型持有、benchmark、既有持有、RM 明示加入的 supplement 全部照常。Phase 1 的閘門只收斂「建議產生面」（L1–L8），不改 `BacktestRequest`、不改 `EtfCatalogUniverseV1.build`（stages/universe.py :73-87）、不改 `_union_supplement_items`（profiles.py :149-206）。

### 3.8 interpret prompt 可銷售清單注入（正向目錄，v1.2 新增）

v1.2 起，L1 從「不可銷售 blocklist 文案」改為**注入完整可銷售目錄**。動機：blocklist 只告訴 AI「不要什麼」，AI 仍會自由發明清單外標的、或把主題需求導向個股追問；正向目錄直接給 AI「可以選什麼」，與白名單擴充（`overlay-param-whitelist-expansion.md`）同一哲學——*give AI the actionable catalog*。

#### 3.8.1 清單推導與格式

- **推導**：BFF route 端本來就可 import `@/data/etf-universe.json`（同步自 `shared/etf-universe.json`，§2.1）。收到 body `non_sellable_tickers`（client 以 `resolveNonSellableSet()` 三層解析算出的補集，§3.5）後，**可銷售目錄 = universe 651 筆 − nonSellable 集合**。server 不需重算預設規則——client 上送的補集已含 RM override 效果（被批次開啟的個股自然落在目錄內）。
- **為何 body 只送補集而非整份目錄**：預設補集為 257 檔純 ticker 字串，payload 遠小於 394 檔含名稱的目錄；目錄本體 server 本地就有，無需網路傳輸。
- **格式（compact pipe-delimited，一檔一行）**：

```
SELLABLE CATALOG (firm restriction — the ONLY instruments you may propose), format TICKER|name|product_type:
ACWI|全球股票|etf
SPY|美國大型股|etf
…
```

- 不用 JSON 陣列（省引號／逗號／括號 token）；`product_type` 欄讓 AI 自行分辨基金類與個股，支撐 §3.8.2 的路由規則。
- 排序：`etf` → `fund` → `stock` 分段，段內按 ticker 字母序（輸出穩定，利於除錯比對與未來 prompt caching）。

#### 3.8.2 注入的 prompt 規則（加掛於 system prompt 尾端動態區塊）

目錄清單之後接以下規則文案（草案；規則本文用英文以省 token，RM-facing 輸出仍走既有 report-language 指令）：

```
Rules for the sellable catalog above:
- universe.proposed_tickers and universe.supplement_tickers MUST be chosen from
  this list. Never invent tickers outside it. (Exception: the RM explicitly
  names a ticker in the conversation — keep it, but never volunteer it.)
- Theme/sector needs (AI, 半導體, ESG, 配息, …): recommend suitable FUNDS/ETFs
  from the list directly in proposed_tickers. Do NOT ask whether to add
  individual stocks, and do NOT propose individual stocks unless the list
  actually contains sellable stocks (product_type=stock rows).
- Direct indexing: allowed ONLY when the list contains sellable stocks;
  otherwise explain that individual stocks are currently non-sellable and
  propose the closest sellable index ETFs from the list instead.
- clarification_questions / clarifications MUST NOT open "add individual
  stocks" paths when the list contains no (or almost no) sellable stocks.
  Route theme-related clarifications toward choosing among sellable
  funds/ETFs (options = 2–4 concrete fund/ETF directions from the list),
  not toward stock picking.
```

既有 DI 規則（system prompt universe.construction 段，interpret/route.ts :241-243）繼續適用——當目錄內**有** sellable 個股時，DI 流程照舊；本區塊只改變「無 sellable 個股」時的行為。

#### 3.8.3 澄清問題路由（新增明確規則）

現況痛點：個股預設全數不可銷售（§2.1：257 檔 stock 全 false），但 AI 的澄清問題常出現「要不要加碼台積電／NVDA 個股？」這類選項——等於開啟一條 RM 根本走不通的路。規則：

1. **當可銷售目錄中 `product_type=stock` 為 0（或接近 0）時**，`clarification_questions`／`clarifications` 的問題與選項**不得**出現「新增個股」「挑個股」路徑；主題相關追問一律導向「在可銷售基金／ETF 中選方向」，選項直接取自目錄（例如從目錄挑 2–4 檔相關主題 ETF 作為 preset options）。
2. 主題需求（「我想要 AI 主題」）→ AI **直接**在 `proposed_tickers` 給出目錄內的可銷售基金／ETF 候選（3–6 檔，既有 L3 合成規則不變），**不先問**「要不要改買個股」。
3. RM 在對話中**明示點名**的個股仍是例外（L2 豁免 + L8 警告，§3.4）；本規則只約束 AI **主動**提議與提問。

#### 3.8.4 Token 預算

- **規模**：預設可銷售 **394 檔**（etf 346 + fund 48，§2.1 實測）。每行 `TICKER|name|product_type` 約 15–25 字元（中文名 2–6 字），全目錄約 **8–10 KB 純文字 ≈ 4k–7k tokens**（CJK 字元約 1 token/字，ticker 與分隔符更低）。
- **成本面**：interpret 呼叫走 Gemini Flash 級模型，context window 為百萬級，4k–7k tokens 的 system 端注入**可接受**；但 `overlaySystemPrompt` 為 per-request 組裝（route.ts :476），每輪對話都重送——須以既有 llm 審計（`generateTextWithAudit` 的 llm_log）持續觀察 token 用量。
- **總量估算**：既有 system prompt 本體約 3k tokens + param catalog block（:153-188）約 1k tokens；加計目錄後 system 端約 8k–11k tokens，仍在合理範圍。
- **縮減選項（預留，本期不實作）**：
  1. 超過門檻時省略 `name` 欄（`TICKER|product_type`，約省 40–50%）；
  2. 依 `prior_overlay`／對話主題只送相關 `asset_class` 分段；
  3. Gemini context caching（目錄為靜態前綴，天然適合）。
- **不改回 blocklist**：257 檔 blocklist 雖較短，但無法承載 §3.8.2/§3.8.3 的正向路由規則（「從清單選」「主題→基金/ETF」都依附在正向目錄上）；token 成本以本節選項管理，而非退回舊設計。

#### 3.8.5 與硬過濾的關係（safety net）

正向目錄是**軟指示**；L2 硬過濾（§3.4）全部保留作為 safety net：AI 不守規則、prompt 過期（RM 在對話中途於標的池頁改了 override）、或 §3.6 fail-open 例外時，輸出端仍以 `filterSellableProposed` 收口並回填 `sellable_blocked`。注入與過濾是雙層防禦，不是二選一。

---

## 4. UX 流程

### 4.1 標的池頁（`apps/web/src/app/pool/page.tsx`，176 行）

現況：搜尋框 + 三個下拉（資產類別 :90-101、區域 :102-112、產品類型 :113-125）、表格六欄（:131-138）、enabled checkbox（:146-152）。

新增：

1. **「可銷售」欄**：加在「啟用」欄右側，checkbox 切換 `setSellableOverride`；非預設值（有覆寫）的列在 checkbox 旁顯示 `*` 或淡色「已覆寫」標記，hover 提示預設值。
2. **可銷售篩選下拉**：`全部 / 僅可銷售 / 僅不可銷售`，併入 `filtered` memo（:43-58）。
3. **批量操作列**（位於篩選列下方、表格上方，僅在 `filtered.length > 0` 時顯示）：

```
┌──────────────────────────────────────────────────────────────────────┐
│ 篩選結果 57 筆（不可銷售 41）  [✓ 全選篩選結果設為可銷售]  [✗ 批次取消可銷售]  [回復全部預設] │
└──────────────────────────────────────────────────────────────────────┘
```

- 「全選篩選結果設為可銷售」→ `setSellableBulk(filteredTickers, true)` → toast/徽章回饋「已更新 N 筆」。
- 典型工作流（寫進按鈕 title）：產品類型篩「個股」→ 全選設為可銷售 → 直接指數化流程即可用（§9 E7）。
- 「回復全部預設」→ `clearAllSellableOverrides()`，二次確認（`window.confirm`，demo 從簡）。
4. **統計徽章**：現有 `pool.countBadge`（:75-80）右側加 `pool.sellableBadge`（「可銷售 {sellable} / {total}」）。

### 4.2 Overlay 對話流程

- 建議面板（ProposedTickersPanel）正常情況下看不到不可銷售標的（L2/L3/L5/L6 已擋）。
- 澄清問題卡（clarifications）在個股全數不可銷售時**不得**出現「加個股」選項；主題追問的選項直接取自可銷售目錄的基金／ETF（§3.8.3 路由規則，由 L1 prompt 區塊承載）。
- RM 手動輸入明示點名不可銷售標的 → L2 豁免放行 → L8 在確認後追加警告訊息：「⚠ 以下標的目前標記為不可銷售：NVDA、AAPL。仍可回測，但請確認適售性後再向客戶揭露。」
- 直接指數化且個股全數不可銷售時：面板空態（OverlayChatTimeline.tsx :196-198 的 `emptyNeedsHint` 位置）改顯示 `pool.sellable.diHint`：「直接指數化需要個股標的；目前個股預設不可銷售，請至標的池頁篩選『個股』後批次開啟。」

### 4.3 CSV（設定頁）

設定頁（`apps/web/src/app/settings/page.tsx` 匯入 :51-82、匯出 :84-86）的 pool CSV 增加選配 `sellable` 欄；詳 §5 F6–F8。

---

## 5. 檔案變更清單

| # | 檔案 | 變更 | 估計規模 |
|---|---|---|---|
| F1 | `shared/etf-universe.json` | 選配 `sellable` 欄位進 schema（本期**不批次落值**，維持缺欄走預設規則；文件化於 §3.1）；如需公司預設調整才落值，改後跑 `npm run sync-universe`（package.json:15） | 0 行（文件化為主） |
| F2 | `apps/web/src/lib/universe.ts` | `UniverseItem`（:4-13）加 `sellable?: boolean`；`getUniverseMeta`（:86-101）加 `sellable_breakdown`（複用 `countField` 模式） | ~15 行 |
| F3 | `apps/web/src/lib/sellable-overrides.ts` | **新增**：§3.2 全部 API + §3.4 閘門函式 | ~180 行 |
| F4 | `apps/web/src/lib/sellable-overrides.test.ts` | **新增**：§7.1 測試 | ~220 行 |
| F5 | `apps/web/src/app/pool/page.tsx` | 可銷售欄（表頭 :131-138 區、列 :141-163 區各加一格）、可銷售篩選 state 與下拉（併入 :20-24、:43-58）、批量操作列（§4.1-3）、可銷售徽章（:75-80 區）、storage 事件訂閱 | ~90 行 |
| F6 | `apps/web/src/lib/investment-pool.ts` | `importPoolFromCsv`（:146-209）解析選配 `sellable` 欄（布林解析比照 :78-83），回傳值加 `sellableOverrides: Record<string, boolean>`；`poolToCsv`（:239-246）加第二參數 `resolveSellable?: (ticker: string) => boolean`，有傳才輸出 `sellable` 欄 | ~35 行 |
| F7 | `apps/web/src/app/settings/page.tsx` | 匯入成功後（:77-81 區）把 `sellableOverrides` 餵給 `setSellableBulk` 逐組寫入；匯出（:84-86）傳入 `isSellableTicker` 作 `resolveSellable` | ~15 行 |
| F8 | `apps/api/app/routers/settings.py` | `validate_pool_csv`（:112-181）辨識選配 `sellable` 欄（寬鬆布林解析），非法值列 error 但不拒收整列；audit 存檔（:106-109）自然帶過 | ~15 行 |
| F9 | `apps/web/src/app/api/universe/filter/route.ts` | `FilterBody`（:25-33）加 `non_sellable_tickers`；`supplementSystem`（:53-77）加軟指示；`runFallback`（:109-122）與 AI 路徑（:129-145）輸出經 `splitBySellable(ctx)`；response 加 `sellable_blocked` | ~30 行 |
| F10 | `apps/web/src/app/api/overlay/interpret/route.ts` | `InterpretBody`（:57-75）加 `non_sellable_tickers`；route import `@/data/etf-universe.json` 推導可銷售目錄（§3.8.1）；system prompt 尾端加 §3.8 動態區塊（可銷售目錄 + §3.8.2 路由規則；`overlaySystemPrompt` :190-350 保持純靜態，動態區塊在 POST 內串接）；輸出後過濾 proposed/supplement（§3.4-L2，`extractExplicitTickersFromTexts` 豁免），response/audit 附 `sellable_blocked` | ~70 行 |
| F11 | `apps/web/src/lib/universe-filter-fallback.ts` | `analyzeUniverseFilterFallback`（:113-148）加 `opts.ctx`，回傳前 `splitBySellable` | ~10 行 |
| F12 | `apps/web/src/lib/overlay-filter-proposals.ts` | `mapTickersToProposed`（:319-337）串接 `filterSellableProposed` | ~5 行 |
| F13 | `apps/web/src/lib/resolve-overlay-universe.ts` | `fetchUniverseSupplements` body（:44-51）加 `non_sellable_tickers`；locked 路徑 `novel`（:137-140）與 local `mapTickersToProposed`（:60-75）串閘門；open-pool `extras` 併入前（:203-212）`splitBySellable` | ~20 行 |
| F14 | `apps/web/src/lib/direct-indexing.ts` | `pickFromPrefer`（:288-314）、`pickDirectIndexStocks`（:321-336）、`proposedTickersForDirectIndex`（:346-366）回傳前 `splitBySellable` | ~10 行 |
| F15 | `apps/web/src/components/OverlayConversationPanel.tsx` | interpret 呼叫（:245）body 加 `non_sellable_tickers`；`confirmProposedTickers`（:600-635）確認後檢查 `splitBySellable(added).blocked`，非空則追加警告 assistant 訊息（§4.2） | ~25 行 |
| F16 | `apps/web/src/components/OverlayChatTimeline.tsx` | `ProposedTickersPanel`（:140-250）候選列對不可銷售者加 ⚠ 徽標（defense-in-depth）；DI 全擋空態文案（:196-198 區） | ~20 行 |
| F17 | `apps/web/src/lib/i18n.tsx` | §6 全部 keys（en dict :30 起、zh dict :2049 起、ko dict :3934 起，各一份） | ~3×14 行 |
| F18 | `apps/web/src/lib/types.ts` | （Phase 2 預留，可本期一併加註解 TODO）`BacktestRequest` :110-116 區段 | ~3 行 |

> 註：F9/F10 的 `sellable_blocked` 欄位讓 client 能提示「AI 原本想建議但被可銷售設定擋下」，避免 RM 誤以為 AI 漏看；`OverlayConversationPanel` 收到後以 dim 小字呈現即可（不阻塞流程）。

---

## 6. i18n 文案

新增 keys（`i18n.tsx` 三 dict 各一份；插值用既有 `{name}` 語法，`translate` 於 i18n.tsx:5905）：

| Key | zh（繁中） | en | ko |
|---|---|---|---|
| `pool.col.sellable` | 可銷售 | Sellable | 판매 가능 |
| `pool.filter.allSellable` | 全部（可銷售） | All sellability | 전체(판매가능) |
| `pool.filter.sellableOnly` | 僅可銷售 | Sellable only | 판매 가능만 |
| `pool.filter.nonSellableOnly` | 僅不可銷售 | Non-sellable only | 판매 불가만 |
| `pool.sellableBadge` | 可銷售 {sellable} / {total} | {sellable} / {total} sellable | 판매 가능 {sellable} / {total} |
| `pool.toggleSellable` | 切換 {ticker} 可銷售 | Toggle sellable for {ticker} | {ticker} 판매 가능 전환 |
| `pool.sellable.overridden` | 已覆寫（預設：{value}） | Overridden (default: {value}) | 재정의됨(기본값: {value}) |
| `pool.bulk.filteredSummary` | 篩選結果 {count} 筆（不可銷售 {blocked}） | {count} filtered ({blocked} non-sellable) | 필터 결과 {count}개(판매 불가 {blocked}) |
| `pool.bulk.setSellable` | 全選篩選結果設為可銷售 | Mark all filtered as sellable | 필터 결과 전체 판매 가능으로 |
| `pool.bulk.unsetSellable` | 批次取消可銷售 | Mark filtered as non-sellable | 필터 결과 판매 불가로 |
| `pool.bulk.resetDefaults` | 回復全部預設 | Reset all to defaults | 모두 기본값으로 |
| `pool.bulk.resetConfirm` | 確定要清除所有可銷售覆寫並回復預設值？ | Clear all sellable overrides and restore defaults? | 모든 판매 가능 재정의를 지우고 기본값으로 복원할까요? |
| `pool.bulk.done` | 已更新 {count} 筆可銷售狀態 | Updated sellable state for {count} tickers | {count}개 종목 판매 가능 상태 변경됨 |
| `pool.sellable.diHint` | 直接指數化需要個股標的；目前個股預設不可銷售，請至標的池頁篩選「個股」後批次開啟。 | Direct indexing needs individual stocks; stocks are non-sellable by default — filter “Stock” on the pool page and bulk-enable them. | 직접 인덱싱에는 개별 주식이 필요합니다. 주식은 기본적으로 판매 불가입니다 — 유니버스 페이지에서 "주식"을 필터링하여 일괄 활성화하세요. |
| `overlay.proposedTickers.nonSellableWarn` | ⚠ 以下標的目前標記為不可銷售：{tickers}。仍可回測，但請確認適售性後再向客戶揭露。 | ⚠ These tickers are marked non-sellable: {tickers}. They remain backtestable, but confirm suitability before presenting to clients. | ⚠ 다음 종목은 판매 불가로 표시되어 있습니다: {tickers}. 백테스트는 가능하지만 고객 제시 전 적합성을 확인하세요. |
| `overlay.proposedTickers.sellableBlocked` | 已依可銷售設定排除 {count} 檔建議標的 | {count} suggested tickers excluded by sellable settings | 판매 가능 설정으로 제안 종목 {count}개 제외됨 |

---

## 7. 測試計畫

測試框架：vitest（`apps/web/vitest.config.ts`；無 npm script，直接 `npx vitest run`）。測試檔與被測檔同目錄，比照 `overlay-filter-proposals.test.ts`、`direct-indexing.test.ts` 風格。localStorage 以 `beforeEach` 清空的 jsdom 實例隔離。

### 7.1 單元測試（`sellable-overrides.test.ts`）

| # | 案例 | 斷言 |
|---|---|---|
| U1 | 無 override、JSON 無 `sellable` 欄（現況 651 筆） | `etf`/`fund` → true；`stock` → false；未知 product_type → false |
| U2 | JSON 明示 `sellable: true` 的 stock | true（JSON 明示 > 預設規則） |
| U3 | override `AAPL → true`；override `ACWI → false` | 覆寫優先於一切 |
| U4 | `clearSellableOverride` | 回到預設規則值；map 中 key 被移除 |
| U5 | `setSellableBulk` 值與有效值相同 | 不寫入覆寫（diff 最小化）；不同才寫入 |
| U6 | 不在 universe 的 ticker（如合成 stub `PRIVFUND1`） | false（§9 E4） |
| U7 | `CASH` | 恆 true，即使被寫入 override false（§9 E5） |
| U8 | `splitBySellable(["ACWI","AAPL"])`（預設態） | kept `[ACWI]`、blocked `[AAPL]`，順序保留 |
| U9 | `filterSellableProposed` 物件版 | `name/category/rationale` 欄位完整保留 |
| U10 | server ctx：`{ nonSellable: new Set(["ACWI"]) }` | ctx 優先且不需要 localStorage（SSR 安全） |
| U11 | localStorage 壞 JSON / quota 例外 | 回 `{}`，不 throw |
| U12 | `resolveNonSellableSet`（預設態） | 恰含 257 檔 stock（對齊 §2.1 實測） |

### 7.2 防線測試（加進既有測試檔或新檔）

| # | 案例（對應防線） | 斷言 |
|---|---|---|
| D1 | interpret route：body 帶 `non_sellable_tickers:["NVDA"]`，mock AI 回 proposed 含 NVDA + 對話文字未點名（L2） | response overlay 的 `proposed_tickers` 無 NVDA；`sellable_blocked` 含 NVDA |
| D2 | interpret route：RM 文字明示「加碼 NVDA」（L2 豁免） | supplement_tickers 保留 NVDA |
| D3 | `synthesizeThemeProposedTickers`：override `BOTZ→false`（L3） | ai_tech bucket 輸出不含 BOTZ，其餘遞補 |
| D4 | `analyzeUniverseFilterFallback("AI 主題", { ctx })`（L4） | 回傳 tickers 不含 ctx 內標的 |
| D5 | `/api/universe/filter` route：fallback 路徑（未設 API key）+ body 帶清單（L5） | `supplement_tickers` 已過濾、`sellable_blocked` 正確 |
| D6 | `resolveOverlayUniverse` open-pool：`extras` 含不可銷售（L6） | `universe_supplement_tickers` 不含被擋標的 |
| D7 | `resolveOverlayUniverse` locked：`filterProposedTickers`（L6） | proposed 不含不可銷售；locked universe 本身（模型持有）不受影響 |
| D8 | `pickDirectIndexStocks` / `proposedTickersForDirectIndex`：個股全預設 false（L7） | 回空陣列；override 部分個股 true 後只回該批 |
| D9 | `confirmProposedTickers` 含 blocked（L8，元件層） | supplement 照常加入 + 追加警告訊息 |
| D10 | 防線完整性檢查清單（防 drift）：grep 式測試或 snapshot，斷言八個呼叫點都 import 自 `sellable-overrides` | 任一防線改回繞過閘門會亮紅 |
| D11 | interpret route 目錄注入（§3.8）：body 帶 `non_sellable_tickers:["AAPL",…]`，攔截送往 AI 的 system prompt | prompt 含 `SELLABLE CATALOG` 區塊；區塊**不含**被擋標的、含其餘可銷售標的；每行符合 `TICKER|name|product_type` compact 格式 |
| D12 | interpret route 路由規則（§3.8.2/§3.8.3）：個股全數不可銷售時的 prompt 內容；AI 仍回個股時的 safety net | prompt 含「不得開啟個股路徑／主題導向基金 ETF」規則文案；mock AI 回 proposed 含個股 → L2 照樣擋下並回填 `sellable_blocked`（§3.8.5） |

### 7.3 整合測試

| # | 案例 | 驗證點 |
|---|---|---|
| I1 | pool 頁：篩 product_type=stock → 批量設可銷售 | overrides map 恰 257→寫入；再次讀取 `isSellableTicker("AAPL")===true` |
| I2 | 「回復全部預設」 | overrides 清空，AAPL 回到 false |
| I3 | CSV 匯入含 `sellable` 欄（settings 頁路徑） | pool items 更新 + overrides 寫入；缺欄時不動 overrides |
| I4 | CSV 匯出 → 重新匯入 round-trip | sellable 狀態不變 |
| I5 | i18n key-parity：§6 keys 三語皆存在 | 不 fallback 成 key 字串 |
| I6 | regression：`enabled` 行為完全不變（既有 pool 測試全綠） | `getEnabledPoolTickers` 結果不受 overrides 影響 |

### 7.4 手動驗收（UI）

1. 標的池頁可見「可銷售」欄；個股列預設未勾、ETF 列預設勾選；切換單列後重新整理狀態保留。
2. 篩「個股」→「全選篩選結果設為可銷售」→ 徽章數字更新；改篩「僅不可銷售」→ 清單變空。
3. 開 overlay 對話要求 AI 主題建議 → 建議清單不含被關閉的標的；被擋時出現 dim 提示。
4. 對話中明示點名不可銷售標的並確認 → 成功加入，且出現 ⚠ 警告訊息。
5. 不做任何覆寫時提出直接指數化需求 → 出現 DI 引導文案；批次開啟個股後重試 → 正常給出股票袖套。
6. 切換 EN/繁中/한국어 → §6 文案全部正確顯示。

---

## 8. 實作順序

### Phase 1 — 本期 ship（web 為主，引擎不動）

1. **S1（F2、F3、F4）**：`UniverseItem.sellable` + `sellable-overrides.ts` + 單元測試。此步獨立可驗。
2. **S2（F5、F17 部分）**：pool 頁欄位／篩選／批量操作列／徽章 + 對應 i18n。關鍵需求（批量全選）在此步落地。
3. **S3（F6、F7、F8、F17 部分）**：CSV 三點（lib、settings 頁、引擎 validate-pool）。
4. **S4（F11、F12、F14、F13）**：client 純函式防線 L3/L4/L7/L6。
5. **S5（F9、F10）**：BFF 兩條 route（L5、L1/L2）+ `non_sellable_tickers` 合約 + §3.8 可銷售目錄注入與路由規則。
6. **S6（F15、F16、F17 部分）**：對話面板 allow+warn（L8）與 ⚠ 徽標、DI 引導文案。
7. **S7**：§7.3 整合測試 + §7.4 手動驗收。

相依：S2–S6 都只依賴 S1 的 store API，彼此可平行；建議仍按序送審以降低 rebase 成本。

### Phase 2 — deferred（開放問題，僅預留）

- **P1 引擎硬閘門**：web `types.ts` 與引擎 `models.py`（:198 區段）加 `non_sellable_tickers`；`EtfCatalogUniverseV1.build`（stages/universe.py :73-87）自 tradable 排除（**豁免** must_include／anchor／benchmark，§9 E1/E2/E6）；optimizer 層是否加硬約束待另行評估（對 max_sharpe 搜尋的候選裁剪影響需實驗）。
- **P2 伺服器端 store**：公司級 sellable 清單（跨 RM／跨裝置一致）。候選落點：引擎 `routers/universe.py`（:8-17）加寫入端點 + 檔案儲存；屆時 web store 改為快取層。fail-open → fail-closed 的政策切換也在此階段決定。

---

## 9. 邊界案例

| # | 案例 | 處理 |
|---|---|---|
| E1 | **anchor／模型持有標的不可銷售** | 不回測層阻擋（§3.7）。locked universe（resolve-overlay-universe.ts :106-170）照舊包含模型持有；僅在 RM 把不可銷售 anchor 留著時，由報告頁既有衝突／警示機制以外的**新增 dim 提示**（可延後，非阻塞）。 |
| E2 | **must-include 衝突** | 引擎 `derive_must_include_tickers`（經 stages/universe.py :59-71 → customization）在 Phase 1 不受 sellable 影響；Phase 2 硬閘門必須豁免 must_include，否則 RM 明示需求會被靜默丟棄。 |
| E3 | **late-listing（新上市）** | 與 sellable 正交：late-listing 由資料層排除（既有 `excluded_late_listing_count`，ResultsDashboard.tsx :1628-1629）。新上市標的可同時 `sellable=true`（前瞻性可建議）但回測歷史被排除——兩軸不衝突，不需特殊處理。 |
| E4 | **合成 stub（overlay 確認加入但不在 JSON）** | `profiles.py` `_synthetic_supplement_item`（:116-146）產生的標的預設**不可被推薦**（§3.2：不在 universe → 預設 false）；RM 明示確認者經 L8 放行 + 警告。不寫任何「合成 stub 預設可銷售」的例外。 |
| E5 | **CASH 偽標的** | `SELLABLE_EXEMPT_TICKERS`（§3.2）恆 true、不可被覆寫；對齊引擎 `_PSEUDO_TICKERS`（profiles.py :86）。 |
| E6 | **benchmark** | benchmark（預設 SPY，stages/universe.py :76-80）僅供比較、非交易候選，不套用 sellable 閘門；即使 SPY 被關閉可銷售，報告照常出 benchmark 線。 |
| E7 | **預設規則與直接指數化的張力** | 個股預設不可銷售 → DI 袖套（L7）初始會全數被擋。**這是預期行為**：UI 以 `pool.sellable.diHint` 引導 RM 至標的池「篩個股 → 全選設可銷售」（§4.1 一鍵完成）；公司若常態做 DI，在 `shared/etf-universe.json` 對個段落明示 `sellable: true` 作為公司預設（§3.1）。 |
| E8 | **JSON 缺 `sellable` 欄的遷移（現況）** | 651 筆全缺欄 → 預設規則即初始態；日後逐筆補明示值時新舊並存無痛（三層解析保證）。`sync-universe`（package.json:15）只複製檔案，不碰 localStorage，RM 覆寫不因同步而丟失。 |

---

## 10. 與現有機制的關係

### 10.1 pool `enabled` vs `sellable` —— 兩軸獨立

| 面向 | `enabled`（既有） | `sellable`（本功能） |
|---|---|---|
| 語意 | RM 的作業範圍／清單成員 | 公司適售性：能不能被 AI 建議 |
| 儲存 | `jasper_investment_pool_v3` 全量快照（investment-pool.ts :4） | `jasper_sellable_overrides_v1` diff map（§3.2） |
| 影響面 | 模型衝突檢測（model-portfolios-store.ts :82/:116/:292）、pool 計數 | 八條建議產生防線（§3.4） |
| 對回測 | 無直接影響 | 無直接影響（Phase 1） |

兩者可任意組合：enabled=false + sellable=true（不在我的清單但可被建議）、enabled=true + sellable=false（在清單、可回測、不被建議）。模型 `conflict_tickers` 計算**不看** sellable（維持現狀；是否對「模型持有含不可銷售」另出警告屬 E1 的延伸，Phase 2 再議）。

### 10.2 late-listing 過濾

不同軸（§9 E3）：late-listing 是「資料歷史不足」的時間軸過濾，sellable 是「當下適售性」的狀態旗標。兩者在報告頁各自呈現，不共用文案。

### 10.3 合成 stub（overlay_supplement）

`category: "overlay_supplement"` 的合成列（profiles.py :143）不進 JSON，自然落在預設 false（§9 E4）。這與其「asset_class 無 hint 時警告並預設 equity」（:129-136）的保守哲學一致：合成品一律先不可推薦、靠 RM 明示放行。

### 10.4 drift-sync / needs-driven-weight-bounds

sellable 閘門位於 **universe 解析之前段**（resolve-overlay-universe.ts 內），早於 `attachDriftSyncAudit` 與權重 band 編譯（needs-driven-weight-bounds.md 的雙軌制在更後段的 allocator/constraints）。被閘門擋掉的標的不會進入 band 編譯，無需改動那兩個功能的任何程式；唯一交點是「ask 點名的 ticker 被擋」時，L8 的警告訊息即為留痕。

**主題 sleeve 成員的可銷售性（v1.3 補記）**：主題／產業比例的表達走 `group_weight_band` + 顯式 tickers（見 `overlay-param-whitelist-expansion.md` §11.1），而 band 綁定的 tickers 來自 RM 確認後的 supplement／proposed 清單——該清單在 L2/L3/L6/L8 已過本文件的 sellable 閘門，因此 band 成員**天然是 sellable-filtered**。日後若 band 編譯改為自 universe 主動擴充成員（而非僅綁確認清單），擴充候選必須先經 `splitBySellable` 過濾，否則會把不可銷售標的帶進權重帶。

### 10.5 settings CSV 稽核檔

引擎 `validate_pool_csv`（routers/settings.py :112-181）會把每次匯入存成稽核 CSV（`_save_audit` :106-109）。加 `sellable` 欄後稽核檔自然包含該欄，`GET /settings/pool`（:252-260）回讀亦相容（舊稽核檔無此欄 → 缺欄不影響 pool 必要欄驗證）。

---

## 11. 風險與回滾

| # | 風險 | 緩解 |
|---|---|---|
| R1 | localStorage store 為單機單瀏覽器，跨裝置／同事間不一致 | 本期明示接受（§1.3 N1）；CSV 匯出（F6/F7）可作為人工攜帶手段；Phase 2 伺服器端 store 治本 |
| R2 | 個股預設不可銷售使 DI 流程「看起來壞掉」 | §9 E7：UI 引導文案 + 一鍵批量開啟；公司可在 JSON 段落落明示值 |
| R3 | 八條防線日後 drift（新建議面忘記接閘門） | 單一閘門函式 + §7.2 D10 完整性測試；code review checklist 把 `sellable-overrides` import 列為建議面必要條件 |
| R4 | 可銷售目錄注入造成 token 膨脹 | §3.8.4：預設 394 檔 compact 格式 ≈ 4k–7k tokens，可接受；預留「省略 name 欄／按 asset_class 分段／context caching」三個縮減選項；llm_log 審計持續觀察。v1.2 起不以 blocklist 取代正向目錄（理由見 §3.8.4 末段） |
| R5 | 閘門例外導致流程中斷 | 全防線 fail-open + console.warn（§3.6）；Phase 2 再議 fail-closed |
| R6 | 舊 localStorage pool（v3）與新功能交互相關疑慮 | 無交互：sellable 獨立 key，不 bump pool 版本；I6 斷言 enabled 行為不變 |

**回滾**：

1. 緊急停用：於 DevTools 執行 `localStorage.setItem("jasper_sellable_gate_off","1")`——閘門函式首行檢查此旗標，設置後所有 `splitBySellable`/`filterSellableProposed` 原樣放行（實作於 F3，一行 if）。
2. 資料回滾：`localStorage.removeItem("jasper_sellable_overrides_v1")` 即回到預設規則初始態；JSON 未落值（F1 不改資料），git revert 本功能 PR 即完全還原。
3. 引擎側本期零改動（F8 僅新增選配欄辨識，舊 CSV 無欄照常通過），無需回滾引擎。

---

## 12. 配套變更：overlay 參數白名單擴充（已實作；v1.2 起遷出）

> v1.2 起本節遷出為獨立文件：**`docs/design/overlay-param-whitelist-expansion.md`**（背景、四鍵語義規格、路由規則全文、再匯出 SOP、測試與邊界案例皆在該文件）。

與本文件主功能（sellable 旗標）為**同批 sibling change**，設計原則相同：把「AI 可操作的目錄」直接餵進 prompt，讓模型用專用欄位表達客戶需求，而不是硬塞錯誤欄位或回 capability_gaps。本文件的 L1 是「把可銷售清單注入 prompt + 硬過濾兜底」（§3.8）；白名單擴充是「把可調約束旋鈕連同中文觸發語注入 prompt + 白名單 parse 兜底」。兩者都是 *give AI the actionable catalog*。

摘要：`ClientOverlay.param_adjustments` 白名單自 11 鍵擴充至 **15 鍵**（新增 `max_weight_actual`／`top_n_actual`／`max_holdings_actual`／`max_turnover_actual` 四個 allocator 約束旋鈕），catalog version 1 → 2，interpret prompt 加 ROUTING 段（**專用欄位優先、`param_adjustments` 為後盾**：單一持股 ≤X% → `allocation.max_single_position_pct` 優先；類別配額 → `sleeve_targets` + `enforce_class_weights`；集中／放寬持股 → `top_n_actual`／`max_holdings_actual`；換手上限 → `max_turnover_actual`）。

---

## 附錄 A：關鍵程式碼座標速查

| 主題 | 座標 |
|---|---|
| Universe JSON 現況 | `shared/etf-universe.json` v1.2 / 651 筆 / product_type: etf 346、stock 257、fund 48 / 無 sellable 欄 |
| JSON → web 同步 | `package.json:15`（`sync-universe`）；引擎直讀 `apps/api/app/config.py:8` |
| `UniverseItem` 型別 | `apps/web/src/lib/universe.ts:4-13` |
| Pool store | `apps/web/src/lib/investment-pool.ts`（key :4；`PoolItem` :9-16；CSV :146-209/:239-246） |
| Pool 頁 | `apps/web/src/app/pool/page.tsx`（state :20-24；filtered :43-58；表頭 :131-138；列 :141-163） |
| 設定頁 CSV | `apps/web/src/app/settings/page.tsx`（匯入 :51-82；匯出 :84-86） |
| 引擎 CSV 驗證 | `apps/api/app/routers/settings.py:112-181` |
| interpret route | `apps/web/src/app/api/overlay/interpret/route.ts`（body :57-75；param catalog block :153-188；system prompt :190-350；universe 規則 :241-249；POST :401 起） |
| universe filter route | `apps/web/src/app/api/universe/filter/route.ts`（body :25-33；prompt :53-77；AI 路徑 :129-145） |
| 主題合成 | `apps/web/src/lib/overlay-filter-proposals.ts:319-337`（buckets :150-215） |
| 規則 fallback | `apps/web/src/lib/universe-filter-fallback.ts:113-148` |
| overlay universe 解析 | `apps/web/src/lib/resolve-overlay-universe.ts`（fetch body :44-51；locked :106-170；open-pool 併入 :203-212） |
| 直接指數化 | `apps/web/src/lib/direct-indexing.ts`（選股 :288-336；proposed :346-366） |
| 對話面板 | `apps/web/src/components/OverlayConversationPanel.tsx`（interpret 呼叫 :245；confirm :600-635）；`OverlayChatTimeline.tsx`（候選面板 :140-250） |
| Web BacktestRequest | `apps/web/src/lib/types.ts:110-116` |
| 引擎 BacktestRequest | `apps/api/app/models.py:189-201` |
| 引擎 universe stage | `apps/api/app/engine/stages/universe.py`（`UniverseResult` :21-27；`build` :73-87） |
| 引擎 universe 讀取／pin | `apps/api/app/profiles.py`（`get_universe` :33-83；`_PSEUDO_TICKERS` :86；合成 stub :116-146；`assert_locked_universe` :265-298） |
| BFF 透明代理 | `apps/web/src/app/quant-api/[[...path]]/route.ts:19-86` |
| 參數白名單目錄（§12 配套） | `apps/api/app/engine/param_taxonomy.py` `_PARAM_CATALOG_META` :100 起；`apps/web/src/lib/overlay-gemini-parse.ts` :23-36；完整座標見 `docs/design/overlay-param-whitelist-expansion.md` 附錄 A |
| i18n dicts | `apps/web/src/lib/i18n.tsx`（en :30 / zh :2049 / ko :3934；pool 段 en :1978 / zh :3865 / ko :5816；`translate` :5905） |
