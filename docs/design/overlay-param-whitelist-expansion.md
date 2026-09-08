# Overlay 參數白名單擴充（Overlay Param Whitelist Expansion）施工說明書

> 版本：v1.1（2026-09-08）
> 狀態：§1–§10 **已實作**（as-built 規格——本文為實作完成後的設計留痕與後續維護依據）。所有檔案路徑與行號均經實際代碼核對（2026-09-08 工作區狀態，`param-catalog.json` version 2）。§11–§12 為 2026-09-08 討論定案，**決策待施工**（座標已核對，實作後轉 as-built）。
> 參考：`docs/design/sellable-universe.md`（同批 sibling change，設計原則相同：*give AI the actionable catalog*）、`docs/design/needs-driven-weight-bounds.md`、`docs/design/overlay-drift-sync.md`
> v1.1：新增 §11（資產類別比例表達與執行規則——含 w_* 存在時強制 `enforce_class_weights=true` 的根因修復決策）與 §12（P0/P1 overlay 接線缺口，knob-gap 審計）。

本文件記錄「overlay `param_adjustments` 白名單擴充」的設計與實作規格：把四個 allocator 約束旋鈕（`max_weight_actual`／`top_n_actual`／`max_holdings_actual`／`max_turnover_actual`）連同中英雙語觸發語開放給 overlay AI，並在 interpret prompt 加入路由規則，讓 AI 用專用欄位表達客戶的約束需求。

---

## 1. 背景與動機

### 1.1 擴充前的白名單（11 鍵）

`ClientOverlay.param_adjustments` 的白名單由引擎端 `_PARAM_CATALOG_META`（`apps/api/app/engine/param_taxonomy.py:100` 起）各鍵的 `overlay_eligible` 旗標決定。擴充前（catalog v1）僅 11 鍵可見於 overlay prompt：

| 類別 | 鍵 |
|---|---|
| 因子權重（7） | `w_mom` `w_reversal` `w_value` `w_lowvol` `w_trend` `w_drawdown` `w_income` |
| 因子 lookback（3） | `factor_lookback_days` `reversal_lookback_days` `value_lookback_days` |
| 客製化漂移（1） | `customization_drift_actual` |

### 1.2 問題：AI 無法表達約束旋鈕

RM 對話中極常見的四類約束語，在白名單內沒有可表達的參數：

1. 「單一持股／單一標的不超過 X%」——僅 `allocation.max_single_position_pct` 可表達（allocation 層），allocator 層沒有對應的硬上限旋鈕開放。
2. 「集中持股」「只買前 N 檔」「放寬持股檔數」。
3. 「最多持有 N 檔」。
4. 「換手不要超過 X%」「減少交易」。

AI 面對這些話術只剩兩條路：硬塞語意不符的欄位（例如把「集中持股」塞進因子權重），或往 `capability_gaps` 回報「系統不支援」——但引擎其實**早就支援**這四個旋鈕（`SETUP_PARAM_KEYS`，param_taxonomy.py :36-49），只是沒開放給 overlay。結果是客戶需求被錯誤映射，或被誤報為能力缺口。

### 1.3 方案比較與決策

| 方案 | 內容 | 評估 |
|---|---|---|
| **Option 1：擴充白名單**（本文件） | 把語意明確、邊界可 clamp 的約束旋鈕標記 `overlay_eligible: true`，連同雙語觸發語餵進 prompt | 採用 |
| Option 2：全靠 `capability_gaps` | 不開白名單，讓 AI 把約束需求回報為缺口 | 否決：把引擎已支援的能力誤報為缺口，RM 體驗差，且需求永遠落不了地 |
| Option 3：自由文字 constraints 欄位 | 讓 AI 用自然語言描述約束，後段再解讀 | 否決：無結構化驗證、無法 deterministic clamp，等於把解析難題往後移一層 |

**決策：採 Option 1。** 理由：四個旋鈕對 RM 話術有清晰的一一對應、bounds 明確（可 deterministic clamp）、引擎穿透路徑現成（`normalize_param_controls` 對鍵名透明），符合 *give AI the actionable catalog* 原則——與 sellable-universe 的「把可銷售清單注入 prompt」（sellable-universe.md §3.8）是同一哲學的兩面。

---

## 2. 範圍

