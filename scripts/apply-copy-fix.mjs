import fs from "node:fs";
import path from "node:path";

const file = path.join(
  process.cwd(),
  "apps/web/src/lib/i18n.tsx",
);
let s = fs.readFileSync(file, "utf8");

/** @type {[string, string][]} */
const pairs = [
  // ── EN: A class ──
  [
    "We load extra price history before this date so your day-one positions are based on real signals, not a placeholder.",
    "Extra price history before this date is included, so day-one positions start from reliable signals.",
  ],
  [
    "Projections run on the server, so you can close this tab. If you enter an email, we'll notify you when the run finishes or fails.",
    "You can close this tab while it runs — we'll email you when it finishes or fails.",
  ],
  [
    "None of the proposals beat {benchmark} on the selected goal over this window. That's a real result, not a failure of the tool — you can keep refining from this run: adjust the signals, constraints, candidate list, or goal and re-run without starting over.",
    "None of the proposals beat {benchmark} on the selected goal over this window. You can keep refining from this run — adjust the signals, constraints, candidate list, or goal and re-run without starting over.",
  ],
  [
    "How many proposals to test. In standard mode every candidate uses an AI-generated starting proposal (no random filler). Set the report size below.",
    "How many proposals to test. Each one starts from AI-suggested parameters. Set the report size below.",
  ],
  [
    "Jasper Pro Search: OFF (single pass — all candidates use AI-generated starting proposals)",
    "Pro optimization: OFF (single round — faster)",
  ],
  [
    "Jasper Pro Search: ON (multi-round AI optimization)",
    "Pro optimization: ON (multi-round AI search)",
  ],
  [
    "AI done: {used} starting proposal sets for {trials} proposals (AI capped at {cap}; extra proposals are search-only) — starting projections…",
    "AI prepared {used} starting proposals — starting projections…",
  ],
  [
    "AI ready: {used} starting proposals for {trials} candidates — running projections…",
    "AI prepared {used} starting proposals — starting projections…",
  ],
  [
    "Preparing {code} ({rank}/{total}): one full-period projection for weights…",
    "Preparing {code} ({rank}/{total})…",
  ],
  [
    "Preparing {code} ({rank}/{total}): rebuilding chart series ({missing})…",
    "Preparing {code} ({rank}/{total})…",
  ],
  [
    "Preparing {code} metrics ({rank}/{total})…",
    "Preparing {code} ({rank}/{total})…",
  ],
  [
    "Preparing {code} {label}  ({rank}/{total})…",
    "Preparing {code} ({rank}/{total})…",
  ],
  [
    "Jasper builds your portfolio from everything in the asset classes you pick, choosing the best holdings at each rebalance.",
    "Your portfolio is built from the asset classes you pick and adjusted at each rebalance.",
  ],
  [
    "Soft targets — engine tries; results show target vs actual",
    "Soft targets — results show target vs actual; missing one is not a failure",
  ],
  [
    "Return fields auto-filled from holdings backcast (回推: monthly rebalanced current mix) — editable.",
    "Return fields are pre-filled from your current holdings' past performance — editable.",
  ],
  [
    "holdings backcast (回推: monthly rebalanced target mix)",
    "past performance of the target holdings",
  ],
  [
    "Holdings backcast unavailable — using the engine backtest curve instead.",
    "Holdings performance unavailable — using the portfolio projection instead.",
  ],
  [
    "Figures come from the engine dual-track projection (anchor vs customized), not generative AI invention. Past performance is not a reliable guide to future performance.",
    "All figures are computed from historical data and can be traced and reproduced. Past performance is not a reliable guide to future performance.",
  ],

  // ── EN: B / D / E / G / terminology ──
  [
    "★ is chosen on the selection horizon (training-period when validation holdout is on; otherwise full-period). Full-period metrics in the report grid can differ — a higher Full Sharpe does not demote the training-period goal winner. Training-period / validation-period gap is diagnostic only.",
    "★ is chosen on the training period (or the full period when validation is off); full-period metrics are for reference only.",
  ],
  [
    "Scores each contiguous active-regime episode by benchmark behavior from switch-in until the label changes: risk-on if return > 0; risk-off if segment annualized vol ≥ 1.15× the lab episode-vol median; neutral relative to the prior episode — after risk-on, return ≤ 0 or below the prior risk-on segment return; after risk-off, segment vol below the prior risk-off segment; otherwise |return| ≤ 3%. Return and drawdown are shown for context. Unlike a fixed 21-day forward window per step, this does not replace the Sharpe A/B test.",
    "Scores how well each predicted market regime matches what the benchmark actually did during that regime. For reference only — does not affect proposal ranking.",
  ],
  [
    "Hits: risk-on (return > 0), risk-off (segment vol ≥ 1.15× episode-vol median), neutral (weakened after risk-on, calmer vol after risk-off, else |return| ≤ 3%). Largest misses are ranked by return shortfall (risk-on), vol shortfall (risk-off), or continued strength / insufficient vol drop (neutral).",
    "Largest misses: regime episodes where the benchmark moved most against the prediction.",
  ],
  [
    "Dynamic adapts the portfolio to the market regime — defensive when risk is high, growth-seeking when conditions are strong, balanced in between. Top picks are ranked on one blended composite score (risk-adjusted return + growth + drawdown + trading cost), not a single metric. To be judged purely on one goal such as Max CAGR while still switching by regime, pick that goal and turn on Regime-adaptive allocation below.",
    "Dynamic shifts the portfolio by market regime — defensive when risk is high, growth-seeking when conditions are strong. Proposals are ranked on one blended score. To rank on a single goal instead, pick that goal and turn on Regime-adaptive allocation below.",
  ],
  [
    "Overlay interpretation failed: AI is temporarily unavailable. Please try again.",
    "Couldn't interpret the request. Please try again.",
  ],
  [
    "Overlay interpretation failed: AI response could not be parsed. Please try again.",
    "Couldn't interpret the request. Please try again.",
  ],
  [
    "Overlay interpretation failed: AI response did not match the expected schema. Please try again.",
    "Couldn't interpret the request. Please try again.",
  ],
  [
    "Overlay interpretation failed: AI returned an unusable response. Please try again.",
    "Couldn't interpret the request. Please try again.",
  ],
  [
    "Overlay interpretation is unavailable: AI API key is not configured.",
    "AI interpretation is not available — the AI API key is not configured. Ask an administrator to set it up in Settings.",
  ],
  [
    "Overlay interpretation failed. Please try again or contact support.",
    "Couldn't interpret the request. Please try again or contact support.",
  ],
  [
    "Candidate selection uses Training period when holdout is on. Training period and Validation period rows are slices of the same continuous Full projection; they are not separate fresh-start runs. Ranked Sharpe on the dashboard may differ slightly from these rows.",
    "Training and validation rows are slices of the same continuous projection, not separate runs.",
  ],
  [
    "Full OHLCV / close price panel is not stored on the job result. Provenance above comes from data_quality meta. There is no public prices API for on-page multi-ticker preview yet.",
    "Full price history is not stored with this result; the summary above shows the data sources used.",
  ],
  [
    "Weight history is not on this payload yet (may load lazily with charts elsewhere).",
    "This result does not include weight history.",
  ],
  [
    "Signed adjustment audit and client_context forwarded on the request",
    "Signed adjustment audit and client context sent with the request",
  ],
  [
    "client_context JSON",
    "Client context (JSON)",
  ],
  [
    "Full narrative_facts JSON",
    "Full summary data (JSON)",
  ],
  [
    "Email alerts are not enabled on this server (SMTP not configured). You won't receive a message even if you enter an address.",
    "Email notifications are not enabled in this environment.",
  ],
  [
    "Rules fallback",
    "Rule-based estimate",
  ],
  [
    "Job identity, window, objective, and champion",
    "Run ID, window, objective, and recommended proposal",
  ],
  [
    "Champion model",
    "Recommended proposal",
  ],
  [
    "Champion params; Pro rounds / scenarios when present",
    "Recommended proposal's parameters; Pro rounds / scenarios when present",
  ],
  [
    "No champion params on this result.",
    "No parameters stored for the recommended proposal on this result.",
  ],
  [
    "Final champion weights and weight-history summary",
    "Final weights of the recommended proposal and weight-history summary",
  ],
  [
    "On-page audit trail for this run — summaries and tables from the job request and result. Large series are paginated; the full multi-ticker price panel is not embedded in the result.",
    "Audit trail for this run — key fields from the request and result.",
  ],
  [
    "Weights are end-of-period allocator holdings (2 d.p.). Near-equal splits usually mean the single-name cap is incompatible with max holdings or class sleeves (e.g. 8% cap with only 8 names needs ≥13 names) — raise max weight, raise max holdings, or loosen class budgets.",
    "Weights are end-of-period values (2 d.p.). Near-equal splits usually mean the single-name cap conflicts with max holdings or asset-class budgets — raise the cap, allow more holdings, or loosen class budgets.",
  ],
  [
    "Drawdown depth, recency of peak, or ulcer-style pain index",
    "Drawdown depth, time since peak, or pain index",
  ],
  [
    "ulcer index",
    "pain index",
  ],
  [
    "Ask evidence",
    "Requirement evidence",
  ],
  [
    "Target vs actual for each signed Ask card — gaps are shown honestly.",
    "Target vs actual for each signed requirement — gaps are shown as-is.",
  ],
  [
    "Asks are soft targets. The job still succeeds when a band is missed; use this ledger in the client conversation.",
    "Requirements are soft targets — a missed band does not fail the run. Use this ledger in the client conversation.",
  ],
  [
    "Calendar-year portfolio returns used for planning bands (winsorize / average cap). Extreme years are the outliers damped in the goal path.",
    "Calendar-year portfolio returns used for planning bands. Extreme years are damped (capped at the sample average) in the goal path.",
  ],
  [
    "Global product shelf",
    "Global product list",
  ],
  [
    "Import or export the global product shelf CSV.",
    "Import or export the global product list CSV.",
  ],
  [
    "Patience (rounds)",
    "Early-stop patience (rounds)",
  ],
  [
    "Strategy engine connected",
    "Analytics engine connected",
  ],
  [
    "Run smart multi-round optimization",
    "Run Pro optimization",
  ],
  [
    "Pro · AI optimization",
    "Pro optimization",
  ],
  [
    "Jasper Pro Search",
    "Pro optimization",
  ],
  [
    "Tip: turn on a holdout so proposals are ranked on the optimization period, then checked on unseen data.",
    "Tip: turn on a holdout so proposals are ranked on the training period, then checked on unseen data.",
  ],
  [
    "Pro: proposals are ranked on the optimization period; the holdout is used for final checks…",
    "Pro: proposals are ranked on the training period; the holdout is used for final checks…",
  ],
  [
    "With a holdout turned on, proposals are ranked on the optimization period; the holdout and full-period results are shown for comparison only.",
    "With a holdout turned on, proposals are ranked on the training period; the holdout and full-period results are shown for comparison only.",
  ],
  [
    "No regime scores yet. Try the newer detector or a longer optimization period.",
    "No regime scores yet. Try the newer detector or a longer training period.",
  ],
  [
    "Top pick for this backtest vs",
    "Top pick of this run vs",
  ],
  [
    "Key fields from the submitted backtest request",
    "Key fields from the submitted projection request",
  ],
  [
    "Backtest mode",
    "Projection mode",
  ],
  [
    "Turn this projection's AI top-recommended portfolio into an Investment Proposal",
    "Turn this run's top-recommended portfolio into an Investment Proposal",
  ],
  [
    "Working draft only. JASPER does not place trades. Formal client documents still require RM and compliance review.",
    "Working draft only. Jasper does not place trades. Formal client documents still require RM and compliance review.",
  ],
  [
    "Suitability, KYC, and product approval remain bank-controlled processes; JASPER does not certify regulatory fitness.",
    "Suitability, KYC, and product approval remain bank-controlled processes; Jasper does not certify regulatory fitness.",
  ],
  [
    "Next steps: RM review → compliance / suitability check → client discussion → implementation instructions (outside JASPER).",
    "Next steps: RM review → compliance / suitability check → client discussion → implementation instructions (outside Jasper).",
  ],
  [
    "Your completed projections show up here. Run one to get started.",
    "Completed projections show up here after you run one.",
  ],
  [
    "Address “{title}” — {hooks}",
    "Address \"{title}\" — {hooks}",
  ],
  [
    "Pro mode manages the search effort for you. It will run up to about",
    "Pro mode manages the search effort for you. It will run up to about",
  ],
  [
    "projections, and may finish early once results stop improving.",
    "projections, and may finish early once results stop improving.",
  ],

  // ── ZH ──
  [
    "在下方設定你的方案。每次組合檢視時，Jasper 會挑出表現最強的標的，再分配權重以兼顧風險與報酬。",
    "在下方設定你的方案。每次再平衡時，Jasper 會挑出表現最強的標的，再分配權重以兼顧風險與報酬。",
  ],
  [
    "每次組合檢視時，低於此比重的部位會被調整，釋出的資金會分配到其餘持股。",
    "每次再平衡時，低於此比重的部位會被調整，釋出的資金會分配到其餘持股。",
  ],
  [
    "限制 Jasper 每次組合檢視能調動的部位比例，有助於控制交易成本。",
    "限制 Jasper 每次再平衡能調動的部位比例，有助於控制交易成本。",
  ],
  [
    "組合檢視頻率",
    "再平衡頻率",
  ],
  [
    "我們會載入此日期前的額外歷史價格，讓第一天的部位以真實訊號為依據，而非暫用的預設值。",
    "系統會額外載入開始日之前的行情，確保第一天就有可靠訊號。",
  ],
  [
    "執行方案測試",
    "執行試算",
  ],
  [
    "執行 Pro 搜尋",
    "執行 Pro 最佳化",
  ],
  [
    "方案測試在伺服器端執行，你可以關閉此分頁。若填入電子郵件，測試完成或失敗時我們會通知你。",
    "試算期間可以關閉此分頁——完成或失敗時會寄信通知你。",
  ],
  [
    "此伺服器尚未設定郵件（SMTP），即使填了信箱也不會收到通知。",
    "此環境未開放郵件通知。",
  ],
  [
    "客觀結果：本次測試未能勝過基準",
    "客觀解讀：本次試算未勝過基準",
  ],
  [
    "在此區間內，沒有任何一組試算在所選目標上勝過 {benchmark}。這是真實的結果，並非工具的問題——你可以從本次執行繼續調整：調整訊號、限制條件、標的池或目標後重新執行，無需從頭開始。",
    "在此區間內，沒有任何方案在所選目標上勝過 {benchmark}。可直接從本次結果調整訊號、限制、標的池或目標後再跑，不必重頭開始。",
  ],
  [
    "Pro · AI 最佳化",
    "Pro 最佳化",
  ],
  [
    "耐心輪數",
    "提前停止容忍輪數",
  ],
  [
    "提示：開啟保留資料，方案會先以最佳化期間排名，再用未看過的資料驗證。",
    "提示：開啟保留資料，方案會先以訓練期排名，再用未看過的資料驗證。",
  ],
  [
    "方案測試排隊中…",
    "試算排隊中…",
  ],
  [
    "Pro 搜尋排隊中…",
    "Pro 最佳化排隊中…",
  ],
  [
    "方案測試完成",
    "試算完成",
  ],
  [
    "Pro 搜尋完成",
    "Pro 最佳化完成",
  ],
  [
    "Pro：方案以最佳化期間排名；保留資料用於最終驗證…",
    "Pro：方案以訓練期排名；保留資料用於最終驗證…",
  ],
  [
    "AI 完成：{trials} 種方案的 {used} 組初始參數（AI 上限 {cap}；其餘方案僅用搜尋）— 開始試算…",
    "AI 已備妥 {used} 組起始方案，開始試算…",
  ],
  [
    "AI 完成：{trials} 種方案的 {used} 組初始參數 — 開始試算…",
    "AI 已備妥 {used} 組起始方案，開始試算…",
  ],
  [
    "整理中 {code}（{rank}/{total}）：以完整期間試算一次以取得權重…",
    "正在準備 {code}（{rank}/{total}）…",
  ],
  [
    "整理中 {code}（{rank}/{total}）：補齊圖表序列（{missing}）…",
    "正在準備 {code}（{rank}/{total}）…",
  ],
  [
    "整理中 {code}（僅指標）（{rank}/{total}）…",
    "正在準備 {code}（{rank}/{total}）…",
  ],
  [
    "整理中 {code} {label}（{rank}/{total}）…",
    "正在準備 {code}（{rank}/{total}）…",
  ],
  [
    "整理中 {code}（{rank}/{total}）：重新計算圖表資料…",
    "正在準備 {code}（{rank}/{total}）…",
  ],
  [
    "Jasper 會從你選取的資產類別中所有標的建構投資組合，並在每次再平衡時挑出最佳持股。",
    "投組會從你勾選的類別中自動產生，並在每次再平衡時調整。",
  ],
  [
    "尚無市場狀態分數。請改用較新的偵測器，或拉長最佳化期間。",
    "尚無市場狀態分數。請改用較新的偵測器，或拉長訓練期。",
  ],
  [
    "Pro 優化",
    "Pro 最佳化",
  ],
  [
    "排行榜 · 依驗證期期間為方案排名",
    "排行榜 · 依驗證期為方案排名",
  ],
  [
    "排行榜 · 依全期間期間為方案排名",
    "排行榜 · 依完整期間為方案排名",
  ],
  [
    "貼近錨定",
    "貼近基準",
  ],
  [
    "相對錨定組合偏離 {actual}（上限 {cap}）",
    "相對基準組合偏離 {actual}（上限 {cap}）",
  ],
  [
    "★ 依挑選期間選定（啟用 驗證期保留段時為訓練期；否則為完整期間）。報告格的完整期間指標可能不同——更高的完整期間夏普不會讓訓練期投資目標勝出者落敗。訓練期／驗證期差距僅供診斷。",
    "★ 依訓練期表現選出（未開驗證時則依完整期間）；完整期間指標僅供參考。",
  ],
  [
    "在投資目標「{objective}」下，{code} 於完整期間期間勝出（夏普 {sharpe}、年化 {cagr}、最大回撤 {mdd}）。",
    "在投資目標「{objective}」下，{code} 於完整期間勝出（夏普 {sharpe}、年化 {cagr}、最大回撤 {mdd}）。",
  ],
  [
    "基準組合模型組合：{anchor}。績效基準代碼（價格序列）：{ticker} — 圖表是與該代碼報酬比較，並非複製基準組合的每一檔持股。",
    "基準模型組合：{anchor}。績效比較代碼：{ticker}——圖表與該代碼的報酬比較，並非複製基準組合的每檔持股。",
  ],
  [
    "比較基準：基準組合模型組合（{anchor}）的基準重播績效，而非僅市場代碼。",
    "比較基準：基準模型組合（{anchor}）的固定權重試算績效，而非僅市場代碼。",
  ],
  [
    "本次客製化在客戶既定的持倉宇宙上，比較幾個具名優化情境（{styles}），而非大規模隨機搜尋。",
    "本次客製化在客戶既定的持倉標的池上，比較幾個具名優化情境（{styles}），而非大規模隨機搜尋。",
  ],
  [
    "本次回測的頁內審計軌跡——來自工作請求與結果的摘要與表格。大型序列已分頁；完整多標的價格面板未嵌入結果。",
    "本次試算的審計軌跡——來自請求與結果的關鍵欄位與摘要。",
  ],
  [
    "工作識別、區間、目標與冠軍模型",
    "執行識別、區間、目標與建議方案",
  ],
  [
    "冠軍模型",
    "建議方案",
  ],
  [
    "回測模式",
    "試算模式",
  ],
  [
    "送出回測請求中的關鍵欄位",
    "送出試算請求中的關鍵欄位",
  ],
  [
    "冠軍參數；若有 Pro 輪次／情境可展開",
    "建議方案參數；若有 Pro 輪次／情境可展開",
  ],
  [
    "此結果沒有冠軍參數。",
    "此結果未含建議方案參數。",
  ],
  [
    "冠軍最終權重與權重歷史摘要",
    "建議方案最終權重與權重歷史摘要",
  ],
  [
    "完整 OHLCV／收盤價面板未存放於工作結果。上方來源來自 data_quality 中繼資料。目前尚無公開價格 API 供頁內多標的預覽。",
    "完整價格明細未隨結果儲存；上方為資料來源摘要。",
  ],
  [
    "此結果載荷尚無權重歷史（可能在其他處以圖表延遲載入）。",
    "此結果未含權重歷史。",
  ],
  [
    "已簽核調整方案審計與請求上的 client_context",
    "已簽核調整方案審計與隨請求送出的客戶脈絡",
  ],
  [
    "完整 narrative_facts JSON",
    "完整摘要資料（JSON）",
  ],
  [
    "錨點投組",
    "基準組合",
  ],
  [
    "錨點工作",
    "基準試算",
  ],
  [
    "AI 結論、建議方案模型與關鍵指標",
    "AI 結論、建議方案與關鍵指標",
  ],
  [
    "開啟保留資料後，方案會以最佳化期間排名；保留期與完整期間的結果僅供比較參考。",
    "開啟保留資料後，方案會以訓練期排名；保留期與完整期間的結果僅供比較參考。",
  ],
  [
    "要測試多少種方案。標準模式下每個試驗都使用 AI 產生的初始方案（不混入隨機探索）。報告數量請在下方設定。",
    "要測試的方案數量；每個方案都由 AI 給出起始參數。報告顯示數量在下方設定。",
  ],
  [
    "回撤深度、距前高時間，或潰瘍痛苦指數",
    "回撤深度、距前高時間，或痛苦指數",
  ],
  [
    "潰瘍指數",
    "痛苦指數",
  ],
  [
    "宇宙與篩選",
    "標的池與篩選",
  ],
  [
    "基準配置",
    "基準組合",
  ],
  [
    "解讀失敗：AI 暫時無法使用，請稍後再試。",
    "需求解讀失敗，請再試一次。",
  ],
  [
    "解讀失敗：AI 回應無法解析，請再試一次。",
    "需求解讀失敗，請再試一次。",
  ],
  [
    "解讀失敗：AI 回應格式不符預期，請再試一次。",
    "需求解讀失敗，請再試一次。",
  ],
  [
    "解讀失敗：AI 回應無法使用，請再試一次。",
    "需求解讀失敗，請再試一次。",
  ],
  [
    "無法解讀客戶需求：尚未設定 AI API 金鑰。",
    "AI 解讀尚未開放——請管理者先到設定頁設定 AI API 金鑰。",
  ],
  [
    "客戶需求解讀失敗，請稍後再試或聯絡支援。",
    "需求解讀失敗，請再試一次或聯絡支援。",
  ],
  [
    "軟目標：引擎盡力達成，結果對照目標與實際",
    "軟目標：結果會並列目標與實際值，未達標不視為失敗",
  ],
  [
    "您：",
    "你：",
  ],
  [
    "JASPER：",
    "Jasper：",
  ],
  [
    "一鍵執行",
    "執行",
  ],
  [
    "Jasper Pro Search：關閉（單次通過 — 所有試驗皆使用 AI 初始方案）",
    "Pro 最佳化：關閉（單輪試算，較快完成）",
  ],
  [
    "Jasper Pro Search：開啟（多輪 AI 最佳化）",
    "Pro 最佳化：開啟（多輪 AI 搜尋）",
  ],
  [
    "本次回測的首選投組，相對「{anchor}」",
    "本次試算的首選投組，相對「{anchor}」",
  ],
  [
    "這次回測有沒有守住調整方案簽核的承諾？",
    "這次試算有沒有守住調整方案簽核的承諾？",
  ],
  [
    "Ask 證據",
    "需求證據",
  ],
  [
    "每張簽核 Ask 的目標 vs 實際——落差會如實呈現。",
    "每張簽核需求的目標 vs 實際——落差會如實呈現。",
  ],
  [
    "Ask 為軟目標。區間未達標不會讓工作失敗；請以此對照表與客戶溝通。",
    "需求為軟目標，未達標不影響試算完成；請以此對照表與客戶溝通。",
  ],
  [
    "權重為期末配置（顯示至小數點後兩位）。接近等權通常代表單檔上限與持股數／資產類別袖口不相容（例如上限 8% 但只持 8 檔，需 ≥13 檔才可行）— 請提高單檔上限、增加持股數，或放寬類別預算。",
    "權重為期末配置（顯示至小數點後兩位）。接近等權通常代表單檔上限與持股數或類別配置不相容——請提高單檔上限、增加持股數，或放寬類別預算。",
  ],
  [
    "將本次試算 AI 最推薦投組製作成投資建議書",
    "將本次最推薦的投組產出為投資建議書",
  ],
  [
    "僅為執行草案。JASPER 不下單。正式對客文件仍須 RM／合規審核。",
    "僅為執行草案。Jasper 不下單。正式對客文件仍須 RM／合規審核。",
  ],
  [
    "適配性、KYC 與產品核准仍為銀行可控流程；JASPER 不對法規適配出具認證。",
    "適配性、KYC 與產品核准仍為銀行可控流程；Jasper 不對法規適配出具認證。",
  ],
  [
    "下一步：RM 審閱 → 合規／適配檢查 → 客戶討論 → 執行指示（於 JASPER 外完成）。",
    "下一步：RM 審閱 → 合規／適配檢查 → 客戶討論 → 執行指示（於 Jasper 外完成）。",
  ],
  [
    "起點（基準組合模型組合）：{anchor}",
    "起點（基準模型組合）：{anchor}",
  ],
  [
    "基準組合模型組合：{am} · {theme}（風險帶：{risk}）。此為資產管理公司主題產品起點。",
    "基準模型組合：{am} · {theme}（風險帶：{risk}）",
  ],
  [
    "…以 {am} · {theme} 為模型組合基準組合。",
    "…以 {am} · {theme} 為基準模型組合。",
  ],
  [
    "數字來自引擎雙軌試算（基準組合 vs 客製化），非 AI 編造。過往績效並非未來表現之可靠指引。",
    "所有數字皆來自歷史資料試算，可追溯、可重現。過往績效並非未來表現之可靠指引。",
  ],
  [
    "生成 Investment Proposal",
    "產出投資建議書",
  ],
  [
    "Investment Proposal（草案）",
    "投資建議書（草案）",
  ],
  [
    "完成的試算會顯示在這裡，跑一次就能開始。",
    "執行一次試算後，結果會顯示在這裡。",
  ],
  [
    "去客製化一組投組",
    "開始客製化投組",
  ],
  [
    "方案引擎已連線",
    "分析引擎已連線",
  ],
  [
    "規則備援",
    "規則推估",
  ],
  [
    "解「{title}」— {hooks}",
    "處理「{title}」— {hooks}",
  ],
  [
    "報酬欄位已依目前持倉回推績效（每月再平衡至現有配置）自動帶入，可自行覆寫。",
    "已依目前持倉的歷史表現自動帶入，可自行調整。",
  ],
  [
    "持倉回推（每月再平衡至目標權重）",
    "持倉歷史表現",
  ],
  [
    "持倉回推暫不可用 — 改用引擎回測曲線。",
    "暫無法取得持倉歷史表現——改用投組試算結果。",
  ],
  [
    "來自持倉回測或模型序列",
    "來自持倉試算或模型序列",
  ],
  [
    "部分區間因無回測曲線，採用原計畫報酬率假設。",
    "部分區間因無試算曲線，採用原計畫報酬率假設。",
  ],
  [
    "您勾選了多個模型組合，將一併客製化並形成同一個投資組合。若有不希望更動的模型，請取消勾選。",
    "你勾選了多個模型組合，將一併客製化並形成同一個投資組合。若有不希望更動的模型，請取消勾選。",
  ],
  [
    "全局示範貨架",
    "全域示範商品清單",
  ],
  [
    "匯入或匯出全局貨架 CSV。",
    "匯入或匯出全域商品清單 CSV。",
  ],
  [
    "備註:",
    "備註：",
  ],
  [
    "投組各曆年報酬（財富路徑規劃用的樣本來源）。極端年份即會被 winsorize／平均上限壓低的 outlier。",
    "投組各曆年報酬，為財富路徑規劃的樣本來源；極端年份會被壓縮處理（不超過樣本平均上限）。",
  ],
  [
    "開啟保留資料時，試算挑選以訓練期為準。訓練期與驗證期列是同一段連續完整模擬的切片，並非各自重新起算的獨立執行。儀表板上的排名夏普值可能與這些列略有差異。",
    "訓練期與驗證期是同一段連續試算的切片，並非各自獨立執行。",
  ],
  [
    "「動態」會讓投資組合隨市場狀態自動切換配置風格：風險高時偏防守、行情強勁時追求成長、介於兩者之間時取得平衡。建議方案方案是以單一綜合分數挑選（風險調整後報酬＋成長＋回撤＋交易成本），而非單一指標。若想單純以某個目標（例如最大 CAGR）排名、同時仍隨市場切換配置，請選擇該目標並開啟下方的「隨市場狀態調整配置」。",
    "依市場狀態自動切換防守／平衡／成長配置，並以綜合分數排名。若想以單一目標（如最大年化報酬）排名，請選該目標並開啟下方「隨市場狀態調整配置」。",
  ],
  [
    "從切換進場到標籤改變為止，依基準表現為每個連續的現行狀態區段評分：報酬 > 0 判為風險偏好；區段年化波動度 ≥ 實驗室區段波動中位數的 1.15 倍判為風險趨避；相對於前一區段判為中性 —— 風險偏好之後報酬 ≤ 0 或低於前一風險偏好區段報酬，風險趨避之後波動低於前一風險趨避區段，否則 |報酬| ≤ 3%。報酬與回撤僅供參考。與每步固定 21 天前瞻窗口不同，此指標不取代夏普 A/B 檢定。",
    "依各狀態區段的實際市場表現評分；僅供參考，不影響方案排名。",
  ],
  [
    "命中：風險偏好（報酬 > 0）、風險趨避（區段波動 ≥ 區段波動中位數的 1.15 倍）、中性（風險偏好後轉弱、風險趨避後波動趨緩，否則 |報酬| ≤ 3%）。最大誤判依報酬缺口（風險偏好）、波動缺口（風險趨避）或持續強勢／波動下降不足（中性）排序。",
    "最大誤判：基準實際走勢與狀態判斷落差最大的區段。",
  ],
  [
    "Pro 模式會替你管理搜尋強度，最多約執行",
    "Pro 模式會替你管理搜尋強度，最多約執行",
  ],
  [
    "次，並可能在結果不再進步時提前結束。",
    "次試算，並可能在結果不再進步時提前結束。",
  ],

  // ── KO (subset — key fixes) ──
  [
    "리더보드 · 검증 구간 기간으로 순위를 매긴 방안",
    "리더보드 · 검증 구간 기준으로 순위를 매긴 방안",
  ],
  [
    "리더보드 · 전체 표본 기간으로 순위를 매긴 방안",
    "리더보드 · 전체 기간 기준으로 순위를 매긴 방안",
  ],
  [
    "리더보드 · 학습 구간 기간으로 순위를 매긴 방안",
    "리더보드 · 학습 구간 기준으로 순위를 매긴 방안",
  ],
  [
    "방안 엔진 연결됨",
    "분석 엔진 연결됨",
  ],
  [
    "Jasper Pro Search: OFF (단일 패스 — 모든 트라이얼이 AI 초기안 사용)",
    "Pro 최적화: OFF (단일 라운드 — 더 빠르게 완료)",
  ],
  [
    "Jasper Pro Search: ON (다중 라운드 AI 최적화)",
    "Pro 최적화: ON (다중 라운드 AI 탐색)",
  ],
  [
    "이번 백테스트의 최우선 제안, 「{anchor}」 대비",
    "이번 시뮬레이션의 최우선 제안, 「{anchor}」 대비",
  ],
  [
    "Pro · AI 최적화",
    "Pro 최적화",
  ],
  [
    "Pro 탐색 실행",
    "Pro 최적화 실행",
  ],
  [
    "인내 라운드",
    "조기 종료 허용 라운드",
  ],
  [
    "얼서 지수",
    "통증 지수",
  ],
  [
    "낙폭 깊이, 고점 이후 경과, 또는 얼서 지수",
    "낙폭 깊이, 고점 이후 경과, 또는 통증 지수",
  ],
  [
    "규칙 대체",
    "규칙 기반 추정",
  ],
  [
    "「{title}」해결 — {hooks}",
    "「{title}」 처리 — {hooks}",
  ],
  [
    "전역 상품 선반",
    "전역 상품 목록",
  ],
  [
    "전역 상품 선반 CSV를 가져오거나 내보냅니다.",
    "전역 상품 목록 CSV를 가져오거나 내보냅니다.",
  ],
];

