"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export const LANG_STORAGE_KEY = "jasper-lang";

export type Lang = "en" | "zh" | "ko";

export const LANGUAGES: ReadonlyArray<{ code: Lang; label: string }> = [
  { code: "en", label: "EN" },
  { code: "zh", label: "繁中" },
  { code: "ko", label: "한국어" },
] as const;

export const DEFAULT_LANG: Lang = "en";

function isLang(value: string | null): value is Lang {
  return value === "en" || value === "zh" || value === "ko";
}

type Dict = Record<string, string>;

const en: Dict = {
  // Header / shell
  "header.phase.scenario": "—",
  "header.phase.constraints": "SETUP",
  "header.phase.running": "RUNNING",
  "header.phase.results": "RESULTS",
  "header.phase.export": "EXPORT",
  "header.apiOffline": "Service offline",
  "header.apiOfflineHint":
    "We can’t reach the analytics service right now. Please try again in a moment.",
  "header.apiLinked": "Connected",
  "header.etfs": "{count} ETFs",
  "header.objectiveLab": "Objective Switch Lab",
  "header.terminalLog": "Activity log",
  "lang.label": "LANG",
  "lang.aria": "Language",
  "font.label": "FONT",

  // Backtest history panel
  "history.title": "Backtest history",
  "history.refresh": "Refresh",
  "history.syncing": "Syncing…",
  "history.apiOffline": "Offline — showing local results",
  "history.record": "{count} result",
  "history.records": "{count} results",
  "history.empty":
    "Your completed backtests show up here. Run one to get started.",
  "history.load": "OPEN",
  "history.status.completed": "completed",
  "history.status.failed": "failed",
  "history.status.running": "running",
  "history.status.queued": "queued",

  // Constraints / config form
  "config.title": "Backtest setup",
  "config.subtitle":
    "Set your strategy below. At each rebalance, Jasper shortlists the strongest holdings, then sizes positions to balance risk and return.",
  "config.maxWeight": "Max weight per holding: {pct}%",
  "config.minWeight": "Min weight per holding: {pct}%",
  "config.minWeightHint":
    "Holdings smaller than this are dropped at each rebalance, and the freed-up cash is spread across your remaining positions.",
  "config.maxTurnover": "Max turnover per rebalance: {pct}%",
  "config.maxTurnoverHint":
    "Limits how much of the portfolio Jasper can trade at each rebalance, helping keep trading costs in check.",
  "config.maxHoldings": "Max number of holdings: {n}",
  "config.maxHoldingsHint":
    "The most positions your portfolio will hold at any one time.",
  "config.topN": "Shortlist size (Top N): {n}",
  "config.topNHint":
    "Jasper ranks every candidate and keeps the top {n} to build your portfolio from.",
  "config.objective": "Optimization goal",
  "config.customObjective": "Describe your goal",
  "config.start": "Start",
  "config.startHint":
    "We load extra price history before this date so your day-one positions are based on real signals, not a placeholder.",
  "config.end": "End",
  "config.trials": "Search effort: {n} strategies",
  "config.topModels": "Strategies to show in the report: {n}",
  "config.holdout":
    "Hold out recent data to test on (Jasper optimizes on the earlier period, then checks results on the unseen part)",
  "config.inSampleRatio": "Optimize on the first {pct}% (the rest is held out for testing)",
  "config.fee": "Trading cost: {bps} bps",
  "config.rebalanceFreq": "Rebalance frequency",
  "config.rebalance.weekly": "Weekly (Fridays)",
  "config.rebalance.monthly": "Monthly",
  "config.rebalance.quarterly": "Quarterly",
  "config.rebalance.yearly": "Yearly",
  "config.runStandard": "Run backtest",
  "config.runPro": "Run Pro optimization",

  // Pro rounds tabs
  "pro.tabsHint":
    "Each tab is one round: the current leader plus its challengers. ★ marks the round winner. The catalog tab lists every strategy tried so far.",
  "pro.allRounds": "ALL ROUNDS",
  "pro.role.incoming": "Current leader",
  "pro.role.challenger": "Challenger",
  "pro.role.winner": "Round winner",

  // Results dashboard
  "results.title": "Results",
  "results.model": "strategy",
  "results.fullNarrative": "Full summary",
  "results.fullPeriod": "Full period",
  "results.refineHint":
    "Click to apply an adjustment · double-click to apply and rerun.",
  "results.editConfig": "Edit setup",
  "results.exportCsv": "Export CSV",

  // Conversation log
  "chat.welcome":
    "Jasper is ready — you can analyze {count} ETFs. Set your strategy below and run a backtest. At each rebalance, Jasper shortlists the strongest holdings, then sizes positions to balance risk and return.",
  "chat.complete":
    "Backtest complete. Your best strategy: {model} vs {benchmark} — Sharpe {sharpe}, max drawdown {mdd}%, CAGR {cagr}%. Compare the others in the results panel.",
  "chat.loadHistory": "Open saved backtest {id}…",
  "chat.loadHistoryLocal": "Open saved backtest {id} (local copy)…",
  "chat.jobNotCompleted": "Backtest {id} hasn’t finished yet ({status}).",
  "chat.jobNotFound":
    "We couldn’t find this backtest on the server or on your device.",
  "chat.historyLoadFailed": "We couldn’t open that saved backtest.",
  "chat.runFailed": "The backtest couldn’t be completed. Please try again.",
  "chat.userRunPro": "Run Pro optimization",
  "chat.userRunStandard": "Run backtest",
  "chat.ackPro":
    "Starting Pro optimization. Jasper will test many strategies and guard against overfitting…",
  "chat.ackStandard": "Running your backtest…",
  "chat.tweak": "Adjustment: {label}",
  "chat.tweakApplied":
    "Updated. Make more changes, or press ↻ to rerun now.",
  "chat.tweakRerun": "Adjust and rerun: {label}",
  "chat.ackRerun": "Rerunning with your updated settings…",
  "chat.backToConfig": "Back to setup",

  // Common labels
  "common.on": "ON",
  "common.off": "OFF",
  "common.yes": "yes",
  "common.no": "no",
  "common.loading": "Loading",
  "common.date": "Date",
  "common.name": "Name",
  "common.period": "Period",
  "common.return": "Return",
  "common.objective": "Objective",
  "common.inSample": "In-Sample",
  "common.outOfSample": "Out-of-Sample",
  "common.full": "Full",
  "common.gap": "Gap",
  "common.regime": "Regime",
  "common.active": "Active",
  "common.vol": "Vol",
  "common.cagr": "CAGR",
  "common.maxDd": "Max DD",
  "common.sharpe": "Sharpe",
  "common.sortino": "Sortino",
  "common.calmar": "Calmar",
  "common.beta": "Beta",
  "common.alpha": "Alpha",
  "common.ticker": "Ticker",
  "common.unknown": "unknown",
  "common.cumulativeReturn": "Cumulative return",
  "common.activeRegime": "Active regime",
  "common.rawRegime": "Raw regime",
  "common.switch": "switch",

  // Pro panel
  "proPanel.title": "Pro · AI optimization",
  "proPanel.desc.beforeDynamic":
    "Jasper runs rounds of challengers against the current leader. The AI proposes new settings based on what worked before, and keeps refining until results stop improving.",
  "proPanel.dynamic": "Dynamic",
  "proPanel.desc.afterDynamic":
    "goal tunes a separate strategy for each market mood (risk-off, neutral, risk-on) and applies the right one as conditions change.",
  "proPanel.estimationPrefix": "Pro mode manages the search effort for you. It will run up to about",
  "proPanel.estimationSuffix":
    "backtests, and may finish early once results stop improving.",
  "proPanel.highTrialsWarning":
    "Higher settings run many more backtests and take longer. Each round uses one AI suggestion to guide the search.",
  "proPanel.round1Batch": "First-round strategies",
  "proPanel.round1BatchHint": "How many strategies to try in the first round (3–100).",
  "proPanel.challengersPerRound": "Challengers per round",
  "proPanel.challengersPerRoundHint": "New strategies tested against the leader each round (2–100).",
  "proPanel.maxRounds": "Max rounds",
  "proPanel.maxRoundsHint": "The most rounds to run, including the first (2–30).",
  "proPanel.patienceRounds": "Patience (rounds)",
  "proPanel.holdoutTip":
    "Tip: turn on a holdout so strategies are ranked on the optimization period, then checked on unseen data.",

  "quickRefinements.title": "Quick adjustments",
  "quickRefinements.doubleClickHint": "double-click to rerun",

  "progress.running": "Running…",
  "progress.roundUnderperformed": "ROUND TRAILED THE BENCHMARK",
  "progress.roundUnderperformedHint":
    "This round’s return came in below the benchmark. Jasper will keep exploring in the next round.",
  "progress.portfolioReturn": "Portfolio return",
  "progress.benchmark": "Benchmark",
  "progress.round": "Round",
  "progress.bestInSample": "Best so far",

  "customScenario.title": "Your market view",
  "customScenario.description":
    "Describe your macro, sector, or risk outlook, and Jasper turns it into a strategy you can backtest.",
  "customScenario.placeholder":
    "e.g. Sticky US inflation, Fed higher for longer, growth multiples under pressure — tilt toward short-duration bonds and defensives...",
  "customScenario.analyzing": "Building…",
  "customScenario.analyzeButton": "Build scenario",
  "customScenario.analysisFailed": "Couldn’t build that scenario",
  "customScenario.analysisFailedRetry": "We couldn’t build that scenario. Please try again.",

  "assetFilter.assetClasses": "ASSET CLASSES",
  "assetFilter.aiFilter": "AI INVESTMENT SEARCH",
  "assetFilter.clearAiFilter": "CLEAR",
  "assetFilter.layer1Hint":
    "Jasper builds your portfolio from everything in the asset classes you pick, choosing the best holdings at each rebalance.",
  "assetFilter.layer2Hint":
    "Add a rule, then run the search. Jasper looks across all {total} ETFs and adds any matches to your pool.",
  "assetFilter.placeholder":
    "e.g. short equity hedge ETFs; US tech and healthcare; AI industry theme",
  "assetFilter.addRule": "ADD RULE",
  "assetFilter.remove": "REMOVE",
  "assetFilter.applying": "SEARCHING…",
  "assetFilter.applyAiFilter": "RUN SEARCH",
  "assetFilter.results": "RESULTS",
  "assetFilter.analysisFailed": "Search failed",
  "assetFilter.analysisFailedRetry": "Search failed. Please try again.",
  "assetFilter.supplementTicker": "added ticker",
  "assetFilter.matchedInUniverse": "matches found",
  "assetFilter.new": "new",
  "assetFilter.expand": "expand",
  "assetFilter.categories": "Categories",
  "assetFilter.matched": "Matched",
  "assetFilter.noneForRule": "(no matches for this rule)",
  "assetFilter.newVsBase": "Newly added",
  "assetFilter.guaranteed": "Always included",
  "assetFilter.guaranteedHint": "these tickers are always part of your backtest.",

  "linkedChart.tooltipRegime": "Regime",
  "linkedChart.tooltipActiveObjective": "Active goal",
  "linkedChart.noHistory": "No performance or holdings history for this strategy.",
  "linkedChart.linkedCursorHint":
    "Hover any chart — performance, market regime, and holdings all line up on the same dates.",
  "linkedChart.cumulativeTitle": "Cumulative return % — Portfolio vs {benchmark}",
  "linkedChart.amberSwitch": "Amber = switch",
  "linkedChart.holdingsTitle": "Holdings over time",
  "linkedChart.otherCapHint": "Smaller holdings grouped as “Other”",
  "linkedChart.hoverHint": "Hover the chart to see holdings",
  "linkedChart.other": "Other",

  "objectiveLab.rec.apply": "Recommendation: apply",
  "objectiveLab.rec.notYet": "Recommendation: not yet",
  "objectiveLab.rec.needMoreData": "Recommendation: need more data",
  "objectiveLab.reportCard": "Lab results",
  "objectiveLab.oosSharpeDelta": "Out-of-sample Sharpe gain (switching vs. fixed):",
  "objectiveLab.regimeDetector": "Regime detector",
  "objectiveLab.detectorV2": "weighs risk-on vs. risk-off signals to read the market",
  "objectiveLab.detectorLegacy": "classic return and volatility thresholds",
  "objectiveLab.fastRiskOffExit": "Exit risk-off quickly on a rebound (21 days)",
  "objectiveLab.fixedObjective": "Fixed goal",
  "objectiveLab.switchPolicy": "Switching strategy",
  "objectiveLab.benchmarkVsRegime": "Benchmark vs. market regime",
  "objectiveLab.regimeScores": "Regime scores vs. active regime",
  "objectiveLab.hoverSyncHint": "Hover either chart — both line up on the same dates.",
  "objectiveLab.regimeTimeline": "Regime timeline",
  "objectiveLab.off": "Off",
  "objectiveLab.on": "On",

  "benchmarkChart.noSeries": "No benchmark data to chart.",
  "benchmarkChart.noValidDates": "No valid dates to chart.",
  "benchmarkChart.cumPct": "{ticker} cumulative %",
  "benchmarkChart.footer":
    "Top: {ticker} cumulative return (%). Shaded bands show the market regime; the amber strip marks regime switches. Hover to sync with the regime scores below.",

  "regimeScore.noScores": "No regime scores yet. Try the newer detector or a longer optimization period.",
  "regimeScore.noValidDates": "No valid dates to chart.",
  "regimeScore.stepWinner": "Leading score",
  "regimeScore.rawRegime": "Raw regime",
  "regimeScore.activeRegime": "Active regime",
  "regimeScore.riskOffScore": "Risk-off score",
  "regimeScore.riskOnScore": "Risk-on score",
  "regimeScore.neutralImplied": "Neutral (implied)",
  "regimeScore.footer":
    "Risk-on and risk-off signal scores over time. The tooltip shows the leading score and the regime Jasper acted on. Hover to sync with the benchmark chart above.",

  "dynamicObjective.noSeries": "No benchmark data to chart.",
  "dynamicObjective.noValidDates": "No valid dates to chart.",
  "dynamicObjective.cumPct": "{ticker} cumulative %",
  "dynamicObjective.footer":
    "Top: {ticker} cumulative return (%); the shaded background shows which goal was active over time. Bottom: goal switches (amber = switch). Hover to sync with the performance chart above.",

  "institutional.loadingAnalytics": "analytics",
  "institutional.noAnalytics": "No detailed analytics available — please rerun the backtest.",
  "institutional.monthlyInSample": "Monthly returns (In-Sample{range})",
  "institutional.monthlyFull": "Monthly returns (Full)",
  "institutional.annualInSample": "Annual returns (In-Sample{range})",
  "institutional.annualFull": "Annual returns (Full)",
  "institutional.monthlyOosFrom": "Monthly returns (Out-of-Sample from {date})",
  "institutional.monthlyOos": "Monthly returns (Out-of-Sample)",
  "institutional.annualOosFrom": "Annual returns (Out-of-Sample from {date})",
  "institutional.annualOos": "Annual returns (Out-of-Sample)",
  "institutional.horizonTitle": "Performance by horizon (In-Sample / Out-of-Sample / Full)",
  "institutional.horizon": "Horizon",
  "institutional.maxDd": "Max DD",
  "institutional.rebalanceExecution": "Rebalance execution",
  "institutional.freq": "Freq",
  "institutional.count": "Count",
  "institutional.sampleDates": "Sample dates",
  "institutional.exposure": "Exposure",
  "institutional.assetClass": "Asset class",
  "institutional.bucketsRegion": "By region",
  "institutional.equity": "Equity",
  "institutional.bond": "Bond",
  "institutional.other": "Other",
  "institutional.durationProxy": "Avg. duration (yrs)",
  "institutional.riskContributionTop": "Top risk contributors",
  "institutional.weightShort": "Wt",
  "institutional.drawdownCurve": "Drawdown curve",
  "institutional.drawdownEpisodes": "Drawdown episodes",
  "institutional.insufficientData": "Not enough data",
  "institutional.noData": "No data",

  // Results extended
  "results.failedLoadTrajectory": "Couldn’t load this chart",
  "results.compareRetried": "AI comparison was retried",
  "results.warning.sampleData":
    "Heads up: results use sample data rather than live market data. Treat metrics as illustrative.",
  "results.warning.unrealistic":
    "Heads up: some metrics look unrealistic. Please review your data and parameters.",
  "results.liveData": "Live market data · {start} → {end} · {rows} trading days",
  "results.requested": "requested",
  "results.lateListingsDropped": "newer listings excluded",
  "results.viewing": "Viewing",
  "results.round": "round",
  "results.newRoundBest": "new round best",
  "results.proRefinement": "Pro refinement",
  "results.rounds": "rounds",
  "results.trials": "strategies",
  "results.earlyStop": "stopped early",
  "results.parameterSearch": "Search",
  "results.feasible": "feasible",
  "results.reported": "reported",
  "results.catalog": "catalog",
  "results.rebalance": "rebalance",
  "results.applied": "applied",
  "results.orderByModel": "order: by number",
  "results.sort": "sort",
  "results.rankedOnInSample": "Ranked on In-Sample",
  "results.gapInOut": "Gap (In-Sample − Out-of-Sample)",
  "results.winRate": "Win rate",
  "results.avgTurnover": "Avg turnover",
  "results.totalTurnover": "Total turnover",
  "results.maxDdDays": "Max DD days",
  "results.var95": "VaR 95% (d)",
  "results.cvar95": "CVaR 95% (d)",
  "results.te": "TE",
  "results.ir": "IR",
  "results.horizonCompareTitle": "In-Sample / Out-of-Sample / Full",
  "results.horizonMetricsHint":
    "Key metrics across each period. Strategies are chosen on the In-Sample period only.",
  "results.metric": "Metric",
  "results.gapObjectiveSharpe": "In-Sample − Out-of-Sample gap: objective",
  "results.positiveInSampleStronger": "positive means In-Sample is stronger",
  "results.championLeaderboard": "Leaderboard · strategies ranked on the In-Sample period",
  "results.sortTableBy": "Sort table by",
  "results.inSampleSelection": "In-Sample (selection)",
  "results.engine": "engine",
  "results.holdings": "holdings",
  "results.cap": "cap",
  "results.weightChartMayListMore": "the holdings chart may show more tickers across rebalances",
  "results.maxWeight": "max weight",
  "results.runCap": "run cap",
  "results.effective": "effective",
  "results.observed": "observed",
  "results.selectionHint": "chosen on In-Sample; Out-of-Sample acts as a live test",
  "results.weightCapBreach": "Weight cap exceeded: observed",
  "results.vsEffectiveCap": "vs effective cap",
  "results.firstOn": "first on",
  "results.only": "only",
  "results.tradableNames": "tradable holdings",
  "results.needAtLeast": "need ≥",
  "results.aiComparison": "AI comparison",
  "results.generatingComparison": "Generating comparison…",
  "results.noComparisonYet": "No comparison available yet",
  "results.benchmark": "benchmark",
  "results.champion": "champion",
  "results.cagrPct": "CAGR %",
  "results.maxDdPct": "MaxDD %",
  "results.dynamicObjectives": "Dynamic goals",
  "results.dynamicObjectivesHint":
    "The market regime and the active goal are shaded in the performance and holdings charts below.",
  "results.loadingTrajectory": "Loading {model}…",
  "results.walkForwardHint":
    "Market regime and active goal over time, lined up with the performance and holdings charts.",
  "results.proChampionScorePrefix": "The Pro winner is chosen on an In-Sample",
  "results.comprehensiveScore": "composite score",
  "results.proChampionScoreFormula":
    "0.45×Sharpe + 0.25×Sortino + 0.20×(5×CAGR) − 0.35×|max drawdown| − 0.10×turnover.",
  "results.selectTrialHint": "Select a strategy above to see its performance and holdings.",
  "results.efficientFrontierHint":
    "Blue dots are strategies Jasper tried; orange dots are the top picks shown in your report.",
  "results.annVol": "Ann. vol (%)",
  "results.annReturn": "Ann. return (%)",
  "results.outputModel": "Top pick",
  "results.searchTrial": "Tested strategy",
  "results.paramSamples": "Strategies tried",
  "results.outputModels": "Top picks",
  "results.universeFilter": "Universe filter",
  "results.universeFilterHint":
    "other asset classes are left out of the search.",
  "results.targetNamesRegime": "Target names ({regime} regime)",
  "results.targetNamesAi": "Target names (from AI)",
  "results.targetCount": "Target count",
  "results.actualClassWeights": "Actual asset-class mix (holdings)",
  "results.classBreakdownChampion":
    "Showing the champion’s asset-class mix — this strategy stored a condensed version.",
  "results.weightPct": "Weight %",
  "results.factorAttributionChampion":
    "Showing the champion’s factor breakdown — this strategy didn’t store full details.",
  "results.noFactorAttribution": "No factor breakdown available",
  "results.contribPct": "Contrib %",
  "results.observations": "Observations",
  "results.rebalanceCrossSections": "rebalance snapshots",
  "results.factorMetricLogic": "How factors were measured",
  "results.noMetricLogic": "No factor detail available",
  "results.summaryOnlyModel":
    "This strategy has a summary only — no detailed holdings or charts. Pick one with a full report to explore further.",
  "results.analyticsFallback":
    "Rolling, exposure, and return tables come from the champion; the headline metrics match the strategy you selected.",
  "results.aiParameterRationale": "Why the AI chose these settings",
  "results.generation": "Generation",
  "results.noAiRationale": "No AI explanation for this run.",
  "results.fullRunConfig": "Full setup (JSON)",
  "results.manualAdjustment": "manual adjustment",
  "results.disclaimer":
    "For research and education only — not investment advice. Data:",
  "results.chart.performanceComparison": "Performance comparison",
  "results.chart.trajectoryHoldings": "Performance and holdings",
  "results.chart.efficientFrontier": "Risk vs. return (efficient frontier)",
  "results.chart.aiClassQuotas": "AI asset-class targets",
  "results.chart.factorAttribution": "Factor attribution",
  "results.chart.latestAllocation": "Current allocation",
  "results.chart.reproducibleParameters": "Settings to reproduce this run",
  "results.factor.momentum": "Momentum",
  "results.factor.reversal": "Reversal",
  "results.factor.value": "Value",
  "results.factor.lowvol": "Low vol",
  "results.factor.trend": "Trend",
  "results.factor.drawdown": "Drawdown",
};

