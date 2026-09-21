# 投資建議書「簡報模式」（Slide Deck）施工說明書

> **版本**：0.3（全部 12 項決議已確認）
> **狀態**：Draft — 全部 12 項決議已確認，可施工
> **日期**：2026-09-21
> **讀者**：Web 工程師、RM 產品負責人
> **內容範本**：使用者提供之 8 章節建議書範本（`gemini-code-1789966043823.md`，見 §2.2 對照表）
> **相關文件**：
> - [`docs/design/needs-evidence-holdings-clarity.md`](./needs-evidence-holdings-clarity.md)（RM 報告可讀性、CASH 列示、雙軌主輔；本簡報的診斷與持股資料同源）
> - [`docs/design/needs-driven-weight-bounds.md`](./needs-driven-weight-bounds.md)（`needs_attainment` 雙軌語意）
> - [`docs/design/overlay-drift-sync.md`](./overlay-drift-sync.md)（偏離同步；本簡報「動態監控」頁引用其門檻概念）
> **適用程式碼**：`apps/web`（Next.js UI + 純函式）＋ `apps/api`（**僅 F2c**：回測完成時預計算壓力測試資料並存入結果物件，不動既有指標語意）＋ `shared/etf-universe.json` 或相關 universe store（**僅 F2d**：ETF/FUND ISIN 更新）
> **已確認事實**（代碼核對）：① 現有提案為**長篇捲動文件** modal（`InvestmentProposalPreview.tsx`），非簡報；② 指標比較僅 CAGR／Sharpe／MDD／Vol 四項（`buildMetricCompareRows`），**Calmar 已在 candidate 上但未入比較列**；③ **全 repo 無壓力測試資料**（無 `stress_test` 相關程式碼）；④ 列印走 `window.print()` + `.proposal-print` CSS 隔離（`globals.css:375-391`）。
>
> 所有檔案路徑與行號均經實際代碼核對（2026-09-21 工作區狀態）。

---

## 1. 目標與範圍

### 1.1 問題陳述

目前「投資建議書」以 **modal 內長篇捲動文件** 呈現（封面 → 信件 → 目錄 → 9 個章節 → 頁尾，`InvestmentProposalPreview.tsx:459-599`）。此形式適合列印存檔，但**不適合 RM 與客戶面對面簡報**：

| # | 症狀 | 使用情境痛點 |
|---|---|---|
| A | 單頁捲動、資訊密度高，無「一頁一主題」節奏 | 面談時 RM 需邊捲邊找重點，客戶注意力渙散 |
| B | 章節為文件語意（executive／profile／current…），與使用者提供的 **8 章節業務範本**（基本資料 → 目標診斷 → 市場展望 → 配置對比 → 回測 → 調倉 → 成本 → 監控與簽章）不對齊 | RM 需自行把系統產出「翻譯」成對客簡報結構 |
| C | 範本所需欄位（帳號、RM 員編／分行、ISIN、RR 風險等級、手續費、壓力測試情境）系統**無資料來源**，現況文件直接不呈現，也無佔位與補登機制 | 產出物無法直接對客使用，需人工後製 |
| D | 列印為整份文件分頁，非「一張投影片 = 一頁」 | 匯出 PDF 後不像簡報 |

典型路徑：RM 完成客製化試算 → RM 報告頁（`RmReportView`）→ 點「Generate Investment Proposal」（`RmReportView.tsx:812-819`）→ 得到長文件 → 自行摘錄成簡報或逐節講解。

### 1.2 目標（本功能要做的）

| # | 目標 | 說明 |
|---|---|---|
| G1 | **簡報式呈現** | 新增「簡報模式」：一頁一主題的 slide deck，對齊使用者 8 章節範本（含封面共約 10–11 張），取代捲動文件作為面談主介面。 |
| G2 | **完整導覽** | 上一張／下一張、圓點指示、頁碼、鍵盤（←／→／Home／End／Esc）；列印時每張投影片各自成頁（觸控滑動本期不做，Q12-B 已決議）。 |
| G3 | **真實資料優先** | 凡系統已有資料（客戶、AUM、配置、回測指標、持股差異、市場觀點、需求達成）一律自動帶入，來源與現有 RM 報告**同源同數字**。 |
| G4 | **缺失欄位誠實佔位** | 帳號／RM／分行／機構由 DEMO 生成資料提供（Q2 已決議）；ETF/FUND ISIN 為入庫真實值（Q9 已決議）；仍無來源之欄位（RR 風險等級、原持有單位數等）顯示「—」或「待補」佔位，**不編造**數字。 |
| G5 | **列印／匯出友善** | 沿用 `.proposal-print` 隔離機制；列印時全張展開、每張 `break-after-page`；保留合規簽核阻擋（`proposal-capability-badge.ts`）。 |
| G6 | **三語完整** | zh／en／ko 同步所有新文案。 |

### 1.3 非目標（Explicit Non-Goals）

- **不做**文件／簡報雙模式並存（Q5-B 已決議完全取代）：`InvestmentProposalPreview` 改為薄殼，直接掛 `ProposalSlideDeck`，移除文件模式切換。
- **不做**參數化／蒙地卡羅壓力測試引擎；固定歷史情境（2008／2020／2022）與最大回撤事件由引擎於**回測完成時預計算並存入結果物件**（Q3 已決議 A+B，見 §5-F2c），前端僅消費、不即時截取曲線。
- **不新增** `apps/api` 引擎契約欄位（費率表、RR 風險等級皆不在引擎內）；**例外**：F2c 壓力測試預計算結果欄位（Q3）與 F2d universe ISIN 資料更新（Q9）。
- **不改** `buildInvestmentProposalDocument` 既有輸出契約；Q5-B 後文件模式移除、不再被 UI 引用（保留或後續清理另案）；簡報另建 builder。
- **不做**電子簽章流程；簽章頁為列印用空白簽署欄、列印後手寫（Q8-A 已決議）。
- **不動**提醒、drift sync、needs 計算語意。

### 1.4 決策摘要（全部 12 項已決議，全文見 §12）

| 決策 | 最終方案 | 狀態 |
|---|---|---|
| Q1 列印／PDF 匯出 | 瀏覽器 `window.print()`（使用者另存 PDF）；伺服器端 PDF 列 Phase 2 | ✅ **已決議（A）** |
| Q2 RM／客戶資料來源 | DEMO 生成：全域單一 `DEMO_RM_PROFILE` 常數（姓名/員編/分行/機構）＋每個 DEMO 客戶個別生成帳號/AUM/風險屬性；擴充 `apps/web/src/lib/clients.ts` 的 DemoClient 型別與 demo 資料 | ✅ **已決議（DEMO 生成）** |
| Q3 壓力測試資料 | A+B 並行且**回測時一併存好**：引擎端（`apps/api`）於回測完成時計算 `drawdown_episodes` 前三大回撤事件與 2008/2020/2022 固定情境跌幅，存入 `BacktestResult` 或 candidate analytics；前端僅消費，不即時截取曲線 | ✅ **已決議（A+B，引擎端預計算）** |
| Q4 視覺主題 | 沿用現提案 slate/blue 私銀風（封面漸層） | ✅ **已決議（A）** |
| Q5 簡報 vs 文件 | 簡報完全取代文件：`InvestmentProposalPreview` 改為薄殼直接掛 `ProposalSlideDeck`，移除文件模式切換 | ✅ **已決議（B）** |
| Q6 交易成本費率 | 申購／贖回分列兩個 bps 常數 | ✅ **已決議（B）** |
| Q7 預期目標年化報酬 | 優先從 overlay 新增欄位讀取（動 schema）；overlay 無設定則以 anchor 模型 CAGR 作參考值並加註「參考」 | ✅ **已決議（C 優先，無設定則 B）** |
| Q8 簽章流程 | 列印後手寫（現範本形式） | ✅ **已決議（A）** |
| Q9 ISIN／RR 風險等級 | ETF/FUND 的 ISIN 自網路資料源取得並更新 universe 資料庫（`shared/etf-universe.json` 或相關 store）；個股恆顯示「-」；RR 風險等級仍佔位 | ✅ **已決議** |
| Q10 投影片比例 | 16:9 固定（`aspect-video`），列印時解除固定 | ✅ **已決議（A）** |
| Q11 S2 集中度語意 | 最大 asset_class 佔比＋最大單一標的佔比並列，文案註明 | ✅ **已決議（A）** |
| Q12 觸控滑動換頁 | 本期不做（僅按鈕／鍵盤／dots） | ✅ **已決議（B）** |