let applied = 0;
let missed = [];
for (const [oldStr, newStr] of pairs) {
  if (oldStr === newStr) continue;
  if (!s.includes(oldStr)) {
    missed.push(oldStr.slice(0, 60));
    continue;
  }
  s = s.split(oldStr).join(newStr);
  applied++;
}

// Insert new EN overlay.chat keys before overlay.thinking.label
const overlayChatEn = `  "overlay.chat.title": "Client needs conversation",
  "overlay.chat.subtitle":
    "Enter the client's needs; AI helps clarify them and turns them into an adjustment you can project.",
  "overlay.chat.placeholder":
    "e.g. The client wants to increase AI sector exposure, but expects to use funds within 5 years, so risk should stay moderate.",
  "overlay.chat.send": "Send",
  "overlay.chat.sending": "Analyzing…",
  "overlay.chat.confirmAdd": "Confirm adding {list}",
  "overlay.chat.phaseDiscovery": "discovery",
  "overlay.chat.phaseLabel": "Phase",
  "overlay.chat.aiSummaryTitle": "AI adjustment summary",
  "overlay.chat.confirm": "Confirm adjustments & sign off",
  "overlay.chat.confirming": "Signing off…",
  "overlay.chat.confirmed": "Confirmed & signed off",
  "overlay.chat.openCta": "Describe client needs with AI",
  "overlay.chat.collapse": "Collapse ▾",
  "overlay.chat.collapseAria": "Collapse chat",
  "overlay.chat.errorDetails": "Error details",
`;