### 2.1 新開放的四鍵（座標已核對）

`apps/api/app/engine/param_taxonomy.py` `_PARAM_CATALOG_META`（:100 起）：

| 鍵 | 座標 | kind | bounds | overlay_eligible |
|---|---|---|---|---|
| `max_weight_actual` | :129-143 | setup_numeric | [0.05, 1.0] | false → **true** |
| `top_n_actual` | :144-156 | setup_numeric | [2, 150]（整數） | false → **true** |
| `max_holdings_actual` | :157-170 | setup_numeric | [1, 150]（整數） | false → **true** |
| `max_turnover_actual` | :185-197 | setup_numeric | [0.05, 1.0] | false → **true** |

白名單 11 → **15 鍵**；`PARAM_CATALOG_VERSION`（:301）1 → **2**。同步更新檔頭註解（:96-99），明示「約束旋鈕 eligible、類別配額／solver mode／regime 鍵維持關閉」的政策。

### 2.2 維持關閉的鍵（明確不開放）

| 鍵 / 群組 | 理由 |
|---|---|
| `w_equity`／`w_bond` 等類別配額（`ALL_ALLOC_WEIGHT_KEYS` setdefault 段，:278-288） | 走 `allocation.sleeve_targets` + `enforce_class_weights`；雙軌並存會互相打架。表達與執行規則總整理見 §11 |
| `mode`（solver 選擇） | Pro-only；overlay 用 `optimization.objective` 表達 |
| `lookback_days`／`shrinkage`／`risk_aversion` | Pro-only 技術旋鈕，RM 話術無清晰對應 |
| `no_trade_tol`／`turnover_penalty_mult` | Pro-only 技術旋鈕；換手需求一律走 `max_turnover_actual` |
| 因子 categorical（`*_indicator`） | Pro-only；indicator 選擇不由 RM 對話決定 |
| regime 鍵（`regime_setups` 等） | 實驗性功能，走 `experiment` 欄位 |

---

## 3. 參數語義規格（核心需求：AI 必須理解每個參數）

白名單開放不只是翻旗標——**每個新開放的鍵必須附帶 AI 讀得懂的雙語 description 與 client_hint**，否則模型只看到鍵名會亂用。以下為各鍵已落地的文案（param_taxonomy.py 實際內容）；日後修改文案須同步重匯出（§5）並更新對應測試（§7.1 的 hint 斷言會鎖定文案）。

### 3.1 `max_weight_actual` [0.05–1.0]

- **控制什麼**：配置器層級的單一標的權重硬上限（fraction；0.10 = 10%）。
- **description**（:133-137）：
  > Per-name weight cap enforced inside the allocator (fraction; 0.10 = 10%). 配置器層級的單一標的權重硬上限。
- **client_hint**（:137-141）：
  > 客戶要求「單一持股/單一標的不超過 X%」時：優先填 allocation.max_single_position_pct；此鍵作為 allocator 層 backstop（例如集中持股但單檔仍不得逾 12% 時一併設定）。Backstop for single-name caps (單一標的上限 X%); prefer the allocation field first.
- **觸發語**：「單一持股不超過 X%」「單一標的上限」「single-name cap」。
- **與專用欄位的互動**：`allocation.max_single_position_pct`（web parser clamp 至 [0.05, 0.40]，overlay-gemini-parse.ts `normalizePositionPct` :267-276）是**首選**；本鍵只在客戶要求「嚴格執行」時作為 allocator 層 backstop 併設。兩者 fraction 語意相同但作用層不同：allocation 欄位進 needs／band 編譯，本鍵直接進 allocator 約束。

### 3.2 `top_n_actual` [2–150]（整數）

- **控制什麼**：每次再平衡**進入配置器的候選檔數**——選股層的寬窄。
- **description**（:147-150）：
  > How many top-ranked names enter the allocator each rebalance (integer). 每次再平衡進入配置器的候選檔數。
- **client_hint**（:151-155）：
  > 客戶要求集中持股（「只買前 N 檔」「持股集中一點」）→ 調低；要求分散、放寬檔數（「多持有一點」）→ 調高。整數。Trigger on 集中持股 / 只持有前 N 檔 / 放寬檔數; lower = more concentrated.