const zh: Dict = {
  // Header / shell
  "header.phase.scenario": "—",
  "header.phase.constraints": "設定",
  "header.phase.running": "執行中",
  "header.phase.results": "結果",
  "header.phase.export": "匯出",
  "header.apiOffline": "服務離線",
  "header.apiOfflineHint": "目前無法連線到分析服務，請稍後再試。",
  "header.apiLinked": "已連線",
  "header.etfs": "{count} 檔 ETF",
  "header.objectiveLab": "目標切換實驗室",
  "header.terminalLog": "活動紀錄",
  "lang.label": "語言",
  "lang.aria": "語言",
  "font.label": "字級",

  // Backtest history panel
  "history.title": "回測紀錄",
  "history.refresh": "重新整理",
  "history.syncing": "同步中…",
  "history.apiOffline": "離線 — 顯示本機結果",
  "history.record": "{count} 筆結果",
  "history.records": "{count} 筆結果",
  "history.empty": "完成的回測會顯示在這裡，跑一次就能開始。",
  "history.load": "開啟",
  "history.status.completed": "已完成",
  "history.status.failed": "失敗",
  "history.status.running": "執行中",
  "history.status.queued": "排隊中",

  // Constraints / config form
  "config.title": "回測設定",
  "config.subtitle":
    "在下方設定你的策略。每次再平衡時，Jasper 會挑出表現最強的標的，再分配權重以兼顧風險與報酬。",
  "config.maxWeight": "單一標的最大權重：{pct}%",
  "config.minWeight": "單一標的最小權重：{pct}%",
  "config.minWeightHint":
    "每次再平衡時，低於此權重的標的會被剔除，釋出的資金會分配到其餘持股。",
  "config.maxTurnover": "每次再平衡最大換手率：{pct}%",
  "config.maxTurnoverHint":
    "限制 Jasper 每次再平衡能調動的部位比例，有助於控制交易成本。",
  "config.maxHoldings": "最多持有檔數：{n}",
  "config.maxHoldingsHint": "投資組合在任一時間最多持有的部位數。",
  "config.topN": "候選清單檔數（Top N）：{n}",
  "config.topNHint": "Jasper 會為所有候選標的排名，保留前 {n} 名來建構你的投資組合。",
  "config.objective": "最佳化目標",
  "config.customObjective": "描述你的目標",
  "config.start": "開始日期",
  "config.startHint":
    "我們會載入此日期前的額外歷史價格，讓第一天的部位以真實訊號為依據，而非暫用的預設值。",
  "config.end": "結束日期",
  "config.trials": "搜尋強度：{n} 種策略",
  "config.topModels": "報告中顯示的策略數：{n}",
  "config.holdout":
    "保留近期資料作測試（Jasper 先在較早期間最佳化，再用未看過的資料驗證結果）",
  "config.inSampleRatio": "以前 {pct}% 的資料最佳化（其餘保留作測試）",
  "config.fee": "交易成本：{bps} 個基點",
  "config.rebalanceFreq": "再平衡頻率",
  "config.rebalance.weekly": "每週（週五）",
  "config.rebalance.monthly": "每月",
  "config.rebalance.quarterly": "每季",
  "config.rebalance.yearly": "每年",
  "config.runStandard": "執行回測",
  "config.runPro": "執行 Pro 最佳化",

  // Pro rounds tabs
  "pro.tabsHint":
    "每個分頁代表一輪：當前領先者與它的挑戰者。★ 標示該輪優勝者。總覽分頁列出目前嘗試過的所有策略。",
  "pro.allRounds": "所有輪次",
  "pro.role.incoming": "當前領先者",
  "pro.role.challenger": "挑戰者",
  "pro.role.winner": "本輪優勝者",

  // Results dashboard
  "results.title": "結果",
  "results.model": "策略",
  "results.fullNarrative": "完整摘要",
  "results.fullPeriod": "完整期間",
  "results.refineHint": "點擊套用調整 · 雙擊套用並重新執行。",
  "results.editConfig": "編輯設定",
  "results.exportCsv": "匯出 CSV",

  // Conversation log
  "chat.welcome":
    "Jasper 已就緒 — 你可以分析 {count} 檔 ETF。在下方設定策略並執行回測。每次再平衡時，Jasper 會挑出表現最強的標的，再分配權重以兼顧風險與報酬。",
  "chat.complete":
    "回測完成。你的最佳策略：{model} vs {benchmark} — 夏普值 {sharpe}、最大回撤 {mdd}%、年化報酬 {cagr}%。可在結果面板比較其他策略。",
  "chat.loadHistory": "開啟已儲存的回測 {id}…",
  "chat.loadHistoryLocal": "開啟已儲存的回測 {id}（本機副本）…",
  "chat.jobNotCompleted": "回測 {id} 尚未完成（{status}）。",
  "chat.jobNotFound": "在伺服器和你的裝置上都找不到這筆回測。",
  "chat.historyLoadFailed": "無法開啟這筆已儲存的回測。",
  "chat.runFailed": "回測無法完成，請再試一次。",
  "chat.userRunPro": "執行 Pro 最佳化",
  "chat.userRunStandard": "執行回測",
  "chat.ackPro": "正在啟動 Pro 最佳化。Jasper 會測試多種策略並防範過度配適…",
  "chat.ackStandard": "正在執行你的回測…",
  "chat.tweak": "調整：{label}",
  "chat.tweakApplied": "已更新。可繼續調整，或按 ↻ 立即重新執行。",
  "chat.tweakRerun": "調整並重新執行：{label}",
  "chat.ackRerun": "正以更新後的設定重新執行…",
  "chat.backToConfig": "返回設定",

  // Common labels
  "common.on": "開",
  "common.off": "關",
  "common.yes": "是",
  "common.no": "否",
  "common.loading": "載入中",
  "common.date": "日期",
  "common.name": "名稱",
  "common.period": "期間",
  "common.return": "報酬",
  "common.objective": "目標",
  "common.inSample": "樣本內",
  "common.outOfSample": "樣本外",
  "common.full": "完整",
  "common.gap": "落差",
  "common.regime": "市場狀態",
  "common.active": "啟用",
  "common.vol": "波動度",
  "common.cagr": "年化報酬",
  "common.maxDd": "最大回撤",
  "common.sharpe": "夏普值",
  "common.sortino": "索提諾值",
  "common.calmar": "卡瑪值",
  "common.beta": "Beta",
  "common.alpha": "Alpha",
  "common.ticker": "代碼",
  "common.unknown": "未知",
  "common.cumulativeReturn": "累積報酬",
  "common.activeRegime": "現行市場狀態",
  "common.rawRegime": "原始市場狀態",
  "common.switch": "切換",

  // Pro panel
  "proPanel.title": "Pro · AI 最佳化",
  "proPanel.desc.beforeDynamic":
    "Jasper 會讓挑戰者一輪輪挑戰當前領先者。AI 會根據先前有效的設定提出新方案，持續優化直到結果不再進步。",
  "proPanel.dynamic": "動態",
  "proPanel.desc.afterDynamic":
    "目標會為每種市場氛圍（避險、中性、偏多）各自調校一套策略，並隨情勢變化套用最合適的那一套。",
  "proPanel.estimationPrefix": "Pro 模式會替你管理搜尋強度，最多約執行",
  "proPanel.estimationSuffix": "次，並可能在結果不再進步時提前結束。",
  "proPanel.highTrialsWarning":
    "設定越高，執行的回測越多、耗時也越長。每一輪都會用一則 AI 建議來引導搜尋。",
  "proPanel.round1Batch": "首輪策略數",
  "proPanel.round1BatchHint": "首輪要嘗試的策略數量（3–100）。",
  "proPanel.challengersPerRound": "每輪挑戰者數",
  "proPanel.challengersPerRoundHint": "每一輪挑戰領先者的新策略數量（2–100）。",
  "proPanel.maxRounds": "最大輪數",
  "proPanel.maxRoundsHint": "最多執行的輪數，含首輪（2–30）。",
  "proPanel.patienceRounds": "耐心輪數",
  "proPanel.holdoutTip":
    "提示：開啟保留資料，策略會先以最佳化期間排名，再用未看過的資料驗證。",

  "quickRefinements.title": "快速調整",
  "quickRefinements.doubleClickHint": "雙擊以重新執行",

  "progress.running": "執行中…",
  "progress.roundUnderperformed": "本輪落後基準",
  "progress.roundUnderperformedHint":
    "本輪報酬低於基準。Jasper 會在下一輪繼續探索。",
  "progress.portfolioReturn": "投資組合報酬",
  "progress.benchmark": "基準",
  "progress.round": "輪次",
  "progress.bestInSample": "目前最佳",

  "customScenario.title": "你的市場觀點",
  "customScenario.description":
    "描述你對總體經濟、產業或風險的看法，Jasper 會把它轉化為可回測的策略。",
  "customScenario.placeholder":
    "例如：美國通膨頑強、聯準會維持高利率更久、成長股評價承壓 — 偏向短天期債券與防禦性資產…",
  "customScenario.analyzing": "建構中…",
  "customScenario.analyzeButton": "建構情境",
  "customScenario.analysisFailed": "無法建構該情境",
  "customScenario.analysisFailedRetry": "無法建構該情境，請再試一次。",

  "assetFilter.assetClasses": "資產類別",
  "assetFilter.aiFilter": "AI 投資搜尋",
  "assetFilter.clearAiFilter": "清除",
  "assetFilter.layer1Hint":
    "Jasper 會從你選取的資產類別中所有標的建構投資組合，並在每次再平衡時挑出最佳持股。",
  "assetFilter.layer2Hint":
    "新增一條規則後執行搜尋。Jasper 會檢視全部 {total} 檔 ETF，並將符合的標的加入你的池中。",
  "assetFilter.placeholder":
    "例如：放空股票避險 ETF；美國科技與醫療；AI 產業主題",
  "assetFilter.addRule": "新增規則",
  "assetFilter.remove": "移除",
  "assetFilter.applying": "搜尋中…",
  "assetFilter.applyAiFilter": "執行搜尋",
  "assetFilter.results": "結果",
  "assetFilter.analysisFailed": "搜尋失敗",
  "assetFilter.analysisFailedRetry": "搜尋失敗，請再試一次。",
  "assetFilter.supplementTicker": "個新增標的",
  "assetFilter.matchedInUniverse": "個符合",
  "assetFilter.new": "新增",
  "assetFilter.expand": "展開",
  "assetFilter.categories": "類別",
  "assetFilter.matched": "符合",
  "assetFilter.noneForRule": "（此規則沒有符合的標的）",
  "assetFilter.newVsBase": "新增加入",
  "assetFilter.guaranteed": "一律納入",
  "assetFilter.guaranteedHint": "這些標的一定會納入你的回測。",

  "linkedChart.tooltipRegime": "市場狀態",
  "linkedChart.tooltipActiveObjective": "現行目標",
  "linkedChart.noHistory": "此策略沒有績效或持股歷史。",
  "linkedChart.linkedCursorHint":
    "將游標移到任一圖表上 — 績效、市場狀態與持股都會對齊到相同日期。",
  "linkedChart.cumulativeTitle": "累積報酬 % — 投資組合 vs {benchmark}",
  "linkedChart.amberSwitch": "琥珀色 = 切換",
  "linkedChart.holdingsTitle": "持股隨時間變化",
  "linkedChart.otherCapHint": "較小的持股歸為「其他」",
  "linkedChart.hoverHint": "將游標移到圖表上查看持股",
  "linkedChart.other": "其他",

  "objectiveLab.rec.apply": "建議：採用",
  "objectiveLab.rec.notYet": "建議：暫不採用",
  "objectiveLab.rec.needMoreData": "建議：需要更多資料",
  "objectiveLab.reportCard": "實驗室結果",
  "objectiveLab.oosSharpeDelta": "樣本外夏普值提升（切換 vs. 固定）：",
  "objectiveLab.regimeDetector": "市場狀態偵測器",
  "objectiveLab.detectorV2": "權衡偏多與避險訊號來判讀市場",
  "objectiveLab.detectorLegacy": "傳統的報酬與波動度門檻",
  "objectiveLab.fastRiskOffExit": "反彈時快速退出避險狀態（21 天）",
  "objectiveLab.fixedObjective": "固定目標",
  "objectiveLab.switchPolicy": "切換策略",
  "objectiveLab.benchmarkVsRegime": "基準 vs. 市場狀態",
  "objectiveLab.regimeScores": "市場狀態分數 vs. 現行狀態",
  "objectiveLab.hoverSyncHint": "將游標移到任一圖表上 — 兩者都會對齊到相同日期。",
  "objectiveLab.regimeTimeline": "市場狀態時間軸",
  "objectiveLab.off": "關",
  "objectiveLab.on": "開",

  "benchmarkChart.noSeries": "沒有可繪製的基準資料。",
  "benchmarkChart.noValidDates": "沒有可繪製的有效日期。",
  "benchmarkChart.cumPct": "{ticker} 累積 %",
  "benchmarkChart.footer":
    "上方：{ticker} 累積報酬（%）。陰影區帶顯示市場狀態；琥珀色條標示狀態切換。移動游標可與下方的市場狀態分數同步。",

  "regimeScore.noScores": "尚無市場狀態分數。請改用較新的偵測器，或拉長最佳化期間。",
  "regimeScore.noValidDates": "沒有可繪製的有效日期。",
  "regimeScore.stepWinner": "領先分數",
  "regimeScore.rawRegime": "原始市場狀態",
  "regimeScore.activeRegime": "現行市場狀態",
  "regimeScore.riskOffScore": "避險分數",
  "regimeScore.riskOnScore": "偏多分數",
  "regimeScore.neutralImplied": "中性（推算）",
  "regimeScore.footer":
    "偏多與避險訊號分數隨時間的變化。提示框會顯示領先分數，以及 Jasper 實際採用的市場狀態。移動游標可與上方的基準圖表同步。",

  "dynamicObjective.noSeries": "沒有可繪製的基準資料。",
  "dynamicObjective.noValidDates": "沒有可繪製的有效日期。",
  "dynamicObjective.cumPct": "{ticker} 累積 %",
  "dynamicObjective.footer":
    "上方：{ticker} 累積報酬（%）；陰影背景顯示各時期啟用的目標。下方：目標切換（琥珀色 = 切換）。移動游標可與上方的績效圖表同步。",

  "institutional.loadingAnalytics": "分析資料",
  "institutional.noAnalytics": "沒有可用的詳細分析 — 請重新執行回測。",
  "institutional.monthlyInSample": "月報酬（樣本內{range}）",
  "institutional.monthlyFull": "月報酬（完整）",
  "institutional.annualInSample": "年報酬（樣本內{range}）",
  "institutional.annualFull": "年報酬（完整）",
  "institutional.monthlyOosFrom": "月報酬（樣本外，自 {date} 起）",
  "institutional.monthlyOos": "月報酬（樣本外）",
  "institutional.annualOosFrom": "年報酬（樣本外，自 {date} 起）",
  "institutional.annualOos": "年報酬（樣本外）",
  "institutional.horizonTitle": "各期間績效（樣本內 / 樣本外 / 完整）",
  "institutional.horizon": "期間",
  "institutional.maxDd": "最大回撤",
  "institutional.rebalanceExecution": "再平衡執行",
  "institutional.freq": "頻率",
  "institutional.count": "次數",
  "institutional.sampleDates": "樣本日期",
  "institutional.exposure": "曝險",
  "institutional.assetClass": "資產類別",
  "institutional.bucketsRegion": "依地區",
  "institutional.equity": "股票",
  "institutional.bond": "債券",
  "institutional.other": "其他",
  "institutional.durationProxy": "平均存續期間（年）",
  "institutional.riskContributionTop": "主要風險貢獻者",
  "institutional.weightShort": "權重",
  "institutional.drawdownCurve": "回撤曲線",
  "institutional.drawdownEpisodes": "回撤事件",
  "institutional.insufficientData": "資料不足",
  "institutional.noData": "無資料",

  // Results extended
  "results.failedLoadTrajectory": "無法載入此圖表",
  "results.compareRetried": "已重試 AI 比較",
  "results.warning.sampleData":
    "提醒：結果使用範例資料，而非即時市場資料。請將指標視為示意。",
  "results.warning.unrealistic":
    "提醒：部分指標看起來不太合理。請檢查你的資料與參數。",
  "results.liveData": "即時市場資料 · {start} → {end} · {rows} 個交易日",
  "results.requested": "已要求",
  "results.lateListingsDropped": "已排除較新上市標的",
  "results.viewing": "檢視中",
  "results.round": "輪次",
  "results.newRoundBest": "本輪新最佳",
  "results.proRefinement": "Pro 優化",
  "results.rounds": "輪",
  "results.trials": "種策略",
  "results.earlyStop": "提前結束",
  "results.parameterSearch": "搜尋",
  "results.feasible": "可行",
  "results.reported": "已列報",
  "results.catalog": "總覽",
  "results.rebalance": "再平衡",
  "results.applied": "已套用",
  "results.orderByModel": "排序：依編號",
  "results.sort": "排序",
  "results.rankedOnInSample": "依樣本內排名",
  "results.gapInOut": "落差（樣本內 − 樣本外）",
  "results.winRate": "勝率",
  "results.avgTurnover": "平均換手率",
  "results.totalTurnover": "總換手率",
  "results.maxDdDays": "最大回撤天數",
  "results.var95": "VaR 95%（日）",
  "results.cvar95": "CVaR 95%（日）",
  "results.te": "追蹤誤差",
  "results.ir": "資訊比率",
  "results.horizonCompareTitle": "樣本內 / 樣本外 / 完整",
  "results.horizonMetricsHint":
    "各期間的關鍵指標。策略僅依樣本內期間挑選。",
  "results.metric": "指標",
  "results.gapObjectiveSharpe": "樣本內 − 樣本外落差：目標",
  "results.positiveInSampleStronger": "正值代表樣本內表現較強",
  "results.championLeaderboard": "排行榜 · 依樣本內期間為策略排名",
  "results.sortTableBy": "表格排序依據",
  "results.inSampleSelection": "樣本內（挑選）",
  "results.engine": "引擎",
  "results.holdings": "持股",
  "results.cap": "上限",
  "results.weightChartMayListMore": "持股圖表可能會顯示跨再平衡的更多標的",
  "results.maxWeight": "最大權重",
  "results.runCap": "執行上限",
  "results.effective": "有效",
  "results.observed": "實際觀察",
  "results.selectionHint": "依樣本內挑選；樣本外作為實戰驗證",
  "results.weightCapBreach": "超過權重上限：實際觀察",
  "results.vsEffectiveCap": "對比有效上限",
  "results.firstOn": "首次出現於",
  "results.only": "僅",
  "results.tradableNames": "可交易持股",
  "results.needAtLeast": "需 ≥",
  "results.aiComparison": "AI 比較",
  "results.generatingComparison": "正在產生比較…",
  "results.noComparisonYet": "目前尚無可用比較",
  "results.benchmark": "基準",
  "results.champion": "冠軍",
  "results.cagrPct": "年化報酬 %",
  "results.maxDdPct": "最大回撤 %",
  "results.dynamicObjectives": "動態目標",
  "results.dynamicObjectivesHint":
    "市場狀態與現行目標已在下方的績效與持股圖表中以陰影標示。",
  "results.loadingTrajectory": "載入 {model} 中…",
  "results.walkForwardHint":
    "市場狀態與現行目標隨時間的變化，與績效及持股圖表對齊。",
  "results.proChampionScorePrefix": "Pro 優勝者依樣本內的",
  "results.comprehensiveScore": "綜合分數",
  "results.proChampionScoreFormula":
    "0.45×夏普 + 0.25×索提諾 + 0.20×(5×年化報酬) − 0.35×|最大回撤| − 0.10×換手率。",
  "results.selectTrialHint": "選取上方的策略以查看其績效與持股。",
  "results.efficientFrontierHint":
    "藍點是 Jasper 嘗試過的策略；橘點是報告中列出的精選策略。",
  "results.annVol": "年化波動度（%）",
  "results.annReturn": "年化報酬（%）",
  "results.outputModel": "精選策略",
  "results.searchTrial": "已測試策略",
  "results.paramSamples": "已嘗試策略數",
  "results.outputModels": "精選策略",
  "results.universeFilter": "投資範圍篩選",
  "results.universeFilterHint": "其他資產類別不納入搜尋。",
  "results.targetNamesRegime": "目標標的（{regime} 狀態）",
  "results.targetNamesAi": "目標標的（來自 AI）",
  "results.targetCount": "目標檔數",
  "results.actualClassWeights": "實際資產類別配置（持股）",
  "results.classBreakdownChampion":
    "顯示冠軍的資產類別配置 — 此策略只儲存了精簡版本。",
  "results.weightPct": "權重 %",
  "results.factorAttributionChampion":
    "顯示冠軍的因子拆解 — 此策略未儲存完整明細。",
  "results.noFactorAttribution": "沒有可用的因子拆解",
  "results.contribPct": "貢獻 %",
  "results.observations": "觀察筆數",
  "results.rebalanceCrossSections": "再平衡快照",
  "results.factorMetricLogic": "因子如何衡量",
  "results.noMetricLogic": "沒有可用的因子明細",
  "results.summaryOnlyModel":
    "此策略僅有摘要 — 沒有詳細持股或圖表。請挑選有完整報告的策略以深入了解。",
  "results.analyticsFallback":
    "滾動、曝險與報酬表格取自冠軍；標題指標則對應你選取的策略。",
  "results.aiParameterRationale": "AI 為何選擇這些設定",
  "results.generation": "世代",
  "results.noAiRationale": "本次執行沒有 AI 說明。",
  "results.fullRunConfig": "完整設定（JSON）",
  "results.manualAdjustment": "手動調整",
  "results.disclaimer":
    "僅供研究與教育用途 — 非投資建議。資料：",
  "results.chart.performanceComparison": "績效比較",
  "results.chart.trajectoryHoldings": "績效與持股",
  "results.chart.efficientFrontier": "風險 vs. 報酬（效率前緣）",
  "results.chart.aiClassQuotas": "AI 資產類別目標",
  "results.chart.factorAttribution": "因子歸因",
  "results.chart.latestAllocation": "目前配置",
  "results.chart.reproducibleParameters": "重現本次執行的設定",
  "results.factor.momentum": "動能",
  "results.factor.reversal": "反轉",
  "results.factor.value": "價值",
  "results.factor.lowvol": "低波動",
  "results.factor.trend": "趨勢",
  "results.factor.drawdown": "回撤",
};