if (!s.includes('"overlay.chat.title"')) {
  s = s.replace(
    '  "overlay.thinking.label":',
    overlayChatEn + '  "overlay.thinking.label":',
  );
  applied++;
}

const assetFilterEn = `  "assetFilter.lockedAdded":
    "Locked model universe: kept holdings and added {adds} (explicit symbols only).",
  "assetFilter.lockedUnchanged":
    "Locked model universe unchanged — name ticker symbols (e.g. GLD) to add, or use overlay supplements.",
`;

if (!s.includes('"assetFilter.lockedAdded"')) {
  s = s.replace(
    '  "assetFilter.layer2Hint":',
    assetFilterEn + '  "assetFilter.layer2Hint":',
  );
  applied++;
}

const settingsEn = `  "settings.validationUnavailable": "Validation service unavailable",
  "settings.validationUnavailableDetail": "Validation service unavailable: {message}",
`;

if (!s.includes('"settings.validationUnavailable"')) {
  s = s.replace('  "settings.poolHint":', settingsEn + '  "settings.poolHint":');
  applied++;
}

const goalSimAiEn = `  "goalSim.source.ai": "AI",
`;

if (!s.includes('"goalSim.source.ai"')) {
  s = s.replace(
    '  "goalSim.rulesFallback":',
    goalSimAiEn + '  "goalSim.rulesFallback":',
  );
  applied++;
}