- **觸發語**：「集中持股」「只買前 N 檔」「放寬檔數」「多持有一點」。
- **注意**：非 matrix 的 Pro round 中，AI 給的 `top_n_actual` 會被展成以該值為中心的 ±25% 搜尋區間（param_taxonomy.py :600-618），避免同 round 組合完全一致；matrix round 維持固定。

### 3.3 `max_holdings_actual` [1–150]（整數）

- **控制什麼**：配置完成後**實際持有檔數**的硬上限——組合層的檔數天花板。
- **description**（:161-164）：
  > Hard cap on the number of names actually held after allocation (integer). 配置完成後實際持有檔數的硬上限。
- **client_hint**（:165-169）：
  > 客戶要求「最多持有 N 檔」或放寬持股檔數時使用；與 top_n_actual 搭配（top_n 是候選池，max_holdings 是最終持有上限）。Trigger on 持股檔數上限 / 最多持有 N 檔 / 放寬檔數.
- **觸發語**：「最多持有 N 檔」「持股檔數上限」「放寬檔數」。

### 3.4 `max_turnover_actual` [0.05–1.0]

- **控制什麼**：每次再平衡的**換手率硬上限**（組合價值 fraction；0.20 = 20%）。
- **description**（:189-192）：
  > Hard turnover ceiling per rebalance (fraction of portfolio value; 0.20 = 20%). 每次再平衡的換手率硬上限。
- **client_hint**（:193-196）：
  > 客戶要求換手/週轉上限（「每次換手不要超過 X%」「減少交易」）→ 調低；要更積極換倉 → 調高。Trigger on 換手上限 / 週轉率 / turnover cap.
- **觸發語**：「換手上限」「週轉率」「減少交易」「turnover cap」。

---

## 4. Prompt 路由規則（interpret route）

白名單擴充後，prompt 必須告訴 AI「什麼需求走哪個欄位」，否則同一需求會被隨機分配到 allocation 欄位或 param_adjustments。已落地於 `apps/web/src/app/api/overlay/interpret/route.ts` `overlayParamCatalogBlock()`（:153-188）的 ROUTING 段（:182-187），全文：

```
- ROUTING (use the dedicated field first; param_adjustments is the backstop, not the first choice):
  • "單一持股 / 單一標的 ≤ X%" (single-name cap) → allocation.max_single_position_pct FIRST; add param_adjustments.max_weight_actual (same fraction) only as an allocator-level backstop when the client wants it strictly enforced.
  • "股債配比 / 類別配額" (asset-class quotas) → allocation.sleeve_targets (+ enforce_class_weights=true for hard enforcement). NEVER express quotas via param_adjustments.
  • "集中持股 / 只買前 N 檔 / 放寬持股檔數" (concentrate or widen holdings) → param_adjustments.top_n_actual and/or max_holdings_actual (integers; lower top_n = more concentrated).
  • "換手上限 / 週轉率不要超過 X% / 減少交易" (turnover cap) → param_adjustments.max_turnover_actual (fraction).
```

核心原則：**專用欄位優先，`param_adjustments` 為後盾（backstop），不是首選**。另兩條既有政策同步保留於 POLICY 段（:175-181、:188）：

- 類別配額永遠不進 param_adjustments（`w_equity`／`w_bond` 等）。
- 對話沒有明確因子傾斜、客製化漂移偏好、或上述約束旋鈕需求時，整個 `param_adjustments` **省略**（防止無需求亂填）。

catalog 清單本體自 `param-catalog.json` 動態生成（:153-174：只列 `overlay_eligible` 鍵，每行附 bounds 與 client_hint 觸發語）——重匯出後 prompt 自動更新，**無硬編碼清單**。

---

## 5. 鏈路與再匯出流程

單一真相來源在引擎，web 端全部自 JSON 衍生：

```
apps/api/app/engine/param_taxonomy.py        （_PARAM_CATALOG_META；PARAM_CATALOG_VERSION :301）
  └─ build_param_catalog()                   （:303-336）
       └─ python scripts/export_param_catalog.py     （= npm run generate-param-catalog）
            └─ shared/param-catalog.json
                 └─ npm run sync-param-catalog
                      └─ apps/web/src/data/param-catalog.json
                           ├─ apps/web/src/lib/overlay-gemini-parse.ts
                           │    OVERLAY_ELIGIBLE_PARAM_KEYS（:23-26）
                           │    OVERLAY_PARAM_BOUNDS（:28-36）
                           │    normalizeParamAdjustments（:733-768）
                           └─ apps/web/src/app/api/overlay/interpret/route.ts
                                overlayParamCatalogBlock()（:153-188）
```

