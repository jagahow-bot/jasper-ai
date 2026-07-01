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
  "font.aria": "Font size",
  "font.decrease": "Decrease font size",
  "font.increase": "Increase font size",
  "font.reset": "Reset font size",
  "font.resetShort": "RESET",

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
  "config.notifyEmail": "Email me when done (optional)",
  "config.notifyEmailPlaceholder": "you@example.com",
  "config.notifyEmailHint":
    "Backtests run on the server, so you can close this tab. If you enter an email, we'll notify you when the run finishes or fails.",

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

  "live.badge": "LIVE",
  "live.working": "Working…",
  "live.trial": "Strategy {n}/{total}",
  "live.recentActivity": "Recent activity",

  // Live progress messages (localized on the client from backend templates)
  "progress.msg.queued": "Backtest job queued…",
  "progress.msg.queuedPro": "Pro optimization job queued…",
  "progress.msg.fetching": "Fetching market data, starting optimization…",
  "progress.msg.fetchingPro": "Pro: fetching data, starting iterative search…",
  "progress.msg.complete": "Backtest complete",
  "progress.msg.completePro": "Pro optimization complete",
  "progress.msg.loaded":
    "Loaded {tickers} tickers, {rows} trading days. Each rebalance shortlists the strongest holdings, then sizes positions.",
  "progress.msg.loadedRegimeSuffix":
    " Regime-adaptive: allocator preset is set per rebalance.",
  "progress.msg.proHoldout":
    "Pro: strategies are ranked on the optimization period; the holdout is used for final checks…",
  "progress.msg.proLoop": "Pro: running challenger rounds (AI learns from history)…",
  "progress.msg.startingAi": "Starting AI — planning strategy seeds for {trials} strategies…",
  "progress.msg.aiDone": "AI done: {used} seed sets for {trials} strategies — starting backtests…",
  "progress.msg.aiDoneCapped":
    "AI done: {used} seed sets for {trials} strategies (AI capped at {cap}; extra strategies are search-only) — starting backtests…",
  "progress.msg.aiOff": "AI off ({err}) — falling back to automatic search…",
  "progress.msg.optuna": "Strategy {trial}/{total} ({scope})",
  "progress.msg.optunaBest": "Strategy {trial}/{total} ({scope}), best {label} {value}",
  "progress.msg.searchDone":
    "Search done ({feasible} feasible) — packaging top {top} for the report…",
  "progress.msg.packaging": "Packaging report: {inner}",
  "progress.msg.roundReport": "Round {round} report: {inner}",
  "progress.msg.proRound": "Round {round}/{max}: {carry}, preparing {n} challengers…",
  "progress.msg.roundOptuna": "Round {round} · strategy {trial}/{total} ({scope})",
  "progress.msg.roundOptunaBest":
    "Round {round} · strategy {trial}/{total} ({scope}), round best {label} {value}",
  "progress.msg.roundAiLearning":
    "Round {round}: AI learning from {n} weaker challengers, target score {score}…",
  "progress.msg.roundDone":
    "Round {round} done: round best {best}, leader {champ} (no-gain streak {streak}/{patience})",
  "progress.msg.roundDoneAlphaSuffix":
    " · in-sample alpha vs {benchmark} {alpha} (below benchmark)",
  "progress.msg.pkgFromCache": "Packaging {code} {label} from search cache ({rank}/{total})…",
  "progress.msg.pkgMetricsOnly": "Packaging {code} metrics only ({rank}/{total})…",
  "progress.msg.pkgNoCache":
    "Packaging {code} ({rank}/{total}): no cache — running backtests for charts…",
  "progress.msg.pkgIsOos":
    "Packaging {code} ({rank}/{total}): one full-period backtest for weights…",
  "progress.msg.pkgIncomplete":
    "Packaging {code} ({rank}/{total}): cache incomplete ({missing}) — running backtests…",
  "progress.msg.pkgTop": "top {top} of {feasible} pool strategies…",
  "progress.msg.scope.inSample": "in-sample",
  "progress.msg.scope.fullWindow": "full window",
  "progress.label.sharpe": "Sharpe",
  "progress.label.cagr": "CAGR",
  "progress.label.maxdd": "max drawdown",
  "progress.label.sortino": "Sortino",
  "progress.label.cvar": "CVaR",
  "progress.label.vol": "vol",
  "progress.label.comprehensive": "composite",
  "progress.label.metric": "metric",

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
  "linkedChart.portfolio": "Portfolio",

  // Market regime + allocator objective band labels (shared across charts)
  "regime.risk_off": "Risk-off",
  "regime.neutral": "Neutral",
  "regime.risk_on": "Risk-on",
  "objectiveBand.max_sharpe": "Max Sharpe",
  "objectiveBand.max_return": "Max CAGR",
  "objectiveBand.min_max_drawdown": "Min Max DD",

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
  "objectiveLab.predictionQualityTitle": "Regime prediction quality (episode-based)",
  "objectiveLab.predictionQualityDesc":
    "Scores each contiguous active-regime episode by benchmark behavior from switch-in until the label changes: risk-on if return > 0; risk-off if segment annualized vol ≥ 1.15× the lab episode-vol median; neutral relative to the prior episode — after risk-on, return ≤ 0 or below the prior risk-on segment return; after risk-off, segment vol below the prior risk-off segment; otherwise |return| ≤ 3%. Return and drawdown are shown for context. Unlike a fixed 21-day forward window per step, this does not replace the Sharpe A/B test.",
  "objectiveLab.episodeAlignment": "Episode alignment {score}/100",
  "objectiveLab.grade": "grade {grade}",
  "objectiveLab.episodes": "Episodes",
  "objectiveLab.medianDays": "Median days",
  "objectiveLab.avgReturn": "Avg return",
  "objectiveLab.hitRate": "Hit rate",
  "objectiveLab.longestEpisodes": "Longest episodes",
  "objectiveLab.largestMisses": "Largest misses",
  "objectiveLab.missesLegend":
    "Hits: risk-on (return > 0), risk-off (segment vol ≥ 1.15× episode-vol median), neutral (weakened after risk-on, calmer vol after risk-off, else |return| ≤ 3%). Largest misses are ranked by return shortfall (risk-on), vol shortfall (risk-off), or continued strength / insufficient vol drop (neutral).",
  "objectiveLab.secondaryForward": "Secondary: {days}d forward (per step)",
  "objectiveLab.stepLevelAlignment":
    "Step-level alignment {score}/100 — same return-based rules on {days}d forward windows; the headline score above uses full episodes.",
  "objectiveLab.regimeSwitches": "Regime switches: {count}",
  "objectiveLab.isSharpe": "IS Sharpe",
  "objectiveLab.oosSharpe": "OOS Sharpe",
  "objectiveLab.isReturn": "IS return",
  "objectiveLab.isMaxDd": "IS max DD",
  "objectiveLab.hit": "hit",
  "objectiveLab.miss": "miss",

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
  "results.dataRange": "Data: {start} → {end}, {rows} sessions",
  "results.endsOn": "ends {date}",
  "results.forThisCap": "for this cap",
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
  "results.dynamicScoreTitle": "Dynamic composite score — this is the ranking metric",
  "results.dynamicScoreExplain":
    "In dynamic mode, strategies aren't ranked by Sharpe or return alone. They are ranked by one composite score that blends risk-adjusted return, growth, drawdown and trading cost. That's why the champion (★) can win overall without topping any single column below.",
  "results.championWhyTitle": "Why ★ {code} is the champion",
  "results.leaderboardDynamicNote":
    "Values are the dynamic composite score for each period (higher is better). The champion (★) is chosen by AI on the In-Sample composite plus out-of-sample robustness, so it may not lead any single column.",
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

  // Constraints — offline + hints
  "config.runOfflineHint":
    "The analytics service is offline right now, so backtests can’t run. Please try again in a moment.",
  "config.assetClassSyncHint":
    "Your selected asset classes and their target weights stay in sync — anything you leave out is held at zero.",
  "config.limitsHint":
    "The sliders above set the upper limits Jasper works within. It tries a range of values up to each limit to find the best fit for your goal.",
  "config.objectiveHint.dynamic":
    "Dynamic adapts the portfolio to the market regime — defensive when risk is high, growth-seeking when conditions are strong, balanced in between. Champions are ranked on one blended composite score (risk-adjusted return + growth + drawdown + trading cost), not a single metric. To be judged purely on one goal such as Max CAGR while still switching by regime, pick that goal and turn on Regime-adaptive allocation below.",
  "config.objectiveHint.default":
    "With a holdout turned on, strategies are ranked on the optimization period; the holdout and full-period results are shown for comparison only.",
  "config.regimeAdaptive": "Regime-adaptive allocation",
  "config.regimeAdaptiveHint.dynamic":
    "Always on with the Dynamic goal: the allocator switches preset by market regime (defensive / balanced / growth) every rebalance.",
  "config.regimeAdaptiveHint.on":
    "On: the allocator switches preset by market regime (risk-off / neutral / risk-on) each rebalance, while your chosen goal above still decides how strategies are ranked.",
  "config.regimeAdaptiveHint.off":
    "Off: one allocation style is used across all market conditions. Turn on to let the allocator adapt by regime while keeping your ranking goal above.",
  "config.customObjectivePlaceholder":
    "e.g. low drawdown first, then return, keep turnover modest",
  "config.customObjectiveHint": "Jasper turns this into a goal it can optimize for.",
  "config.trialsHint.pro":
    "Pro mode manages this for you using the round settings above.",
  "config.trialsHint.standard":
    "How many strategies to test. The first few start from AI suggestions; the rest are explored automatically. Set the report size below.",
  "config.benchmarkLine": "Benchmark: SPY · Risk-free rate: 4%",

  // Constraints — advanced controls
  "config.advanced.title": "Advanced controls (optional)",
  "config.advanced.maxWeightNote":
    "The max single-weight search cannot exceed {pct}% (run slider).",
  "config.advanced.categorical": "Categorical",
  "config.advanced.factorIndicators": "Factor indicators (per factor)",
  "config.advanced.search": "Search",
  "config.advanced.fixed": "Fixed",
  "config.advanced.off": "Off",
  "config.advanced.searchHint":
    "The search considers all options; your selection is an AI starting hint",
  "config.advanced.fixedHint": "Fixed indicator for this factor",

  // Constraints — categorical labels
  "config.categorical.objective_mode": "Objective fn",
  "config.categorical.allocator_mode": "Allocator mode",
  "config.categorical.rebalance_freq": "Rebalance freq",

  // Constraints — advanced numeric control labels
  "config.control.subPrefix": "Sub {label}",
  "config.control.lookback_days": "Allocator lookback (d)",
  "config.control.shrinkage": "Cov shrinkage",
  "config.control.risk_aversion": "Risk aversion",
  "config.control.max_weight_actual": "Max single weight (trial)",
  "config.control.top_n_actual": "Top N (actual)",
  "config.control.factor_lookback_days": "Factor lookback (d)",
  "config.control.reversal_lookback_days": "Reversal lookback (d)",
  "config.control.value_lookback_days": "Value lookback (d)",
  "config.control.no_trade_tol": "No-trade band",
  "config.control.turnover_penalty_mult": "Turnover penalty",
  "config.control.max_turnover_actual": "Max turnover / rebalance",
  "config.control.w_mom": "Wt momentum",
  "config.control.w_reversal": "Wt reversal",
  "config.control.w_value": "Wt value",
  "config.control.w_lowvol": "Wt low-vol",
  "config.control.w_trend": "Wt trend",
  "config.control.w_drawdown": "Wt drawdown qual",
  "config.control.w_equity": "Alloc equity",
  "config.control.w_bond": "Alloc bond",
  "config.control.w_commodity": "Alloc commodity",
  "config.control.w_real_estate": "Alloc REIT",
  "config.control.w_alternative": "Alloc alt",

  // Quick refinements
  "refinements.bond-tilt.label": "Bond tilt",
  "refinements.bond-tilt.desc": "Equity + bond focus, drawdown-aware objective",
  "refinements.dd-guard.label": "Drawdown guard",
  "refinements.dd-guard.desc": "Minimize max drawdown objective",
  "refinements.cap-2.label": "Cap −2%",
  "refinements.cap-2.desc": "Tighter single-name concentration",
  "refinements.sharpe.label": "Sharpe hunt",
  "refinements.sharpe.desc": "Maximize Sharpe ratio",
  "refinements.defensive.label": "Defensive mix",
  "refinements.defensive.desc": "Bond, REIT, commodity, alternatives",
  "refinements.equity-only.label": "Equity only",
  "refinements.equity-only.desc": "Optimize within equity ETFs only",

  // Pro rounds — banner, seed panel, prefix
  "pro.roundN": "Round {n}",
  "pro.banner.title": "ROUND UNDERPERFORMED BENCHMARK",
  "pro.banner.body":
    "Portfolio return trails the benchmark ({benchmark}) in this sample. Consider wider exploration or strategy tweaks next round.",
  "pro.banner.stats":
    "Portfolio return {portfolio} · Benchmark {benchmark} · Alpha {alpha}",
  "pro.seed.regimeMatrix":
    "Regime matrix (allocator per regime — used at each rebalance switch)",
  "pro.seed.regimeQuotas": "Regime class quotas (Top N asset classes per regime)",
  "pro.seed.assessment": "AI performance assessment",
  "pro.seed.strategy": "AI optimization strategy",
  "pro.seed.roundSetup": "Round setup (applies to every strategy this round)",
  "pro.seed.factorSearch": "Factor search (ranges Jasper explored)",
  "pro.seed.fixed": "fixed",
  "pro.prefix.improved": "Round winner — replaced the incoming champion",
  "pro.prefix.held": "Incoming champion held (improvement below threshold)",
  "pro.prefix.body":
    "[{label}] {status} · adj score {score} · {trials} trials · {models} strategies.",

  // Pro rounds — parameter labels
  "pro.param.mode": "Allocator mode",
  "pro.param.lookback_days": "Covariance lookback",
  "pro.param.shrinkage": "Shrinkage",
  "pro.param.risk_aversion": "Risk aversion",
  "pro.param.max_weight_actual": "Max weight",
  "pro.param.top_n_actual": "Top N holdings",
  "pro.param.max_turnover_actual": "Max turnover",
  "pro.param.no_trade_tol": "No-trade tolerance",
  "pro.param.turnover_penalty_mult": "Turnover penalty",
  "pro.param.factor_lookback_days": "Factor lookback",
  "pro.param.reversal_lookback_days": "Reversal lookback",
  "pro.param.value_lookback_days": "Value lookback",
  "pro.param.w_mom": "Momentum weight",
  "pro.param.w_reversal": "Reversal weight",
  "pro.param.w_value": "Value weight",
  "pro.param.w_lowvol": "Low-vol weight",
  "pro.param.w_trend": "Trend weight",
  "pro.param.w_drawdown": "Drawdown weight",
  "pro.param.w_equity": "Equity quota",
  "pro.param.w_bond": "Bond quota",
  "pro.param.w_commodity": "Commodity quota",
  "pro.param.w_real_estate": "Real estate quota",
  "pro.param.w_alternative": "Alternative quota",
  "pro.param.mom_indicator": "Momentum indicator",
  "pro.param.reversal_indicator": "Reversal indicator",
  "pro.param.value_indicator": "Value indicator",
  "pro.param.lowvol_indicator": "Low-vol indicator",
  "pro.param.trend_indicator": "Trend indicator",
  "pro.param.drawdown_indicator": "Drawdown indicator",

  // Institutional report — extended
  "institutional.loadingFor": "for {model}",
  "institutional.through": "through {date}",
  "institutional.horizonNote":
    "Trial selection uses In-Sample when holdout is on. In-Sample and Out-of-Sample rows are slices of the same continuous Full backtest; they are not separate fresh-start runs. Ranked Sharpe on the dashboard may differ slightly from these rows.",
  "institutional.gapNote":
    "In-Sample − Out-of-Sample gap: objective {objective}, Sharpe {sharpe} (positive = In-Sample stronger).",
  "institutional.vsBenchmark": "vs {benchmark}",
  "institutional.trackingErr": "Tracking err",
  "institutional.ir": "IR",
  "institutional.upCapture": "Up capture",
  "institutional.downCapture": "Down capture",
  "institutional.riskPct": "Risk %",
  "institutional.rollingSharpe": "Rolling Sharpe (252D)",
  "institutional.rollingVol": "Rolling vol (252D)",
  "institutional.inSampleNote":
    "Selection and ranking use In-Sample only; periods below exclude the Out-of-Sample tail.",
  "institutional.ddStart": "Start",
  "institutional.ddTrough": "Trough",
  "institutional.ddEnd": "End",
  "institutional.ddDepth": "Depth",
  "institutional.ddDays": "Days",
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
  "font.aria": "字級大小",
  "font.decrease": "縮小字級",
  "font.increase": "放大字級",
  "font.reset": "重設字級",
  "font.resetShort": "重設",

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
  "config.notifyEmail": "完成後寄信通知我（選填）",
  "config.notifyEmailPlaceholder": "you@example.com",
  "config.notifyEmailHint":
    "回測在伺服器端執行，你可以關閉此分頁。若填入電子郵件，回測完成或失敗時我們會通知你。",

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

  "live.badge": "即時",
  "live.working": "執行中…",
  "live.trial": "策略 {n}/{total}",
  "live.recentActivity": "近期動態",

  // Live progress messages (localized on the client from backend templates)
  "progress.msg.queued": "回測作業已排入佇列…",
  "progress.msg.queuedPro": "Pro 最佳化作業已排入佇列…",
  "progress.msg.fetching": "正在擷取市場資料，開始最佳化…",
  "progress.msg.fetchingPro": "Pro：正在擷取資料，開始迭代搜尋…",
  "progress.msg.complete": "回測完成",
  "progress.msg.completePro": "Pro 最佳化完成",
  "progress.msg.loaded":
    "已載入 {tickers} 檔標的、{rows} 個交易日。每次再平衡會挑出最強的持股，再分配部位權重。",
  "progress.msg.loadedRegimeSuffix": " 隨市場狀態調整：每次再平衡設定配置器預設。",
  "progress.msg.proHoldout": "Pro：策略以最佳化期間排名；保留資料用於最終驗證…",
  "progress.msg.proLoop": "Pro：執行挑戰者輪次（AI 從歷史學習）…",
  "progress.msg.startingAi": "正在啟動 AI — 為 {trials} 種策略規劃初始參數…",
  "progress.msg.aiDone": "AI 完成：{trials} 種策略的 {used} 組初始參數 — 開始回測…",
  "progress.msg.aiDoneCapped":
    "AI 完成：{trials} 種策略的 {used} 組初始參數（AI 上限 {cap}；其餘策略僅用搜尋）— 開始回測…",
  "progress.msg.aiOff": "AI 關閉（{err}）— 改用自動搜尋…",
  "progress.msg.optuna": "策略 {trial}/{total}（{scope}）",
  "progress.msg.optunaBest": "策略 {trial}/{total}（{scope}），目前最佳 {label} {value}",
  "progress.msg.searchDone": "搜尋完成（{feasible} 個可行）— 正在為報告打包前 {top} 名…",
  "progress.msg.packaging": "正在打包報告：{inner}",
  "progress.msg.roundReport": "第 {round} 輪報告：{inner}",
  "progress.msg.proRound": "第 {round}/{max} 輪：{carry}，準備 {n} 位挑戰者…",
  "progress.msg.roundOptuna": "第 {round} 輪 · 策略 {trial}/{total}（{scope}）",
  "progress.msg.roundOptunaBest":
    "第 {round} 輪 · 策略 {trial}/{total}（{scope}），本輪最佳 {label} {value}",
  "progress.msg.roundAiLearning":
    "第 {round} 輪：AI 從 {n} 位較弱的挑戰者學習，目標分數 {score}…",
  "progress.msg.roundDone":
    "第 {round} 輪完成：本輪最佳 {best}，領先者 {champ}（無進步輪數 {streak}/{patience}）",
  "progress.msg.roundDoneAlphaSuffix":
    " · 樣本內 Alpha 相對 {benchmark} {alpha}（低於基準）",
  "progress.msg.pkgFromCache": "正在打包 {code} {label}，取自搜尋快取（{rank}/{total}）…",
  "progress.msg.pkgMetricsOnly": "正在打包 {code}（僅指標）（{rank}/{total}）…",
  "progress.msg.pkgNoCache": "正在打包 {code}（{rank}/{total}）：無快取 — 為圖表執行回測…",
  "progress.msg.pkgIsOos": "正在打包 {code}（{rank}/{total}）：以完整期間回測一次以取得權重…",
  "progress.msg.pkgIncomplete":
    "正在打包 {code}（{rank}/{total}）：快取不完整（{missing}）— 執行回測…",
  "progress.msg.pkgTop": "資料池中前 {top}／{feasible} 個策略…",
  "progress.msg.scope.inSample": "樣本內",
  "progress.msg.scope.fullWindow": "完整期間",
  "progress.label.sharpe": "夏普",
  "progress.label.cagr": "年化報酬",
  "progress.label.maxdd": "最大回撤",
  "progress.label.sortino": "索提諾",
  "progress.label.cvar": "CVaR",
  "progress.label.vol": "波動度",
  "progress.label.comprehensive": "綜合分數",
  "progress.label.metric": "指標",

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
  "linkedChart.portfolio": "投資組合",

  // Market regime + allocator objective band labels (shared across charts)
  "regime.risk_off": "風險趨避",
  "regime.neutral": "中性",
  "regime.risk_on": "風險偏好",
  "objectiveBand.max_sharpe": "最大夏普",
  "objectiveBand.max_return": "最大 CAGR",
  "objectiveBand.min_max_drawdown": "最小最大回撤",

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
  "objectiveLab.predictionQualityTitle": "市場狀態預測品質（以區段為基礎）",
  "objectiveLab.predictionQualityDesc":
    "從切換進場到標籤改變為止，依基準表現為每個連續的現行狀態區段評分：報酬 > 0 判為風險偏好；區段年化波動度 ≥ 實驗室區段波動中位數的 1.15 倍判為風險趨避；相對於前一區段判為中性 —— 風險偏好之後報酬 ≤ 0 或低於前一風險偏好區段報酬，風險趨避之後波動低於前一風險趨避區段，否則 |報酬| ≤ 3%。報酬與回撤僅供參考。與每步固定 21 天前瞻窗口不同，此指標不取代夏普 A/B 檢定。",
  "objectiveLab.episodeAlignment": "區段一致度 {score}/100",
  "objectiveLab.grade": "等級 {grade}",
  "objectiveLab.episodes": "區段數",
  "objectiveLab.medianDays": "中位天數",
  "objectiveLab.avgReturn": "平均報酬",
  "objectiveLab.hitRate": "命中率",
  "objectiveLab.longestEpisodes": "最長區段",
  "objectiveLab.largestMisses": "最大誤判",
  "objectiveLab.missesLegend":
    "命中：風險偏好（報酬 > 0）、風險趨避（區段波動 ≥ 區段波動中位數的 1.15 倍）、中性（風險偏好後轉弱、風險趨避後波動趨緩，否則 |報酬| ≤ 3%）。最大誤判依報酬缺口（風險偏好）、波動缺口（風險趨避）或持續強勢／波動下降不足（中性）排序。",
  "objectiveLab.secondaryForward": "次要：{days} 天前瞻（逐步）",
  "objectiveLab.stepLevelAlignment":
    "逐步一致度 {score}/100 —— 以相同的報酬規則套用於 {days} 天前瞻窗口；上方主要分數採用完整區段。",
  "objectiveLab.regimeSwitches": "市場狀態切換次數：{count}",
  "objectiveLab.isSharpe": "樣本內夏普",
  "objectiveLab.oosSharpe": "樣本外夏普",
  "objectiveLab.isReturn": "樣本內報酬",
  "objectiveLab.isMaxDd": "樣本內最大回撤",
  "objectiveLab.hit": "命中",
  "objectiveLab.miss": "誤判",

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
  "results.dataRange": "資料：{start} → {end}，{rows} 個交易日",
  "results.endsOn": "結束於 {date}",
  "results.forThisCap": "才能滿足此上限",
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
  "results.dynamicScoreTitle": "動態綜合分數 —— 這就是排名依據",
  "results.dynamicScoreExplain":
    "在動態模式下，策略不是只看夏普或報酬來排名，而是用一個綜合分數排名，該分數同時衡量風險調整後報酬、成長、回撤與交易成本。因此冠軍（★）可能整體勝出，卻不一定在下方任一欄位都最高。",
  "results.championWhyTitle": "為什麼 ★ {code} 是冠軍",
  "results.leaderboardDynamicNote":
    "數值為各期間的動態綜合分數（越高越好）。冠軍（★）由 AI 依樣本內綜合分數與樣本外穩健度挑選，因此不一定在單一欄位領先。",
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

  // Constraints — offline + hints
  "config.runOfflineHint": "分析服務目前離線，無法執行回測。請稍後再試。",
  "config.assetClassSyncHint":
    "你選取的資產類別與目標權重會保持同步 — 未納入的部分一律維持為零。",
  "config.limitsHint":
    "上方的滑桿設定 Jasper 運作的上限。它會在每個上限內嘗試一系列數值，找出最符合你目標的設定。",
  "config.objectiveHint.dynamic":
    "「動態」會讓投資組合隨市場狀態自動切換配置風格：風險高時偏防守、行情強勁時追求成長、介於兩者之間時取得平衡。冠軍策略是以單一綜合分數挑選（風險調整後報酬＋成長＋回撤＋交易成本），而非單一指標。若想單純以某個目標（例如最大 CAGR）排名、同時仍隨市場切換配置，請選擇該目標並開啟下方的「隨市場狀態調整配置」。",
  "config.objectiveHint.default":
    "開啟保留資料後，策略會以最佳化期間排名；保留期與完整期間的結果僅供比較參考。",
  "config.regimeAdaptive": "隨市場狀態調整配置",
  "config.regimeAdaptiveHint.dynamic":
    "選擇「動態」目標時一律開啟：配置器會在每次再平衡依市場狀態（防守／平衡／成長）切換預設配置風格。",
  "config.regimeAdaptiveHint.on":
    "開啟：配置器會在每次再平衡依市場狀態（風險趨避／中性／風險偏好）切換預設風格，而上方選定的目標仍決定策略的排名方式。",
  "config.regimeAdaptiveHint.off":
    "關閉：所有市場狀態都套用同一套配置風格。開啟後，配置會隨市場狀態調整，同時仍以上方目標排名。",
  "config.customObjectivePlaceholder":
    "例如：先求低回撤，再求報酬，換手率維持適度",
  "config.customObjectiveHint": "Jasper 會把它轉化為可最佳化的目標。",
  "config.trialsHint.pro": "Pro 模式會依上方的輪次設定替你管理。",
  "config.trialsHint.standard":
    "要測試多少種策略。前幾個從 AI 建議開始，其餘由系統自動探索。報告數量請在下方設定。",
  "config.benchmarkLine": "基準：SPY · 無風險利率：4%",

  // Constraints — advanced controls
  "config.advanced.title": "進階控制（選用）",
  "config.advanced.maxWeightNote": "單一權重搜尋最高不得超過 {pct}%（執行滑桿）。",
  "config.advanced.categorical": "類別型",
  "config.advanced.factorIndicators": "因子指標（每個因子）",
  "config.advanced.search": "搜尋",
  "config.advanced.fixed": "固定",
  "config.advanced.off": "關閉",
  "config.advanced.searchHint": "搜尋會考量所有選項；你的選擇僅作為 AI 起始提示",
  "config.advanced.fixedHint": "此因子的固定指標",

  // Constraints — categorical labels
  "config.categorical.objective_mode": "目標函數",
  "config.categorical.allocator_mode": "配置器模式",
  "config.categorical.rebalance_freq": "再平衡頻率",

  // Constraints — advanced numeric control labels
  "config.control.subPrefix": "子類 {label}",
  "config.control.lookback_days": "配置器回顧期（日）",
  "config.control.shrinkage": "共變異數收縮",
  "config.control.risk_aversion": "風險趨避",
  "config.control.max_weight_actual": "單一標的最大權重（試驗）",
  "config.control.top_n_actual": "Top N（實際）",
  "config.control.factor_lookback_days": "因子回顧期（日）",
  "config.control.reversal_lookback_days": "反轉回顧期（日）",
  "config.control.value_lookback_days": "價值回顧期（日）",
  "config.control.no_trade_tol": "免交易區間",
  "config.control.turnover_penalty_mult": "換手率懲罰",
  "config.control.max_turnover_actual": "每次再平衡最大換手率",
  "config.control.w_mom": "動能權重",
  "config.control.w_reversal": "反轉權重",
  "config.control.w_value": "價值權重",
  "config.control.w_lowvol": "低波動權重",
  "config.control.w_trend": "趨勢權重",
  "config.control.w_drawdown": "回撤品質權重",
  "config.control.w_equity": "股票配置",
  "config.control.w_bond": "債券配置",
  "config.control.w_commodity": "商品配置",
  "config.control.w_real_estate": "REIT 配置",
  "config.control.w_alternative": "另類配置",

  // Quick refinements
  "refinements.bond-tilt.label": "債券傾斜",
  "refinements.bond-tilt.desc": "聚焦股票＋債券，採用回撤導向目標",
  "refinements.dd-guard.label": "回撤防護",
  "refinements.dd-guard.desc": "以最小化最大回撤為目標",
  "refinements.cap-2.label": "上限 −2%",
  "refinements.cap-2.desc": "收緊單一標的集中度",
  "refinements.sharpe.label": "夏普追求",
  "refinements.sharpe.desc": "最大化夏普值",
  "refinements.defensive.label": "防禦組合",
  "refinements.defensive.desc": "債券、REIT、商品、另類資產",
  "refinements.equity-only.label": "僅股票",
  "refinements.equity-only.desc": "僅在股票 ETF 中最佳化",

  // Pro rounds — banner, seed panel, prefix
  "pro.roundN": "第 {n} 輪",
  "pro.banner.title": "本輪表現落後基準",
  "pro.banner.body":
    "本樣本中，投資組合報酬落後基準（{benchmark}）。下一輪可考慮擴大探索或調整策略。",
  "pro.banner.stats": "投資組合報酬 {portfolio} · 基準 {benchmark} · Alpha {alpha}",
  "pro.seed.regimeMatrix": "市場狀態矩陣（各狀態的配置器 — 於每次再平衡切換時採用）",
  "pro.seed.regimeQuotas": "市場狀態類別配額（各狀態的 Top N 資產類別）",
  "pro.seed.assessment": "AI 績效評估",
  "pro.seed.strategy": "AI 最佳化策略",
  "pro.seed.roundSetup": "本輪設定（套用於本輪每一個策略）",
  "pro.seed.factorSearch": "因子搜尋（Jasper 探索的範圍）",
  "pro.seed.fixed": "固定",
  "pro.prefix.improved": "本輪優勝者 — 取代了原本的領先者",
  "pro.prefix.held": "原領先者保留（進步幅度低於門檻）",
  "pro.prefix.body":
    "[{label}] {status} · 調整後分數 {score} · {trials} 次試驗 · {models} 種策略。",

  // Pro rounds — parameter labels
  "pro.param.mode": "配置器模式",
  "pro.param.lookback_days": "共變異數回顧期",
  "pro.param.shrinkage": "收縮",
  "pro.param.risk_aversion": "風險趨避",
  "pro.param.max_weight_actual": "最大權重",
  "pro.param.top_n_actual": "Top N 持股",
  "pro.param.max_turnover_actual": "最大換手率",
  "pro.param.no_trade_tol": "免交易容忍度",
  "pro.param.turnover_penalty_mult": "換手率懲罰",
  "pro.param.factor_lookback_days": "因子回顧期",
  "pro.param.reversal_lookback_days": "反轉回顧期",
  "pro.param.value_lookback_days": "價值回顧期",
  "pro.param.w_mom": "動能權重",
  "pro.param.w_reversal": "反轉權重",
  "pro.param.w_value": "價值權重",
  "pro.param.w_lowvol": "低波動權重",
  "pro.param.w_trend": "趨勢權重",
  "pro.param.w_drawdown": "回撤權重",
  "pro.param.w_equity": "股票配額",
  "pro.param.w_bond": "債券配額",
  "pro.param.w_commodity": "商品配額",
  "pro.param.w_real_estate": "不動產配額",
  "pro.param.w_alternative": "另類配額",
  "pro.param.mom_indicator": "動能指標",
  "pro.param.reversal_indicator": "反轉指標",
  "pro.param.value_indicator": "價值指標",
  "pro.param.lowvol_indicator": "低波動指標",
  "pro.param.trend_indicator": "趨勢指標",
  "pro.param.drawdown_indicator": "回撤指標",

  // Institutional report — extended
  "institutional.loadingFor": "（{model}）",
  "institutional.through": "至 {date}",
  "institutional.horizonNote":
    "開啟保留資料時，試驗挑選以樣本內為準。樣本內與樣本外列是同一段連續完整回測的切片，並非各自重新起算的獨立執行。儀表板上的排名夏普值可能與這些列略有差異。",
  "institutional.gapNote":
    "樣本內 − 樣本外落差：目標 {objective}、夏普 {sharpe}（正值代表樣本內較強）。",
  "institutional.vsBenchmark": "vs {benchmark}",
  "institutional.trackingErr": "追蹤誤差",
  "institutional.ir": "資訊比率",
  "institutional.upCapture": "上行捕捉",
  "institutional.downCapture": "下行捕捉",
  "institutional.riskPct": "風險 %",
  "institutional.rollingSharpe": "滾動夏普值（252 日）",
  "institutional.rollingVol": "滾動波動度（252 日）",
  "institutional.inSampleNote":
    "挑選與排名僅使用樣本內；下方各期間不含樣本外尾段。",
  "institutional.ddStart": "起始",
  "institutional.ddTrough": "谷底",
  "institutional.ddEnd": "結束",
  "institutional.ddDepth": "深度",
  "institutional.ddDays": "天數",
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
  "font.aria": "글꼴 크기",
  "font.decrease": "글꼴 축소",
  "font.increase": "글꼴 확대",
  "font.reset": "글꼴 초기화",
  "font.resetShort": "초기화",

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
  "config.notifyEmail": "완료되면 이메일로 알림 (선택)",
  "config.notifyEmailPlaceholder": "you@example.com",
  "config.notifyEmailHint":
    "백테스트는 서버에서 실행되므로 이 탭을 닫아도 됩니다. 이메일을 입력하면 실행이 완료되거나 실패할 때 알려드립니다.",

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

  "live.badge": "실시간",
  "live.working": "실행 중…",
  "live.trial": "전략 {n}/{total}",
  "live.recentActivity": "최근 활동",

  // Live progress messages (localized on the client from backend templates)
  "progress.msg.queued": "백테스트 작업이 대기열에 추가되었습니다…",
  "progress.msg.queuedPro": "Pro 최적화 작업이 대기열에 추가되었습니다…",
  "progress.msg.fetching": "시장 데이터를 가져오는 중, 최적화를 시작합니다…",
  "progress.msg.fetchingPro": "Pro: 데이터를 가져오는 중, 반복 탐색을 시작합니다…",
  "progress.msg.complete": "백테스트 완료",
  "progress.msg.completePro": "Pro 최적화 완료",
  "progress.msg.loaded":
    "티커 {tickers}개, 거래일 {rows}일을 불러왔습니다. 리밸런싱마다 가장 강한 종목을 추린 뒤 비중을 배분합니다.",
  "progress.msg.loadedRegimeSuffix": " 국면 적응형: 리밸런싱마다 배분기 프리셋을 설정합니다.",
  "progress.msg.proHoldout": "Pro: 전략은 최적화 기간으로 순위가 매겨지며, 홀드아웃은 최종 검증에 사용됩니다…",
  "progress.msg.proLoop": "Pro: 도전자 라운드 실행 중(AI가 기록에서 학습)…",
  "progress.msg.startingAi": "AI 시작 — 전략 {trials}개의 초기 매개변수를 계획하는 중…",
  "progress.msg.aiDone": "AI 완료: 전략 {trials}개를 위한 시드 세트 {used}개 — 백테스트 시작…",
  "progress.msg.aiDoneCapped":
    "AI 완료: 전략 {trials}개를 위한 시드 세트 {used}개(AI 상한 {cap}; 나머지 전략은 탐색만) — 백테스트 시작…",
  "progress.msg.aiOff": "AI 꺼짐({err}) — 자동 탐색으로 대체…",
  "progress.msg.optuna": "전략 {trial}/{total}({scope})",
  "progress.msg.optunaBest": "전략 {trial}/{total}({scope}), 현재 최고 {label} {value}",
  "progress.msg.searchDone": "탐색 완료(실현 가능 {feasible}개) — 보고서용 상위 {top}개 패키징 중…",
  "progress.msg.packaging": "보고서 패키징 중: {inner}",
  "progress.msg.roundReport": "{round}라운드 보고서: {inner}",
  "progress.msg.proRound": "{round}/{max}라운드: {carry}, 도전자 {n}명 준비 중…",
  "progress.msg.roundOptuna": "{round}라운드 · 전략 {trial}/{total}({scope})",
  "progress.msg.roundOptunaBest":
    "{round}라운드 · 전략 {trial}/{total}({scope}), 이번 라운드 최고 {label} {value}",
  "progress.msg.roundAiLearning":
    "{round}라운드: AI가 더 약한 도전자 {n}명에게서 학습, 목표 점수 {score}…",
  "progress.msg.roundDone":
    "{round}라운드 완료: 이번 라운드 최고 {best}, 선두 {champ}(무개선 라운드 {streak}/{patience})",
  "progress.msg.roundDoneAlphaSuffix":
    " · 인샘플 알파 vs {benchmark} {alpha}(벤치마크 미달)",
  "progress.msg.pkgFromCache": "{code} {label} 패키징 중, 탐색 캐시에서({rank}/{total})…",
  "progress.msg.pkgMetricsOnly": "{code} 지표만 패키징 중({rank}/{total})…",
  "progress.msg.pkgNoCache": "{code} 패키징 중({rank}/{total}): 캐시 없음 — 차트용 백테스트 실행…",
  "progress.msg.pkgIsOos": "{code} 패키징 중({rank}/{total}): 비중을 위해 전체 기간 백테스트 1회…",
  "progress.msg.pkgIncomplete":
    "{code} 패키징 중({rank}/{total}): 캐시 불완전({missing}) — 백테스트 실행…",
  "progress.msg.pkgTop": "풀에서 상위 {top}/{feasible}개 전략…",
  "progress.msg.scope.inSample": "인샘플",
  "progress.msg.scope.fullWindow": "전체 구간",
  "progress.label.sharpe": "샤프",
  "progress.label.cagr": "CAGR",
  "progress.label.maxdd": "최대 낙폭",
  "progress.label.sortino": "소르티노",
  "progress.label.cvar": "CVaR",
  "progress.label.vol": "변동성",
  "progress.label.comprehensive": "종합",
  "progress.label.metric": "지표",

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
  "linkedChart.portfolio": "포트폴리오",

  // Market regime + allocator objective band labels (shared across charts)
  "regime.risk_off": "위험 회피",
  "regime.neutral": "중립",
  "regime.risk_on": "위험 선호",
  "objectiveBand.max_sharpe": "최대 샤프",
  "objectiveBand.max_return": "최대 CAGR",
  "objectiveBand.min_max_drawdown": "최소 최대 낙폭",

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
  "objectiveLab.predictionQualityTitle": "국면 예측 품질(구간 기반)",
  "objectiveLab.predictionQualityDesc":
    "전환 시점부터 라벨이 바뀔 때까지, 벤치마크 움직임으로 연속된 활성 국면 구간마다 점수를 매깁니다: 수익률 > 0이면 위험 선호; 구간 연 변동성이 랩 구간 변동성 중앙값의 1.15배 이상이면 위험 회피; 직전 구간 대비 중립 — 위험 선호 이후 수익률 ≤ 0이거나 직전 위험 선호 구간 수익률보다 낮음, 위험 회피 이후 변동성이 직전 위험 회피 구간보다 낮음, 그 외 |수익률| ≤ 3%. 수익률과 낙폭은 참고용입니다. 매 스텝 고정 21일 전방 창과 달리, 이 지표는 샤프 A/B 검정을 대체하지 않습니다.",
  "objectiveLab.episodeAlignment": "구간 정합도 {score}/100",
  "objectiveLab.grade": "등급 {grade}",
  "objectiveLab.episodes": "구간 수",
  "objectiveLab.medianDays": "중앙 일수",
  "objectiveLab.avgReturn": "평균 수익률",
  "objectiveLab.hitRate": "적중률",
  "objectiveLab.longestEpisodes": "최장 구간",
  "objectiveLab.largestMisses": "최대 오차",
  "objectiveLab.missesLegend":
    "적중: 위험 선호(수익률 > 0), 위험 회피(구간 변동성 ≥ 구간 변동성 중앙값의 1.15배), 중립(위험 선호 후 약화, 위험 회피 후 변동성 완화, 그 외 |수익률| ≤ 3%). 최대 오차는 수익률 부족(위험 선호), 변동성 부족(위험 회피) 또는 지속된 강세/불충분한 변동성 하락(중립) 순으로 정렬됩니다.",
  "objectiveLab.secondaryForward": "보조: {days}일 전방(스텝별)",
  "objectiveLab.stepLevelAlignment":
    "스텝 단위 정합도 {score}/100 — {days}일 전방 창에 동일한 수익률 규칙 적용; 위의 주요 점수는 전체 구간을 사용합니다.",
  "objectiveLab.regimeSwitches": "국면 전환 횟수: {count}",
  "objectiveLab.isSharpe": "IS 샤프",
  "objectiveLab.oosSharpe": "OOS 샤프",
  "objectiveLab.isReturn": "IS 수익률",
  "objectiveLab.isMaxDd": "IS 최대 낙폭",
  "objectiveLab.hit": "적중",
  "objectiveLab.miss": "오차",

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
  "results.dataRange": "데이터: {start} → {end}, 거래일 {rows}일",
  "results.endsOn": "{date} 종료",
  "results.forThisCap": "이 상한을 충족하려면",
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
  "results.dynamicScoreTitle": "동적 종합 점수 — 이것이 순위 기준입니다",
  "results.dynamicScoreExplain":
    "동적 모드에서는 샤프나 수익률만으로 순위를 매기지 않습니다. 위험조정수익, 성장, 낙폭, 거래비용을 결합한 하나의 종합 점수로 순위를 매깁니다. 그래서 챔피언(★)은 아래의 어떤 단일 열에서도 1위가 아니면서 전체적으로 이길 수 있습니다.",
  "results.championWhyTitle": "★ {code}가 챔피언인 이유",
  "results.leaderboardDynamicNote":
    "값은 각 기간의 동적 종합 점수입니다(높을수록 좋음). 챔피언(★)은 인샘플 종합 점수와 아웃오브샘플 견고성을 바탕으로 AI가 선택하므로 단일 열에서 선두가 아닐 수 있습니다.",
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

  // Constraints — offline + hints
  "config.runOfflineHint":
    "지금은 분석 서비스가 오프라인이라 백테스트를 실행할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  "config.assetClassSyncHint":
    "선택한 자산군과 목표 비중은 서로 동기화됩니다 — 포함하지 않은 항목은 0으로 유지됩니다.",
  "config.limitsHint":
    "위 슬라이더는 Jasper가 작동하는 상한을 설정합니다. 각 상한까지 다양한 값을 시도해 목표에 가장 잘 맞는 설정을 찾습니다.",
  "config.objectiveHint.dynamic":
    "동적 모드는 시장 국면에 따라 포트폴리오를 조정합니다: 위험이 높으면 방어적으로, 여건이 강하면 성장 추구로, 그 사이에서는 균형을 맞춥니다. 챔피언은 단일 지표가 아니라 하나의 종합 점수(위험조정 수익 + 성장 + 낙폭 + 거래비용)로 순위가 매겨집니다. 최대 CAGR 같은 단일 목표로 순위를 매기면서도 국면에 따라 전환하려면, 그 목표를 선택하고 아래의 '국면 적응형 배분'을 켜세요.",
  "config.objectiveHint.default":
    "홀드아웃을 켜면 전략이 최적화 기간으로 순위가 매겨지며, 홀드아웃과 전체 기간 결과는 비교용으로만 표시됩니다.",
  "config.regimeAdaptive": "국면 적응형 배분",
  "config.regimeAdaptiveHint.dynamic":
    "동적 목표에서는 항상 켜져 있습니다: 배분기가 리밸런스마다 시장 국면(방어 / 균형 / 성장)에 따라 프리셋을 전환합니다.",
  "config.regimeAdaptiveHint.on":
    "켜짐: 배분기가 리밸런스마다 시장 국면(위험 회피 / 중립 / 위험 선호)에 따라 프리셋을 전환하며, 위에서 선택한 목표는 여전히 전략 순위를 결정합니다.",
  "config.regimeAdaptiveHint.off":
    "꺼짐: 모든 시장 상황에서 하나의 배분 방식이 사용됩니다. 켜면 위의 순위 목표는 유지하면서 배분이 국면에 따라 조정됩니다.",
  "config.customObjectivePlaceholder":
    "예: 낙폭을 먼저 낮추고, 그다음 수익, 회전율은 적정 수준 유지",
  "config.customObjectiveHint": "Jasper가 이를 최적화할 수 있는 목표로 바꿔 줍니다.",
  "config.trialsHint.pro": "Pro 모드가 위의 라운드 설정을 사용해 대신 관리합니다.",
  "config.trialsHint.standard":
    "테스트할 전략 수. 처음 몇 개는 AI 제안에서 시작하고, 나머지는 자동으로 탐색됩니다. 보고서 크기는 아래에서 설정하세요.",
  "config.benchmarkLine": "벤치마크: SPY · 무위험 수익률: 4%",

  // Constraints — advanced controls
  "config.advanced.title": "고급 설정(선택)",
  "config.advanced.maxWeightNote":
    "단일 비중 탐색은 {pct}%를 초과할 수 없습니다(실행 슬라이더).",
  "config.advanced.categorical": "범주형",
  "config.advanced.factorIndicators": "팩터 지표(팩터별)",
  "config.advanced.search": "탐색",
  "config.advanced.fixed": "고정",
  "config.advanced.off": "끄기",
  "config.advanced.searchHint":
    "탐색은 모든 옵션을 고려하며, 선택한 값은 AI 시작 힌트로만 사용됩니다",
  "config.advanced.fixedHint": "이 팩터의 고정 지표",

  // Constraints — categorical labels
  "config.categorical.objective_mode": "목적 함수",
  "config.categorical.allocator_mode": "배분기 모드",
  "config.categorical.rebalance_freq": "리밸런싱 주기",

  // Constraints — advanced numeric control labels
  "config.control.subPrefix": "하위 {label}",
  "config.control.lookback_days": "배분기 회고 기간(일)",
  "config.control.shrinkage": "공분산 축소",
  "config.control.risk_aversion": "위험 회피",
  "config.control.max_weight_actual": "단일 최대 비중(시행)",
  "config.control.top_n_actual": "Top N(실제)",
  "config.control.factor_lookback_days": "팩터 회고 기간(일)",
  "config.control.reversal_lookback_days": "리버설 회고 기간(일)",
  "config.control.value_lookback_days": "가치 회고 기간(일)",
  "config.control.no_trade_tol": "무거래 구간",
  "config.control.turnover_penalty_mult": "회전율 패널티",
  "config.control.max_turnover_actual": "리밸런싱당 최대 회전율",
  "config.control.w_mom": "모멘텀 가중치",
  "config.control.w_reversal": "리버설 가중치",
  "config.control.w_value": "가치 가중치",
  "config.control.w_lowvol": "저변동성 가중치",
  "config.control.w_trend": "추세 가중치",
  "config.control.w_drawdown": "낙폭 품질 가중치",
  "config.control.w_equity": "주식 배분",
  "config.control.w_bond": "채권 배분",
  "config.control.w_commodity": "원자재 배분",
  "config.control.w_real_estate": "REIT 배분",
  "config.control.w_alternative": "대체 배분",

  // Quick refinements
  "refinements.bond-tilt.label": "채권 기울이기",
  "refinements.bond-tilt.desc": "주식＋채권 중심, 낙폭 고려 목표",
  "refinements.dd-guard.label": "낙폭 방어",
  "refinements.dd-guard.desc": "최대 낙폭 최소화 목표",
  "refinements.cap-2.label": "상한 −2%",
  "refinements.cap-2.desc": "단일 종목 집중도 축소",
  "refinements.sharpe.label": "샤프 추구",
  "refinements.sharpe.desc": "샤프 비율 최대화",
  "refinements.defensive.label": "방어형 조합",
  "refinements.defensive.desc": "채권, REIT, 원자재, 대체자산",
  "refinements.equity-only.label": "주식만",
  "refinements.equity-only.desc": "주식 ETF 내에서만 최적화",

  // Pro rounds — banner, seed panel, prefix
  "pro.roundN": "{n}라운드",
  "pro.banner.title": "이번 라운드가 벤치마크에 못 미침",
  "pro.banner.body":
    "이 표본에서 포트폴리오 수익률이 벤치마크({benchmark})를 밑돌았습니다. 다음 라운드에서는 탐색 범위를 넓히거나 전략을 조정해 보세요.",
  "pro.banner.stats":
    "포트폴리오 수익률 {portfolio} · 벤치마크 {benchmark} · 알파 {alpha}",
  "pro.seed.regimeMatrix": "국면 매트릭스(국면별 배분기 — 리밸런싱 전환마다 적용)",
  "pro.seed.regimeQuotas": "국면 자산군 쿼터(국면별 Top N 자산군)",
  "pro.seed.assessment": "AI 성과 평가",
  "pro.seed.strategy": "AI 최적화 전략",
  "pro.seed.roundSetup": "라운드 설정(이번 라운드의 모든 전략에 적용)",
  "pro.seed.factorSearch": "팩터 탐색(Jasper가 탐색한 범위)",
  "pro.seed.fixed": "고정",
  "pro.prefix.improved": "라운드 우승자 — 기존 선두를 교체함",
  "pro.prefix.held": "기존 선두 유지(개선폭이 기준 미만)",
  "pro.prefix.body":
    "[{label}] {status} · 조정 점수 {score} · 시행 {trials}회 · 전략 {models}개.",

  // Pro rounds — parameter labels
  "pro.param.mode": "배분기 모드",
  "pro.param.lookback_days": "공분산 회고 기간",
  "pro.param.shrinkage": "축소",
  "pro.param.risk_aversion": "위험 회피",
  "pro.param.max_weight_actual": "최대 비중",
  "pro.param.top_n_actual": "Top N 보유 종목",
  "pro.param.max_turnover_actual": "최대 회전율",
  "pro.param.no_trade_tol": "무거래 허용치",
  "pro.param.turnover_penalty_mult": "회전율 패널티",
  "pro.param.factor_lookback_days": "팩터 회고 기간",
  "pro.param.reversal_lookback_days": "리버설 회고 기간",
  "pro.param.value_lookback_days": "가치 회고 기간",
  "pro.param.w_mom": "모멘텀 가중치",
  "pro.param.w_reversal": "리버설 가중치",
  "pro.param.w_value": "가치 가중치",
  "pro.param.w_lowvol": "저변동성 가중치",
  "pro.param.w_trend": "추세 가중치",
  "pro.param.w_drawdown": "낙폭 가중치",
  "pro.param.w_equity": "주식 쿼터",
  "pro.param.w_bond": "채권 쿼터",
  "pro.param.w_commodity": "원자재 쿼터",
  "pro.param.w_real_estate": "부동산 쿼터",
  "pro.param.w_alternative": "대체 쿼터",
  "pro.param.mom_indicator": "모멘텀 지표",
  "pro.param.reversal_indicator": "리버설 지표",
  "pro.param.value_indicator": "가치 지표",
  "pro.param.lowvol_indicator": "저변동성 지표",
  "pro.param.trend_indicator": "추세 지표",
  "pro.param.drawdown_indicator": "낙폭 지표",

  // Institutional report — extended
  "institutional.loadingFor": "({model})",
  "institutional.through": "{date}까지",
  "institutional.horizonNote":
    "홀드아웃이 켜져 있으면 시행 선택은 인샘플을 사용합니다. 인샘플과 아웃오브샘플 행은 동일한 연속 전체 백테스트의 구간이며, 각각 새로 시작한 별개의 실행이 아닙니다. 대시보드의 순위 샤프는 이 행들과 약간 다를 수 있습니다.",
  "institutional.gapNote":
    "인샘플 − 아웃오브샘플 격차: 목표 {objective}, 샤프 {sharpe}(양수면 인샘플이 더 강함).",
  "institutional.vsBenchmark": "vs {benchmark}",
  "institutional.trackingErr": "추적 오차",
  "institutional.ir": "정보 비율",
  "institutional.upCapture": "상승 포착",
  "institutional.downCapture": "하락 포착",
  "institutional.riskPct": "위험 %",
  "institutional.rollingSharpe": "롤링 샤프(252일)",
  "institutional.rollingVol": "롤링 변동성(252일)",
  "institutional.inSampleNote":
    "선택과 순위는 인샘플만 사용하며, 아래 기간은 아웃오브샘플 구간을 제외합니다.",
  "institutional.ddStart": "시작",
  "institutional.ddTrough": "저점",
  "institutional.ddEnd": "종료",
  "institutional.ddDepth": "깊이",
  "institutional.ddDays": "일수",
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

/** Localized market-regime label (risk_off/neutral/risk_on) with safe fallback. */
export function regimeLabel(t: TFn, regime?: string | null): string {
  if (!regime) return "";
  const key = `regime.${regime}`;
  const val = t(key);
  return val === key ? regime.replace(/_/g, " ") : val;
}

/** Localized allocator objective band label with safe fallback. */
export function objectiveBandLabel(t: TFn, objective?: string | null): string {
  if (!objective) return "";
  const key = `objectiveBand.${objective}`;
  const val = t(key);
  return val === key ? objective.replace(/_/g, " ") : val;
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
