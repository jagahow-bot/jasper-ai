# JASPER AI 智能量化助手
## 重新想像私人銀行：為數位原生高淨值客戶打造超個人化投資旅程

**提案團隊**：TradingValley  
**競賽**：Singapore FinTech Festival (SFF) Global FinTech Hackcelerator 2026  
**Corporate Champion**：Julius Baer  
**題目**：Reimagining Private Banking for Digitally Native HNW Clients

---

## 1. Executive Summary

Relationship Managers (RMs) in private banking face a structural mismatch: digitally native High-Net-Worth (HNW) clients expect hyper-personalized, transparent, and continuously adaptive advice—yet most institutions still deliver standardized model portfolios designed for operational efficiency, not individual fit. With an estimated **US$84 trillion wealth transfer** underway, the next generation of clients will not accept one-size-fits-all allocation.

**JASPER AI** is an institutional-grade quantitative copilot that empowers RMs to design, validate, and explain **client-specific investment strategies** in a single working session—without replacing human judgment or compliance oversight. Built on a core principle—**the math engine computes numbers; generative AI only writes narratives and research hypotheses**—JASPER transforms the RM workflow from manual spreadsheet iteration to a closed loop of hypothesis → backtest → champion selection → institutional report → client-ready narrative.

Unlike model portfolios from large asset managers, JASPER enables:

- **Per-client strategy construction** aligned to risk tolerance, liquidity needs, ESG preferences, and market views
- **Regime-adaptive optimization** that adjusts objectives across risk-on, neutral, and risk-off environments
- **Pro multi-round convergence** with champion–challenger selection, warm-start, and continuation across sessions
- **Out-of-sample validation** and benchmark-relative analytics to suppress overfitting before client presentation
- **Zero-hallucination narrative guardrails** that bind AI text to engine-computed facts

Our team, **TradingValley**, has supported Taiwanese financial institutions in building robo-advisory infrastructure since 2017 and was previously selected in the **SFF Global FinTech Hackcelerator** (2025, Growin / wealth management track). We combine deep wealth-management domain expertise with production-grade AI and quantitative engineering—positioning us to deliver a working prototype that demonstrates immediate RM productivity gains and a differentiated client experience for Julius Baer.

**Hackcelerator goal**: Deliver a pilot-ready JASPER RM copilot integrated with Julius Baer's product universe and RM workflows, proving that hyper-personalization at scale is achievable without proportional headcount growth.

---

## 2. 問題陳述：對齊 Julius Baer 挑戰

### 2.1 世代財富轉移與客戶期待落差

全球約 **84 兆美元** 財富正由嬰兒潮世代轉移至數位原生接班人。這群客戶具備以下特徵：

- 習慣即時、透明、可互動的數位體驗（投資 App、即時報價、個人化推薦）
- 不接受「標準型投資組合 + 年度檢視」的慢節奏服務
- 要求投資建議能對應其價值觀（ESG、地緣偏好、流動性事件）與人生階段

然而，多數私人銀行仍依賴**大型資產管理公司的模型投資組合（Model Portfolio）**作為配置骨幹——高效、合規、可規模化，卻本質上是**一體適用（one-size-fits-all）**。

### 2.2 理專（RM）工作流的結構性瓶頸

現代私人銀行的 RM 是客戶體驗的樞紐，但其效率持續被以下痛點侵蝕：

| 痛點 | 現況 | 對機構的影響 |
|------|------|-------------|
| **資訊過載** | RM 需手動消化國際財經新聞、地緣風險、產品公告 | 研究時間過長，建議品質因個人能力而異 |
| **個人化不足** | 模型投資組合覆蓋 80% 客戶，僅在邊緣做微調 | 高淨值客戶感受不到「為我設計」的專屬感 |
| **策略驗證耗時** | 組合調整依賴 Excel / 內部試算，缺乏樣本外驗證 | 推薦前難以快速證明「歷史上是否合理」 |
| **靜態客戶報告** | 系統報表呈現數據，缺乏市場脈絡與前瞻敘事 | 客戶檢視會流於形式，信任感難以深化 |
| **再平衡反應慢** | 市場 regime 切換時，調整週期以週／月計 | 錯失主動溝通與交叉銷售時機 |