**改鍵 SOP**：改 `_PARAM_CATALOG_META` → bump `PARAM_CATALOG_VERSION` → `npm run generate-param-catalog` → `npm run sync-param-catalog` → 跑 §7 測試。下游（parse 白名單、bounds clamp、prompt 清單）零改動自動生效；全鏈路沒有任何硬編碼過濾點需要手工同步。

**引擎側零改動**：overlay 送進的 param_controls 經 `normalize_param_controls`（`apps/api/app/engine/param_bounds.py:72`）對鍵名透明穿透；`build_pro_round_param_controls`（param_taxonomy.py :552 起）對 `top_n_actual`／`max_holdings_actual` 自動取整（:592-594）。

---

## 6. 檔案變更清單（as-built）

| # | 檔案 | 變更 |
|---|---|---|
| F1 | `apps/api/app/engine/param_taxonomy.py` | 四鍵 `overlay_eligible` 翻 `true` + 雙語 description/client_hint（:129-197）；檔頭政策註解（:96-99）；`PARAM_CATALOG_VERSION` 1→2（:301） |
| F2 | `shared/param-catalog.json` | 重匯出（version 2，15 個 eligible 鍵） |
| F3 | `apps/web/src/data/param-catalog.json` | `npm run sync-param-catalog` 同步 |
| F4 | `apps/web/src/app/api/overlay/interpret/route.ts` | `overlayParamCatalogBlock()` 加 POLICY + ROUTING 段（:175-188） |
| F5 | `apps/api/tests/test_param_catalog.py` | 新增 `test_overlay_eligible_includes_allocator_constraint_knobs`（:35-62） |
| F6 | `apps/web/src/lib/overlay-gemini-parse.test.ts` | 新增「accepts allocator constraint knobs and clamps them to catalog bounds」（:148-195） |

刻意不改：`overlay-gemini-parse.ts`（白名單／bounds 自 JSON 衍生）、`param_bounds.py`（ceiling 機制對新鍵本就適用）、引擎 allocator／solver 本體。

---

## 7. 測試

### 7.1 pytest（`apps/api/tests/test_param_catalog.py`）

`test_overlay_eligible_includes_allocator_constraint_knobs`（:35-62）斷言：

- 四鍵進入 `overlay_eligible_keys`；
- Pro-only 技術旋鈕（`no_trade_tol`／`turnover_penalty_mult`／`shrinkage`／`risk_aversion`）與類別配額（`w_equity`／`w_bond`）**仍被排除**；
- 四鍵 bounds 恰為 [0.05, 1.0]／[2, 150]／[1, 150]／[0.05, 1.0]；
- client_hint 帶繁中觸發語（`集中持股`／`換手`／`max_single_position_pct`／`持有`）——**hint 文案被測試鎖定**，改文案需同步改測試。

既有 `test_overlay_eligible_includes_factor_weights_not_class_budgets`（:21-33）繼續守舊白名單語意（因子權重 eligible、類別配額與 `mode` 排除、eligible 鍵必帶 bounds）。

### 7.2 vitest（`apps/web/src/lib/overlay-gemini-parse.test.ts`）

- 「drops unknown param_adjustments keys and clamps eligible bounds」（:114-146）：幻覺鍵被丟棄、既有 eligible 鍵 clamp 至 catalog bounds。
- 「accepts allocator constraint knobs and clamps them to catalog bounds」（:148-195）：`max_weight_actual` fixed 0.12 保留；`top_n_actual` fixed 500 → clamp 至 150；`max_holdings_actual` search [0, 999] → [1, 150]；`max_turnover_actual` fixed 0.2 保留；`no_trade_tol`（非白名單）被丟棄。

執行：`cd apps/api && .venv\Scripts\python.exe -m pytest tests/test_param_catalog.py`；`cd apps/web && npx vitest run src/lib/overlay-gemini-parse.test.ts`。

---

## 8. 實作順序（已執行）