---

## 2. 現況分析

### 2.1 現有提案元件與資料流

```
RmReportView.tsx:869-877
  └─ <InvestmentProposalPreview open compare overlay anchorPortfolio client customizedModelCode />
       ├─ buildMetricCompareRows(base, adjusted, {cagr,sharpe,mdd,vol}, pick)   rm-report-utils.ts:355-434
       ├─ buildHoldingsDiff(base, adjusted, anchorHoldings, pick)               rm-report-utils.ts:437-486
       ├─ useAiTalkingSummary(...)  → Kimi AI 摘要，失敗回退 buildTalkingPoints  use-ai-talking-summary.ts
       └─ buildInvestmentProposalDocument(...) → ProposalDocument               investment-proposal.ts:355-717
            ├─ cover  { brand:"JASPER", docTitle, clientName, preparedBy, firmName, dateLabel, investmentAmount, strategyLine }
            ├─ letter[5]
            ├─ toc[]
            └─ sections[9]：executive(narrative) / profile / current(holdings) / strategy(narrative)
                            / allocation / rationale(talking) / performance(圖+表+持股變化)
                            / implementation / disclaimers
```

關鍵座標：

| 主題 | 路徑:行號 |
|---|---|
| Modal 外殼／列印按鈕 | `InvestmentProposalPreview.tsx:459-490` |
| 封面區塊 | `InvestmentProposalPreview.tsx:493-536` |
| Section renderer（8 種 kind） | `InvestmentProposalPreview.tsx:120-376` |
| `ProposalSection` union 型別 | `investment-proposal.ts:60-121` |
| 文件 builder | `investment-proposal.ts:355-717` |
| 投資本金推斷（cash≥50% AUM 用 cash） | `investment-proposal.ts:163-170`（`investmentNotional`） |
| 建議配置權重（champion／指定 model） | `investment-proposal.ts:172-204`（`customizedWeightMap`） |
| 客戶現有持股列 | `investment-proposal.ts:231-247`（`clientHoldingRows`） |
| 列印 CSS 隔離 | `apps/web/src/app/globals.css:375-391` |
| 合規列印阻擋 | `apps/web/src/lib/proposal-capability-badge.ts`（`proposalRequiresSupervisorSignoff`／`proposalPrintBlockedMessage`） |
| RM 報告 CTA 與開啟 | `RmReportView.tsx:807-820`、`:869-877` |
| 單軌判定 | `RmReportView.tsx:247`（`isSingleTrackPersonalizationCompare`） |

### 2.2 可用資料盤點（對照使用者 8 章節範本）

| 範本章節 | 範本欄位 | 系統現況 | 來源 |
|---|---|---|---|
| ① 基本資料 | 客戶姓名 | ✅ | `DemoClient.display_name`（`clients.ts:72`） |
| | 受託帳號 | ✅ **Q2 已決議** | DEMO 生成：`DemoClient.account_number`（新增欄位，每客戶獨立） |
| | 風險承受屬性 | ✅ | `client.risk_profile`（conservative/moderate/aggressive）／`overlay.client_profile.risk_tolerance` |
| | 當前 AUM／幣別 | ✅（USD 計） | `client.aum_usd`／`cash_usd`；`formatUsd` |
| | RM 姓名／員編 | ✅ **Q2 已決議** | DEMO 生成：全域 `DEMO_RM_PROFILE` 常數（姓名/員編/分行/機構） |
| | 機構／分行 | ✅ **Q2 已決議** | DEMO 生成：`DEMO_RM_PROFILE.institution`／`branch` |
| | 報告日期 | ✅ | `formatProposalDate(rm_sign_off.signed_at)` |
| ② 目標與診斷 | 投資目標 | ✅ | `overlay.optimization.objective`／`resolveRunObjective` |
| | 投資期限 | ✅ | `client.investment_horizon`／`overlay.client_profile.investment_horizon_years` |
| | 預期目標年化報酬 | ⚠️ **Q7 已決議** | 優先讀 overlay 新增欄位（動 schema）；無設定則以 anchor 模型 CAGR 作參考值並加註「參考」 |
| | 容許最大下檔 | ✅ | `needs_attainment.max_drawdown_tolerance`（`types.ts:275`） |
| | 資產偏離度 Drift | ✅ 可算 | `needs_attainment.customization_drift_l1`／`buildHoldingsDiff` 加總 |
| | 集中度診斷 | ✅ 可算 | `needs_attainment.max_single_name_actual`；或以權重最大值＋universe `asset_class` 聚合 |
| ③ 市場展望 | House View | ✅ | `overlay.market_view.narrative_summary`＋`stance`（risk_on/neutral/risk_off，`overlay-schema.ts:144-150`）＋`themes[]` |
| | 策略方針 bullets | ✅ | `useAiTalkingSummary`（Kimi）／`buildTalkingPoints` 回退（`rm-report-utils.ts:790-841`） |
| ④ 配置對比 | 大類資產權重（現有 vs 建議） | ⚠️ 需新聚合 | 類別對映表 `constants.ts:1-7`（equity/bond/commodity/real_estate/alternative）；聚合函式 `computeAssetMixFromWeights` 目前為 **module-private**（`rm-report-utils.ts:508-518`），需 export |
| | 建議配置金額 | ✅ | `investmentNotional × weight`（現有 `buildAllocationRows` 邏輯） |
| ⑤ 量化回測 | CAGR／Vol／Sharpe／MDD | ✅ | `buildMetricCompareRows`（圖表對齊窗口，`rm-report-utils.ts:355-434`） |
| | Calmar | ⚠️ 有原始值 | `PortfolioCandidate.calmar`（`types.ts:254`）**未**入比較列；需擴充 |
| | 回測區間 | ✅ | `compare.adjustedRequest.start_date/end_date` |
| | 淨值走勢圖 | ✅ | `buildBenchmarkCompareChartData`（rebased=100，`rm-report-utils.ts:179-186`） |
| | 壓力測試（2008/2020/2022） | ⚠️ 需引擎端擴充（**Q3 已決議 A+B**） | **回測完成時由引擎（`apps/api`）一併計算並存入 `BacktestResult` 或 candidate analytics**（見 §5-F2c）：(A) `drawdown_episodes`（`types.ts:355-360`，含 start/trough/end/depth）前三大回撤事件 →「歷史最大回撤回顧」；(B) 固定情境 2008/2020/2022 跌幅 →「固定情境模擬」；前端僅消費預計算結果，不即時截取曲線；兩者並列於 S6 |
| ⑥ 調倉明細 | 賣出／買入清單（標的、比例、金額） | ✅ | `buildHoldingsDiff`（added/removed/increased/decreased）＋ notional 換算金額 |
| | ISIN | ⚠️ **Q9 已決議** | ETF／FUND：自網路資料源取得 ISIN 並更新 universe 資料庫（`shared/etf-universe.json` 或相關 store，見 §5-F2d）；個股恆顯示「-」 |
| | RR 風險等級 | ❌ 無欄位 | 佔位（Q9 已決議：本期維持佔位，不做 asset_class 對映） |
| | 原持有單位數 | ❌ 無（僅權重） | 佔位或省略該欄 |
| | 調整原因 | ⚠️ 可推導 | 依 change 類型＋overlay rationale 產生固定文案 |
| ⑦ 交易成本 | 贖回／申購費、總成本佔 AUM% | ⚠️ 可試算 | `PortfolioCandidate.turnover_total`（`types.ts:259`）× **申購／贖回分列費率常數（Q6-B 已決議：兩個 bps 常數）**；文案標「試算假設」 |
| ⑧ 監控＋法規 | 偏離警示 ±5% | ✅ 可引用 | drift sync 已有偏離概念（`overlay-drift-sync.ts`）；監控文案為靜態承諾 |
| | 法規揭露 | ✅ | 現有 `disclaimers` section 5 條 warnings＋5 條 bullets（`investment-proposal.ts:683-699`） |
| | 簽章欄 | ⚠️ 列印用 | RM／主管／客戶三欄空白簽署列（列印樣式） |

### 2.3 缺口摘要