// ZH overlay.chat + assetFilter + settings + goalSim
const overlayChatZh = `  "overlay.chat.title": "客戶需求對話",
  "overlay.chat.subtitle":
    "輸入客戶需求，AI 會協助釐清並轉成可試算的投組調整。",
  "overlay.chat.placeholder":
    "例如：客戶想增加 AI 產業配置，但未來 5 年內有資金需求，因此不希望風險過高。",
  "overlay.chat.send": "送出",
  "overlay.chat.sending": "分析中…",
  "overlay.chat.confirmAdd": "確認加入 {list}",
  "overlay.chat.phaseDiscovery": "探索",
  "overlay.chat.phaseLabel": "階段",
  "overlay.chat.aiSummaryTitle": "AI 解析的調整方案",
  "overlay.chat.confirm": "確認調整方案並簽核",
  "overlay.chat.confirming": "簽核中…",
  "overlay.chat.confirmed": "已確認並簽核",
  "overlay.chat.openCta": "使用 AI 描述客戶需求",
  "overlay.chat.collapse": "收起 ▾",
  "overlay.chat.collapseAria": "收起對話",
  "overlay.chat.errorDetails": "錯誤詳情",
`;

const zhThinking = s.indexOf('"overlay.thinking.label":', s.indexOf('const zh:'));
if (zhThinking > 0 && !s.includes('"overlay.chat.title": "客戶需求對話"')) {
  s =
    s.slice(0, zhThinking) +
    overlayChatZh +
    s.slice(zhThinking);
  applied++;
}

