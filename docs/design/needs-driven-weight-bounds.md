# 需求驅動標的權重邊界（Needs-Driven Weight Bounds）與資產類別配額雙軌制 施工說明書

> **版本**：0.1（施工前設計定稿）
> **狀態**：Ready for implementation — 尚未落地
> **日期**：2026-09-04
> **讀者**：Web/BFF 工程師、API/引擎工程師、RM 產品負責人、合規/稽核
> **相關文件**：[`docs/design/overlay-drift-sync.md`](./overlay-drift-sync.md)（漂移滑桿連動；本文件 §9.2 說明兩者相依）
> **適用程式碼**:`apps/web`（Next.js BFF + UI）**與** `apps/api`（FastAPI + 回測引擎）——本功能兩端皆動
> **事故背景**:Job `fa51bebe-c730-45f1-a4bc-0fe1ef5ca3e0` — Overlay 要求「私募基金 15%」，模型輸出 `w_alternative=0.15`，但最終組合另類曝險為 0，且報告全綠燈（靜默失敗）

---

## 1. 目標與範圍

### 1.1 問題陳述

客戶需求「私募基金 15%」目前只有**一條半**傳輸鏈路，且每條都有斷點：

1. Overlay LLM 把需求寫成 `sleeve_targets: { "w_alternative": 0.15 }` → `sleeveTargetsToParamControls`（`apps/web/src/lib/overlay-schema.ts:626-636`）釘成 `param_controls.w_alternative = { mode: "fixed", fixed: 0.15 }` → 引擎 `class_budget_from_params`（`apps/api/app/engine/asset_class_policy.py:306-328`）建立 `{alternative: 0.15}` 類別配額。
2. 但 Overlay 建議的私募基金 ETF 不在靜態 catalog 內，`profiles.py` 的 `_synthetic_supplement_item`（`apps/api/app/profiles.py:75-90`）合成 catalog row 時把 `asset_class` **硬編碼為 `"equity"`**（:86）→ alternative 配額在整個 universe 中**沒有任何成員**。
3. 引擎兩道配額機制對「空類別」皆靜默跳過（§2.2 G2/G3）,`needs_attainment` 根本沒有類別配額與 band 達成檢核（§2.2 G4）→ 結果全綠燈，RM 與客戶都不知道 15% 另類配置從未發生。

### 1.2 目標（本功能要做的）

| # | 目標 | 說明 |
|---|---|---|
| G1 | **補充標的類別提示鏈路** | Overlay interpret prompt 要求 LLM 為 proposed tickers 標注 `asset_class`;schema、BFF、`BacktestRequest.universe_supplement_meta`、引擎 `_synthetic_supplement_item` 全鏈路打通；無提示時退回 equity **並記 warning**（不再靜默）。 |
| G2 | **具名配置雙軌編譯** | 具名 sleeve/ask（如「私募基金 15%」）同時編譯出 ① 類別配額軌（`w_alternative`，既有）與 ② ticker 級 `group_weight_band` 軌（綁定該 sleeve 實際選中的標的）。修復 `groupWeightBandsFromOverlay` 的 `w_*` 靜默跳過與 `"other"` 分支過度綁定。 |
| G3 | **空類別配額顯性化** | 引擎在 universe 確定後檢查：類別配額若在標的池中無成員，寫入 job 結果 `narrative_facts.class_quota_unfilled` 並記 warning log;UI 於需求達標面板顯示琥珀色警告。 |
| G4 | **needs_attainment 增列檢核** | 每個候選組合增列「資產類別配額」與「配置區間（band)」達成列；`NeedsFulfillmentPanel` 如實呈現，未達不再隱形。 |

### 1.3 非目標（Explicit Non-Goals）