1. **S1**：`param_taxonomy.py` 四鍵翻旗標 + 雙語文案 + version bump。此步獨立可驗（pytest 直接測 `build_param_catalog()`）。
2. **S2**：重匯出 + 同步 catalog JSON（§5 SOP）。
3. **S3**：interpret route prompt 加 POLICY／ROUTING 段。
4. **S4**：vitest 案例補齊 + 全量回歸。

相依極低：S3 只依賴 S2 的 JSON；S1 → S2 為硬性順序（否則 JSON 與引擎真相不一致）。

---

## 9. 邊界案例

| # | 案例 | 處理 |
|---|---|---|
| E1 | **AI 幻覺鍵**（白名單外的 param_adjustments） | `normalizeParamAdjustments`（overlay-gemini-parse.ts :733-768）以 `OVERLAY_ELIGIBLE_PARAM_KEYS` Set 過濾——不在白名單的鍵**直接丟棄**，不進 Zod、不進引擎。prompt 怎麼寫都無法繞過。 |
| E2 | **越界值（supervisor clamping）** | 雙層 clamp：①web parser 先 clamp 到 catalog bounds（:750-763，`fixed` 與 `search` 的 min/max 都處理，min>max 自動交換）；②引擎層 `cap_search_high`（param_bounds.py :111-128）再以 **run 層滑桿 ceiling** 收斂——`RUN_CEILING_KEYS`（:11-17）把 `max_weight_actual`→`max_weight`、`max_turnover_actual`→`max_turnover`、`top_n_actual`→`top_n`、`max_holdings_actual`→`max_holdings`、`customization_drift_actual`→`customization_drift` 對到 BacktestRequest 的 run 參數，overlay 提供的值不得超過 RM 在 run 設定的上限。 |
| E3 | **mode=off 落在 ceiling 鍵** | `normalize_param_controls`（param_bounds.py :72-96）把 ceiling 鍵的 `off` 正規化為 `fixed`＠run ceiling 值——AI 無法用 `off` 繞過 run 層上限。 |
| E4 | **整數鍵被給 float** | `build_pro_round_param_controls` 對 `top_n_actual`／`max_holdings_actual` 強制 `int()`（param_taxonomy.py :592-594）；web parser 層不取整，bounds clamp 後由引擎收尾。 |
| E5 | **與 `allocation.max_single_position_pct` 重複表達** | 預期行為（backstop 設計，§3.1）。兩者 clamp 範圍不同（allocation 欄位 [0.05, 0.40] vs 本鍵 [0.05, 1.0]），互不覆寫；同時出現時 band 編譯與 allocator cap 各自作用，實效取較嚴者。 |
| E6 | **類別配額話術誤進 param_adjustments** | ROUTING 段明示 NEVER；即使 AI 仍送出 `w_equity` 等配額鍵，E1 白名單直接丟棄（`ALL_ALLOC_WEIGHT_KEYS` 的 `overlay_eligible` 恆 false，param_taxonomy.py :278-288）。 |
| E7 | **非 matrix Pro round 的 top_n／max_holdings 變異** | AI 給定值被展成 ±25% 搜尋區間（param_taxonomy.py :600-618）——客戶說「集中持有 10 檔」不會讓同 round 全部組合恰好 10 檔；matrix round 維持固定。 |
| E8 | **catalog JSON 與引擎漂移**（改了 taxonomy 忘記重匯出） | `PARAM_CATALOG_VERSION` 隨改動 bump；pytest 直接測 `build_param_catalog()`（引擎真相），vitest 測同步後的 JSON——兩側任一失真都有測試亮紅。SOP 見 §5。 |

---

## 10. 風險與回滾

| # | 風險 | 緩解 |
|---|---|---|
| R1 | AI 濫用新旋鈕（對話無明確需求也亂填） | prompt POLICY 末條：無明確需求時整個 `param_adjustments` 省略（route.ts :188）；所有 client_hint 以「客戶要求 X 時」開頭 |
| R2 | 新鍵與既有 needs／ask 欄位語意重疊造成雙重編碼 | ROUTING 段定義優先序；E5 為可接受的 backstop 疊加 |
| R3 | 未來白名單繼續膨脹 | 開放標準三要件：①RM 話術有清晰一一對應、②bounds 可 deterministic clamp、③無對應專用欄位。缺一不開 |