這些效率問題轉化為：**較高的營運成本、較慢的 AUM 成長、客戶流失風險，以及財富管理事業難以在不大幅增聘 RM 的前提下規模化**。

### 2.3 Julius Baer 挑戰的核心命題

> 如何運用 AI，為數位原生高淨值客戶打造從**開戶（onboarding）到投資組合顧問（portfolio advisory）**的無縫、超個人化旅程？

我們的理解是：答案不在於用聊天機器人取代 RM，而在於讓 RM 能在**每一次客戶互動中**，以機構級量化能力快速產出**專屬於該客戶**的策略假設、回測證據與可審計敘事——這是模型投資組合架構上無法提供的體驗。

---

## 3. 解決方案：JASPER AI — 私人銀行理專智能副駕

### 3.1 產品定位

**JASPER AI 智能量化助手**是一套 **RM Copilot（理專副駕）**，服務於私人銀行內部工作流程：

- **不是** 對客直接下單的 Robo-Advisor
- **不是** 取代 RM 判斷的「黑箱推薦引擎」
- **是** 讓 RM 在單次工作階段內，完成「客戶輪廓 → 市場觀點 → 策略回測 → 冠軍遴選 → 機構級報告 → 客戶敘事」的閉環

**設計原則**：數學引擎算數字，生成式 AI 只寫敘事與研究假設。所有績效數字（夏普比率、最大回撤、相對基準超額等）均由同一套量化引擎計算，AI 敘事經**零幻覺校驗（narrative_facts）**自動比對，杜絕捏造報酬。

### 3.2 核心能力一覽

| 能力模組 | 功能說明 | RM 價值 |
|----------|----------|---------|
| **AI 投資搜尋（Pro 優化）** | 生成式 AI 提供回合種子（round seed）+ Optuna 貝葉斯搜尋，在宣告邊界內探索最優權重與因子組合 | 從「手動試參數」升級為「AI 引導的智能收斂」 |
| **Regime 自適應** | 自動偵測 risk-on / neutral / risk-off 市場型態，動態切換優化目標 | 市場轉折時主動調整策略方向，而非年度再平衡才反應 |
| **多資產類別槽位規劃** | 依股、債、商品、REITs、另類等資產類別設定預算槽位（class budget）與區域子權重 | 對齊客戶約束與 Julius Baer 產品貨架結構 |
| **冠軍遴選（Champion Selection）** | 多回合 champion–challenger 機制，樣本內外分離評分，排行榜支援 OOS 排序 | RM 可自信地向客戶展示「經得起樣本外考驗」的策略 |
| **延續／暖啟動（Continuation / Warm-start）** | 跨工作階段延續 Pro 收斂狀態；相似情境快取冠軍策略即時載入 | 客戶回訪或市場微調時無需從零開始 |
| **機構級報告（Institutional Report）** | 多期間績效、相對基準追蹤誤差／資訊比率、資產類別曝險、核心持股、回撤事件分析 | 直接作為客戶檢視會簡報素材，提升專業感 |
| **自訂市場觀點** | RM 以自然語言描述市場看法 → AI 結構化為可回測情境（無金鑰時規則備援） | 將 RM 的判斷力注入量化流程，而非被動套用模板 |
| **多語系 B2C 介面（i18n）** | 支援英文、繁體中文、韓文，適配數位原生客戶語言偏好 | 客戶共閱報告時降低語言障礙，強化信任 |
| **標的池（Universe）** | 目前約 328 檔 ETF，涵蓋美／歐／亞／新興股票、各類債券、商品、REITs、另類 | POC 快速驗證；量產可擴充至 Julius Baer 基金／結構型產品目錄 |

### 3.3 與模型投資組合（Model Portfolio）的本質差異