| 缺口 | 說明 | 處理 |
|---|---|---|
| GAP-1 | 無 slide deck 架構（僅捲動文件） | 新建 `ProposalSlideDeck`（§3.1） |
| GAP-2 | 章節結構不對齊業務範本 | 新 builder `buildProposalSlideDeck`（§3.2） |
| GAP-3 | 大類資產聚合函式未 export | export `computeAssetMixFromWeights` 或遷移至共用模組（§5-F2） |
| GAP-4 | Calmar 未入指標比較 | 擴充 metric 列（可選，§3.4-S5） |
| GAP-5 | 無壓力測試資料 | 引擎端於回測完成時預計算並存入結果物件（Q3 已決議 A+B，§5-F2c） |
| GAP-6 | ISIN／RR／帳號／分行／費率無來源 | 帳號／分行／RM：DEMO 生成（Q2，§5-F2b）；ISIN：ETF/FUND 網路取得入庫、個股「-」（Q9，§5-F2d）；RR：維持佔位；費率：申購／贖回雙常數（Q6） |
| GAP-7 | 列印非「一頁一投影片」 | slide 容器加 `print:break-after-page`（§3.6） |

---

## 3. 核心設計

### 3.1 簡報架構總覽

新增三層結構，**與 RM 報告及原文件 builder 共用底層資料來源**：

```
buildProposalSlideDeck(input) → ProposalSlide[]        （純函式，新檔 proposal-slides.ts）
        ↓
<ProposalSlideDeck slides … />                          （新元件：導覽 shell + 鍵盤 + 列印）
        ↓
<SlideRenderer slide /> → 依 slide.kind 分派至各 slide 元件
```

- **`ProposalSlide`** 為 discriminated union（`kind` 辨別），每張 slide 自帶 `id`、`titleKey`、`subtitleKey?` 與該頁所需**已解析**資料（字串已格式化、金額已換算），元件層不再做業務計算——比照現有 `ProposalSection` 設計（`investment-proposal.ts:60-121`）。
- **資料來源完全復用**：`buildMetricCompareRows`／`buildHoldingsDiff`／`buildBenchmarkCompareChartData`／`useAiTalkingSummary` 的輸出直接餵入 builder，保證與 RM 報告同數字。
- **單軌（single-track）**：`isSingleTrackPersonalizationCompare(compare)` 為 true 時，對比欄（現有 vs 建議）退化為單欄「建議投組」，封面副標與文案切換（同 `RmReportView.tsx:247` 的處理模式）。

### 3.2 投影片清單（對應範本 8 章節）

| # | Slide id | 範本對應 | kind | 主要內容 | 顯示條件 |
|---|---|---|---|---|---|
| S0 | `cover` | —（封面） | `cover` | 品牌、文件標題、客戶、RM、日期、AUM、策略一句話 | 恆顯示 |
| S1 | `basic-info` | ① 基本資料 | `kv-grid` | 客戶／帳號／風險屬性／AUM／RM／機構分行／日期（7 欄網格；帳號與 RM 欄位由 DEMO 生成，Q2 已決議） | 恆顯示 |
| S2 | `goals-diagnosis` | ② 目標與診斷 | `goals` | 目標／期限／容許下檔＋偏離度、集中度、調倉必要性摘要 | 恆顯示（無 overlay 時目標列降級為 request.objective） |
| S3 | `market-strategy` | ③ 市場展望 | `market` | House View（stance 徽章＋narrative）＋策略方針 3 bullets（talking points 前 3） | 恆顯示（無 overlay.market_view 時顯示回退文案） |
| S4 | `allocation-compare` | ④ 配置對比 | `asset-class-compare` | 大類資產表：類別｜現有%｜建議%｜增減｜建議金額；合計列 | 恆顯示（無客戶持股時「現有」欄為 anchor 模型或 100% 現金，見 §9-E2） |
| S5 | `backtest-metrics` | ⑤ 量化回測 | `metrics` | 指標對照矩陣（CAGR/Vol/Sharpe/MDD/Calmar）＋淨值走勢圖＋回測區間標註 | 恆顯示；單軌時僅建議欄 |
| S6 | `stress-review` | ⑤.2 壓力測試 | `stress` | **雙區塊並列（Q3 已決議 A+B）**：(A) 歷史最大回撤回顧（`drawdown_episodes` 前 3：期間／深度，現有 vs 建議）＋(B) 固定情境壓力測試（2008/2020/2022 跌幅，**引擎端於回測完成時預計算並存入結果物件**，見 §5-F2c）＋誠實標註 | **引擎結果有 episodes 或固定情境資料才顯示**；否則整張略過（不產生空白頁） |
| S7 | `trade-list` | ⑥ 調倉明細 | `trade-list` | 賣出表＋買入表：標的｜ISIN（ETF/FUND 真實值、個股「-」，Q9 已決議）｜風險等級(佔位)｜比例｜金額｜原因 | 恆顯示（diff 為空時顯示「無需調倉」） |
| S8 | `cost-estimate` | ⑦ 交易成本 | `cost` | 週轉率 × 假設費率 → 預估總成本與佔 AUM%；成本效益說明 | 有 turnover 資料才顯示金額；否則僅說明文字＋佔位 |
| S9 | `monitoring` | ⑧ 動態監控 | `bullets` | 偏離警示（±5%）、定期健檢、事件響應三承諾（靜態文案） | 恆顯示 |
| S10 | `compliance-signoff` | ⑧ 法規與簽章 | `signoff` | 風險警語（沿用 disclaimers warnings）＋三欄簽署表（RM／主管／客戶） | 恆顯示 |

**張數**：10–11 張（S6 條件顯示）。TOC 圓點即為導覽，不另做目錄頁。

### 3.3 導覽與操作

| 功能 | 設計 |
|---|---|
| 上一張／下一張 | 底部固定控制列按鈕；首張禁用上一張、末張禁用下一張 |
| 圓點指示 | 底部 dots（≤11 顆），可點跳頁；`aria-current` |
| 頁碼 | 「3 / 11」tabular-nums |
| 鍵盤 | `←/→` 換頁、`Home/End` 首末頁、`Esc` 關閉 modal；監聽掛在 modal 容器（`tabIndex={-1}` 聚焦後生效），避免與全域快捷鍵衝突 |
| 觸控 | **本期不做**（Q12-B 已決議）；僅按鈕／鍵盤／dots |
| 進度記憶 | 關閉重開回到 S0（不記憶，避免簡報從中段開始） |
| 列印 | 控制列「列印／存 PDF」按鈕 → `window.print()`；列印時所有 slide 垂直展開、每張 `print:break-after-page`；沿用 `globals.css:375-391` 的 `.proposal-print` 隔離（deck 根節點掛同 class） |
| 合規阻擋 | `proposalRequiresSupervisorSignoff(capabilities_used)` 為 true 時，列印按鈕禁用並顯示 `proposalPrintBlockedMessage`（與文件模式一致） |
| 無障礙 | `role="dialog"`＋`aria-modal`；每張 slide `role="group"`＋`aria-roledescription="slide"`＋`aria-label`；換頁後焦點移至 slide 標題 |

### 3.4 資料綁定（builder 輸入 → 各 slide 欄位）

`buildProposalSlideDeck` 入參與現行 `buildInvestmentProposalDocument` 相同（`compare / overlay / anchorPortfolio / client / lang / t / customizedModelCode / talkingPoints`）。Q2 決議後帳號／RM／分行／機構由 DEMO 生成資料提供（見 §5-F2b），**無需** RM 補登入參；費率為 builder 內申購／贖回雙常數（Q6-B 已決議）。