**回滾**：四鍵 `overlay_eligible` 翻回 `false` + `PARAM_CATALOG_VERSION` bump + 重匯出同步（§5 SOP）即完全還原；web 端無硬編碼，不需額外改動。prompt 的 ROUTING 段對已關閉的鍵無害，可留可移除。

---

## 11. 資產類別比例表達與執行規則（2026-09-08 定案，待施工）

> 狀態：**決策定案、尚未實作**。本節把「資產類別比例怎麼表達、怎麼被執行、怎麼被檢核」收斂成單一規則集，作為後續施工的依據；實作完成後另補 as-built 座標。

### 11.1 表達層分工（什麼需求走哪個欄位）

| 需求類型 | 表達通道 | 說明 |
|---|---|---|
| 股債比／大類配額（「股票 60%／債券 40%」） | `allocation.sleeve_targets` 的 **`w_*` 鍵** | **不開** param_adjustments 白名單（§2.2 政策維持；`ALL_ALLOC_WEIGHT_KEYS` 恆 `overlay_eligible: false`，E6 直接丟棄）。`w_*` 經 `sleeveTargetsToParamControls`（overlay-schema.ts :629-637）釘成 fixed param_controls 進引擎配額軌 |
| 主題／產業／存續期比例（「AI 10%」「長天期政府債 20%」） | **`group_weight_band` ask + 顯式 tickers** | band 綁定具體標的才會被 `apply_group_weight_bands` 執行、被 attainment 檢核；tickers 取自 RM 確認後的 supplement 清單（可銷售過濾後，見 sellable-universe.md §10.4） |
| 主題 sleeve_targets（非 `w_*` key，如 `{"ai": 0.10}`） | **次佳路徑，不建議主用** | 依賴主題 → ticker 的隱式解析（`sleeveKeyTheme`／two-pass 認領，needs-driven-weight-bounds.md §3.2）；解析不到成員即**靜默落空**，僅作相容保留，引導走 band + 顯式 tickers |

### 11.2 執行規則：有任一 `w_*` sleeve 時，編譯端強制 `enforce_class_weights=true`

- **現況（偏離根因）**：overlay 路徑預設 `false`（overlay-schema.ts :1440-1441、:1477-1478 的 `?? false` 尾項），是否開啟全看 LLM 有沒有照 prompt（route.ts :240）判斷「RM 要硬執行」。LLM 漏判時配額軌只剩 Top-N 槽位 bias、無 rebalance 硬投影——這正是股債比／大類配額「說了卻沒做到」偏離的根因。
- **決策**：`overlayToBacktestRequest` 偵測到 `sleeve_targets` 含**任一 `w_*` 鍵**時，**強制 `enforce_class_weights=true`，覆寫 LLM 輸出與預設值**。RM 不需手開、LLM 不需判斷；prompt 的 enforce 指示行可隨之簡化。
- **定位**：此決策落地了 needs-driven-weight-bounds.md §9.3 列為 P2 的評估項（「雙軌產生 band 且有 w_* fixed 時自動翻 true」）——結論：**做，且無條件做**（不限雙軌情境；有 w_* 即翻）。行為變更面集中在 overlay 編譯單點，API 預設值（models.py `enforce_class_weights` 預設 true）與非 overlay 路徑不受影響。

### 11.3 產品規則六條

| # | 規則 | 依據 |
|---|---|---|
| 1 | **sleeve 為唯一表達**：資產類別比例一律走 `sleeve_targets`（`w_*`）；param_adjustments 永不承載類別配額 | §2.2、§11.1；白名單 E6 兜底 |
| 2 | **enforce 自動**：有任一 `w_*` sleeve 即強制 `enforce_class_weights=true` | §11.2 |
| 3 | **具名配置雙軌**：具名 sleeve（「私募基金 15%」）同時編譯配額軌（`w_alternative`）+ band 軌（綁實際標的） | needs-driven-weight-bounds.md §3.2（已實作） |
| 4 | **needs 面板必檢達成**：類別配額與 band 各有 attainment 列，未達即紅／琥珀，不允許靜默全綠 | needs-driven-weight-bounds.md §3.4；objectives.py :425-426、:461 |
| 5 | **drift 衝突時紅燈 + 提示提高漂移**：band／配額被 drift cap 截斷時，attainment 如實未達，並提示 RM 提高 `customization_drift` | §11.4；overlay-drift-sync.md §3（自動調升鏈路已存在） |
| 6 | **有 cash 時註明「投資部位內比例」**：配額／band 作用於排除 CASH 的風險資產向量；`cash_reserve_pct > 0` 時 UI 與對外文案必須標註比例基準為「投資部位內」而非總資產 | needs-driven-weight-bounds.md §8 E5 |