const assetFilterZh = `  "assetFilter.lockedAdded":
    "已鎖定模型標的池：保留持倉並加入 {adds}（僅限明確代碼）。",
  "assetFilter.lockedUnchanged":
    "已鎖定模型標的池未變更——輸入代碼（如 GLD）即可加入，或使用調整方案補充標的。",
`;

const zhLayer2 = s.indexOf('"assetFilter.layer2Hint":', s.indexOf('const zh:'));
if (zhLayer2 > 0 && !s.includes('"assetFilter.lockedAdded":\n    "已鎖定')) {
  s = s.slice(0, zhLayer2) + assetFilterZh + s.slice(zhLayer2);
  applied++;
}

const settingsZh = `  "settings.validationUnavailable": "驗證服務暫不可用",
  "settings.validationUnavailableDetail": "驗證服務暫不可用：{message}",
`;

const zhPoolHint = s.indexOf('"settings.poolHint":', s.indexOf('const zh:'));
if (zhPoolHint > 0 && !s.includes('"settings.validationUnavailable": "驗證')) {
  s = s.slice(0, zhPoolHint) + settingsZh + s.slice(zhPoolHint);
  applied++;
}

const goalSimAiZh = `  "goalSim.source.ai": "AI",
`;

const zhRules = s.indexOf('"goalSim.rulesFallback":', s.indexOf('const zh:'));
if (zhRules > 0 && !s.includes('"goalSim.source.ai": "AI",\n', zhRules - 50)) {
  s = s.slice(0, zhRules) + goalSimAiZh + s.slice(zhRules);
  applied++;
}