- **不改配額/帶寬的求解語意**:`enforce_class_weight_budget`、`apply_group_weight_bands`、`project_anchor_l1_drift` 的數學行為完全不變；本功能只修「輸入編譯」與「結果檢核」。
- **不改 `enforce_class_weights` 預設值**:API 預設 `true`（`apps/api/app/models.py:171-177`),overlay 路徑預設 `false`(`overlay-schema.ts:1234-1235, 1271-1272`)；是否自動翻 true 列為 P2 選項（§9.3)，本功能預設不動。
- **不做 LLM 提示詞以外的類別推斷**:不對 ticker 名稱做關鍵字猜測（如 "PRIV" → alternative)；catalog 查不到的標的只信 LLM hint，否則退回 equity + warning。
- **不處理 regime 別配額**(`regime_class_quotas`）的空類別檢查：列為 P2（§7）。
- **不阻擋執行**：空類別配額只警告與留痕，不讓 job 失敗（與 drift-sync「警告不阻擋」一致）。

---

## 2. 現況分析

### 2.1 事故資料流（Job fa51bebe 實際路徑）

```
RM 對話「…私募基金 15%…」
  → POST /api/overlay/interpret (apps/web/src/app/api/overlay/interpret/route.ts:396)
  → overlaySystemPrompt (route.ts:186-343) 現行提示詞未要求標注 asset_class
  → LLM 輸出 sleeve_targets { w_alternative: 0.15 }
     + proposed_tickers [{ ticker: "<私募基金ETF>" }]（無 asset_class 欄位可填）
  → 簽核 → overlayToBacktestRequest (overlay-schema.ts:1154)
     ├─ sleeveTargetsToParamControls (overlay-schema.ts:626-636)
     │    → param_controls.w_alternative = { mode:"fixed", fixed:0.15 }   …配額軌
     └─ universe_supplement_tickers 帶上私募基金ETF                         …標的軌
  → POST /jobs → engine backtest.py
     ├─ get_universe(..., supplement_tickers=…) (backtest.py:2938-2942)
     │    → _union_supplement_items (profiles.py:93-134)
     │    → catalog 查無此檔 → _synthetic_supplement_item (profiles.py:75-90)
     │    → asset_class = "equity"（硬編碼,profiles.py:86）★斷點 1
     ├─ pin_guaranteed_supplements (backtest.py:2952-2956) 同一路徑再合成一次
     ├─ class_budget_from_params → { alternative: 0.15 } (asset_class_policy.py:306)
     │    但 universe 中 asset_class=="alternative" 的成員數 = 0            ★斷點 2
     ├─ Top-N：pick_top_n_by_class_slots (asset_class_policy.py:483)
     │    → alternative 槽位 shortfall → 名額靜默讓給其他類別 (:537-553)   ★斷點 3a
     ├─ Rebalance：enforce_class_weights=false（overlay 預設）→ 整段不執行；
     │    即使為 true,enforce_class_weight_budget 對無成員類別
     │    `if not idxs: continue` 靜默跳過 (:158-161)                        ★斷點 3b
     ├─ groupWeightBandsFromOverlay 從未產生任何 band(§2.2 G2)→
     │    apply_group_weight_bands 無輸入                                   ★斷點 3c
     └─ needs_attainment (objectives.py:274) 無類別配額/band 檢核
          → all_floors_met=true,報告全綠                                   ★斷點 4
```

### 2.2 缺口（gap）總表

| # | 缺口 | 位置 | 現況 |
|---|---|---|---|
| G1 | 合成補充標的 `asset_class` 硬編碼 equity | `profiles.py:86`(`_synthetic_supplement_item` 全文 :75-90) | Overlay 新增的未知標的一律歸入 equity;alternative/commodity/real_estate/bond 類配額對它們永遠無成員。上游（schema、prompt、`BacktestRequest`）沒有任何欄位可攜帶類別提示。 |
| G2 | 具名配置只編譯半軌 | `overlay-schema.ts:995`(`w_*` skip）、:998-1002 與 :974-978(`"other"` 分支） | ① `groupWeightBandsFromOverlay`(:934-1033）對 `sleeve_targets` 迴圈中 `if (key.startsWith("w_")) continue;`(:995）一律跳過 → 類別配額**永不**產生 ticker 級 band。② 具名 sleeve key（如「私募基金」）或無 tickers 的 band ask,`sleeveKeyTheme`(:914-919）判為 `"other"` 時把**全部** supplement pool 綁進 band(:977、:1000-1002)→ 過度綁定：私募基金 15% 會把 AI/避險補充標的也算進來。 |
| G3 | 空類別配額全程靜默 | `asset_class_policy.py:537-553`(Top-N shortfall 讓位）、:139-141 與 :158-161(`enforce_class_weight_budget` skip-empty) | 配額類別無成員時，Top-N 把槽位讓給其他類別、預算強制投影直接跳過該類別；無 log、無結果欄位、無 UI 呈現。 |
| G4 | `needs_attainment` 無配額/band 檢核 | `objectives.py:274-413`（檢核列舉於 :401-408)、`_needs_score` :416-428 | 只檢 drawdown / single-name / theme / cash / income / must_include / drift 七項；類別配額與 `group_weight_bands`（明明已隨 `ClientContext` 送進引擎，`models.py:90-96`）完全沒有達成檢核。 |

### 2.3 可直接複用的現有機制

| 機制 | 位置 | 複用方式 |
|---|---|---|
| `ClientContext.group_weight_bands` 通道 | `models.py:90-96` → `group_weights.py:178-185` | band 軌的既有傳輸與解析，原樣沿用；新編譯出的 band 走同一通道進引擎。 |
| `apply_group_weight_bands` | `group_weights.py:88-175`;rebalance 呼叫點 `portfolio.py:1039-1045` | band 軌的既有執行器（drift 投影前）；本功能只負責餵給它正確的 band。 |
| `class_sleeve_totals` | `asset_class_policy.py:88-105` | attainment 檢核時按類別加總實際權重，原樣呼叫。 |
| `class_budget_from_params` / `zero_disallowed_class_params` | `asset_class_policy.py:306-328, 570-592` | 3.3 靜態預檢與 3.4 候選檢核的配額推導，比照 `backtest.py:4058-4061` champion 路徑既有用法。 |
| `narrative_facts` 診斷通道 | 先例：`narrative_facts["regime_class_quotas"]`(backtest.py:4457-4458);web 型別 `Record<string, unknown>`(`types.ts:412, 429`) | `class_quota_unfilled` 寫入此通道，web 端免改型別。 |
| Web 端 universe catalog | `apps/web/src/lib/universe.ts:30-32`(`getUniverseItems`,`UniverseItem.asset_class` :7) | 雙軌編譯時查已知 ticker 的類別（catalog 優先於 LLM hint，與引擎行為對齊）。 |
| `ASSET_CLASSES` 五類列舉 | `apps/web/src/lib/constants.ts:1-7` | prompt、zod schema、`sleeveKeyToAssetClass` 的單一來源。 |
| i18n needs 表列 | `i18n.tsx` en :573-585 / zh :2499-2509 / ko :4354-4364 | 新列文案比照既有 `results.needsTable.*` 模式。 |

---

## 3. 核心設計

### 3.1 補充標的 `asset_class` 提示鏈路（G1)

**設計原則**:catalog（`universe.json` / `etf-universe.json`）永遠優先；hint 只用於 catalog 查無的**合成**標的；無 hint 時退回 equity 但必須留下 warning（顯性化，不再靜默）。

#### 3.1.1 Interpret prompt 增列標注規則

`overlaySystemPrompt`(`route.ts:186-343`）在 `universe.proposed_tickers` 規則（:240）後追加：

```
- universe.proposed_tickers asset_class: each proposed ticker SHOULD include
  "asset_class": one of equity|bond|commodity|real_estate|alternative.
  Private funds, hedge funds, managed futures, private credit/equity, and
  crypto proxies → "alternative". Well-known catalog ETFs may omit it.
  Never invent asset classes outside the five allowed values.
```

同步更新 asks 規則段落（:249-258)：當 ask 屬於某資產類別配置（如私募基金）且帶 `tickers` 時，這些 tickers 若同時出現在 `proposed_tickers`，應帶一致的 `asset_class`。

#### 3.1.2 Schema:`overlayProposedTickerSchema` 加欄位

`overlay-schema.ts:170-177`:

```ts
export const overlayProposedTickerSchema = z
  .object({
    ticker: z.string().min(1).max(8),
    name: z.string().max(120).optional(),
    category: z.string().max(60).optional(),
    /** LLM hint for catalog-unknown tickers; engine catalog row wins on conflict. */
    asset_class: z.enum(ASSET_CLASSES).optional(),
    rationale: z.string().max(200).optional(),
  })
  .strip();
```

zod enum 在 interpret 層直接擋下非法值（如 `"crypto"`),LLM 標錯類別本身由 §3.3/§3.4 的顯性化兜底（§8 E9)。

#### 3.1.3 BFF 編譯:`universeSupplementMetaFromOverlay()`

新純函式（放 `overlay-schema.ts`，與 `groupWeightBandsFromOverlay` 同級）:

```ts
export type SupplementMeta = { asset_class: AssetClass };

/**
 * Collect asset_class hints for supplement/proposed tickers.
 * Priority: ① proposed_tickers[].asset_class (LLM hint)
 *          ② band ask / named sleeve key mapped via sleeveKeyToAssetClass (§3.2)
 * Catalog-known tickers are still included — engine ignores meta when a
 * catalog row exists (profiles.py catalog-first rule).
 */
export function universeSupplementMetaFromOverlay(
  overlay: ClientOverlay,
): Record<string, SupplementMeta>;
```

- 來源 ② 的 ticker 集合解析與 §3.2 的 band 編譯**共用同一個 resolver**（見 §3.2.3),保證「meta 標的類別」與「band 綁定標的」一致。
- 只輸出 supplement/proposed/ask 提及的 tickers；不對全 catalog 產生 meta。

#### 3.1.4 請求欄位：`BacktestRequest.universe_supplement_meta`

- Web `types.ts`（接 `universe_supplement_tickers` :112-113 之後）:

```ts
/** asset_class hints for supplement tickers absent from the engine catalog. */
universe_supplement_meta?: Record<string, { asset_class?: AssetClass }> | null;
```

- `overlayToBacktestRequest`(`overlay-schema.ts:1154-1287`）兩個分支（locked :1204-1249、open :1251-1286）皆設定：

```ts
const supplementMeta = universeSupplementMetaFromOverlay(overlay);
// ...
universe_supplement_meta: Object.keys(supplementMeta).length ? supplementMeta : null,
```

- API `models.py`（接 `universe_supplement_tickers` :190-197 之後）:

```python
class SupplementMeta(BaseModel):
    asset_class: Literal["equity", "bond", "commodity", "real_estate", "alternative"] | None = None

class BacktestRequest(BaseModel):
    # ...
    universe_supplement_meta: dict[str, SupplementMeta] | None = Field(
        default=None,
        description=(
            "Per-ticker hints for overlay supplements absent from the static "
            "catalog. Only used when synthesizing stub catalog rows; existing "
            "catalog entries always win."
        ),
    )
```

注意：此欄位**要送往引擎**，與 `top_n`/`overlay_drift_floor` 等 UI-only 欄位不同,`createJob` 不可剝除。

#### 3.1.5 引擎消費端

`profiles.py`:

```python
_VALID_ASSET_CLASSES = frozenset({"equity", "bond", "commodity", "real_estate", "alternative"})

def _synthetic_supplement_item(
    ticker: str,
    *,
    asset_class_hint: str | None = None,
) -> dict[str, Any]:
    t = str(ticker).strip().upper()
    hint = str(asset_class_hint or "").strip().lower()
    if hint not in _VALID_ASSET_CLASSES:
        # Explicit surfacing (was: silently "equity" — job fa51bebe root cause).
        logger.warning(
            "Synthetic supplement %s has no valid asset_class hint (%r); "
            "defaulting to 'equity' — class quotas for its intended class will "
            "have no members", t, asset_class_hint,
        )
        hint = "equity"
    return {
        "ticker": t,
        "name": t,
        "asset_class": hint,
        "category": "overlay_supplement",
        "region": "unknown",
        "overlay_synthetic": True,
        "asset_class_source": "overlay_hint" if asset_class_hint else "default_equity",
    }
```

- `_union_supplement_items`(:93-134）與對外兩個入口 `get_universe`(:28-70)、`pin_guaranteed_supplements`(:137-158）各加 `supplement_meta: dict[str, Any] | None = None` 參數往內傳；**catalog 命中的 row 不看 meta**(profiles.py:118-127 既有分支不動）。
- `backtest.py` 呼叫點：`get_universe(...)`（:2938-2942）與 `pin_guaranteed_supplements(...)`（:2952-2956）傳入 `supplement_meta=req.universe_supplement_meta`;DI 分支彙整 `guaranteed_supplements`(:2937 前後）同樣適用。靜態回放路徑（:2772）無 supplements，不變。

### 3.2 具名配置雙軌編譯（G2)

**雙軌定義**：同一個具名配置意圖（「私募基金 15%」）同時產生——

- **配額軌（quota track)**:`w_alternative = 0.15` → Top-N 槽位分配（`portfolio.py:640-653`）與可選的 `enforce_class_weight_budget` 硬投影。解決「挑哪些標的、各類多少槽」。
- **帶寬軌（band track)**:`GroupWeightBand { group_id, tickers: [該 sleeve 實際標的], target_pct: 0.15 }` → `apply_group_weight_bands`(`portfolio.py:1039-1045`）在 drift 投影前把這些標的推到目標權重。解決「配額有數字但無具體標的承接」。

兩軌互為冗餘：配額軌失效（如成員為零、flag 關閉）時帶寬軌仍作用；反之帶寬被 drift cap 截斷時配額軌的 attainment 檢核（§3.4）仍會報告未達。

#### 3.2.1 `sleeveKeyToAssetClass()`

新 export（放 `overlay-schema.ts`):

```ts
/**
 * Map a sleeve_targets key / ask group_id to a top-level asset class.
 * Conservative: returns null when not confidently classifiable — callers
 * fall back to theme classification or diagnostics, never to "bind everything".
 */
export function sleeveKeyToAssetClass(key: string): AssetClass | null {
  const k = key.trim().toLowerCase();
  if (k.startsWith("w_")) {
    const ac = k.slice(2);
    return (ASSET_CLASSES as readonly string[]).includes(ac) ? (ac as AssetClass) : null;
  }
  const HINTS: Array<[RegExp, AssetClass]> = [
    [/私募|private[\s_-]?(fund|equity|credit|debt)|對沖基金|对冲基金|hedge[\s_-]?fund|managed[\s_-]?futures|另類|另类|alternative/, "alternative"],
    [/債券|债券|bond|固定收益|fixed[\s_-]?income/, "bond"],
    [/不動產|不动产|房地產|real[\s_-]?estate|reit/, "real_estate"],
    [/商品|貴金屬|贵金属|commodity|precious/, "commodity"],
    [/股票|equity|stock/, "equity"],
  ];
  for (const [re, ac] of HINTS) if (re.test(k)) return ac;
  return null;
}
```

注意：**不**把「黃金/gold/避險/hedge（單獨出現）」映射到 commodity/bond —— 那是 `sleeveKeyTheme` 的 hedge 主題路徑（既有行為），混用會與 `OVERLAY_HEDGE_TICKERS`(:871-888）語意衝突。只有明確的資產類別詞才映射。

#### 3.2.2 類別成員解析器（web 端）

```ts
/** Pool tickers whose asset class matches — catalog lookup first, then LLM hints. */
function poolTickersInClass(
  pool: string[],
  assetClass: AssetClass,
  proposed: OverlayProposedTicker[],
): string[] {
  const catalog = new Map(
    getUniverseItems().map((u) => [u.ticker.toUpperCase(), u.asset_class]),
  );
  const hint = new Map(
    proposed.filter((p) => p.asset_class).map((p) => [p.ticker.toUpperCase(), p.asset_class!]),
  );
  return pool.filter((t) => (catalog.get(t) ?? hint.get(t)) === assetClass);
}
```

#### 3.2.3 `groupWeightBandsFromOverlay` 修改

維持現有簽名與預設行為（`includeUnsigned` 等，:934-940）的前提下，改寫成員解析，並新增帶診斷的姊妹函式：

```ts
export type BandCompileDiagnostic = {
  kind: "unfilled_class_quota" | "unresolved_sleeve";
  ref: string;                    // sleeve key 或 ask id
  asset_class?: AssetClass;
  target_pct: number;
};

export function groupWeightBandsWithDiagnostics(
  overlay: ClientOverlay,
  opts?: { includeUnsigned?: boolean },
): { bands: GroupWeightBand[]; diagnostics: BandCompileDiagnostic[] };

export function groupWeightBandsFromOverlay(  // 原函式改為薄 wrapper,行為相容
  overlay: ClientOverlay,
  opts?: { includeUnsigned?: boolean },
): GroupWeightBand[];
```

**sleeve_targets 迴圈**（現 :991-1007）改為：

```ts
for (const [key, raw] of Object.entries(sleeves)) {
  const target = Number(raw);
  if (!Number.isFinite(target) || target <= 0) continue;
  const assetClass = sleeveKeyToAssetClass(key);           // w_* 與具名 key 都先走這裡
  if (assetClass) {
    const tickers = poolTickersInClass(supplementTickers, assetClass, proposed);
    if (tickers.length) {
      pushBand({ group_id: key, tickers, target_pct: target });   // ★ 雙軌:quota 之外補上 band
    } else {
      diagnostics.push({ kind: "unfilled_class_quota", ref: key, asset_class: assetClass, target_pct: target });
    }
    continue;
  }
  const theme = sleeveKeyTheme(key);                       // 既有 ai/hedge 主題路徑不變
  if (theme === "other") {
    // ★ 修復 over-binding：不再綁全部 pool;改用「未被類別帶寬認領的剩餘池」(§3.2.4)
    const tickers = unclaimedPool();
    if (tickers.length) pushBand({ group_id: key, tickers, target_pct: target });
    else diagnostics.push({ kind: "unresolved_sleeve", ref: key, target_pct: target });
    continue;
  }
  const tickers = supplementTickers.filter((t) => overlayThemeClass(t) === theme);
  if (tickers.length) pushBand({ group_id: key, tickers, target_pct: target });
}
```

**ask 迴圈**（現 :967-989):ask 無 `tickers` 時的 group_id 推斷比照同樣優先序——① `sleeveKeyToAssetClass(ask.group_id ?? ask.title)` → 類別過濾；② `sleeveKeyTheme` 的 ai/hedge → 主題過濾（不變）;③ other → 剩餘池，不再全綁（:974-978 現行邏輯替換）。

**向後相容關鍵**:`w_*` skip(:995）移除後，對「純 `w_*` 且 supplement pool 無該類成員」的舊 overlay，結果不產生 band（同現況）但多一條 diagnostic——引擎輸入完全不變，僅診斷面增加。

#### 3.2.4 兩階段認領（two-pass claiming)

為保留「單一 unnamed sleeve 綁住整個補充籃」的既有合理行為，同時修掉多 sleeve 時的過度綁定：

1. **Pass 1**：先解析所有能映射類別的 key(w_* 與具名皆可），把其成員 tickers 標記為「已認領」。
2. **Pass 2**:`theme === "other"` 的 key 只能綁 **pool − 已認領** 的剩餘 ticker；剩餘為空 → diagnostic。
3. ai/hedge 主題過濾維持在原 pass 內運作（其 tickers 與類別維度正交，不參與認領）。

如此：舊案例「core/satellite 以外一個模糊 sleeve」→ 無類別認領 → 剩餘池 = 全池 → 行為不變；新案例「私募基金 15% + AI 衛星 45%」→ 私募基金綁 alternative 標的，AI 走主題，互不污染。

#### 3.2.5 diagnostics 的去處

- BFF interpret 回合：`attachMechanicalOverlayConflicts`(`overlay-feasibility.ts`）可選加一張**非阻擋**提示卡 `CLASS_QUOTA_NO_MEMBERS`（「私募基金 15% 目前沒有可配置的標的，請在標的審核步驟確認另類 ETF」）——P2。
- 確認後:diagnostics 與 §3.1 的 meta 一起由 `overlayToBacktestRequest` 處理；`unfilled_class_quota` 在引擎端由 §3.3 再次檢出（引擎是唯一可信來源，web diagnostics 僅為早提示）。

### 3.3 空類別配額顯性化（G3)

#### 3.3.1 引擎靜態預檢

`asset_class_policy.py` 新增純函式：

```python
def fixed_class_budget_from_param_controls(
    param_controls: dict[str, Any] | None,
    *,
    asset_classes: list[str] | None = None,
) -> dict[str, float]:
    """Top-level class budget from *fixed* w_* param_controls only (overlay path pins these)."""

def find_unfilled_class_quotas(
    class_budget: dict[str, float] | None,
    universe_by_ticker: dict[str, dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """[{asset_class, target_pct, reason: "no_universe_members"}] for quotas with zero members."""
```

`backtest.py` 在 universe 定案（`pin_guaranteed_supplements` :2952-2956 之後、`universe_by_ticker` 建立 :3102 前後）呼叫：

```python
static_budget = fixed_class_budget_from_param_controls(
    {k: v.model_dump() for k, v in (req.param_controls or {}).items()},
    asset_classes=req.asset_classes,
)
class_quota_unfilled = find_unfilled_class_quotas(static_budget, universe_by_ticker)
if class_quota_unfilled:
    logger.warning(
        "Class quota(s) have no universe members and cannot be filled: %s "
        "(job %s) — quotas will be silently redistributed by Top-N shortfall "
        "unless supplements gain asset_class hints",
        class_quota_unfilled, job_id,
    )
# 結果組裝時:
narrative_facts["class_quota_unfilled"] = class_quota_unfilled or None
```

- 此檢查只看 **fixed** 配額（overlay 路徑的配額皆為 fixed);Optuna 搜尋出來的 per-trial 配額由 §3.4 的候選級 attainment 兜底。
- `regime_class_quota_matrix` 啟用時（`backtest.py:1949-1953` 既有判斷）略過此檢查（P2 再補 regime 別檢查）。

#### 3.3.2 UI 呈現

`NeedsFulfillmentPanel` 加可選 prop:

```ts
classQuotaUnfilled?: Array<{ asset_class: string; target_pct: number; reason?: string }> | null;
```

有值時在面板頂部渲染琥珀色警告條（沿用既有 `pixel-badge-warn` / `border-amber-200` 視覺語言）:

```
⚠ 以下資產類別配額因標的池無對應成員而未生效:另類(目標 15%)
   — 請在 Overlay 標的審核中確認該類別的 ETF,或移除該配額。
```

接線點：`RmReportView.tsx:671` 目前 `<NeedsFulfillmentPanel needs={needs} />`;`compare.adjustedResult.narrative_facts` 已在同檔作用域（:666）可直接讀取 `class_quota_unfilled` 傳入。歷史 job 無此欄位 → prop 為 null → 不渲染（向後相容）。

### 3.4 `needs_attainment` 增列檢核（G4)

#### 3.4.1 引擎：`objectives.py`

`needs_attainment`(:274-413）新增可選參數（預設 `None`，既有呼叫行為完全不變）:

```python
def needs_attainment(
    metrics, client_context, *,
    holdings=None, ticker_meta=None,
    must_include_tickers=None, anchor_weights=None, customization_drift=None,
    class_budget: dict[str, float] | None = None,   # 新增
) -> dict[str, Any] | None:
```

**Band 達成**（bands 自 `client_context.group_weight_bands` 讀取，與引擎執行同源，`models.py:90-96`):

```python
bands = parse_group_weight_bands(_ctx_get(client_context, "group_weight_bands"))
if bands:
    any_floor = True
    band_rows = []
    for b in bands:
        actual = sum(w for t, w in h.items() if t in set(b.tickers))
        lo, hi = b.min_pct, b.max_pct
        if lo is None and hi is None and b.target_pct is not None:
            lo, hi = b.target_pct - BAND_TOL, b.target_pct + BAND_TOL   # BAND_TOL = 0.02
        within = (lo is None or actual >= lo - 1e-9) and (hi is None or actual <= hi + 1e-9)
        band_rows.append({"group_id": b.group_id, "target_pct": ..., "min_pct": ..., "max_pct": ...,
                          "actual_pct": round(actual, 4), "within_band": within})
    checks["group_bands"] = band_rows
    checks["within_group_bands"] = all(r["within_band"] for r in band_rows)
```

**類別配額達成**（呼叫端傳入 `class_budget`；排除 CASH 後歸一化再比對，與 `enforce_class_weight_budget` 作用標的一致，見 §8 E5):

```python
budget = normalize_class_budget(class_budget)
if budget and ticker_meta is not None:
    any_floor = True
    invested = {t: w for t, w in h.items() if t != "CASH"}
    tot = sum(invested.values()) or 1.0
    w_vec = np.asarray([invested[t] / tot for t in invested])
    totals = class_sleeve_totals(w_vec, list(invested), ticker_meta)
    rows = []
    for ac, target in budget.items():
        actual = totals.get(ac, 0.0)
        rows.append({"asset_class": ac, "target_pct": round(target, 4),
                     "actual_pct": round(actual, 4),
                     "within_class_quota": abs(actual - target) <= CLASS_QUOTA_TOL})  # 0.02
    checks["class_quotas"] = rows
    checks["within_class_quotas"] = all(r["within_class_quota"] for r in rows)
```

**彙總更新**(:401-408 的 floors 列表與 `_needs_score` :416-428 的 keys tuple）加入 `within_group_bands`、`within_class_quotas`——兩處皆為「存在才計入」模式，無新檢核的舊路徑分數不變。

#### 3.4.2 呼叫端與 stage 包裝

- `backtest.py:1836-1856` 候選組裝處新增傳參：

```python
class_budget=(
    None
    if params.get("regime_class_quota_matrix")
    else class_budget_from_params(
        zero_disallowed_class_params(params, req.asset_classes),
        asset_classes=req.asset_classes,
    )
),
```

（與 champion 路徑 :4058-4061 同一推導，保證「檢核用的配額」=「該候選實際配額」。)

- `stages/reporting.py` 兩個入口（`attainment` :61-76、`needs_attainment` :78-97）簽名同步加 `class_budget=None` 透傳；`stages/accessors.py:254` 的包裝一併更新。注意 `tests/golden/test_stage_parity.py:126` 會比對 stage 與 legacy 輸出，兩側必須同參數同結果。

#### 3.4.3 Web 呈現

- `types.ts` `needs_attainment`(:267-291）加：

```ts
class_quotas?: Array<{ asset_class: string; target_pct: number; actual_pct: number; within_class_quota: boolean }>;
within_class_quotas?: boolean;
group_bands?: Array<{ group_id: string | null; target_pct?: number | null; min_pct?: number | null; max_pct?: number | null; actual_pct: number; within_band: boolean }>;
within_group_bands?: boolean;
```

- `needs-fulfillment.ts`:`NeedsFloorRowKey`(:3-10）加 `"classQuota" | "groupBands"`;`NEEDS_TABLE_I18N`(:12-20）加對應 key;`needsFloorRows`(:35-116）各產生一列——全達標時 detail 顯示「{n} 項配額全達成」式摘要，有未達時 detail 列未達項（如 `另類 0.0% / 15%`;band 列 `私募基金 0.0% / 15%`)。`needsAllPassed`(:118-126）自動生效（rows 有 false 即整體未達）。
- `NeedsFulfillmentPanel.tsx`：無結構改動（rows 驅動），僅 §3.3.2 的警告條 prop。

---

## 4. 檔案變更清單

### 4.1 API(`apps/api`)

| # | 檔案 | 變更 | 估計規模 |
|---|---|---|---|
| A1 | `app/models.py` | `SupplementMeta` 新 model;`BacktestRequest.universe_supplement_meta` 新欄位（接 :190-197 後） | ~20 行 |
| A2 | `app/profiles.py` | `_synthetic_supplement_item` 加 `asset_class_hint` + warning log(:75-90);`_union_supplement_items`(:93-134)、`get_universe`(:28-70)、`pin_guaranteed_supplements`(:137-158）加 `supplement_meta` 透傳；檔頭加 `logger` | ~45 行 |
| A3 | `app/engine/asset_class_policy.py` | 新增 `fixed_class_budget_from_param_controls`、`find_unfilled_class_quotas`（純函式） | ~45 行 |
| A4 | `app/engine/backtest.py` | `get_universe`/`pin_guaranteed_supplements` 傳 meta(:2938-2942, :2952-2956)；空類別預檢 + warning + `narrative_facts["class_quota_unfilled"]`(:3102 前後與結果組裝處）;`needs_attainment` 呼叫傳 `class_budget`(:1836-1856) | ~45 行 |
| A5 | `app/engine/objectives.py` | `needs_attainment` 新參數 + `group_bands`/`class_quotas` 檢核區塊；floors 列表（:401-408）與 `_needs_score`(:416-428）加新 keys | ~70 行 |
| A6 | `app/engine/stages/reporting.py` + `stages/accessors.py` | wrapper 簽名同步（:61-76, :78-97;accessors :254) | ~20 行 |

### 4.2 Web(`apps/web`)

| # | 檔案 | 變更 | 估計規模 |
|---|---|---|---|
| W1 | `src/lib/overlay-schema.ts` | `overlayProposedTickerSchema.asset_class`(:170-177);`sleeveKeyToAssetClass`、`poolTickersInClass`、`universeSupplementMetaFromOverlay` 新增;`groupWeightBandsWithDiagnostics` 重構 + 原函式薄化(:934-1033);`overlayToBacktestRequest` 兩分支寫 `universe_supplement_meta`(:1204-1249, :1251-1286) | ~160 行 |
| W2 | `src/app/api/overlay/interpret/route.ts` | `overlaySystemPrompt` 增列 asset_class 標注規則（:240 附近）+ asks 段一致性註記（:249-258) | ~12 行 |
| W3 | `src/lib/types.ts` | `BacktestRequest.universe_supplement_meta`(:112-113 後）;`needs_attainment` 新欄位（:267-291) | ~14 行 |
| W4 | `src/lib/needs-fulfillment.ts` | 新 row keys、`NEEDS_TABLE_I18N` 條目、`needsFloorRows` 兩列生成 | ~45 行 |
| W5 | `src/components/NeedsFulfillmentPanel.tsx` | `classQuotaUnfilled` prop + 警告條 | ~30 行 |
| W6 | `src/components/RmReportView.tsx` | :671 處從 `narrative_facts` 讀 `class_quota_unfilled` 傳入面板 | ~8 行 |
| W7 | `src/lib/i18n.tsx` | §5 全部文案（en/zh/ko 三處，接 :573-585 / :2499-2509 / :4354-4364 模式） | ~3×10 行 |

> 註：`overlay-fallback.ts`(rules fallback）產生的 proposed_tickers 不帶 `asset_class`——屬預期；引擎端無 hint → 退回 equity + warning，與設計一致，不需改動。

### 4.3 測試

| # | 檔案 | 內容 |
|---|---|---|
| T1 | `apps/api/tests/test_synthetic_supplement_asset_class.py`（新） | §6.1 U1–U6 |
| T2 | `apps/api/tests/test_class_quota_attainment.py`（新） | §6.1 U7–U12 + §6.2 I1–I3 |
| T3 | `apps/web/src/lib/overlay-schema-bands.test.ts`（新） | §6.1 U13–U20 |
| T4 | `apps/web/src/lib/needs-fulfillment.test.ts`（擴充） | §6.1 U21–U23 |
| T5 | `apps/api/tests/test_class_quota_unfilled.py`（新） | §6.2 I4(fa51bebe 復現） |

---

## 5. i18n 文案

新增 keys(`i18n.tsx` 三個 dict 各一份；插值沿用既有 `{name}` 語法）:

| Key | zh（繁中） | en | ko |
|---|---|---|---|
| `results.needsTable.classQuota` | 資產類別配額 | Asset-class quota | 자산군 배분 한도 |
| `results.needsTable.groupBands` | 配置區間目標 | Sleeve band targets | 슬리브 밴드 목표 |
| `results.needsTable.classQuotaUnfilledTitle` | 配額未生效警告 | Inactive quota warning | 적용 불가 한도 경고 |
| `results.needsClassQuotaUnfilled` | 以下資產類別配額因標的池無對應成員而未生效:{items} | These asset-class quotas had no matching instruments and were not applied: {items} | 해당 종목이 없어 적용되지 않은 자산군 한도: {items} |
| `results.needsClassQuotaUnfilledHint` | 請在 Overlay 標的審核中確認該類別的 ETF，或移除該配額。 | Confirm an ETF for this class in the overlay ticker review, or remove the quota. | 오버레이 종목 검토에서 해당 자산군 ETF를 확인하거나 한도를 제거하세요. |
| `results.assetClass.equity` | 股票 | Equity | 주식 |
| `results.assetClass.bond` | 債券 | Bond | 채권 |
| `results.assetClass.commodity` | 商品 | Commodity | 원자재 |
| `results.assetClass.real_estate` | 不動產 | Real estate | 부동산 |
| `results.assetClass.alternative` | 另類 | Alternative | 대체 |

`{items}` 由呼叫端組「另類（目標 15%)」字串（`results.assetClass.*` + 百分比）後帶入。band 列的 `group_id` 原樣顯示（RM 在 Overlay 中看過該名稱，如「私募基金」)。

---

## 6. 測試計畫

框架：API 用 pytest(`apps/api/tests/`);web 用 vitest(`npx vitest run`，測試檔與被測檔同目錄，比照 `overlay-drift-sync.test.ts` 風格）。

### 6.1 單元測試

| # | 案例 | 斷言 |
|---|---|---|
| U1 | `_synthetic_supplement_item("PFX", asset_class_hint="alternative")` | `asset_class == "alternative"`、`asset_class_source == "overlay_hint"`、無 warning(caplog) |
| U2 | 無 hint | 退回 `"equity"`、caplog 有一條 WARNING 含 ticker 名（fa51bebe 舊行為的顯性化） |
| U3 | hint 非法值（`"crypto"`) | 退回 equity + warning;不 raise |
| U4 | `_union_supplement_items` catalog 命中 | catalog row 的 `asset_class` 優先，meta 被忽略 |
| U5 | `get_universe(tickers=[...locked], supplement_tickers=["PFX"], supplement_meta={"PFX": {"asset_class": "alternative"}})` | 池內 PFX 為 alternative;`pin_guaranteed_supplements` 同 |
| U6 | meta 為 None（舊請求） | 行為與現況逐位一致（回歸） |
| U7 | `find_unfilled_class_quotas({"alternative": 0.15}, universe 全 equity)` | 回傳 `[{asset_class: "alternative", target_pct: 0.15, reason: "no_universe_members"}]` |
| U8 | 同上但 universe 含一檔 alternative | 空 list |
| U9 | `needs_attainment` 傳 `class_budget={"alternative": 0.15}`,holdings 全 equity | `class_quotas[0].within_class_quota is False`、`within_class_quotas is False`、`all_floors_met is False` |
| U10 | 同上，holdings 含 15% alternative 標的（ticker_meta 標注） | 全 True;CASH 存在時先排除歸一再比對（§8 E5) |
| U11 | `needs_attainment` 讀 client_context 內 `group_weight_bands`(target 0.15,actual 0.0) | `group_bands[0].within_band is False`;min/max 皆無時走 target±0.02 容差 |
| U12 | `_needs_score` 加新 keys 後：無新檢核的 attainment | 分數與現況一致（分母不變） |
| U13 | `sleeveKeyToAssetClass`:`w_alternative`→alternative;「私募基金」→alternative;「對沖基金」→alternative;「避險」→**null**（留給 theme 路徑）;「核心」→null | 映射表行為 |
| U14 | `groupWeightBandsFromOverlay`:`sleeve_targets {w_alternative: 0.15}` + proposed PFX(asset_class=alternative) | 產生 band `{group_id: "w_alternative", tickers: ["PFX"], target_pct: 0.15}`(:995 skip 移除的迴歸鎖定） |
| U15 | 同上但 proposed 無 asset_class 且 catalog 查無 | 不產生 band;diagnostics 含 `unfilled_class_quota` |
| U16 | 具名 sleeve「私募基金 0.15」+ PFX 標 alternative + 另一 AI sleeve | 私募基金 band 只綁 PFX;AI 走 theme 不變；PFX 不被 AI band 認領 |
| U17 | 相容：單一「其他」sleeve、無任何類別映射 | 剩餘池 = 全 supplement pool → band 行為與現況一致（two-pass 認領） |
| U18 | over-binding 修復：「私募基金 0.15」無法映射時 + 已有 `w_alternative` band 認領 PFX | 「私募基金」落 diagnostics(`unresolved_sleeve`），不再全綁 |
| U19 | `universeSupplementMetaFromOverlay`:proposed hint 優先於 ask/sleeve 推導；輸出僅涵蓋 supplement 相關 tickers | 優先序正確 |
| U20 | `overlayToBacktestRequest` locked 與 open 分支 | 皆帶 `universe_supplement_meta`;`param_controls.w_alternative` 仍存在（雙軌並存） |
| U21 | `needsFloorRows`:`class_quotas` 有未達 | 產生 `classQuota` 列、pass=false、detail 含「另類 0.0% / 15%」;`needsAllPassed` 回 false |
| U22 | `needsFloorRows`:`group_bands` 全達 | `groupBands` 列 pass=true |
| U23 | 舊 job 的 attainment（無新欄位） | rows 與現況一致（向後相容） |

### 6.2 整合測試

| # | 案例 | 驗證點 |
|---|---|---|
| I1 | `apps/api` 既有 `test_client_needs.py`、`test_group_weight_bands.py`、`test_class_slot_planning.py`、`tests/golden/test_stage_parity.py` 全數通過 | A5/A6 簽名擴充無行為變更 |
| I2 | 引擎端 run：固定 `w_alternative=0.15` + universe 僅 equity（合成標的無 hint) | `narrative_facts.class_quota_unfilled` 含 alternative;caplog 有 warning;job **照常完成**（警告不阻擋） |
| I3 | 引擎端 run：同上但 supplement 帶 alternative hint | 無 unfilled;champion `needs_attainment.class_quotas` 的 alternative 列 actual ≈ 0.15 且 met |
| I4 | **fa51bebe 復現**(T5)：合成私募基金 ETF(「PFX」)+ `sleeve_targets {w_alternative: 0.15}` 的 overlay → 走完整 `overlayToBacktestRequest` → 引擎 run（可比照 `test_constrained_customization.py` 的 fixture 模式 monkeypatch 價格源） | 修復後：① request 同時有 `param_controls.w_alternative` fixed 與 `client_context.group_weight_bands` 綁 PFX;② PFX 合成 row 為 alternative;③ attainment 另類配額達標；④ 對照組（拔掉 hint）復現舊事故：unfilled 警告 + attainment 未達，**且兩者在報告上皆可見** |
| I5 | Web:`createJob` payload **保留** `universe_supplement_meta`（與 UI-only 欄位剝除相反，防呆斷言） | API 契約 |
| I6 | i18n key parity:§5 keys 在三語 dict 皆存在 | 無 fallback 到 key 字串 |

### 6.3 手動驗收（UI)

1. Overlay 對話輸入「配置 15% 私募基金」→ 標的審核出現 LLM 建議的另類 ETF（帶類別標注）→ 確認執行 → 報告需求面板出現「資產類別配額」與「配置區間目標」兩列且達標。
2. 對照：把該 ETF 的類別標注移除（模擬 LLM 漏標）→ 報告出現琥珀色「配額未生效」警告條 + 配額列未達。
3. 切換語言（EN/繁中/한국어）→ 新文案正確。

---

## 7. 實作順序

### Phase 1 — 止血與顯性化（可獨立 ship;web 未上線前引擎即有 warning)

| 優先 | 內容 | 相依 | 完成判準 |
|---|---|---|---|
| P0 | A1、A2(profiles hint 鏈路 + 退回 warning) | 無 | T1 U1–U6 全綠；`pytest apps/api` 無回歸 |
| P0 | A3 + A4 的預檢部分（`find_unfilled_class_quotas` → `narrative_facts` + log) | 無（不依賴 A2) | T5/I2:fa51bebe 對照情境產生 unfilled 警告 |
| P1 | A5、A6(needs_attainment 增列）+ A4 的 attainment 傳參 | 無 | T2 U7–U12、I1 全綠 |
| P1 | W4、W5、W6、W7(needs 面板新列 + 警告條） | Phase 1 的 API 欄位已在 result 中 | T4 U21–U23、I6；手動驗收 #2 |

> Phase 1 單獨上線的效果：事故**不再靜默**（log + 結果欄位 + UI 警告 + attainment 未達），即使雙軌編譯（Phase 2）尚未交付。

### Phase 2 — 雙軌編譯與提示鏈路

| 優先 | 內容 | 相依 | 完成判準 |
|---|---|---|---|
| P0 | W1 的 schema + `sleeveKeyToAssetClass` + `universeSupplementMetaFromOverlay` + `overlayToBacktestRequest` 寫 meta;A4 的 meta 傳遞 | Phase 1 的 A1/A2 | T3 U13–U15、U19、U20;I5 |
| P0 | W2(prompt 標注規則） | 無（可與上項平行） | 手動驗收 #1 前半；interpret 輸出可過 zod |
| P1 | W1 的 `groupWeightBandsWithDiagnostics` 重構（two-pass 認領、over-binding 修復） | 上兩項（meta 與類別解析器是其輸入） | T3 U14、U16–U18;`overlay-feasibility.test.ts`、`overlay-drift-sync.test.ts` 無回歸 |
| P2 | BFF interpret 非阻擋提示卡 `CLASS_QUOTA_NO_MEMBERS`（§3.2.5) | P1 重構 | 提示卡出現且不阻擋 confirm |
| P2 | regime 別配額（`regime_class_quotas`）的空類別檢查 | Phase 1 A3 | 另開測試 |
| P2 | 評估「雙軌產生 band 且有 w_* fixed 時自動 `enforce_class_weights=true`」(§9.3) | P1 | 設計評審後另行決策，預設不做 |

相依性：Phase 2 P0 的 meta 鏈路必須在 P1 雙軌重構**之前**（雙軌的類別成員解析依賴 proposed_tickers 的 asset_class)。每個 Phase 獨立可 ship;Phase 1 全為新增欄位/警告，對現有行為零變更。

---

## 8. 邊界案例

| # | 案例 | 預期行為 |
|---|---|---|
| E1 | band 解析後 tickers 為空 | `pushBand` 本就丟棄空 band(:956-958)；新增 diagnostics 記錄原因；配額軌由 §3.3 顯性化兜底。 |
| E2 | 未簽核（unsigned)ask | `groupWeightBandsFromOverlay` 預設只編譯 signed ask（現行 :969 條件不變）;`includeUnsigned` 僅供 drift-sync 對話期提示，不進引擎。`universe_supplement_meta` 由 `overlayToBacktestRequest` 產生，天然只在簽核後存在。 |
| E3 | 多個具名 sleeve 映射同一類別（私募基金 15% + 對沖基金 10% → 皆 alternative) | 各產生一條 band,tickers 不重疊時各自為絕對份額；若 ticker 被兩個 sleeve 爭奪，two-pass 認領先來先得並記 diagnostic。注意 `group_weights.py:77-86`(`_find_parent_idx`）會把「嚴格子集」band 解讀為群內份額——編譯端應避免產出子集關係的 bands，文件化此行為。 |
| E4 | signed band 與 `w_*` 配額並存且 target 不一致（私募基金 band 15% vs `w_alternative` 20%) | 執行順序上 band 在 class budget 之後（`portfolio.py:1039-1045` 晚於 :1026-1038),band 覆蓋配額投影結果；attainment 兩列分開呈現使不一致可見。P2 可加 BFF「目標不一致」提示，本期不阻擋。 |
| E5 | cash reserve 疊加 | 引擎的類別預算與 bands 都作用在**風險資產向量**上（現金在外層扣除）;attainment 的配額比對先在排除 CASH 後歸一化的持倉上計算（§3.4.1)，與 enforcement 標的一致。例如另類目標 15% + 現金 5% → 風險資產內 15%、佔總資產 14.25%，檢核以 15% 為準。 |
| E6 | LLM 把私募基金標成 equity（標錯） | 類別配額依然無成員 → §3.3 unfilled + §3.4 attainment 未達，RM 在報告可見。hint 是提示不是保證；顯性化是最後防線。 |
| E7 | catalog 已有該 ticker 但類別與 hint 不同 | catalog 優先，meta 忽略（profiles.py:118-127 分支不動），不覆寫人工維護的資料；debug log 記一筆。 |
| E8 | 舊 job 重跑 / 歷史 overlay 重放 | 無 `universe_supplement_meta` → 與現況逐位一致，僅每個合成標的多一條 warning（顯性化目的）;result JSON 多新欄位，舊 UI 讀取忽略。 |
| E9 | 補充標的全部無 hint | 全數退回 equity + 每標的一條 warning（可於實作時改為 per-run 彙總一條以降噪）；不阻擋、不報錯。 |
| E10 | `sleeve_targets` 同時有 `w_alternative` 與具名「私募基金」key | 兩者都映射 alternative → 各產生 band,two-pass 認領避免重複綁定；`formatOverlaySummary` 顯示不受影響。 |
| E11 | 與 overlay-drift-sync 的交互 | 見 §9.2：雙軌編譯讓更多 bands 真實存在 → drift 需求提示可能上升（修正過去的低估），屬預期且正確的變化。 |
| E12 | locked universe(anchor 模式）下補充標的 | locked 分支 `universe_supplement_tickers = locked`(:1232-1234),meta 一樣寫入；`_union_supplement_items` 的 `bypass_asset_class_filter=True` 路徑（profiles.py:46-51）同樣走合成函式，hint 生效。 |

---

## 9. 與現有機制的關係

### 9.1 引擎執行順序（`portfolio.py` rebalance loop,:961-1048)

```
solve_weights(含 anchor drift 懲罰)  :961-975
→ project_max_weight                 :981
→ apply_must_include_floor(軟必持)   :983-997
→ _finalize_rebalance_weights(換手)  :999-1005
→ apply_min_holding_weight           :1006
→ apply_max_holdings                 :1007-1012
→ apply_must_include_floor(再次)     :1013-1024
→ enforce_class_weight_budget        :1026-1038  ← 配額軌(需 enforce_class_weights=true)
→ apply_group_weight_bands           :1039-1045  ← 帶寬軌(不受該旗標管制)
→ project_anchor_l1_drift            :1046-1048  ← 最後;其後不得再擴大 L1
```

- **配額軌先、帶寬軌後**：具名配置同時有兩軌時，band 結果覆蓋配額投影（E4)。本功能不改此順序。
- **drift cap 是最終硬約束**:band 把私募基金推到 15% 所需的 L1 若超出 `customization_drift`，會被 :1046-1048 截斷——這正是 overlay-drift-sync 要對齊的空間問題，本功能不處理。
- **Top-N 槽位**(:640-653）用 `class_budget` 決定各類名額；§3.1 修復後 alternative 類才有成員可被挑入，槽位分配才真正生效。

### 9.2 與 overlay-drift-sync 的相依

`computeOverlayDriftHints` 的 waterfall 層級 2 呼叫 `groupWeightBandsFromOverlay(overlay, { includeUnsigned: true })`(overlay-drift-sync.md §3.3.4)。雙軌編譯上線後：

- 層級 2 會看到**更多真實 bands**（過去 `w_*` 被 :995 跳過、具名 key 被 over-bind),`minRequiredDrift` 可能**上升**——這是修正過去的低估，屬預期變化；對話期提示與確認時自動調升會更常觸發。
- 不修改 drift-sync 的計算邏輯；僅其輸入（bands）變完整。上線時於 PR 說明註記此行為變化，並以 `overlay-drift-sync.test.ts` 加一個「`w_*` sleeve 產生 band」的迴歸案例鎖定。

### 9.3 `enforce_class_weights` 旗標

API 預設 `true`(`models.py:171-177`)，但 overlay 路徑預設 `false`(`overlay-schema.ts:1234-1235, 1271-1272`)。旗標為 false 時，配額軌只剩 Top-N 槽位 bias、無 rebalance 硬投影；帶寬軌不受影響。本功能**不改預設**——雙軌設計刻意讓帶寬軌在 flag=false 時仍生效，這正是 fa51bebe 情境的最短修復路徑。是否在「存在 fixed `w_*` 且 band 已編譯」時自動翻 true，列 P2 評估（行為變更面較大，需 RM 產品確認）。

### 9.4 與 `clientContextFromOverlay` 的同源性

bands 經 `clientContextFromOverlay`(:1045-1108;:1061 計算、:1106 寫入）隨 `ClientContext` 進引擎，執行端（`group_weights.py:178-185`）與 §3.4 的 attainment 檢核**讀同一份 bands**——保證「編譯給引擎執行的」與「事後檢核的」同源，不會出現執行與報告各說各話。

### 9.5 與 `applyAsksToOverlayLevers` 的分工

`group_weight_band` ask 目前會在 universe prompts 留一行軟提示（`overlay-schema.ts:444-454`)。此行為不變；雙軌編譯是**結構化**通道，prompt 提示僅供 AI universe filter 參考，兩者不衝突。

---

## 10. 風險與回滾

| # | 風險 | 緩解 | 回滾 |
|---|---|---|---|
| R1 | LLM 亂標/漏標 `asset_class` → 錯誤類別成員進入配額與 band | hint 僅用於 catalog 查無的標的；prompt 明確五類定義與私募基金歸屬；§3.3/§3.4 顯性化讓錯誤在報告可見 | 引擎端忽略 `universe_supplement_meta`(A4 加一行開關）即退回現況 + warning |
| R2 | `"other"` 不再全綁的相容風險：舊 overlay 依賴模糊 sleeve 綁整個補充籃 | two-pass 認領設計（§3.2.4)：無類別認領時剩餘池 = 全池，行為不變；T3 U17 鎖定 | 單獨 revert W1 的重構段，保留 meta 鏈路 |
| R3 | attainment 新增檢核列使部分 overlay job 的 `all_floors_met` 由 true 變 false | 語意上是修正（過去是假綠燈）；只在實際存在配額/bands 時才新增列，無則不變；PR 說明與 CHANGELOG 註記 | revert A4/A5;UI 列由 rows 驅動自動消失 |
| R4 | `_needs_score` 分母變化影響 Pareto 提案排序（`objectives.py:525` 用於提案卡） | 僅在有新檢核時變化；屬如實反映；排序微幅變動可接受 | 同 R3 |
| R5 | 每個無 hint 合成標的一條 warning 造成 log 噪音 | 實作時改 per-run 彙總一條（warning 列出所有 tickers) | 調整 log 等級即可 |
| R6 | `profiles.py` 三個函式簽名擴充影響其他呼叫方 | 新參數皆有預設值 `None`;`grep` 全倉呼叫點（backtest.py 兩處 + tests）逐一更新；T1 U6 鎖定位元相容 | revert A2 |

**總回滾策略**：兩個 Phase 皆為純新增欄位/警告 + 單檔重構，無 DB/持久層變更；job cache 的 result JSON 多新欄位，舊版 UI 讀取時忽略。任一 Phase 可獨立 revert 而不影響另一 Phase 的價值。

---

## 附錄 A：關鍵程式碼座標速查

| 符號 | 位置 |
|---|---|
| `_synthetic_supplement_item`（硬編碼 equity 於 :86) | `apps/api/app/profiles.py:75-90` |
| `_union_supplement_items` / `get_universe` / `pin_guaranteed_supplements` | `apps/api/app/profiles.py:93-134, 28-70, 137-158` |
| `CLASS_BUDGET_KEYS` / `TOP_LEVEL_QUOTA_KEYS` | `apps/api/app/engine/asset_class_policy.py:14-20, 40-43` |
| `class_budget_from_params` / `zero_disallowed_class_params` | `apps/api/app/engine/asset_class_policy.py:306-328, 570-592` |
| `class_sleeve_totals` | `apps/api/app/engine/asset_class_policy.py:88-105` |
| `pick_top_n_by_class_slots`(shortfall 讓位 :537-553) | `apps/api/app/engine/asset_class_policy.py:483-567` |
| `enforce_class_weight_budget`(skip-empty :139-141, :158-161) | `apps/api/app/engine/asset_class_policy.py:107-262` |
| `needs_attainment` / `_needs_score` | `apps/api/app/engine/objectives.py:274-413, 416-428` |
| `apply_group_weight_bands` / `parse_group_weight_bands` / `_find_parent_idx` | `apps/api/app/engine/group_weights.py:88-175, 36-60, 77-86` |
| rebalance 執行順序（budget → bands → drift) | `apps/api/app/engine/portfolio.py:1026-1048` |
| Top-N 類別槽位 | `apps/api/app/engine/portfolio.py:640-653` |
| `needs_attainment` 候選呼叫點 | `apps/api/app/engine/backtest.py:1836-1856` |
| `get_universe` / `pin_guaranteed_supplements` 呼叫點 | `apps/api/app/engine/backtest.py:2938-2942, 2952-2956` |
| `universe_by_ticker` 建立 | `apps/api/app/engine/backtest.py:3102` |
| champion `class_budget` 推導先例 | `apps/api/app/engine/backtest.py:4058-4061` |
| `narrative_facts` 診斷先例（regime_class_quotas) | `apps/api/app/engine/backtest.py:4457-4458` |
| `GroupWeightBand` / `ClientContext.group_weight_bands` | `apps/api/app/models.py:31-38, 90-96` |
| `BacktestRequest.universe_supplement_tickers` / `enforce_class_weights` | `apps/api/app/models.py:190-197, 171-177` |
| reporting stage wrapper | `apps/api/app/engine/stages/reporting.py:61-76, 78-97`;`stages/accessors.py:254` |
| `overlayProposedTickerSchema` / `universeRuleOverlaySchema` | `apps/web/src/lib/overlay-schema.ts:170-177, 181-190` |
| `sleeveTargetsToParamControls`(`w_*` → param_controls) | `apps/web/src/lib/overlay-schema.ts:626-636` |
| `sleeveKeyTheme` / `overlayThemeClass` / `bandTargetFromAsk` | `apps/web/src/lib/overlay-schema.ts:914-919, 907-912, 922-928` |
| `groupWeightBandsFromOverlay`(`w_*` skip :995;"other" 全綁 :977, :1000-1002) | `apps/web/src/lib/overlay-schema.ts:934-1033` |
| `clientContextFromOverlay`(bands 入 context :1061, :1106) | `apps/web/src/lib/overlay-schema.ts:1045-1108` |
| `overlayToBacktestRequest`（補充標的 :1232-1234, :1274-1277;enforce 預設 false :1234-1235, :1271-1272) | `apps/web/src/lib/overlay-schema.ts:1154-1287` |
| interpret system prompt | `apps/web/src/app/api/overlay/interpret/route.ts:186-343` |
| web universe catalog(`asset_class`) | `apps/web/src/lib/universe.ts:4-32` |
| `ASSET_CLASSES` | `apps/web/src/lib/constants.ts:1-7` |
| `BacktestRequest` / `needs_attainment` 型別 | `apps/web/src/lib/types.ts:112-113, 267-291` |
| `needsFloorRows` / `NEEDS_TABLE_I18N` | `apps/web/src/lib/needs-fulfillment.ts:35-116, 12-20` |
| `NeedsFulfillmentPanel` 與接線點 | `apps/web/src/components/NeedsFulfillmentPanel.tsx:23`;`apps/web/src/components/RmReportView.tsx:671` |
| i18n needs 表列（en/zh/ko) | `apps/web/src/lib/i18n.tsx:573-585, 2499-2509, 4354-4364` |