### 11.4 執行順序備註（稀釋鏈）

```
cash reserve（外層扣除；配額與 band 都作用在風險資產向量上）
→ enforce_class_weight_budget（配額投影，portfolio.py :1031；需 §11.2 的旗標為 true）
→ apply_group_weight_bands（band 推進，portfolio.py :1040）
→ project_anchor_l1_drift（drift cap，portfolio.py :1048；最終硬約束）
```

**後者可稀釋前者**：band 把主題推到目標後，`project_anchor_l1_drift` 仍可能為了守住 L1 上限把它截回錨點附近。因此 needs 面板的 attainment 列（配額／帶寬）必須顯示**最終**實際值，讓稀釋在報告上可見——這是規則 4、5 的落點，也是 drift-sync 自動調升存在的意義。

### 11.5 容差與對外口徑

- 引擎 attainment 容差目前 **±2%**（`BAND_TOL`／`CLASS_QUOTA_TOL`，objectives.py :15-16）。
- 對外（RM／客戶）溝通可放寬至 **±5%**——**產品二選一定案，避免引擎報告（±2%）與對外話術（±5%）雙標**。定案前，對外一律引用引擎 ±2% 的實測判定，不自行放寬。

---

## 12. Overlay 接線缺口（knob-gap 審計，2026-09-08）

> 來源：對「RM 話術 → overlay 欄位 → BacktestRequest → param_controls」全鏈路的旋鈕盤點。以下缺口建議與 §11 同批施工；優先級 P0 > P1 > P2。座標均已核對（2026-09-08 工作區）。

### 12.1 P0：`rebalance_freq` 未接線

- **現況**：`BacktestRequest.rebalance_freq`（types.ts :122，預設 `"QE"`）、UI 雙寫（ConstraintsPanel :556-575：寫 request + 釘 `param_controls.rebalance_freq` fixed）、引擎消費皆完備；**唯獨 overlay schema 無欄位、prompt 無路由、`overlayToBacktestRequest` 不寫**——客戶說「每月／每季再平衡」只能落在 narrative，落不了參數。
- **修法**：① overlay schema 的 `optimization` 區加 `rebalance_freq`（列舉值對齊既有 categorical spec）；② interpret prompt 加一條路由（「每月／每季／每半年／每年再平衡」→ 該欄位）；③ `overlayToBacktestRequest` 比照 UI **雙寫**：`request.rebalance_freq` + `param_controls.rebalance_freq = { mode: "fixed", fixed }`。

### 12.2 P1：`start_date`／`end_date` overlay 不驅動

- **現況**：overlay 有捕捉 `client_profile.investment_horizon_years`（overlay-schema.ts :130），但只進 `client_context`（:1252、:1297）供 needs 檢核，**不影響** request 的 `start_date`／`end_date`（types.ts :103-104）——回測期間完全由 base request（RM 手選）決定。
- **選項（待施工時定）**：由 `investment_horizon_years` 推導 end = 今日、start = end − horizon（有 anchor 時再受價格歷史下限約束）。前置產品問題：對話捕捉的期間**可否覆寫** RM 手選區間，需先定。

### 12.3 P1：`objective_mode` 同步缺口（UI 雙寫、overlay 單寫）

- **現況**：UI 手選投資目標時同時寫 `request.objective` 與 `param_controls.objective_mode` fixed（ConstraintsPanel :376-397）；overlay 設 `optimization.objective` 時**只寫** `request.objective`（overlay-schema.ts :1422、:1463），不釘 param_controls。結果：同一語意兩條路徑產出不一致——overlay 產生的 job 在 AI 參數揭露（ai-params-disclosure 的 winner-params 回填，:433-434）與審計視圖會缺 `objective_mode`。
- **修法**：`overlayToBacktestRequest` 在 `opt.objective` 有值時，同步釘 `param_controls.objective_mode = { mode: "fixed", fixed: objective }`（比照 §12.1 的雙寫模式；search 模式屬 Pro 流程，不在此列）。

