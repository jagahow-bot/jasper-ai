# JASPER AI 系統架構圖

> 由 Cursor agent 依目前程式碼結構自動整理，自由格式。

---

## 1. 整體系統架構

```mermaid
flowchart TB
    subgraph User["使用者層"]
        Browser["Browser (RM / 客戶)"]
    end

    subgraph Web["Web 層 (apps/web)"]
        NextJS["Next.js 15 + React"]
        Components["UI Components<br/>Anchor / Overlay / Constraints / Report"]
        BFF["Next.js BFF<br/>/api/* (Gemini 3.6 Flash + Kimi K3) + /quant-api/* (Proxy)"]
    end

    subgraph API["量化引擎層 (apps/api)"]
        FastAPI["FastAPI + uvicorn"]
        Router["Routers: jobs / scenarios / universe / lab"]
        Engine["Quant Engine"]
    end

    subgraph QuantCore["量化核心 (apps/api/app/engine)"]
        Optimizer["Optuna Optimizer"]
        Portfolio["Portfolio Simulator"]
        Allocator["Weight Allocator"]
        Factors["Factor Scoring"]
        Analytics["Institutional Analytics"]
        Refinement["Pro Refinement"]
    end

    subgraph Data["資料與快取層"]
        Shared["shared/*.json<br/>ETF universe / model portfolios / demo clients"]
        Parquet["bundled_prices / .cache/prices/*.parquet"]
        SQLite["champions.db (SQLite)"]
        JobJSON[".cache/jobs/*.json"]
        LocalStorage["Browser localStorage (PoC)"]
    end

    subgraph LLM["AI 層"]
        Gemini["Google Gemini 3.6 Flash<br/>結構化 / 常規 AI 呼叫"]
        Kimi["Moonshot Kimi K3<br/>overlay / narrate / candidate-summary"]
        Fallback["Rules Fallbacks<br/>overlay / universe / scenario"]
    end

    subgraph External["外部服務"]
        YF["yfinance"]
        SMTP["SMTP (optional)"]
    end

    Browser --> NextJS
    NextJS --> Components
    Components --> BFF
    BFF -->|BacktestRequest| FastAPI
    FastAPI --> Router
    Router --> Engine
    Engine --> QuantCore

    Engine --> Data
    QuantCore --> Data

    BFF -->|NL prompts| Gemini
    BFF -->|NL prompts| Kimi
    FastAPI -->|param seeds / universe refine| Gemini
    Kimi -->|structured JSON / prose| BFF
    Gemini -->|structured JSON| BFF
    Gemini --> Fallback
    Kimi --> Fallback

    Engine -->|fetch prices| YF
    FastAPI -->|notify| SMTP
```

---

## 2. 典型 RM 使用流程資料流

```mermaid
sequenceDiagram
    participant RM as RM
    participant Client as Client Dashboard<br/>clients/[id]/page.tsx
    participant Wizard as Main Wizard<br/>page.tsx
    participant Overlay as Overlay AI<br/>/api/overlay/interpret
    participant Quant as FastAPI<br/>/quant-api/jobs
    participant Report as RmReportView

    RM->>Client: 查看客戶現況持倉
    Client->>Wizard: 啟動客製化 (anchor + groups)
    RM->>Wizard: 選擇目標 Model Portfolio
    RM->>Wizard: 選擇客製化範圍 (holding groups)

    RM->>Overlay: 輸入自然語言需求
    Overlay->>Overlay: Gemini 3.6 Flash 萃取 ClientOverlay JSON<br/>Kimi K3 用於 overlay / narrate / candidate-summary
    Overlay->>Wizard: 返回結構化需求 + 標的增減

    RM->>Wizard: 確認約束條件 (dates / objective / trials)
    Wizard->>Quant: 1. 發送 Anchor 回測 (static replay)
    Quant-->>Wizard: Job progress
    Wizard->>Quant: 2. 發送 Customized 回測 (Optuna)
    Quant-->>Wizard: Job progress

    Wizard->>Report: 顯示雙軌報告
    Report->>Overlay: /api/narrate 生成敘事
    Overlay-->>Report: 經過驗證的 prose
    RM->>Report: 檢視 benchmark vs customized、提案書
```

---

## 3. 量化引擎內部流程

```mermaid
flowchart LR
    A[BacktestRequest] --> B[Universe Resolution]
    B --> C[Fetch Prices<br/>bundled parquet + yfinance]
    C --> D{Mode}
    D -->|standard| E[Optuna Search]
    D -->|pro_auto| F[Iterative Refinement]
    E --> G[Per-trial Portfolio Construction]
    F --> G
    G --> H[Factor Scoring]
    H --> I[Allocator Weight Solve]
    I --> J[Portfolio Simulation]
    J --> K[Objective Scoring]
    K --> L[OOS Validation 70/30]
    L --> M[Analytics + Narrative Facts]
    M --> N[BacktestResult]
```

---

## 4. 技術棧對照

| 層級 | 技術 | 負責內容 |
|---|---|---|
| 前端 | Next.js 15, React, Tailwind, Recharts | UI wizard、圖表、i18n |
| BFF | Next.js Route Handlers | Gemini 3.6 Flash + Kimi K3 路由、API Proxy |
| 後端 | FastAPI + uvicorn | 回測任務、進度、資料 API |
| 量化 | Optuna, pandas, numpy | 優化、模擬、配置 |
| AI | Google Gemini 3.6 Flash + Moonshot Kimi K3 | 3.6 Flash 負責結構化萃取、常規參數建議；Kimi K3 負責 overlay / narrate / candidate-summary 等高價值推理 |
| 資料 | SQLite, Parquet, JSON | 冠軍註冊、價格快取、靜態資料 |
| 外部 | yfinance, SMTP | 市場資料、郵件通知 |

---

## 5. 混合模型配置 (Hybrid Model Assignment)

系統目前採用雙模型策略，依任務特性分派最適合的 LLM：

- **Kimi K3**（Moonshot）：用於高價值推理任務，例如 `overlay` 自然語言理解、`narrate` 敘事生成、`candidate-summary` 候選組合摘要。這類任務需要更強的語意理解與生成品質。
- **Gemini 3.6 Flash**（Google）：用於結構化、可重複且對延遲敏感的常規 AI 呼叫，例如 `ClientOverlay` JSON 萃取、參數建議、universe refinement 等。這類任務需要穩定的 JSON 輸出與較低成本。
- 兩者皆受相同的 Rules Fallback 與 `validateNarrative()` 檢查約束，確保數學指標仍由量化引擎產生，不會由 LLM 幻覺推導。

---

## 6. 設計原則

> **數學引擎算數字，LLM 只寫敘事。**

- Gemini 不直接計算報酬、權重、風險指標
- 所有數字由 Python 量化引擎產生
- LLM 僅用於自然語言理解、敘事生成、參數建議
- 產出前經過 `validateNarrative()` 零幻覺檢查