| 維度 | 模型投資組合（大型資管） | JASPER AI 超個人化 |
|------|--------------------------|-------------------|
| **設計邏輯** | 機構效率優先，服務成千上萬客戶 | 客戶輪廓優先，每位客戶可獨立策略 |
| **市場觀點** | 總部統一觀點，季度調整 | RM 輸入個別觀點，即時結構化回測 |
| **資產配置** | 固定資產類別權重區間 | 多資產槽位 + 區域子權重動態優化 |
| **市場型態適應** | 靜態或緩慢再平衡 | Regime 自適應，目標函數隨市場切換 |
| **驗證嚴謹度** | 回溯績效為主，樣本外驗證有限 | 預設 70% 訓練 / 30% 樣本外，冠軍須經 OOS 考驗 |
| **敘事能力** | 標準化產品說明書 | AI 生成客製敘事，數字經零幻覺校驗 |
| **迭代速度** | 週／月級調整週期 | 單次工作階段內多回合收斂 + 暖啟動 |
| **RM 角色** | 產品銷售與合規填表 | 策略設計師 + 客戶關係深化 |
| **規模化方式** | 標準化複製 | AI 放大 RM 產能，每位 RM 服務更多客戶而不犧牲品質 |

> **一句話差異化**：模型投資組合回答「這個風險等級的客戶應買什麼」；JASPER 回答「**這位**客戶在**當前**市場環境下，**為什麼**這套配置對他／她最合理」。

---

## 4. RM 工作流轉型：開戶到再平衡

### 4.1 現況（Before JASPER）

```
開戶 → 填寫 KYC / 風險問卷 → 指派模型投資組合 → 年度檢視
         ↓                        ↓                    ↓
    紙本／表單流程            標準化配置              靜態報表 + RM 口頭說明
```

**痛點**：從開戶到首次有意義的個人化對話，可能需數週；市場劇變時 RM 難以即時提供有數據支撐的調整建議。

### 4.2 導入 JASPER 後（After JASPER）

| 階段 | RM 操作 | JASPER 支援 | 客戶體驗提升 |
|------|---------|-------------|-------------|
| **① 開戶（Onboarding）** | 輸入客戶風險等級、流動性需求、ESG 偏好、投資年限 | 自動對應資產類別約束與槽位預算 | 首次會議即有量化輪廓，非空談 |
| **② 需求探索（Discovery）** | 以對話方式了解客戶市場觀點、人生事件（購屋、傳承） | 自訂觀點 → AI 結構化為可回測情境 | 客戶感受到「被理解」，而非被推銷 |
| **③ 組合建構（Construction）** | 選擇標的池範圍、啟動 Pro 多回合優化 | AI 回合種子 + Optuna 搜尋 + 冠軍遴選 | 數分鐘內產出經樣本外驗證的策略候選 |
| **④ 績效監控（Monitoring）** | 定期檢視客戶組合 vs. 策略基準 | Regime 偵測 + 機構級報告（追蹤誤差、回撤事件） | 主動式溝通：「市場進入 risk-off，建議檢視債券曝險」 |
| **⑤ 再平衡（Rebalancing）** | 觸發微調或延續上次 Pro 收斂 | Warm-start 載入冠軍 + Continuation 跨 session | 調整有連續性與審計軌跡，非從零開始 |

### 4.3 工作流示意

```
客戶輪廓 + 市場觀點
        ↓
  JASPER 情境結構化
        ↓
  Pro 多回合優化（AI 種子 → Optuna → 冠軍遴選）
        ↓
  樣本外驗證 + 基準比較
        ↓
  機構級報告 + AI 敘事（零幻覺校驗）
        ↓
  RM 人審 → 客戶簡報 / 數位共閱（i18n）
        ↓
  監控 → Regime 切換 → 暖啟動微調 → 循環
```

---

## 5. 技術架構（高階）