### 12.4 P2：`benchmark_ticker`、`fee_bps`——待產品決策

- `benchmark_ticker`：overlay 僅 passthrough `base.benchmark_ticker ?? null`（overlay-schema.ts :1419、:1460）。「跟 0050 比」這類話術是否開放 overlay 驅動，涉及比較基準的對外合規口徑——**待產品決策**，決前不開。
- `fee_bps`（types.ts :121）：費率假設影響所有候選組合的淨報酬口徑，同列 P2 **待產品決策**，預設不開放。

### 12.5 刻意**不**開放 overlay 調整的旋鈕（維持 Pro-only）

通用 `lookback_days`、`shrinkage`、`risk_aversion`、因子 categorical（`*_indicator`）維持 Pro-only：RM 話術無清晰一一對應，屬 Pro 技術面板專屬（§2.2 政策不變；本次審計再次確認此結論，未改動）。注意因子 lookback 三鍵（`factor_lookback_days` 等）**本就**在白名單內（§1.1），不在此限。

---

## 附錄 A：關鍵程式碼座標速查

| 主題 | 座標 |
|---|---|
| 單一真相來源 | `apps/api/app/engine/param_taxonomy.py`：`_PARAM_CATALOG_META` :100 起（四新鍵 :129-197；類別配額 setdefault :278-288）；`PARAM_CATALOG_VERSION` :301；`build_param_catalog` :303-336；`SETUP_PARAM_KEYS` :36-49 |
| 匯出腳本 | `scripts/export_param_catalog.py`（全檔 28 行）；root `package.json` scripts：`generate-param-catalog`、`sync-param-catalog` |
| Catalog JSON | `shared/param-catalog.json` → `apps/web/src/data/param-catalog.json`（version 2，15 eligible 鍵） |
| Web 解析白名單 | `apps/web/src/lib/overlay-gemini-parse.ts`：`OVERLAY_ELIGIBLE_PARAM_KEYS` :23-26；`OVERLAY_PARAM_BOUNDS` :28-36；`normalizeParamAdjustments` :733-768；`normalizePositionPct` :267-276 |
| Interpret prompt | `apps/web/src/app/api/overlay/interpret/route.ts`：`overlayParamCatalogBlock()` :153-188（POLICY :175-181；ROUTING :182-187）；`overlaySystemPrompt` :190-350 |
| 引擎 ceiling（supervisor clamp） | `apps/api/app/engine/param_bounds.py`：`RUN_CEILING_KEYS` :11-17；`normalize_param_controls` :72-96；`cap_search_high` :111-128 |
| 引擎測試 | `apps/api/tests/test_param_catalog.py`：白名單擴充案例 :35-62；舊白名單語意 :21-33 |
| Web 測試 | `apps/web/src/lib/overlay-gemini-parse.test.ts`：丟棄幻覺鍵 :114-146；接受並 clamp 新旋鈕 :148-195 |
| 執行順序（§11.4 稀釋鏈） | `apps/api/app/engine/portfolio.py`：`enforce_class_weight_budget` :1031；`apply_group_weight_bands` :1040；`project_anchor_l1_drift` :1048 |
| attainment 容差（§11.5） | `apps/api/app/engine/objectives.py`：`BAND_TOL`／`CLASS_QUOTA_TOL` :15-16（±2%）；band 判定 :425-426；配額判定 :461 |
| overlay 編譯（§11.2、§12） | `apps/web/src/lib/overlay-schema.ts`：`sleeveTargetsToParamControls`（`w_*` → fixed）:629-637；`enforce_class_weights` 預設 false :1440-1441、:1477-1478；`objective` 單寫 :1422、:1463；`benchmark_ticker` passthrough :1419、:1460；`investment_horizon_years` :130 → 僅進 client_context :1252、:1297 |
| UI 雙寫參照（§12.1／§12.3） | `apps/web/src/components/ConstraintsPanel.tsx`：`objective_mode` 雙寫 :376-397；`rebalance_freq` 雙寫 :556-575 |
| Request 欄位（§12） | `apps/web/src/lib/types.ts`：`start_date`／`end_date` :103-104；`fee_bps` :121；`rebalance_freq` :122；`benchmark_ticker` :155 |