const ko: Dict = {
  // Header / shell
  "header.phase.scenario": "—",
  "header.phase.constraints": "설정",
  "header.phase.running": "실행 중",
  "header.phase.results": "결과",
  "header.phase.export": "내보내기",
  "header.apiOffline": "서비스 오프라인",
  "header.apiOfflineHint": "지금은 분석 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  "header.apiLinked": "연결됨",
  "header.etfs": "ETF {count}개",
  "header.objectiveLab": "목표 전환 랩",
  "header.terminalLog": "활동 로그",
  "lang.label": "언어",
  "lang.aria": "언어",
  "font.label": "글꼴",

  // Backtest history panel
  "history.title": "백테스트 기록",
  "history.refresh": "새로고침",
  "history.syncing": "동기화 중…",
  "history.apiOffline": "오프라인 — 로컬 결과 표시",
  "history.record": "결과 {count}개",
  "history.records": "결과 {count}개",
  "history.empty": "완료된 백테스트가 여기에 표시됩니다. 한 번 실행해 시작해 보세요.",
  "history.load": "열기",
  "history.status.completed": "완료됨",
  "history.status.failed": "실패",
  "history.status.running": "실행 중",
  "history.status.queued": "대기 중",

  // Constraints / config form
  "config.title": "백테스트 설정",
  "config.subtitle":
    "아래에서 전략을 설정하세요. 리밸런싱할 때마다 Jasper가 가장 강한 종목을 추려낸 뒤, 위험과 수익의 균형을 맞춰 비중을 배분합니다.",
  "config.maxWeight": "종목당 최대 비중: {pct}%",
  "config.minWeight": "종목당 최소 비중: {pct}%",
  "config.minWeightHint":
    "이 비중보다 작은 종목은 리밸런싱마다 제외되고, 확보된 자금은 나머지 종목에 분산됩니다.",
  "config.maxTurnover": "리밸런싱당 최대 회전율: {pct}%",
  "config.maxTurnoverHint":
    "Jasper가 리밸런싱마다 거래할 수 있는 포트폴리오 비율을 제한해 거래 비용을 억제합니다.",
  "config.maxHoldings": "최대 보유 종목 수: {n}",
  "config.maxHoldingsHint": "포트폴리오가 동시에 보유하는 최대 종목 수입니다.",
  "config.topN": "후보 종목 수(Top N): {n}",
  "config.topNHint": "Jasper가 모든 후보의 순위를 매기고 상위 {n}개를 골라 포트폴리오를 구성합니다.",
  "config.objective": "최적화 목표",
  "config.customObjective": "목표를 설명하세요",
  "config.start": "시작일",
  "config.startHint":
    "이 날짜 이전의 가격 데이터를 추가로 불러와, 첫날 비중이 임시 값이 아닌 실제 신호를 기반으로 정해집니다.",
  "config.end": "종료일",
  "config.trials": "탐색 강도: 전략 {n}개",
  "config.topModels": "보고서에 표시할 전략 수: {n}",
  "config.holdout":
    "최근 데이터를 검증용으로 보류(Jasper가 이전 구간에서 최적화한 뒤, 보지 않은 데이터로 결과를 확인합니다)",
  "config.inSampleRatio": "앞쪽 {pct}%로 최적화(나머지는 검증용으로 보류)",
  "config.fee": "거래 비용: {bps} bps",
  "config.rebalanceFreq": "리밸런싱 주기",
  "config.rebalance.weekly": "매주(금요일)",
  "config.rebalance.monthly": "매월",
  "config.rebalance.quarterly": "분기별",
  "config.rebalance.yearly": "매년",
  "config.runStandard": "백테스트 실행",
  "config.runPro": "Pro 최적화 실행",

  // Pro rounds tabs
  "pro.tabsHint":
    "각 탭은 한 라운드입니다: 현재 선두와 그 도전자들. ★는 라운드 우승자를 표시합니다. 카탈로그 탭에는 지금까지 시도한 모든 전략이 나열됩니다.",
  "pro.allRounds": "전체 라운드",
  "pro.role.incoming": "현재 선두",
  "pro.role.challenger": "도전자",
  "pro.role.winner": "라운드 우승자",

  // Results dashboard
  "results.title": "결과",
  "results.model": "전략",
  "results.fullNarrative": "전체 요약",
  "results.fullPeriod": "전체 기간",
  "results.refineHint": "클릭하면 조정 적용 · 더블클릭하면 적용 후 다시 실행.",
  "results.editConfig": "설정 편집",
  "results.exportCsv": "CSV 내보내기",

  // Conversation log
  "chat.welcome":
    "Jasper가 준비되었습니다 — ETF {count}개를 분석할 수 있습니다. 아래에서 전략을 설정하고 백테스트를 실행하세요. 리밸런싱할 때마다 Jasper가 가장 강한 종목을 추려낸 뒤, 위험과 수익의 균형을 맞춰 비중을 배분합니다.",
  "chat.complete":
    "백테스트 완료. 최고 전략: {model} vs {benchmark} — 샤프 {sharpe}, 최대 낙폭 {mdd}%, CAGR {cagr}%. 결과 패널에서 다른 전략과 비교해 보세요.",
  "chat.loadHistory": "저장된 백테스트 {id} 열기…",
  "chat.loadHistoryLocal": "저장된 백테스트 {id} 열기(로컬 사본)…",
  "chat.jobNotCompleted": "백테스트 {id}가 아직 완료되지 않았습니다({status}).",
  "chat.jobNotFound": "이 백테스트를 서버에서도 기기에서도 찾을 수 없습니다.",
  "chat.historyLoadFailed": "저장된 백테스트를 열 수 없습니다.",
  "chat.runFailed": "백테스트를 완료하지 못했습니다. 다시 시도해 주세요.",
  "chat.userRunPro": "Pro 최적화 실행",
  "chat.userRunStandard": "백테스트 실행",
  "chat.ackPro": "Pro 최적화를 시작합니다. Jasper가 여러 전략을 테스트하며 과적합을 방지합니다…",
  "chat.ackStandard": "백테스트를 실행하는 중…",
  "chat.tweak": "조정: {label}",
  "chat.tweakApplied": "업데이트되었습니다. 더 변경하거나 ↻를 눌러 지금 다시 실행하세요.",
  "chat.tweakRerun": "조정 후 다시 실행: {label}",
  "chat.ackRerun": "업데이트된 설정으로 다시 실행하는 중…",
  "chat.backToConfig": "설정으로 돌아가기",

  // Common labels
  "common.on": "켜기",
  "common.off": "끄기",
  "common.yes": "예",
  "common.no": "아니요",
  "common.loading": "로딩 중",
  "common.date": "날짜",
  "common.name": "이름",
  "common.period": "기간",
  "common.return": "수익률",
  "common.objective": "목표",
  "common.inSample": "인샘플",
  "common.outOfSample": "아웃오브샘플",
  "common.full": "전체",
  "common.gap": "격차",
  "common.regime": "국면",
  "common.active": "활성",
  "common.vol": "변동성",
  "common.cagr": "CAGR",
  "common.maxDd": "최대 낙폭",
  "common.sharpe": "샤프",
  "common.sortino": "소르티노",
  "common.calmar": "칼마",
  "common.beta": "베타",
  "common.alpha": "알파",
  "common.ticker": "티커",
  "common.unknown": "알 수 없음",
  "common.cumulativeReturn": "누적 수익률",
  "common.activeRegime": "활성 국면",
  "common.rawRegime": "원시 국면",
  "common.switch": "전환",

  // Pro panel
  "proPanel.title": "Pro · AI 최적화",
  "proPanel.desc.beforeDynamic":
    "Jasper가 현재 선두에 맞서 도전자들을 라운드별로 겨루게 합니다. AI는 이전에 효과적이었던 설정을 바탕으로 새 설정을 제안하고, 결과가 더 좋아지지 않을 때까지 다듬습니다.",
  "proPanel.dynamic": "동적",
  "proPanel.desc.afterDynamic":
    "목표는 시장 분위기(위험 회피, 중립, 위험 선호)별로 전략을 따로 조정하고, 상황이 바뀌면 알맞은 전략을 적용합니다.",
  "proPanel.estimationPrefix": "Pro 모드가 탐색 강도를 대신 관리합니다. 최대 약",
  "proPanel.estimationSuffix": "회를 실행하며, 결과가 더 좋아지지 않으면 조기에 종료될 수 있습니다.",
  "proPanel.highTrialsWarning":
    "설정이 높을수록 훨씬 많은 백테스트를 실행하고 시간이 더 걸립니다. 각 라운드는 하나의 AI 제안으로 탐색을 안내합니다.",
  "proPanel.round1Batch": "첫 라운드 전략 수",
  "proPanel.round1BatchHint": "첫 라운드에서 시도할 전략 수(3–100).",
  "proPanel.challengersPerRound": "라운드당 도전자 수",
  "proPanel.challengersPerRoundHint": "라운드마다 선두에 맞서 테스트할 새 전략 수(2–100).",
  "proPanel.maxRounds": "최대 라운드",
  "proPanel.maxRoundsHint": "첫 라운드를 포함해 실행할 최대 라운드 수(2–30).",
  "proPanel.patienceRounds": "인내 라운드",
  "proPanel.holdoutTip":
    "팁: 홀드아웃을 켜면 전략이 최적화 기간으로 순위가 매겨진 뒤, 보지 않은 데이터로 검증됩니다.",

  "quickRefinements.title": "빠른 조정",
  "quickRefinements.doubleClickHint": "더블클릭하면 다시 실행",

  "progress.running": "실행 중…",
  "progress.roundUnderperformed": "이번 라운드가 벤치마크에 못 미침",
  "progress.roundUnderperformedHint":
    "이번 라운드 수익률이 벤치마크를 밑돌았습니다. Jasper가 다음 라운드에서 계속 탐색합니다.",
  "progress.portfolioReturn": "포트폴리오 수익률",
  "progress.benchmark": "벤치마크",
  "progress.round": "라운드",
  "progress.bestInSample": "현재까지 최고",

  "customScenario.title": "나의 시장 관점",
  "customScenario.description":
    "거시, 섹터 또는 리스크 전망을 설명하면 Jasper가 백테스트할 수 있는 전략으로 바꿔 줍니다.",
  "customScenario.placeholder":
    "예: 미국 인플레이션 고착, 연준 고금리 장기화, 성장주 밸류에이션 압박 — 단기 채권과 방어주로 기울이기…",
  "customScenario.analyzing": "구성 중…",
  "customScenario.analyzeButton": "시나리오 구성",
  "customScenario.analysisFailed": "시나리오를 구성하지 못했습니다",
  "customScenario.analysisFailedRetry": "시나리오를 구성하지 못했습니다. 다시 시도해 주세요.",

  "assetFilter.assetClasses": "자산군",
  "assetFilter.aiFilter": "AI 투자 검색",
  "assetFilter.clearAiFilter": "지우기",
  "assetFilter.layer1Hint":
    "Jasper는 선택한 자산군의 모든 종목으로 포트폴리오를 구성하며, 리밸런싱할 때마다 최적의 종목을 고릅니다.",
  "assetFilter.layer2Hint":
    "규칙을 추가한 뒤 검색을 실행하세요. Jasper가 전체 {total}개 ETF를 살펴보고 일치하는 종목을 풀에 추가합니다.",
  "assetFilter.placeholder":
    "예: 인버스 주식 헤지 ETF; 미국 기술·헬스케어; AI 산업 테마",
  "assetFilter.addRule": "규칙 추가",
  "assetFilter.remove": "제거",
  "assetFilter.applying": "검색 중…",
  "assetFilter.applyAiFilter": "검색 실행",
  "assetFilter.results": "결과",
  "assetFilter.analysisFailed": "검색 실패",
  "assetFilter.analysisFailedRetry": "검색에 실패했습니다. 다시 시도해 주세요.",
  "assetFilter.supplementTicker": "개 추가 종목",
  "assetFilter.matchedInUniverse": "개 일치",
  "assetFilter.new": "신규",
  "assetFilter.expand": "펼치기",
  "assetFilter.categories": "카테고리",
  "assetFilter.matched": "일치",
  "assetFilter.noneForRule": "(이 규칙에 일치하는 종목 없음)",
  "assetFilter.newVsBase": "새로 추가됨",
  "assetFilter.guaranteed": "항상 포함",
  "assetFilter.guaranteedHint": "이 종목들은 항상 백테스트에 포함됩니다.",

  "linkedChart.tooltipRegime": "국면",
  "linkedChart.tooltipActiveObjective": "활성 목표",
  "linkedChart.noHistory": "이 전략에는 성과나 보유 종목 기록이 없습니다.",
  "linkedChart.linkedCursorHint":
    "아무 차트에나 마우스를 올려 보세요 — 성과, 시장 국면, 보유 종목이 모두 같은 날짜에 정렬됩니다.",
  "linkedChart.cumulativeTitle": "누적 수익률 % — 포트폴리오 vs {benchmark}",
  "linkedChart.amberSwitch": "황색 = 전환",
  "linkedChart.holdingsTitle": "기간별 보유 종목",
  "linkedChart.otherCapHint": "비중이 작은 종목은 ‘기타’로 묶음",
  "linkedChart.hoverHint": "차트에 마우스를 올리면 보유 종목 표시",
  "linkedChart.other": "기타",

  "objectiveLab.rec.apply": "추천: 적용",
  "objectiveLab.rec.notYet": "추천: 아직 아님",
  "objectiveLab.rec.needMoreData": "추천: 데이터가 더 필요함",
  "objectiveLab.reportCard": "랩 결과",
  "objectiveLab.oosSharpeDelta": "아웃오브샘플 샤프 개선(전환 vs. 고정):",
  "objectiveLab.regimeDetector": "국면 감지기",
  "objectiveLab.detectorV2": "위험 선호와 위험 회피 신호를 가늠해 시장을 읽음",
  "objectiveLab.detectorLegacy": "기존 수익률·변동성 임계값",
  "objectiveLab.fastRiskOffExit": "반등 시 위험 회피에서 빠르게 빠져나오기(21일)",
  "objectiveLab.fixedObjective": "고정 목표",
  "objectiveLab.switchPolicy": "전환 전략",
  "objectiveLab.benchmarkVsRegime": "벤치마크 vs. 시장 국면",
  "objectiveLab.regimeScores": "국면 점수 vs. 활성 국면",
  "objectiveLab.hoverSyncHint": "두 차트 중 하나에 마우스를 올리면 둘 다 같은 날짜에 정렬됩니다.",
  "objectiveLab.regimeTimeline": "국면 타임라인",
  "objectiveLab.off": "끄기",
  "objectiveLab.on": "켜기",

  "benchmarkChart.noSeries": "차트로 그릴 벤치마크 데이터가 없습니다.",
  "benchmarkChart.noValidDates": "차트로 그릴 유효한 날짜가 없습니다.",
  "benchmarkChart.cumPct": "{ticker} 누적 %",
  "benchmarkChart.footer":
    "위: {ticker} 누적 수익률(%). 음영 띠는 시장 국면을 나타내고, 황색 띠는 국면 전환을 표시합니다. 마우스를 올리면 아래 국면 점수와 동기화됩니다.",

  "regimeScore.noScores": "아직 국면 점수가 없습니다. 최신 감지기를 사용하거나 최적화 기간을 늘려 보세요.",
  "regimeScore.noValidDates": "차트로 그릴 유효한 날짜가 없습니다.",
  "regimeScore.stepWinner": "선두 점수",
  "regimeScore.rawRegime": "원시 국면",
  "regimeScore.activeRegime": "활성 국면",
  "regimeScore.riskOffScore": "위험 회피 점수",
  "regimeScore.riskOnScore": "위험 선호 점수",
  "regimeScore.neutralImplied": "중립(추정)",
  "regimeScore.footer":
    "기간에 따른 위험 선호·위험 회피 신호 점수입니다. 툴팁에는 선두 점수와 Jasper가 실제로 적용한 국면이 표시됩니다. 마우스를 올리면 위 벤치마크 차트와 동기화됩니다.",

  "dynamicObjective.noSeries": "차트로 그릴 벤치마크 데이터가 없습니다.",
  "dynamicObjective.noValidDates": "차트로 그릴 유효한 날짜가 없습니다.",
  "dynamicObjective.cumPct": "{ticker} 누적 %",
  "dynamicObjective.footer":
    "위: {ticker} 누적 수익률(%); 음영 배경은 기간별로 어떤 목표가 활성이었는지 보여 줍니다. 아래: 목표 전환(황색 = 전환). 마우스를 올리면 위 성과 차트와 동기화됩니다.",

  "institutional.loadingAnalytics": "분석",
  "institutional.noAnalytics": "사용 가능한 상세 분석이 없습니다 — 백테스트를 다시 실행해 주세요.",
  "institutional.monthlyInSample": "월별 수익률(인샘플{range})",
  "institutional.monthlyFull": "월별 수익률(전체)",
  "institutional.annualInSample": "연간 수익률(인샘플{range})",
  "institutional.annualFull": "연간 수익률(전체)",
  "institutional.monthlyOosFrom": "월별 수익률(아웃오브샘플, {date}부터)",
  "institutional.monthlyOos": "월별 수익률(아웃오브샘플)",
  "institutional.annualOosFrom": "연간 수익률(아웃오브샘플, {date}부터)",
  "institutional.annualOos": "연간 수익률(아웃오브샘플)",
  "institutional.horizonTitle": "기간별 성과(인샘플 / 아웃오브샘플 / 전체)",
  "institutional.horizon": "기간",
  "institutional.maxDd": "최대 낙폭",
  "institutional.rebalanceExecution": "리밸런싱 실행",
  "institutional.freq": "주기",
  "institutional.count": "횟수",
  "institutional.sampleDates": "표본 날짜",
  "institutional.exposure": "익스포저",
  "institutional.assetClass": "자산군",
  "institutional.bucketsRegion": "지역별",
  "institutional.equity": "주식",
  "institutional.bond": "채권",
  "institutional.other": "기타",
  "institutional.durationProxy": "평균 듀레이션(년)",
  "institutional.riskContributionTop": "주요 위험 기여 종목",
  "institutional.weightShort": "비중",
  "institutional.drawdownCurve": "낙폭 곡선",
  "institutional.drawdownEpisodes": "낙폭 구간",
  "institutional.insufficientData": "데이터 부족",
  "institutional.noData": "데이터 없음",

  // Results extended
  "results.failedLoadTrajectory": "이 차트를 불러오지 못했습니다",
  "results.compareRetried": "AI 비교를 다시 시도했습니다",
  "results.warning.sampleData":
    "참고: 결과는 실시간 시장 데이터가 아닌 샘플 데이터를 사용합니다. 지표는 예시로만 봐 주세요.",
  "results.warning.unrealistic":
    "참고: 일부 지표가 비현실적으로 보입니다. 데이터와 매개변수를 확인해 주세요.",
  "results.liveData": "실시간 시장 데이터 · {start} → {end} · 거래일 {rows}일",
  "results.requested": "요청됨",
  "results.lateListingsDropped": "최근 상장 종목 제외됨",
  "results.viewing": "보기",
  "results.round": "라운드",
  "results.newRoundBest": "이번 라운드 최고",
  "results.proRefinement": "Pro 개선",
  "results.rounds": "라운드",
  "results.trials": "개 전략",
  "results.earlyStop": "조기 종료",
  "results.parameterSearch": "검색",
  "results.feasible": "실현 가능",
  "results.reported": "보고됨",
  "results.catalog": "카탈로그",
  "results.rebalance": "리밸런싱",
  "results.applied": "적용됨",
  "results.orderByModel": "정렬: 번호순",
  "results.sort": "정렬",
  "results.rankedOnInSample": "인샘플 기준 순위",
  "results.gapInOut": "격차(인샘플 − 아웃오브샘플)",
  "results.winRate": "승률",
  "results.avgTurnover": "평균 회전율",
  "results.totalTurnover": "총 회전율",
  "results.maxDdDays": "최대 낙폭 일수",
  "results.var95": "VaR 95%(일)",
  "results.cvar95": "CVaR 95%(일)",
  "results.te": "추적 오차",
  "results.ir": "정보 비율",
  "results.horizonCompareTitle": "인샘플 / 아웃오브샘플 / 전체",
  "results.horizonMetricsHint":
    "기간별 주요 지표. 전략은 인샘플 기간으로만 선택됩니다.",
  "results.metric": "지표",
  "results.gapObjectiveSharpe": "인샘플 − 아웃오브샘플 격차: 목표",
  "results.positiveInSampleStronger": "양수면 인샘플이 더 강함을 의미",
  "results.championLeaderboard": "리더보드 · 인샘플 기간으로 순위를 매긴 전략",
  "results.sortTableBy": "표 정렬 기준",
  "results.inSampleSelection": "인샘플(선택)",
  "results.engine": "엔진",
  "results.holdings": "보유 종목",
  "results.cap": "상한",
  "results.weightChartMayListMore": "보유 종목 차트에는 리밸런싱 전반에 걸쳐 더 많은 종목이 표시될 수 있음",
  "results.maxWeight": "최대 비중",
  "results.runCap": "실행 상한",
  "results.effective": "유효",
  "results.observed": "실측",
  "results.selectionHint": "인샘플로 선택; 아웃오브샘플은 실전 검증 역할",
  "results.weightCapBreach": "비중 상한 초과: 실측",
  "results.vsEffectiveCap": "유효 상한 대비",
  "results.firstOn": "최초 등장",
  "results.only": "단",
  "results.tradableNames": "거래 가능 종목",
  "results.needAtLeast": "최소 ≥ 필요",
  "results.aiComparison": "AI 비교",
  "results.generatingComparison": "비교 생성 중…",
  "results.noComparisonYet": "아직 사용 가능한 비교가 없습니다",
  "results.benchmark": "벤치마크",
  "results.champion": "챔피언",
  "results.cagrPct": "CAGR %",
  "results.maxDdPct": "최대 낙폭 %",
  "results.dynamicObjectives": "동적 목표",
  "results.dynamicObjectivesHint":
    "시장 국면과 활성 목표가 아래 성과 및 보유 종목 차트에 음영으로 표시됩니다.",
  "results.loadingTrajectory": "{model} 불러오는 중…",
  "results.walkForwardHint":
    "기간에 따른 시장 국면과 활성 목표로, 성과 및 보유 종목 차트와 정렬됩니다.",
  "results.proChampionScorePrefix": "Pro 우승자는 인샘플 기준",
  "results.comprehensiveScore": "종합 점수",
  "results.proChampionScoreFormula":
    "0.45×샤프 + 0.25×소르티노 + 0.20×(5×CAGR) − 0.35×|최대 낙폭| − 0.10×회전율.",
  "results.selectTrialHint": "위에서 전략을 선택하면 성과와 보유 종목을 볼 수 있습니다.",
  "results.efficientFrontierHint":
    "파란 점은 Jasper가 시도한 전략이고, 주황 점은 보고서에 표시된 추천 전략입니다.",
  "results.annVol": "연 변동성(%)",
  "results.annReturn": "연 수익률(%)",
  "results.outputModel": "추천 전략",
  "results.searchTrial": "테스트한 전략",
  "results.paramSamples": "시도한 전략 수",
  "results.outputModels": "추천 전략",
  "results.universeFilter": "유니버스 필터",
  "results.universeFilterHint": "다른 자산군은 검색에서 제외됩니다.",
  "results.targetNamesRegime": "목표 종목({regime} 국면)",
  "results.targetNamesAi": "목표 종목(AI 제공)",
  "results.targetCount": "목표 종목 수",
  "results.actualClassWeights": "실제 자산군 구성(보유 종목)",
  "results.classBreakdownChampion":
    "챔피언의 자산군 구성을 표시합니다 — 이 전략은 압축 버전만 저장했습니다.",
  "results.weightPct": "비중 %",
  "results.factorAttributionChampion":
    "챔피언의 팩터 분해를 표시합니다 — 이 전략은 전체 세부 정보를 저장하지 않았습니다.",
  "results.noFactorAttribution": "사용 가능한 팩터 분해가 없습니다",
  "results.contribPct": "기여도 %",
  "results.observations": "관측치",
  "results.rebalanceCrossSections": "리밸런싱 스냅샷",
  "results.factorMetricLogic": "팩터를 어떻게 측정했는지",
  "results.noMetricLogic": "사용 가능한 팩터 세부 정보가 없습니다",
  "results.summaryOnlyModel":
    "이 전략은 요약만 있습니다 — 상세 보유 종목이나 차트가 없습니다. 더 살펴보려면 전체 보고서가 있는 전략을 선택하세요.",
  "results.analyticsFallback":
    "롤링·익스포저·수익률 표는 챔피언에서 가져오며, 헤드라인 지표는 선택한 전략과 일치합니다.",
  "results.aiParameterRationale": "AI가 이 설정을 선택한 이유",
  "results.generation": "세대",
  "results.noAiRationale": "이번 실행에 대한 AI 설명이 없습니다.",
  "results.fullRunConfig": "전체 설정(JSON)",
  "results.manualAdjustment": "수동 조정",
  "results.disclaimer":
    "연구 및 교육 목적으로만 제공 — 투자 자문이 아닙니다. 데이터:",
  "results.chart.performanceComparison": "성과 비교",
  "results.chart.trajectoryHoldings": "성과 및 보유 종목",
  "results.chart.efficientFrontier": "위험 vs. 수익(효율적 프런티어)",
  "results.chart.aiClassQuotas": "AI 자산군 목표",
  "results.chart.factorAttribution": "팩터 기여도",
  "results.chart.latestAllocation": "현재 배분",
  "results.chart.reproducibleParameters": "이 실행을 재현하기 위한 설정",
  "results.factor.momentum": "모멘텀",
  "results.factor.reversal": "리버설",
  "results.factor.value": "가치",
  "results.factor.lowvol": "저변동성",
  "results.factor.trend": "추세",
  "results.factor.drawdown": "낙폭",
};

const DICTS: Record<Lang, Dict> = { en, zh, ko };

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

export type TFn = (key: string, params?: Record<string, string | number>) => string;

export function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const template = DICTS[lang]?.[key] ?? DICTS.en[key] ?? key;
  return interpolate(template, params);
}

export function readStoredLang(): Lang {
  if (typeof window === "undefined") return DEFAULT_LANG;
  try {
    const raw = localStorage.getItem(LANG_STORAGE_KEY);
    return isLang(raw) ? raw : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

function persistLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* private mode / quota */
  }
}

type I18nContextValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TFn;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  useEffect(() => {
    setLangState(readStoredLang());
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    persistLang(next);
    if (typeof document !== "undefined") {
      document.documentElement.lang = next;
    }
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang,
      t: (key, params) => translate(lang, key, params),
    }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return ctx;
}