| Slide | 欄位 | 來源（已核對） |
|---|---|---|
| S0/S1 | clientName | `localizedText(client.display_name, lang)`；無 client → `proposal.cover.clientFallback` |
| S0/S1 | preparedBy（RM） | `DEMO_RM_PROFILE`（Q2 已決議：系統生成之全域單一 DEMO RM 常數，含姓名／員編／分行／機構，見 §5-F2b） |
| S1 | 帳號／分行 | DEMO 生成（Q2 已決議）：`client.account_number`（每個 DEMO 客戶個別生成之新增欄位）／`DEMO_RM_PROFILE.branch` |
| S1 | AUM／現金 | `formatUsd(client.aum_usd / cash_usd)`；本金邏輯沿用 `investmentNotional` |
| S1 | 風險屬性 | `riskProfileLabel(t, client.risk_profile)`；無 client 用 overlay `risk_tolerance` |
| S2 | 目標／期限 | overlay `optimization.objective`＋`client_profile.investment_horizon_years`；回退 `compare.adjustedRequest.objective` |
| S2 | 預期目標年化報酬 | **Q7 已決議（C 優先，無設定則 B）**：優先讀 overlay 新增欄位（動 schema）；無設定則以 anchor 模型 CAGR 作參考值並加註「參考」 |
| S2 | 容許下檔 | `needs.max_drawdown_tolerance`（×100 顯示 %）；無則「—」 |
| S2 | 偏離度 | 優先 `needs.customization_drift_l1`；否則 `holdingsDiff` 的 `Σ|deltaPct|/2` 近似；皆無則「—」 |
| S2 | 集中度 | **Q11-A 已決議**：最大 asset_class 佔比（以 `computeAssetMixFromWeights` 聚合）＋最大單一標的佔比（`needs.max_single_name_actual`）並列，文案註明語意 |
| S3 | House View | `overlay.market_view.stance`（`regime.*` i18n 徽章）＋`narrative_summary`＋`themes` chips |
| S3 | 策略 bullets | `talkingPoints.slice(0,3)`（AI 摘要；回退 `buildTalkingPoints`） |
| S4 | 類別權重 | 現有：`computeAssetMixFromWeights(client.holdings)`；建議：`resolveExposureMix(adjustedResult, modelCode)`（優先 `analytics.exposure.by_asset_class`，`rm-report-utils.ts:520-537`）；金額 = notional × 建議權重 |
| S5 | 指標列 | `buildMetricCompareRows` 四列 ＋ **新增 calmar 列**（anchor/champion `calmar` 與 customized `calmar`，`types.ts:254`；無值則該列「—」） |
| S5 | 走勢圖 | `buildBenchmarkCompareChartData`（rebased=100；recharts `LineChart`，樣式沿用 `InvestmentProposalPreview.tsx:243-278`） |
| S6 | 回撤事件（A） | `adjustedCandidate.analytics.drawdown_episodes` 依 `depth` 排序取前 3（引擎端既有欄位，隨回測存入）；anchor 側同取 `baseResult` champion；每列：期間（start→trough→end）／深度 %；標題與註腳明示「歷史回測區間內最大回撤事件，非情境模擬」 |
| S6 | 固定情境（B） | 2008/2020/2022 三情境：**引擎端於回測完成時預計算**各情境跌幅，存入 `BacktestResult` 或 candidate analytics 新增欄位（如 `stress_scenarios`，見 §5-F2c）；前端僅讀取展示，**不即時截取曲線**；引擎無該情境資料（回測區間不覆蓋）則該列顯示「—」；標題註明「固定歷史情境模擬」 |
| S7 | 賣出清單 | `holdingsDiff` 中 `removed/decreased`：比例 = |deltaPct|，金額 = notional × |deltaPct|/100，原因依 change 類型 i18n 文案 |
| S7 | 買入清單 | `added/increased` 同上；ISIN：ETF/FUND 顯示 universe 真實值（Q9 已決議，F2d 入庫）、個股恆「-」；RR 欄位恆佔位「—」 |
| S8 | 成本試算 | `turnover_total`（無則用 `Σ|deltaPct|/100/2` 近似單邊週轉）× **申購／贖回分列費率常數**（Q6-B 已決議：`SUBSCRIPTION_FEE_BPS`／`REDEMPTION_FEE_BPS` 兩個 bps 常數，賣出側用贖回、買入側用申購）；佔 AUM% = 成本/notional |
| S9 | 監控承諾 | 靜態 i18n 三條（偏離 ±5% 對齊 drift sync 概念） |
| S10 | 警語／簽章 | 沿用 `proposal.warning.*` 五條；簽章三欄為列印用空框，RM 欄預填 preparedBy |

### 3.5 佔位策略（缺失欄位）

| 欄位 | 策略 |
|---|---|
| 帳號、分行、機構、RM 姓名／員編 | **Q2 已決議：不再佔位、無需補登**——由 DEMO 生成（每客戶 `account_number` 等新增欄位；全域 `DEMO_RM_PROFILE` 常數），見 §5-F2b |
| ISIN、RR 風險等級 | **Q9 已決議**：ETF/FUND 的 ISIN 自網路資料源取得並更新 universe 資料庫（§5-F2d），S7 顯示真實值；個股 ISIN 恆「-」；RR 風險等級維持佔位「—」，表頭加註「待串接產品資料」 |
| 目標年化報酬 | **Q7 已決議**：優先讀 overlay 新增欄位（動 schema）；無設定則以 anchor 模型 CAGR 作參考值並加註「參考」 |
| 壓力測試 | **Q3 已決議**：引擎端預計算並存入結果物件（§5-F2c）；episodes 與固定情境皆缺 → **整張 S6 不產生**（dots 同步減少）；有資料時標題與註腳誠實標示資料性質 |
| 費率 | **Q6-B 已決議**：申購／贖回分列兩個 bps 常數（builder 內 `SUBSCRIPTION_FEE_BPS`／`REDEMPTION_FEE_BPS`）；S8 永遠附「試算假設，實際費率以分行公告為準」 |
| 金額（無 AUM） | notional 為 null 時所有金額欄「—」（沿用現行 `investment-proposal.ts` 慣例），比例欄不受影響 |

**原則**：佔位一律顯示「—」或「待補」i18n 文案，**不得**以 0、隨機值或 anchor 值冒充。

### 3.6 列印／匯出

- Deck 根節點掛 `proposal-print` class → 沿用 `globals.css:375-391` 隔離（body 其餘隱藏）。
- 每張 slide 容器：`print:break-after-page`；最後一張不加。
- 螢幕上 slide 為固定比例容器（Q10-A 已決議：16:9，`aspect-video`，最大寬 5xl，置中）；列印時解除固定比例、高度 auto，避免內容被裁。
- 走勢圖列印高度 `print:h-48`（沿用現行做法，`InvestmentProposalPreview.tsx:243`）。
- 簽章頁（S10）簽署欄以底線框呈現，列印後可手寫。
- 合規阻擋沿用 `proposal-capability-badge.ts`；被擋時列印按鈕 disabled＋訊息。

---

## 4. UX 流程與線框

### 4.1 進入路徑

```
RM 報告頁（RmReportView）
  └─ CTA「Generate Investment Proposal」（現有，:812-819）
       └─ Modal 開啟 → 簡報（Q5-B 已決議：唯一模式，無文件模式切換）
            ├─ 頂列：標題｜列印｜關閉
            ├─ 中央：當前 slide（16:9，Q10-A）
            └─ 底列：← ｜ dots ｜ 3/11 ｜ →
```

### 4.2 各張線框

**S0 封面**

```
┌──────────────────────────────────────────────┐
│ JASPER · Private Banking · RM Copilot        │
│                                              │
│   專屬資產配置檢視與再平衡建議書              │
│   {strategyLine}                             │
│                                              │
│   客戶 {clientName}    理財顧問 {preparedBy} │
│   日期 {dateLabel}     投資金額 {amount}     │
│                          [機密文件]          │
└──────────────────────────────────────────────┘
```

**S1 基本資料**

```
┌──────────────────────────────────────────────┐
│ 01 基本資料                        1/11      │
│ ┌───────────┬───────────┬───────────┐        │
│ │客戶姓名    │受託帳號 88…123│風險屬性 PR3│   │
│ │AUM $1.2M  │RM 王○○(E1024)│分行 台北信義│   │
│ │報告日期 … │           │           │        │
│ └───────────┴───────────┴───────────┘        │
└──────────────────────────────────────────────┘
```
（帳號／RM／分行皆為 DEMO 生成資料，Q2 已決議，無補登入口）

**S2 理財目標與現況診斷**

```
┌──────────────────────────────────────────────┐
│ 02 理財目標與現況診斷                         │
│ 目標 {objective}｜期限 {horizon}｜容許下檔 -15%│
│ ┌ 偏離度 +8.2% ── 股票部位偏離目標配置        ┐│
│ ┌ 集中度 科技/股票 62% ── 集中度過高          ┐│
│ ▶ 調倉必要性：降低風格偏離、強化下檔防禦       │
└──────────────────────────────────────────────┘
```

**S3 市場展望與配置方針**

```
┌──────────────────────────────────────────────┐
│ 03 市場總經展望與配置方針        [risk_off]  │
│ 「{narrative_summary}」                      │
│ #theme1 #theme2                              │
│  1 鎖定穩定收益 …（talking point 1）         │
│  2 適度降溫成長股 …（talking point 2）       │
│  3 動態風險控制 …（talking point 3）         │
└──────────────────────────────────────────────┘
```