// KO overlay.chat etc.
const overlayChatKo = `  "overlay.chat.title": "고객 니즈 대화",
  "overlay.chat.subtitle":
    "고객 니즈를 입력하면 AI가 정리해 시뮬레이션 가능한 조정으로 바꿔 줍니다.",
  "overlay.chat.placeholder":
    "예: 고객이 AI 산업 비중 확대를 원하지만, 향후 5년 내 자금 사용 계획이 있어 위험은 높지 않기를 원합니다.",
  "overlay.chat.send": "보내기",
  "overlay.chat.sending": "분석 중…",
  "overlay.chat.confirmAdd": "{list} 추가 확인",
  "overlay.chat.phaseDiscovery": "탐색",
  "overlay.chat.phaseLabel": "단계",
  "overlay.chat.aiSummaryTitle": "AI 조정안 요약",
  "overlay.chat.confirm": "조정안 확인 및 서명",
  "overlay.chat.confirming": "서명 중…",
  "overlay.chat.confirmed": "확인 및 서명 완료",
  "overlay.chat.openCta": "AI로 고객 니즈 입력",
  "overlay.chat.collapse": "접기 ▾",
  "overlay.chat.collapseAria": "대화 접기",
  "overlay.chat.errorDetails": "오류 상세",
`;

const koThinking = s.indexOf('"overlay.thinking.label":', s.indexOf('const ko:'));
if (koThinking > 0 && !s.includes('"overlay.chat.title": "고객 니즈 대화"')) {
  s = s.slice(0, koThinking) + overlayChatKo + s.slice(koThinking);
  applied++;
}