```
┌─────────────────────────────────────────────────────────────┐
│                    RM / 客戶介面層                            │
│   Next.js Web App（對話式精靈｜多語系 EN / 繁中 / 한국어）      │
└─────────────────────────┬───────────────────────────────────┘
                          │ REST API
┌─────────────────────────▼───────────────────────────────────┐
│                    FastAPI 服務層                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │ Job 管理      │  │ Champion     │  │ Continuation     │ │
│  │ 非同步任務    │  │ Registry     │  │ Warm-start       │ │
│  └──────────────┘  └──────────────┘  └──────────────────┘ │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    量化引擎層（Python）                        │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌───────────┐ │
│  │ VectorBT   │ │ Optuna     │ │ Regime     │ │ Asset     │ │
│  │ 組合回測   │ │ 貝葉斯搜尋  │ │ Detection  │ │ Class     │ │
│  │            │ │            │ │ V2         │ │ Slot Plan │ │
│  └────────────┘ └────────────┘ └────────────┘ └───────────┘ │
│  ┌────────────┐ ┌────────────┐ ┌────────────────────────────┐│
│  │ OOS 驗證   │ │ 基準比較   │ │ Institutional Analytics   ││
│  │ 70/30 切分 │ │ TE / IR    │ │ 曝險 / 回撤 / 持股分析     ││
│  └────────────┘ └────────────┘ └────────────────────────────┘│
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    生成式 AI 層（Gemini）                      │
│  回合種子｜市場觀點結構化｜策略敘事｜績效評估                    │
│  ⚠ 僅輸出假設與文字；績效數字由引擎計算並經 narrative_facts 校驗 │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    資料層                                      │
│  ETF Universe（328 檔）｜公開行情｜策略情境設定檔               │
│  [量產] Julius Baer 產品目錄 API 介面（基金／債券／結構型）     │
└─────────────────────────────────────────────────────────────┘
```

**整合設計原則**：

- **API-first**：可嵌入 Julius Baer 現有 CRM、組合管理系統
- **無客戶 PII 進模型**：客戶個資不進入 LLM prompt；僅傳入匿名化約束參數
- **可審計**：每次回測留下完整參數、冠軍紀錄、收斂歷程
- **部署彈性**：Docker Compose 本機 PoC → Vercel + Railway 雲端 → 私有雲

---

## 6. 與 Julius Baer 的試點計畫（Pilot / PoC）

### 6.1 試點目標

在 Hackcelerator 期間，與 Julius Baer 團隊共創一個**可演示、可審計**的 RM Copilot 原型，驗證：

1. RM 能否在 **30 分鐘內** 完成一位模擬高淨值客戶的策略建構與報告產出
2. 超個人化策略的樣本外表現是否優於對應風險等級的模型投資組合基準
3. RM 對 AI 敘事與機構級報告的採用意願與信任度

### 6.2 三階段實施路線

| 階段 | 時間 | 重點工作 | 交付物 |
|------|------|----------|--------|
| **Phase 1：探索與對齊** | 第 1 個月 | 深入理解 Julius Baer RM 工作流、產品目錄結構、合規邊界；定義試點客戶輪廓與基準 | 需求規格書、整合架構圖 |
| **Phase 2：開發與整合** | 第 2 個月 | 產品目錄介面對接（或模擬資料）；RM 專屬 UI 流程；冠軍快取與延續功能驗證 | 可運行原型、API 文件 |
| **Phase 3：測試與迭代** | 第 3 個月 | 邀請 RM 試用、收集回饋、快速迭代；準備 Demo 簡報與 3 分鐘影片 | 試用報告、Demo 腳本、路線圖建議 |

### 6.3 建議試點場景

**場景**：數位原生繼承人（35 歲），風險中等偏積極，關注 ESG 與亞洲曝險，認為未來 12 個月市場震盪加劇。

| 步驟 | RM 操作 | 預期產出 |
|------|---------|----------|
| 1 | 設定資產類別（股 60% / 債 30% / 另類 10%）、ESG 篩選 | 約束面板 |
| 2 | 輸入「亞洲成長放緩、美債殖利率見頂」觀點 | AI 結構化情境 |
| 3 | 啟動 Pro 優化（3 回合、樣本外 30%） | 冠軍策略 + 排行榜 |
| 4 | 檢視機構級報告、AI 敘事 | 客戶簡報草稿 |
| 5 | RM 微調權重、匯出 CSV | 可審計紀錄 |

### 6.4 成功指標（待與 Julius Baer 共定）

| 指標類別 | 方向性目標 |
|----------|-----------|
| **RM 效率** | 策略建構時間從「數天」縮短至「單次會議內」 |
| **建議品質** | 樣本外夏普 ≥ 對應模型投資組合基準 |
| **採用度** | 試用 RM 中 ≥ 70% 願意在客戶會議中使用 JASPER 報告 |
| **客戶體驗** | 試點客戶回饋「感受到個人化」比例提升 |