**S4 資產配置架構對比**

```
┌──────────────────────────────────────────────┐
│ 04 資產配置架構對比                           │
│ 類別      │ 現有  │ 建議  │ 增減  │ 建議金額 │
│ 股票      │ 72%   │ 55%   │ -17pp │ $660k   │
│ 固定收益  │ 10%   │ 30%   │ +20pp │ $360k   │
│ …                                     合計   │
└──────────────────────────────────────────────┘
```

**S5 量化回測與風險效益**

```
┌──────────────────────────────────────────────┐
│ 05 量化回測與風險效益  區間 2019-01~2025-12  │
│ ┌ 淨值走勢圖（rebased=100，雙線） ──────────┐│
│ │ 指標     │ 現有   │ 建議   │ 改善         ││
│ │ CAGR     │  6.1%  │  7.3%  │ +1.2%        ││
│ │ Sharpe   │  0.62  │  0.85  │ +0.23        ││
│ │ MDD/Vol/Calmar …                         ││
│ └──────────────────────────────────────────┘│
└──────────────────────────────────────────────┘
```

**S6 壓力測試（條件顯示，雙區塊）**

```
┌──────────────────────────────────────────────┐
│ 06 壓力測試                                  │
│ ┌─ A. 歷史最大回撤回顧 ※回測區間內實際事件 ─┐│
│ │ 事件期間        │ 現有跌幅 │ 建議跌幅 │ 差異││
│ │ 2020-02→2020-03 │  -33.9%  │  -24.1%  │+9.8pp│
│ │ …（前 3 大）                              ││
│ └──────────────────────────────────────────┘│
│ ┌─ B. 固定情境模擬 ※引擎預計算之歷史情境重播 ─┐│
│ │ 情境            │ 現有跌幅 │ 建議跌幅 │ 差異││
│ │ 2008 金融海嘯   │  -38.2%  │  -28.5%  │+9.7pp│
│ │ 2020 疫情流動性 │  -33.9%  │  -24.1%  │+9.8pp│
│ │ 2022 升息雙殺   │  -25.4%  │  -18.2%  │+7.2pp│
│ └──────────────────────────────────────────┘│
└──────────────────────────────────────────────┘
```

**S7 調倉明細**

```
┌──────────────────────────────────────────────┐
│ 07 再平衡調倉明細                             │
│ 賣出：標的│ISIN（個股 -）│RR —│比例│金額│原因 │
│ 買入：標的│ISIN（ETF/FUND 真實值）│RR —│類別│比例│金額│邏輯
└──────────────────────────────────────────────┘
```

**S8 交易成本**　／　**S9 動態監控**　／　**S10 法規與簽章**

```
S8 ：週轉率 38% × 假設費率 → 預估成本 $X（約 AUM 0.6%）＋效益說明
S9 ：①偏離 ±5% 警示 ②定期健檢 ③事件響應（三條承諾卡）
S10：五條風險警語（琥珀框）＋ RM/主管/客戶三欄簽署表
```

---

## 5. 檔案變更清單

| # | 檔案 | 變更 | 預估 |
|---|---|---|---|
| F1 | `apps/web/src/lib/proposal-slides.ts`（**新**） | `ProposalSlide` union 型別＋`buildProposalSlideDeck`（11 張建構、條件過濾、佔位邏輯） | ~350 行 |
| F2 | `apps/web/src/lib/rm-report-utils.ts` | export `computeAssetMixFromWeights`（現 `:508-518` private）；可選 export `resolveExposureMix`（`:520-537`） | ~5 行 |
| F2b | `apps/web/src/lib/clients.ts` | **Q2 決議**：擴充 `DemoClient` 型別，新增帳戶欄位（`account_number`、`risk_profile_label` 等）與全域 DEMO RM 常數（`DEMO_RM_PROFILE`：姓名/員編/分行/機構）；demo 資料生成邏輯同步更新 | ~50 行 |
| F2c | `apps/api`（回測引擎／結果組裝）＋ `apps/web/src/lib/types.ts` | **Q3 決議**：回測完成時一併計算壓力測試資料並存入結果物件——(A) 整理 `drawdown_episodes` 前三大回撤事件；(B) 固定情境 2008/2020/2022 跌幅（於 `BacktestResult` 或 candidate analytics 新增欄位，如 `stress_scenarios`）；前端 `types.ts` 同步型別。前端**不**即時截取曲線 | ~120 行 |
| F2d | `shared/etf-universe.json`（或相關 universe store）＋更新腳程 | **Q9 決議**：自網路資料源取得 ETF／FUND 之 ISIN 並更新入庫；個股不設 ISIN（前端恆顯示「-」）；RR 風險等級仍佔位 | ~80 行＋資料更新 |
| F3 | `apps/web/src/components/ProposalSlideDeck.tsx`（**新**） | 導覽 shell：dots、頁碼、鍵盤、列印按鈕、合規阻擋、`proposal-print` 根節點 | ~200 行 |
| F4 | `apps/web/src/components/proposal-slides/*.tsx`（**新**，可單檔多元件） | S0–S10 各 slide 呈現元件（cover/kv-grid/goals/market/asset-class-compare/metrics/stress/trade-list/cost/bullets/signoff） | ~450 行 |
| F5 | `apps/web/src/components/InvestmentProposalPreview.tsx` | **Q5-B 決議**：移除文件模式與模式切換，此檔改為薄殼直接掛 `ProposalSlideDeck`；原長文件 section renderer（`:120-376`）與封面區塊刪減，`buildInvestmentProposalDocument` 不再被 UI 引用 | 淨刪減（約 -300 行） |
| F6 | `apps/web/src/app/globals.css` | slide 列印規則（`.proposal-slide { break-after: page }`、解除固定比例） | ~15 行 |
| F7 | `apps/web/src/lib/i18n.tsx` | §6 新 keys × 三語 | ~3×45 行 |
| F8 | `apps/web/src/lib/proposal-slides.test.ts`（**新**） | builder 單測（§7.1） | ~200 行 |
| F9 | `apps/web/src/lib/rm-report-utils.ts` 或 `rm-report-utils.test.ts` | calmar 列擴充＋測試 | ~30 行 |

**不改（本期）**：`buildInvestmentProposalDocument` 輸出契約（Q5-B 後不再被 UI 引用，保留或清理另案）、引擎既有指標語意、drift sync 規則。`apps/api` 變更**僅限 F2c** 壓力測試預計算。

### 5.1 F1 型別草圖

```ts
export type ProposalSlide =
  | { id: "cover"; kind: "cover"; titleKey: string; brand: string; firm: string;
      clientName: string; preparedBy: string; dateLabel: string;
      investmentAmount: string; strategyLine: string; confidential: string }
  | { id: "basic-info"; kind: "kv-grid"; titleKey: string;
      rows: { label: string; value: string }[] } // Q2：帳號／RM 欄位由 DEMO 生成，無補登入口
  | { id: "goals-diagnosis"; kind: "goals"; titleKey: string;
      goal: string; horizon: string; maxDrawdown: string; targetReturn: string;
      driftLabel: string; concentrationLabel: string; necessity: string }
  | { id: "market-strategy"; kind: "market"; titleKey: string;
      stanceLabel: string | null; narrative: string; themes: string[]; bullets: string[] }
  | { id: "allocation-compare"; kind: "asset-class-compare"; titleKey: string;
      columns: { current: string; proposed: string };
      rows: { cls: string; label: string; currentPct: number | null;
              proposedPct: number; deltaPp: number | null; amountLabel: string }[];
      totalLabel: string; totalAmount: string }
  | { id: "backtest-metrics"; kind: "metrics"; titleKey: string;
      periodLabel: string; metrics: ProposalMetricTableRow[];
      chartData: BenchmarkCompareChartRow[] | null;
      anchorLabel: string | null; customizedLabel: string }
  | { id: "stress-review"; kind: "stress"; titleKey: string; honestyNote: string;
      episodesTitle: string;   // A 區：歷史最大回撤回顧（引擎預存 drawdown_episodes 前 3）
      episodes: { window: string; anchorDepth: string | null; customizedDepth: string; deltaLabel: string }[];
      scenariosTitle: string;  // B 區：固定情境模擬（引擎預存 stress_scenarios，F2c）
      scenarios: { scenario: string; anchorDepth: string | null; customizedDepth: string; deltaLabel: string }[] }
  | { id: "trade-list"; kind: "trade-list"; titleKey: string;
      sells: TradeRow[]; buys: TradeRow[]; emptyLabel?: string }
  | { id: "cost-estimate"; kind: "cost"; titleKey: string;
      turnoverLabel: string; feeLabel: string; totalCostLabel: string;
      costPctLabel: string; assumptionNote: string; benefitNote: string }
  | { id: "monitoring"; kind: "bullets"; titleKey: string; bullets: string[] }
  | { id: "compliance-signoff"; kind: "signoff"; titleKey: string;
      warnings: string[]; signees: { role: string; name?: string }[]; ackNote: string };

export function buildProposalSlideDeck(input: {
  compare: PersonalizationCompare;
  overlay: ClientOverlay | null;
  anchorPortfolio: ModelPortfolio;
  client: DemoClient | null;
  lang: Lang;
  t: TFn;
  customizedModelCode?: string | null;
  talkingPoints?: string[];
}): ProposalSlide[]; // S6 無引擎預存壓力資料時不列入回傳陣列
```