const assetFilterKo = `  "assetFilter.lockedAdded":
    "잠긴 모델 유니버스: 보유 종목 유지 및 {adds} 추가(명시적 심볼만).",
  "assetFilter.lockedUnchanged":
    "잠긴 모델 유니버스 변경 없음 — 추가할 티커(예: GLD)를 입력하거나 조정안 보충 종목을 사용하세요.",
`;

const koLayer2 = s.indexOf('"assetFilter.layer2Hint":', s.indexOf('const ko:'));
if (koLayer2 > 0 && !s.includes('"assetFilter.lockedAdded":\n    "잠긴')) {
  s = s.slice(0, koLayer2) + assetFilterKo + s.slice(koLayer2);
  applied++;
}

const settingsKo = `  "settings.validationUnavailable": "검증 서비스를 사용할 수 없습니다",
  "settings.validationUnavailableDetail": "검증 서비스를 사용할 수 없습니다: {message}",
`;

const koPoolHint = s.indexOf('"settings.poolHint":', s.indexOf('const ko:'));
if (koPoolHint > 0 && !s.includes('"settings.validationUnavailable": "검증')) {
  s = s.slice(0, koPoolHint) + settingsKo + s.slice(koPoolHint);
  applied++;
}

const goalSimAiKo = `  "goalSim.source.ai": "AI",
`;