> ⚠️ 以上為合理推論方向，非財務或轉換率承諾；具體 KPI 待試點啟動後與 Julius Baer 共定。

---

## 7. 團隊與既有成果

### 7.1 TradingValley

自 **2017 年** 起，團隊持續協助台灣金融機構建置 Robo-Advisor 與量化投資基礎設施，深刻理解財富管理產業的營運流程、法規環境與真實痛點。

### 7.2 核心競爭力

| 維度 | 說明 |
|------|------|
| **產業經驗** | 7+ 年財富科技落地經驗，熟悉 RM 工作流與合規審查節奏 |
| **AI × 量化雙棲** | 團隊同時具備生成式 AI 工程與量化交易研究能力，確保方案既智能又穩健 |
| **SFF 歷屆入選** | **2025 年 SFF Global FinTech Hackcelerator 入選**（Growin 財富管理賽道，WinwinGPT RM 智能助手提案） |
| **產品成熟度** | JASPER AI 已具備 MVP v0.3 可演示功能，非從零概念 |

### 7.3 團隊分工

| 角色 | 專長 |
|------|------|
| 產品與場景設計 | 財富管理 UX、RM 訪談、合規溝通 |
| 量化引擎 | VectorBT、Optuna、Regime 偵測、OOS 驗證 |
| 生成式 AI | Gemini 整合、零幻覺校驗、Pro 回合種子 |
| 部署與整合 | Docker、API 設計、CRM 對接 |

---

## 8. 路線圖、合規與免責聲明

### 8.1 產品路線圖

| 階段 | 時間 | 里程碑 |
|------|------|--------|
| **Hackcelerator PoC** | 2026 Q3 | Julius Baer RM Copilot 原型、試點驗證 |
| **產品目錄擴充** | 2026 Q4 | 接入基金、債券、結構型產品 API |
| **CRM 深度整合** | 2027 H1 | 單一登入、客戶檔案同步、審計日誌 |
| **客戶共閱入口** | 2027 H2 | 白標 B2C 介面，客戶可即時檢視組合與報告 |
| **多市場部署** | 2027+ | 支援歐洲、中東、亞洲多時區與監管框架 |

### 8.2 合規設計原則

| 原則 | 實作方式 |
|------|----------|
| **Human-in-the-Loop** | 所有對客建議須經 RM 審核後方可發送；JASPER 為內部工具 |
| **研究與教育定位** | 系統標示「研究與教育用途，不構成投資建議」 |
| **可審計軌跡** | 每次回測保留完整參數、冠軍紀錄、AI 敘事與校驗結果 |
| **資料邊界** | 客戶 PII 不進入 LLM；僅傳入匿名化風險參數 |
| **樣本外驗證** | 預設 70/30 切分，抑制過擬合後才呈現給 RM |
| **參數上限** | Pro 優化僅在宣告邊界內搜尋，防止極端配置 |

### 8.3 免責聲明

> **JASPER AI 智能量化助手僅供研究與教育用途，不構成任何形式之投資建議、要約或招攬。** 所有策略回測結果基於歷史資料，過往績效不代表未來表現。任何投資決策應由合格之關係經理人（RM）依客戶個別情況審慎評估，並遵循當地法規與機構內部合規流程。本提案所述效益為方向性推論，非財務承諾。

---

## 9. 結語：為什麼是我們

84 兆美元的財富轉移，不是危機，而是私人銀行重新定義客戶體驗的契機。數位原生高淨值客戶要的不是另一個模型投資組合，而是**真正理解他們**的顧問——能即時回應市場變化、以數據支撐建議、並用他們的語言溝通。

**JASPER AI** 讓每一位 RM 都具備機構級量化能力，在不增加人力的前提下，將超個人化服務規模化。我們不是在取代 RM，而是在放大他們的專業價值。

我們期待與 **Julius Baer** 攜手，在 SFF Hackcelerator 期間打造一個可演示、可審計、可擴展的 RM Copilot 原型，為私人銀行的下一個世代奠定基礎。

---

**聯絡資訊**  
TradingValley  
[聯絡人姓名 / Email / 電話 — 提交前填入]

---

*文件版本：v1.0｜2026 年 7 月｜SFF Global FinTech Hackcelerator — Julius Baer Track*