---

## 6. i18n（zh / en / ko）

於 `apps/web/src/lib/i18n.tsx` 三 dict（en `:30`／zh `:2086`／ko `:4008`）各增（節錄主要 keys）：

| Key | zh（繁中） | en | ko |
|---|---|---|---|
| `slides.nav.prev` | 上一張 | Previous | 이전 |
| `slides.nav.next` | 下一張 | Next | 다음 |
| `slides.nav.counter` | {current} / {total} | {current} / {total} | {current} / {total} |
| `slides.s1.title` | 基本資料 | Client & Advisor Overview | 기본 정보 |
| `slides.s1.account` | 受託帳號 | Account number | 수탁 계좌 |
| `slides.s1.branch` | 所屬機構／分行 | Institution / Branch | 소속 기관/지점 |
| `slides.s2.title` | 理財目標與現況診斷 | Goals & Portfolio Health Check | 투자 목표 및 현황 진단 |
| `slides.s2.targetReturn` | 預期目標年化報酬 | Target annual return | 목표 연수익률 |
| `slides.s2.targetReturnNote` | 參考值：anchor 模型歷史年化報酬，非承諾績效 | Reference: anchor model historical CAGR; not a promise | 참고값: 앵커 모델 과거 연수익률(약정 아님) |
| `slides.s2.maxDd` | 容許最大下檔風險 | Max acceptable drawdown | 허용 최대 낙폭 |
| `slides.s2.drift` | 資產偏離度 | Portfolio drift | 자산 이탈도 |
| `slides.s2.concentration` | 風險集中度診斷 | Concentration check | 집중도 진단 |
| `slides.s2.necessity` | 透過本次再平衡，降低資產風格偏離，強化下檔防禦力並鎖定收益。 | This rebalance reduces style drift, strengthens downside defense, and locks in gains. | 이번 리밸런싱으로 스타일 이탈을 줄이고 하방 방어를 강화합니다. |
| `slides.s3.title` | 市場總經展望與配置方針 | Market Outlook & Strategy | 시장 전망 및 배분 방침 |
| `slides.s3.houseView` | 總體經濟觀點 | House view | 하우스 뷰 |
| `slides.s4.title` | 資產配置架構對比 | Asset Allocation: Current vs. Proposed | 자산배분 비교 |
| `slides.s4.current` | 現有投資組合 | Current | 현재 |
| `slides.s4.proposed` | 建議新投資組合 | Proposed | 제안 |
| `slides.s4.adjustment` | 權重增減 | Adjustment | 조정 |
| `slides.s4.amount` | 建議配置金額 | Proposed amount | 제안 금액 |
| `slides.s5.title` | 量化回測與風險效益分析 | Back-testing & Risk Metrics | 백테스트 및 리스크 지표 |
| `slides.s5.period` | 回測區間：{start} 至 {end} | Backtest window: {start} – {end} | 백테스트 구간: {start}~{end} |
| `slides.s5.improvement` | 改善效益 | Improvement | 개선 효과 |
| `slides.s6.title` | 壓力測試 | Stress Test Review | 스트레스 테스트 |
| `slides.s6.blockA` | 歷史最大回撤回顧 | Historical Drawdown Review | 과거 최대 낙폭 검토 |
| `slides.s6.blockB` | 固定情境模擬（2008／2020／2022） | Fixed Scenario Simulation (2008/2020/2022) | 고정 시나리오 시뮬레이션(2008/2020/2022) |
| `slides.s6.honesty` | A 區為回測區間內實際最大回撤事件；B 區為固定歷史情境重播（引擎預計算），兩者皆非未來績效預測。 | Block A shows actual largest drawdowns within the backtest window; Block B replays fixed historical scenarios (precomputed by the engine). Neither predicts future performance. | A는 백테스트 구간 내 실제 최대 낙폭, B는 고정 역사 시나리오 재현(엔진 사전 계산)이며 미래 성과 예측이 아닙니다. |
| `slides.s6.defenseDelta` | 防禦差異 | Defense delta | 방어 차이 |
| `slides.s7.title` | 再平衡調倉明細 | Action Plan: Buy/Sell List | 리밸런싱 매매 내역 |
| `slides.s7.sell` | 建議賣出／贖回清單 | Redemption list | 매도/환매 목록 |
| `slides.s7.buy` | 建議買入／新增配置清單 | Subscription list | 매수/신규 편입 목록 |
| `slides.s7.isin` | 代碼 (ISIN) | ISIN | ISIN |
| `slides.s7.rr` | 風險等級 | Risk rating | 위험 등급 |
| `slides.s7.pendingData` | 待串接產品資料 | Product data pending | 상품 데이터 연동 예정 |
| `slides.s7.reason.sell` | 風格漂移，鎖定獲利 | Style drift; lock in gains | 스타일 이탈, 이익 확정 |
| `slides.s7.reason.buy` | 提高穩定配息與防禦 | Raise stable income & defense | 안정 인컴·방어 강화 |
| `slides.s7.none` | 無需調倉 | No trades required | 조정 불필요 |
| `slides.s8.title` | 交易成本預估與效益 | Estimated Costs & Net Impact | 거래 비용 추정 |
| `slides.s8.assumption` | 本頁為試算假設（申購 {subBps} bps／贖回 {redBps} bps），實際費率以分行公告為準。 | Illustrative assumption (subscription {subBps} bps / redemption {redBps} bps); actual fees per branch schedule. | 예시 가정(신규 {subBps}bps/환매 {redBps}bps)이며 실제 수수료는 지점 기준입니다. |
| `slides.s8.totalCost` | 預計一次性總換倉成本 | One-off transition cost | 일회성 교체 비용 |
| `slides.s9.title` | 動態監控機制與服務承諾 | Monitoring & Action Triggers | 모니터링 및 서비스 약속 |
| `slides.s9.driftAlert` | 任一大類資產權重偏離目標超過 ±5% 時，系統主動發出再平衡檢視提示。 | Alert when any asset class drifts beyond ±5% from target. | 자산군 비중이 목표 대비 ±5% 초과 이탈 시 알림. |
| `slides.s9.review` | 每季／每半年固定寄發投組表現追蹤報告，並由理財顧問主動聯繫討論。 | Quarterly / semiannual performance reviews with proactive RM outreach. | 분기/반기 성과 보고 및 RM 선제 연락. |
| `slides.s9.event` | 市場波動超越預設風控門檻時，第一時間提供應對指引與防禦建議。 | On threshold breaches, timely defensive guidance is provided. | 변동성 임계 초과 시 방어 가이드 제공. |
| `slides.s10.title` | 法規風險揭露與簽章覆核 | Compliance, Risk Disclosures & Sign-off | 규제 고지 및 서명 |
| `slides.s10.rm` | 理財顧問 (RM) | Relationship Manager | RM |
| `slides.s10.supervisor` | 分行／合規主管 | Branch / Compliance Supervisor | 지점/준법 책임자 |
| `slides.s10.client` | 客戶確認簽署 | Client Acknowledged | 고객 서명 확인 |
| `slides.s10.ack` | 本人已詳閱並充分理解本建議書之各項分析內容、標的特性、潛在風險及預估費用，並同意依上述規劃指示執行後續交易。 | I have read and understood the analyses, product features, risks, and estimated fees in this proposal, and agree to execute accordingly. | 본 제안서의 분석, 상품 특성, 위험 및 예상 비용을 충분히 이해하였으며 이에 동의합니다. |
| `slides.placeholder.dash` | — | — | — |

