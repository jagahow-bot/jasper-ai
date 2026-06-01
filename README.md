# AI Quant Assistant

Chat-and-Click 量化策略助手（MVP v0.1）。架構原則：**數學引擎算數字，LLM 只寫敘事**。

## 專案結構

```
ai-quant-assistant/
├── apps/
│   ├── web/          # Next.js 前端 + 內建 fallback API
│   └── api/          # FastAPI 量化引擎（建議安裝 Python 3.11+）
├── shared/
│   └── strategy-profiles.json   # 市場情境卡片與 ETF universe
└── .env.example
```

## 快速啟動（一鍵：前端 + Python 後端）

在**專案根目錄**執行：

```powershell
cd C:\Users\jaga1\Projects\ai-quant-assistant
copy .env.example apps\web\.env.local
npm run dev
```

會同時啟動：

| 服務 | 網址 |
|------|------|
| Next.js 前端 | http://localhost:3000（若占用則為 3001） |
| FastAPI 後端 | http://localhost:8001 |

建議在 `apps\web\.env.local` 設定：

```
NEXT_PUBLIC_API_URL=http://localhost:8001
GOOGLE_GENERATIVE_AI_API_KEY=你的_Gemini_Key
GEMINI_MODEL=gemini-3.5-flash
GEMINI_MAX_OUTPUT_TOKENS=4096
```

Python 後端請在 `apps\api\.env` 設定相同 `GEMINI_MODEL` 與 `GEMINI_MAX_OUTPUT_TOKENS`（修改後需重啟 API）。Pro 參數種子另可調 `GEMINI_PARAM_SEED_MAX_RETRIES`（預設 3）、`GEMINI_LEARNING_CONTEXT_MODE`（`ultra|standard|full|auto`）、`GEMINI_THINKING_LEVEL`（預設 `off`；`full` 情境下可用 `GEMINI_THINKING_LEVEL_FULL=low` 啟用較深思考）。`GEMINI_THINKING_LEVEL` 非 `off` 時，Pro round seed 會在 `generationConfig.thinkingConfig` 送出 `thinkingLevel`（gemini-3.x / gemini-2.5 模型字串匹配即可，含 `gemini-3-flash-preview`）；與 JSON `responseMimeType` 可並存。Google AI Studio 日誌有時不顯示 `thinkingConfig` 或獨立 thinking token，且手動在 Studio 重放請求若未帶該欄位也會看起來「沒有思考」——請以 API 回傳的 `thinking_level` / `thinking_config` 或重啟後的實際請求為準。

### 只啟動單一服務

```powershell
npm run dev:web    # 僅前端
npm run api:dev    # 僅 Python 後端
```

- 若未設定 `GOOGLE_GENERATIVE_AI_API_KEY`，敘事報告會使用模板文字。
- 僅開前端時，回測會自動改用 Next.js 內建 fallback 引擎。

## Python 後端（首次設定）

若尚未建立虛擬環境：

```powershell
cd apps\api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## ETF 標的池

- 主設定檔：`shared/etf-universe.json`（目前 **328** 檔，含細分 `category`）
- 前端 bundle 使用：`apps/web/src/data/etf-universe.json`（修改主檔後請執行 `npm run sync-universe`）
- 資產類別：股票（美/歐/亞/新興）、債券（公債/信用/高收益/市政/TIPS）、商品、REITs、另類
- API：`GET /universe`（後端）或 `GET /api/universe`（前端 fallback）

## MVP v0.3（Phase A）已包含

- **Optuna**：貝葉斯搜尋取代純隨機試權重
- **VectorBT**：標準化組合回測（失敗時自動 fallback pandas）
- **樣本外驗證**：預設 70% 訓練 / 30% 驗證，結果區分 in-sample / OOS
- **回測規格**：10 bps 手續費、季再平衡、SPY 基準、4% 無風險利率
- **零幻覺校驗**：Gemini 敘事自動比對 `narrative_facts` 數字

## MVP v0.2（Phase B）已包含

- **自訂市場觀點**：文字描述 → Gemini 結構化情境（無 Key 時用規則 fallback）
- **標的池篩選**：依資產類別（股/債/商品/房地產/另類）縮小 universe
- **快速微調**：結果頁一鍵調參數，↻ 立即重跑

## MVP v0.1 已包含

- Phase 1–2：四種市場情境卡片 + 參數面板（靜態回測、Sharpe / MaxDD 目標）
- Phase 3：非同步 job + 進度條
- Phase 4：Top 3 組合、績效圖、權重圓餅圖、效率前緣採樣點、LLM/模板敘事
- Phase 5：CSV 匯出、返回微調

## 下一步（v0.2+）

- Optuna 正式接入、VectorBT 向量化回測
- Firebase session 持久化
- 專業 PDF 報告
- Regime / 動態滾動回測

## 上線部署

生產環境（Docker Compose / Vercel + Railway）步驟見 **[DEPLOY.md](./DEPLOY.md)**。複製 `.env.production.example` 為 `.env.production` 並填入 `GEMINI_API_KEY`。

## 免責聲明

本工具僅供研究與教育用途，不構成投資建議。