const koRules = s.indexOf('"goalSim.rulesFallback":', s.indexOf('const ko:'));
if (koRules > 0) {
  const slice = s.slice(koRules - 80, koRules);
  if (!slice.includes('"goalSim.source.ai"')) {
    s = s.slice(0, koRules) + goalSimAiKo + s.slice(koRules);
    applied++;
  }
}

// Fix proposal.body.letterIntro zh (partial match failed above)
s = s.replace(
  "本建議書為 {client} 之客製化 ETF 配置草案（參考規模 {amount}），以 {am} · {theme} 為模型組合基準組合。",
  "本建議書為 {client} 之客製化 ETF 配置草案（參考規模 {amount}），以 {am} · {theme} 為基準模型組合。",
);

// Fix zh clients.cagr
s = s.replace('"clients.cagr": "CAGR",', '"clients.cagr": "年化報酬",', 1);

// Fix ko clients.cagr (first occurrence in ko section only - use replace once per lang)
const koStart = s.indexOf("const ko:");
const koCagr = s.indexOf('"clients.cagr": "CAGR",', koStart);
if (koCagr > 0) {
  s =
    s.slice(0, koCagr) +
    '"clients.cagr": "연환산 수익",' +
    s.slice(koCagr + '"clients.cagr": "CAGR",'.length);
}

// Fix en clients.ageUnit
s = s.replace('"clients.ageUnit": "yo",', '"clients.ageUnit": "yrs",', 1);

// Fix zh goalCompare.returnNote winsorize
s = s.replace(
  "（winsorize {years} 年樣本、不高於樣本平均 {ceiling}，波動 {vol}）。保守色帶≈歷史單年有 {conf}% 機率不低於 {floor}。",
  "（{years} 年樣本極端值壓縮、不高於樣本平均 {ceiling}，波動 {vol}）。保守色帶≈歷史單年有 {conf}% 機率不低於 {floor}。",
);

fs.writeFileSync(file, s, "utf8");
console.log(`Applied ${applied} replacement groups.`);
if (missed.length) {
  console.log("Missed (first 20):");
  for (const m of missed.slice(0, 20)) console.log(" -", m);
}