**保留不動**：現有 `proposal.*` keys（`buildInvestmentProposalDocument` 契約本期不動；Q5-B 後 UI 不再引用，清理另案）。

---

## 7. 測試計畫

框架：vitest（`npx vitest run`，延續 `investment-proposal.test.ts` 慣例）。

### 7.1 單元（builder — F1/F8）

| # | 案例 | 斷言 |
|---|---|---|
| U1 | 完整 client＋overlay＋雙軌 compare | 回傳 11 張（含 S6）；S1 含客戶姓名／AUM；S4 類別列合計 100% |
| U2 | 無 client | S1 客戶姓名為 fallback；金額欄「—」；不 throw |
| U3 | 無 overlay | S3 stance 為 null、顯示回退文案；S2 目標列回退 request.objective |
| U4 | 引擎結果無壓力資料（episodes 與固定情境皆缺） | 回傳 10 張（**無 S6**）；dots 總數同步 |
| U5 | 單軌 compare | S4/S5 無 anchor 欄；S5 metrics 僅 customized 值 |
| U6 | client 僅現金（cash≥50% AUM） | notional 用 cash；S4「現有」欄全現金 |
| U7 | holdingsDiff 全 unchanged | S7 `emptyLabel` 出現、買賣表為空 |
| U8 | 無 turnover 且無 diff | S8 金額佔位、仍有假設註記 |
| U9 | DEMO 資料（Q2） | S1 帳號顯示 `client.account_number`；RM／分行顯示 `DEMO_RM_PROFILE` |
| U10 | 既有 `investment-proposal.test.ts` | 全綠（文件 builder 契約零回歸；UI 引用隨 F5 移除） |
| U11 | 固定情境部分缺失（引擎無該區間資料） | 該情境列「—」，其餘情境與 episodes 區塊正常 |

### 7.2 元件（F3/F4，可選 @testing-library）

| # | 案例 | 斷言 |
|---|---|---|
| C1 | 鍵盤 → | slide index +1；末張再按不變 |
| C2 | Esc | 觸發 onClose |
| C3 | dots 點擊 | 跳至對應張；`aria-current` 正確 |
| C4 | 合規阻擋（capabilities pending） | 列印鈕 disabled＋阻擋訊息 |

### 7.3 手動驗收

| # | 步驟 | 期望 |
|---|---|---|
| M1 | RM 報告 → 產生建議書 | 直接進入簡報（Q5-B：唯一模式）、S0 封面 |
| M2 | ←/→/dots/Esc | 導覽流暢、無焦點遺失 |
| M3 | window.print() | 每張一頁、無內容被裁、簽章欄可寫 |
| M4 | zh/en/ko 切換 | 無裸 key；日期／幣別格式隨語系 |
| M5 | 無壓力資料的 job（episodes 與固定情境皆缺） | 無 S6 空白頁 |
| M6 | 單軌流程 | 對比欄正確退化 |

### 7.4 回歸

| # | 案例 | 期望 |
|---|---|---|
| R1 | `investment-proposal.test.ts` | Q5-B：文件模式 UI 移除後，builder 測試保留全綠或隨 F5 調整；簡報路徑不回歸 |
| R2 | `rm-report-utils` 相關測試 | export 化不影響行為 |
| R3 | i18n key-parity 三語 | 無缺 key |
| R4 | 列印 CSS | `.proposal-slide` 規則僅作用於 deck，不影響其他列印路徑 |

---

## 8. 實作順序

| Phase | 內容 | 相依 | 完成判準 |
|---|---|---|---|
| **P1**（核心簡報＋真實資料） | F2（export）＋**F2b（demo client 欄位擴充，Q2）**＋**F2c（引擎端壓力測試預計算與存儲，Q3）**＋**F2d（ETF/FUND ISIN 網路取得與入庫，Q9）**＋F1（builder：S0–S10 全量）＋F3（導覽 shell）＋F4（slide 元件）＋F5（薄殼取代文件模式，Q5-B）＋F7 i18n＋F8 測試＋F9（calmar 列） | 無 | U1–U11、C1–C4 綠；M1/M2/M4/M5/M6 過 |
| **P2**（列印精修＋殘留佔位） | F6（列印 CSS 精修）＋RR 風險等級對映（**若需要**：待產品提供對映表；本期維持佔位，Q9 已決議） | P1 | M3 過；R1–R4 綠 |

建議 P1 拆 2–3 支 PR（F2c／F2d 引擎與資料一支、前端簡報一至兩支）；P2 一支。**引擎改動僅限 F2c，不實作本文件以外的引擎改動。**

---

## 9. 邊界案例

| # | 案例 | 預期行為 |
|---|---|---|
| E1 | 無 AUM（client 為 null 或 aum=0 且 cash=0） | notional=null → 所有金額欄「—」；比例欄正常；S8 成本金額「—」 |
| E2 | 客戶無持股（純現金） | S4「現有」欄 = 100% 現金類；文案改「新建投組配置」；S7 賣出表為空、買入表為全量 |
| E3 | 無壓力資料（引擎結果無 `drawdown_episodes` 且無固定情境資料） | S6 整張不產生；張數與 dots 同步減少；**不顯示**空白佔位頁 |
| E4 | 單軌（single-track） | S4/S5/S6 無「現有／anchor」欄；S5 指標僅建議值；封面副標切換（同 `RmReportView` 單軌處理） |
| E5 | 無 client（僅 overlay） | S1 姓名 fallback；風險屬性取自 overlay；S4「現有」欄改以 anchor 模型持股近似並加註 |
| E6 | 無 overlay | S3 顯示回退文案（沿用 `proposal.body.market` 邏輯）；S2 目標回退 request.objective |
| E7 | 指標缺 calmar | 該列顯示「—」，其餘列不受影響 |
| E8 | 調倉差異為空 | S7 顯示「無需調倉」；不產生空表 |
| E9 | episodes 僅 1–2 筆 | S6 A 區列數如實減少 |
| E10 | 鍵盤事件與全域快捷鍵衝突 | 監聽僅掛 modal 容器（`tabIndex={-1}` 聚焦後生效）；Q2 決議後無 inline 補登 input |
| E11 | StrictMode 雙 render | builder 純函式冪等；deck state 僅 slide index |
| E12 | 列印時某張內容過長 | slide 列印解除固定高度；表格允許跨頁（`break-inside: auto` 於列印） |
| E13 | 固定情境未被回測區間覆蓋 | 引擎無該情境資料 → 該列「—」，其餘情境與 A 區正常、S6 仍顯示 |
| E14 | overlay 無目標年化報酬欄位（Q7） | S2 顯示 anchor 模型 CAGR 並加註「參考」；有設定則顯示設定值 |

---

## 10. 與現有機制關係

| 現有機制 | 關係 |
|---|---|
| `InvestmentProposalPreview`（原文件模式） | **取代（Q5-B 已決議）**：移除文件模式與切換，此檔改為薄殼直接掛 `ProposalSlideDeck`；`buildInvestmentProposalDocument` 不再被 UI 引用 |
| `useAiTalkingSummary`（Kimi AI 摘要） | S3 策略 bullets 直接消費其 `summary`；loading 中顯示骨架、失敗回退 `buildTalkingPoints`（與文件模式相同契約） |
| `NeedsFulfillmentPanel`／`needs_attainment` | S2 診斷（容許下檔、偏離、集中度）同源消費；不另算 |
| `BenchmarkComparePanel` | S5 圖與其共用 `buildBenchmarkCompareChartData`；數字一致 |
| RM 報告 tabs（rm/quant/audit） | 入口維持 RM tab 的 CTA；簡報不新增 tab |
| `proposal-capability-badge` | 合規阻擋邏輯整份沿用 |
| drift sync（`overlay-drift-sync.ts`） | S9 ±5% 警示文案與其概念對齊；不讀取其狀態 |
| `.proposal-print` 列印隔離 | deck 根節點沿用同 class；新增 `.proposal-slide` 分頁規則 |

---

## 11. 風險與回滾

| # | 風險 | 等級 | 緩解 |
|---|---|---|---|
| R-1 | 壓力測試雙區塊被誤解為未來績效預測 | 中 | 標題＋註腳雙重誠實標示（`slides.s6.honesty`）；固定情境由引擎端預計算（F2c），前端不即時截取曲線 |
| R-2 | 費率假設與實際收費落差 | 中 | 永附假設註記；費率為申購／贖回兩個常數便於調整（Q6-B 已定） |
| R-3 | 佔位欄位（RR 風險等級、個股 ISIN「-」）被當成系統缺失 | 低 | 表頭加註「待串接產品資料」；帳號／RM 為 DEMO 生成（Q2）、ETF/FUND ISIN 為入庫真實值（Q9） |
| R-4 | 列印版面（16:9 容器）內容被裁 | 中 | 列印解除固定比例；M3 手動驗收多語系（ko/en 字長） |
| R-5 | 鍵盤導覽與全域快捷鍵／輸入框衝突 | 低 | 監聽限 modal 容器；E10 檢查 target |
| R-6 | i18n 缺 key 顯示裸字串 | 低 | R3 key-parity |
| R-7 | 文件模式移除後 `buildInvestmentProposalDocument` 成未引用碼 | 低 | 本期保留不動（其測試隨 F5 調整）；後續清理另案 |

**回滾**：

1. F5 為刪減式變更：revert F5 所在 commit 即還原文件模式；其餘新檔（F1/F3/F4）不影響既有路徑。
2. F2c 引擎變更為**新增欄位**，向後相容——舊回測結果無壓力欄位時，前端整張 S6 不顯示（E3）。

**完成定義（DoD）**：

- [ ] U1–U11、C1–C4、R1–R4 全綠
- [ ] M1–M6 手動過關（含三語列印）
- [x] §12 全部 12 項決議並回填本文件 §1.4（v0.3 完成）
- [ ] 文件狀態改為「Implemented」並補 PR 連結

---

## 12. 決議記錄（2026-09-21 全部 12 項確認）

| # | 問題 | 選項 | 決議 |
|---|---|---|---|
| Q1 | **列印／PDF 匯出形式**？ | A. 維持瀏覽器 `window.print()`（使用者另存 PDF）；B. 伺服器端產生正式 PDF（需新 API／套件，工項大） | ✅ **A**：列印/PDF 走瀏覽器 `window.print()`（使用者另存 PDF）；伺服器端 PDF 列 Phase 2 |
| Q2 | **RM 姓名／員編／分行／客戶帳號從哪來**？ | A. 僅用現有 `rm_owner`／`rm_sign_off.rm_id`，其餘佔位；B. RM 現場補登（session state）；C. 擴充 demo client JSON／localStorage 持久化補登值；D. DEMO 資料生成 | ✅ **D**：RM 資料（姓名/員編/分行/機構）由系統生成單一 DEMO RM；客戶資料（帳號/AUM/風險屬性）為每個 DEMO 客戶個別生成。需擴充 `apps/web/src/lib/clients.ts` 的 DemoClient 型別與 demo 資料 |
| Q3 | **壓力測試情境**：固定歷史情境（2008/2020/2022）或資料驅動？ | A. 以 `drawdown_episodes` 前三大回撤事件呈現並誠實標示；B. 固定窗口需引擎支援（本期不可行）；C. 整張不做 | ✅ **A+B 都做，且回測時一併存好**：同張 slide 雙區塊並列 (A) `drawdown_episodes` 前三大回撤事件與 (B) 固定歷史情境 2008/2020/2022 跌幅。**關鍵**：跑回測時即由引擎端（`apps/api`）一併計算並存入 `BacktestResult` 或 candidate analytics，**非前端即時截取曲線**（見 §5-F2c） |
| Q4 | **簡報視覺主題／品牌**？ | A. 沿用現提案 slate/blue 私銀風（封面漸層）；B. 改用 RM 報告 pixel 主題；C. 需品牌稿（logo/色票/字體） | ✅ **A**：沿用現提案 slate/blue 私銀風（封面漸層） |
| Q5 | **簡報與文件並存或取代**？ | A. 並存（modal 內切換，預設簡報）；B. 簡報完全取代文件；C. 簡報僅為列印前預覽 | ✅ **B**：簡報完全取代文件。`InvestmentProposalPreview` 改為薄殼，直接掛 `ProposalSlideDeck`；移除文件模式切換 |
| Q6 | **交易成本費率假設**？ | A. 單一混合 bps 常數（如 50bps 單邊）；B. 申購／贖回分列常數；C. 機構可設定（需設定頁，工項大） | ✅ **B**：申購／贖回分列兩個 bps 常數（`SUBSCRIPTION_FEE_BPS`／`REDEMPTION_FEE_BPS`） |
| Q7 | **「預期目標年化報酬」來源**？ | A. 佔位「—」；B. 以 anchor 模型 CAGR 作參考值並加註；C. overlay 新增欄位（動 schema） | ✅ **優先 C，若 overlay 無設定則 B**：優先從 overlay 新增欄位讀取（動 schema）；無設定則以 anchor 模型 CAGR 作參考值並加註「參考」 |
| Q8 | **簽章流程**？ | A. 列印後手寫（現範本形式）；B. 僅 RM 端沿用 `rm_sign_off` 狀態顯示；C. 未來電子簽（不做） | ✅ **A**：列印後手寫（現範本形式） |
| Q9 | **ISIN／RR 風險等級**？ | A. 恆佔位「—」＋表頭加註；B. 以 asset_class 固定對映 RR（如 equity→RR4、bond→RR2，需產品確認對映表）；C. universe 擴充欄位（動資料源） | ✅ **ETF/FUND 自網路取得 ISIN 並更新資料庫**：ETF/FUND 的 ISIN 從網路資料源取得並更新到 universe 資料庫（`shared/etf-universe.json` 或相關 store，見 §5-F2d）；個股恆顯示「-」。RR 風險等級仍佔位 |
| Q10 | **投影片比例與尺寸**？ | A. 16:9 固定比例（`aspect-video`）；B. 流動高度（內容自適應）；C. A4 橫式優先（列印導向） | ✅ **A**：16:9 固定（`aspect-video`），列印時解除固定 |
| Q11 | **S2 集中度語意**：範本指「單一產業／區域」，系統僅有 asset_class 與單一標的 | A. 以最大 asset_class 佔比＋最大單一標的佔比並列，文案註明；B. 僅單一標的 | ✅ **A**：最大 asset_class 佔比＋最大單一標的佔比並列，文案註明 |
| Q12 | **觸控滑動換頁**是否本期做？ | A. 做；B. 不做（僅按鈕/鍵盤/dots） | ✅ **B**：本期不做（僅按鈕／鍵盤／dots） |

---

## 附錄：關鍵座標速查（2026-09-21）

| 主題 | 路徑:行號 |
|---|---|
| 文件模式 modal 外殼 | `apps/web/src/components/InvestmentProposalPreview.tsx:459-599` |
| Section renderer | `InvestmentProposalPreview.tsx:120-376` |
| 文件 builder | `apps/web/src/lib/investment-proposal.ts:355-717` |
| `ProposalSection` union | `investment-proposal.ts:60-121` |
| 投資本金推斷 | `investment-proposal.ts:163-170` |
| 指標比較（4 項） | `apps/web/src/lib/rm-report-utils.ts:355-434` |
| 持股差異 | `rm-report-utils.ts:437-486` |
| 走勢圖資料（rebased） | `rm-report-utils.ts:179-186` |
| 類別聚合（private，待 export） | `rm-report-utils.ts:508-518` |
| exposure 解析（private） | `rm-report-utils.ts:520-537` |
| Talking points 回退 | `rm-report-utils.ts:790-841` |
| `PortfolioCandidate`（calmar/turnover/episodes 入口） | `apps/web/src/lib/types.ts:244-313` |
| `needs_attainment` | `types.ts:274-313` |
| `CandidateAnalytics.drawdown_episodes` | `types.ts:355-360` |
| `PersonalizationCompare` | `types.ts:493-501` |
| `DemoClient` | `apps/web/src/lib/clients.ts:71-96` |
| overlay `rm_sign_off` | `apps/web/src/lib/overlay-schema.ts:114-121` |
| overlay `market_view` | `overlay-schema.ts:144-150` |
| 資產類別常數 | `apps/web/src/lib/constants.ts:1-7` |
| 列印隔離 CSS | `apps/web/src/app/globals.css:375-391` |
| i18n dicts | `apps/web/src/lib/i18n.tsx`（en `:30`／zh `:2086`／ko `:4008`） |
| RM 報告 CTA／modal 接線 | `apps/web/src/components/RmReportView.tsx:807-820`、`:869-877` |
| 合規列印阻擋 | `apps/web/src/lib/proposal-capability-badge.ts` |
