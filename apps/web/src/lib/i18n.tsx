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
  "header.phase.anchor": "ANCHOR",
  "header.phase.overlay": "CLIENT NEEDS",
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
  "config.notifyEmailSmtpDisabled":
    "Email alerts are not enabled on this server (SMTP not configured). You won't receive a message even if you enter an address.",

  // Pro rounds tabs
  "pro.tabsHint":
    "Each tab is one round: the current leader plus its challengers. ★ marks the round winner. The catalog tab lists every strategy tried so far.",
  "pro.allRounds": "ALL ROUNDS",
  "pro.role.incoming": "Current leader",
  "pro.role.challenger": "Challenger",
  "pro.role.winner": "Round winner",

  // Results dashboard
  "results.runObjectiveLabel": "Optimization goal for this run",
  "results.title": "Results",
  "results.model": "strategy",
  "results.fullNarrative": "Full summary",
  "results.fullPeriod": "Full period",
  "results.rmChampionLine": "Champion model {model} · Sharpe {sharpe} · CAGR {cagr}",
  "results.refineHint":
    "Click to apply an adjustment · double-click to apply and rerun.",
  "results.editConfig": "Edit setup",
  "results.exportCsv": "Export CSV",
  "results.belowBenchmarkTitle": "Honest read: this run underperformed the benchmark",
  "results.belowBenchmarkBody":
    "None of the trials beat {benchmark} on the selected objective over this window. That's a real result, not a failure of the tool — you can keep iterating from this run: adjust the factors, constraints, universe, or objective and re-run without starting over.",
  "results.iterateFromHere": "Adjust & re-run",
  "results.continueRefinementTitle": "Below benchmark — continue refining?",
  "results.continueRefinementBody":
    "None of the trials beat {benchmark} on the objective over this window. You can add more Pro rounds (or trials) and carry over the champion, learning history, and AI context from this run.",
  "results.continueRefinementCta": "Continue optimization",
  "results.continueRefinementRunning": "Continuing…",
  "results.continueRefinementHint": "Carries champion pool and prior rounds from job {job}…",
  "results.extraRoundsLabel": "Additional rounds",
  "results.extraTrialsPerRoundLabel": "Trials per round (challengers)",
  "results.extraTrialsLabel": "Additional Optuna trials",
  "results.continueFromRound": "Will resume at round {round}",

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
  "chat.continueRefinementUser": "Continue optimization from this run",
  "chat.continueRefinementAck":
    "Continuing with prior champion and learning history — more rounds incoming…",

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
  "common.maxDd": "Max drawdown",
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
  "progress.msg.queuedStatic": "Static replay job queued…",
  "progress.msg.queuedPro": "Pro optimization job queued…",
  "progress.msg.fetching": "Fetching market data, starting optimization…",
  "progress.msg.fetchingStatic": "Static replay: fetching market data…",
  "progress.msg.staticSimulating": "Static replay: simulating fixed-weight portfolio…",
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
  "progress.label.vol": "volatility",
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
  "assetFilter.selectedBase": "{base} of {total} ETFs selected",
  "assetFilter.selectedCombined": "{combined} of {total} ETFs selected",
  "assetFilter.layer1Intro": "Pick the asset classes to invest across ({base} ETFs).",
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
  "assetFilter.resultsPoolWithSupplement":
    "{base} ETFs from your asset classes · {supplement} added from your search (always included) · {combined} ETFs in total.",
  "assetFilter.resultsPoolNoSupplement":
    "{base} ETFs from your asset classes. Run the search to add more ETFs on top of your selection.",
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
  "linkedChart.assetClassTitle": "Asset class mix over time",
  "linkedChart.otherCapHint": "Smaller holdings grouped as “Other”",
  "linkedChart.rebalanceSnapshotHint":
    "Weights held constant between rebalance dates (step changes at each rebalance)",
  "linkedChart.hoverHint": "Hover the chart to see holdings",
  "linkedChart.other": "Other",
  "linkedChart.portfolio": "Portfolio",

  // Market regime + allocator objective band labels (shared across charts)
  "regime.risk_off": "Risk-off",
  "regime.neutral": "Neutral",
  "regime.risk_on": "Risk-on",
  "objectiveBand.max_sharpe": "Maximize Sharpe",
  "objectiveBand.max_return": "Maximize CAGR",
  "objectiveBand.min_max_drawdown": "Minimize max drawdown",

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
  "objectiveLab.isSharpe": "In-sample Sharpe",
  "objectiveLab.oosSharpe": "Out-of-sample Sharpe",
  "objectiveLab.isReturn": "In-sample return",
  "objectiveLab.isMaxDd": "In-sample max drawdown",
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
  "institutional.monthlyFull": "Monthly returns",
  "institutional.annualInSample": "Annual returns (In-Sample{range})",
  "institutional.annualFull": "Yearly returns",
  "institutional.monthlyOosFrom": "Monthly returns (Out-of-Sample from {date})",
  "institutional.monthlyOos": "Monthly returns (Out-of-Sample)",
  "institutional.annualOosFrom": "Annual returns (Out-of-Sample from {date})",
  "institutional.annualOos": "Annual returns (Out-of-Sample)",
  "institutional.horizonTitle": "Performance by horizon (In-Sample / Out-of-Sample / Full)",
  "institutional.horizon": "Horizon",
  "institutional.maxDd": "Max drawdown",
  "institutional.rebalanceExecution": "Rebalance execution",
  "institutional.freq": "Freq",
  "institutional.count": "Count",
  "institutional.sampleDates": "Sample dates",
  "institutional.exposure": "Exposure",
  "institutional.assetClass": "Asset class",
  "institutional.bucketsRegion": "By region",
  "institutional.equity": "Equity",
  "institutional.bond": "Bond",
  "institutional.commodity": "Commodity",
  "institutional.real_estate": "REIT",
  "institutional.alternative": "Alt",
  "institutional.other": "Other",
  "institutional.durationProxy": "Avg. duration (yrs)",
  "institutional.riskContributionTop": "Top risk contributors",
  "institutional.coreHoldingsTitle": "Core holdings",
  "institutional.coreHoldingsNote": "The names this strategy leaned on most — how large a share they usually took and how consistently they were held across rebalances.",
  "institutional.avgWeight": "Avg. weight",
  "institutional.avgWeightHint": "Average share of the portfolio across all rebalance dates. Higher means it was a bigger, more central position.",
  "institutional.holdFrequency": "Held",
  "institutional.holdFrequencyHint": "How often this name was held (share of rebalance dates with a position above 0.5%). 100% means it was held the whole time.",
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
  "results.proRefinement": "Pro optimization",
  "results.meta.rounds": "{rounds} refinement rounds across {trials} candidate strategies",
  "results.meta.convergedEarly": "converged early (no further gains)",
  "results.meta.fullSearch": "ran the full search",
  "results.meta.search": "Parameter search across {trials} candidate strategies",
  "results.meta.reported": "{feasible} valid strategies found, {reported} included in this report",
  "results.meta.catalog": "(of {catalog} explored in total)",
  "results.meta.rebalance": "{freq} rebalancing — applied {applied} of {count} scheduled dates",
  "results.meta.rebalanceSkipped": "({skipped} skipped — need more price history before first rebalance)",
  "results.meta.rebalanceChartDownsampled":
    "holdings chart shows {shown} of {total} rebalance snapshots",
  "results.freq.weekly": "Weekly",
  "results.freq.monthly": "Monthly",
  "results.freq.quarterly": "Quarterly",
  "results.freq.yearly": "Yearly",
  "results.freq.daily": "Daily",
  "results.sort": "sort",
  "results.rankedOnInSample": "Ranked on In-Sample",
  "results.gapInOut": "Gap (In-Sample − Out-of-Sample)",
  "results.winRate": "Win rate",
  "results.avgTurnover": "Avg turnover",
  "results.totalTurnover": "Total turnover",
  "results.maxDdDays": "Max drawdown (days)",
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
  "results.leaderboardTitleOutOfSample":
    "Leaderboard · strategies ranked on the Out-of-Sample period",
  "results.leaderboardTitleFull":
    "Leaderboard · strategies ranked on the full sample period",
  "results.leaderboardTitleGap":
    "Leaderboard · strategies ranked by In-Sample minus Out-of-Sample gap",
  "results.sortTableBy": "Sort table by",
  "results.inSampleSelection": "In-Sample (selection)",
  "results.gapSelection": "Gap (IS − OOS)",
  "results.engine": "engine",
  "results.warmStartExact": "Warm-started from prior champion {code} (job {job})",
  "results.warmStartFuzzy": "Warm-started from prior champion {code} (job {job}; period end differs)",
  "results.warmStartImproved": "New champion beat the cached baseline",
  "results.warmStartKept": "Cached champion still competitive",
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
  "results.championWhyHorizonNote":
    "★ is chosen on the selection horizon (in-sample when OOS holdout is on; otherwise full-sample). Full-period metrics in the report grid can differ — a higher Full Sharpe does not demote the IS objective winner. Overfitting / IS–OOS gap is diagnostic only.",
  "results.championWhyFallbackLead":
    "{code} won under objective “{objective}” on the {horizon} selection horizon (IS Sharpe {sharpe}, CAGR {cagr}, max DD {mdd}). Full-period: Sharpe {fullSharpe}, CAGR {fullCagr}.",
  "results.championWhyFallbackLeadFull":
    "{code} won under objective “{objective}” on the full-sample horizon (Sharpe {sharpe}, CAGR {cagr}, max DD {mdd}).",
  "results.championWhyFallbackAlt":
    "Runner-up {alt} scored lower on that same selection horizon (IS Sharpe {altSharpe}, CAGR {altCagr}) even if its full-period Sharpe ({altFullSharpe}) looks higher.",
  "results.championWhyFallbackAltFull":
    "Compared with runner-up {alt} (Sharpe {altSharpe}, CAGR {altCagr}).",
  "results.championHorizonInSample": "in-sample",
  "results.championHorizonFullSample": "full-sample",
  "results.anchorBenchmarkNote":
    "Anchor model portfolio: {anchor}. Performance benchmark ticker (price series): {ticker} — the chart compares strategies to this ticker’s returns, not a replica of every anchor holding.",
  "results.anchorPortfolioBaselineNote":
    "Baseline for comparison: static replay of the anchor model portfolio ({anchor}), not the market ticker alone.",
  "results.championFullSharpe": "Full Sharpe",
  "results.championFullMaxDd": "Full max DD",
  "results.championFullCagr": "Full CAGR",
  "results.leaderboardDynamicNote":
    "Values are the dynamic composite score for each period (higher is better). The champion (★) is ranked by the objective on the selection horizon (in-sample when OOS is on). OOS / overfitting metrics are informational and do not demote the objective winner.",
  "results.selectTrialHint": "Select a strategy above to see its performance and holdings.",
  "results.efficientFrontierHint":
    "Blue dots are strategies Jasper tried; orange dots are the top picks shown in your report.",
  "results.annVol": "Annualized volatility (%)",
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
  "results.targetWeightPct": "Target weight %",
  "results.actualClassWeights": "Actual asset-class mix (holdings)",
  "results.actualClassWeightsRegime": "Actual mix during {regime} rebalances",
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
  "report.group.summary": "Executive summary",
  "report.group.summaryHint": "AI verdict, champion pick, and headline metrics",
  "report.group.performance": "Performance",
  "report.group.performanceHint": "How the models stack up against the benchmark",
  "report.group.journey": "Portfolio journey",
  "report.group.journeyHint": "Equity growth and how holdings shifted over time",
  "report.group.holdings": "Holdings & risk",
  "report.group.holdingsHint": "What the portfolio owns and its asset-class mix",
  "report.group.strategy": "Strategy deep-dive",
  "report.group.strategyHint": "Risk/return trade-offs and factor drivers",
  "report.group.institutional": "Institutional analytics",
  "report.group.institutionalHint": "Benchmark, exposure, rolling risk, and drawdowns",
  "report.group.reproducibility": "Reproducibility",
  "report.group.reproducibilityHint": "Exact settings and parameters behind this run",
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
  "config.enforceClassWeights": "Enforce class allocation targets",
  "config.enforceClassWeightsHint":
    "When on, bond/equity targets (and per-regime quotas) set final sleeve weights — not just which names enter Top-N screening.",
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
    "How many strategies to test. In standard mode every trial uses an AI-generated seed (no random filler). Set the report size below.",
  "config.benchmarkLine": "Benchmark: {benchmark} · Risk-free rate: 4%",

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

  // Optimization objectives (dropdown)
  "objective.dynamic": "Dynamic — regime-adaptive (composite score)",
  "objective.max_sharpe": "Maximize Sharpe ratio",
  "objective.max_return": "Maximize CAGR (annual return)",
  "objective.min_max_drawdown": "Minimize maximum drawdown",
  "objective.max_sortino": "Maximize Sortino ratio",
  "objective.min_cvar": "Minimize CVaR (tail risk)",
  "objective.risk_parity_erc": "Risk parity (equal risk contribution)",
  "objective.max_diversification": "Maximize diversification",
  "objective.mean_variance_utility": "Mean-variance utility",
  "objective.custom": "Custom objective",

  // Allocator modes (dropdown)
  "allocator.auto": "Auto (let Jasper choose)",
  "allocator.mean_variance": "Mean-variance",
  "allocator.min_var": "Minimum variance",
  "allocator.risk_parity": "Risk parity",
  "allocator.max_diversification": "Maximum diversification",

  // Factor indicators — factor name + friendly description
  "factorInd.mom_indicator.label": "Momentum",
  "factorInd.mom_indicator.hint":
    "Return level, vol-adjusted return, or 12-1 skip-month style",
  "factorInd.reversal_indicator.label": "Reversal",
  "factorInd.reversal_indicator.hint":
    "Short return flip, distance from peak, or RSI oversold proxy",
  "factorInd.value_indicator.label": "Value",
  "factorInd.value_indicator.hint":
    "Below MA, cheap in range, or contrarian long-window return",
  "factorInd.lowvol_indicator.label": "Low vol",
  "factorInd.lowvol_indicator.hint":
    "Total vol, downside vol, or low beta vs equal-weight index",
  "factorInd.trend_indicator.label": "Trend",
  "factorInd.trend_indicator.hint":
    "Price vs MA, MA slope, or fast/slow MA crossover",
  "factorInd.drawdown_indicator.label": "Drawdown",
  "factorInd.drawdown_indicator.hint":
    "Drawdown depth, recency of peak, or ulcer-style pain index",

  // Factor indicator options (dropdown values)
  "factorOpt.cumulative_return": "cumulative return",
  "factorOpt.risk_adjusted_return": "risk-adjusted return",
  "factorOpt.skip_month_12_1": "12-1 skip month",
  "factorOpt.negative_return": "negative return",
  "factorOpt.off_peak": "off peak",
  "factorOpt.rsi_mean_reversion": "RSI mean reversion",
  "factorOpt.ma_price_ratio": "MA / price ratio",
  "factorOpt.price_percentile": "price percentile",
  "factorOpt.inverse_long_momentum": "inverse long momentum",
  "factorOpt.negative_vol": "negative volatility",
  "factorOpt.negative_downside_dev": "negative downside deviation",
  "factorOpt.negative_beta_market": "negative market beta",
  "factorOpt.price_ma_ratio": "price / MA ratio",
  "factorOpt.ma_slope": "MA slope",
  "factorOpt.dual_ma_crossover": "dual MA crossover",
  "factorOpt.max_drawdown_depth": "max drawdown depth",
  "factorOpt.time_since_peak": "time since peak",
  "factorOpt.ulcer_index": "ulcer index",

  // Constraints — categorical labels
  "config.categorical.objective_mode": "Objective fn",
  "config.categorical.allocator_mode": "Allocator mode",
  "config.categorical.rebalance_freq": "Rebalance frequency",

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
  "config.control.w_lowvol": "Low-vol weight",
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
    "{label} — {status}. Adjusted score {score}, from {trials} trials across {models} strategies.",

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
  "institutional.rmCompactHint": "Key benchmark and allocation context for client discussions",
  "institutional.benchmarkStaleNote":
    "Beta, alpha, and IR below were computed vs {computed}. Re-run the backtest to refresh metrics for the selected anchor benchmark.",
  "institutional.trackingErr": "Tracking err",
  "institutional.ir": "IR",
  "institutional.upCapture": "Up capture",
  "institutional.downCapture": "Down capture",
  "institutional.riskPct": "Risk %",
  "institutional.rollingSharpe": "Rolling Sharpe (252-day)",
  "institutional.rollingVol": "Rolling volatility (252-day)",
  "institutional.inSampleNote":
    "Selection and ranking use In-Sample only; periods below exclude the Out-of-Sample tail.",
  "institutional.ddStart": "Start",
  "institutional.ddTrough": "Trough",
  "institutional.ddEnd": "End",
  "institutional.ddDepth": "Depth",
  "institutional.ddDays": "Days",

  // Anchor / benchmark personalization
  "anchor.title": "Anchor portfolio",
  "anchor.subtitle":
    "Choose an Asset Manager model portfolio as the client's starting benchmark. Each model is a theme built from that issuer's ETFs in the Investment Pool — JASPER builds a customized variant on top.",
  "anchor.universeNote": "Demo universe: {count} mainstream ETFs (SPY, IVV, QQQ, VTI, AGG, …)",
  "anchor.placeholderHoldingsHint": "All constituents are ETFs from this Asset Manager",
  "anchor.selected": "Selected anchor",
  "anchor.continue": "Continue to client needs",
  "anchor.am": "Asset Manager",
  "anchor.theme": "Theme",

  // Overlay conversation step
  "overlay.skipToConfig": "Skip to advanced setup",
  "overlay.continueToConfig": "Continue to backtest setup",
  "overlay.interpret.error.apiKeyMissing":
    "Overlay interpretation is unavailable: Gemini API key is not configured.",
  "overlay.interpret.error.geminiUnavailable":
    "Overlay interpretation failed: Gemini is temporarily unavailable. Please try again.",
  "overlay.interpret.error.parseFailed":
    "Overlay interpretation failed: AI response could not be parsed. Please try again.",
  "overlay.interpret.error.validationFailed":
    "Overlay interpretation failed: AI response did not match the expected schema. Please try again.",
  "overlay.interpret.error.responseInvalid":
    "Overlay interpretation failed: AI returned an unusable response. Please try again.",
  "overlay.interpret.error.generic":
    "Overlay interpretation failed. Please try again or contact support.",
  "chat.speakerYou": "You:",
  "chat.speakerJasper": "Jasper:",
  "chat.speakerSystem": "System:",

  // Base vs customized comparison
  "compare.title": "Anchor vs customized",
  "compare.subtitle": "Side-by-side metrics from parallel backtests.",
  "compare.col.metric": "Metric",
  "compare.col.delta": "Δ",
  "compare.metric.cagr": "CAGR",
  "compare.metric.sharpe": "Sharpe",
  "compare.metric.mdd": "Max drawdown",
  "compare.metric.vol": "Volatility",
  "compare.chart.title": "Equity curves",
  "compare.chart.anchor": "Anchor",
  "compare.chart.customized": "Customized",

  // RM workflow (Relationship Manager)
  "rm.mode.label": "Mode",
  "rm.mode.rm": "RM",
  "rm.mode.advanced": "Advanced",
  "rm.step.nav": "Workflow steps",
  "rm.step.anchor": "Anchor",
  "rm.step.overlay": "Client needs",
  "rm.step.execute": "Run",
  "rm.step.report": "Report",
  "rm.step.skipped": "skipped",
  "rm.run.title": "Ready to run",
  "rm.run.subtitle":
    "Review the signed client overlay, then run the anchor vs customized dual backtest.",
  "rm.run.clientNeeds": "Client needs summary",
  "rm.run.whatWillRun": "What will run",
  "rm.run.period": "Period: {start} → {end}",
  "rm.run.dualTrack": "Dual track: anchor replay + customized optimization",
  "rm.run.proSearchTitle": "Jasper Pro Search",
  "rm.run.proSearchHint":
    "Turning on Pro Search runs AI multi-round parameter optimization (champion–challenger). It usually takes longer.",
  "rm.run.proSearchOn": "Jasper Pro Search: ON (multi-round AI optimization)",
  "rm.run.proSearchOff":
    "Jasper Pro Search: OFF (single pass — all trials use AI-generated seeds)",
  "rm.run.execute": "Run backtest",
  "rm.run.showAdvanced": "Advanced settings",
  "rm.run.hideAdvanced": "Hide advanced settings",
  "rm.universe.resolving": "Resolving investment universe from client overlay…",
  "rm.universe.fixedTitle": "Investment universe (fixed)",
  "rm.universe.fixedCount": "{n} tickers pinned for backtest",
  "rm.report.title": "RM report",
  "rm.report.tabRm": "RM summary",
  "rm.report.tabQuant": "Quant analysis",
  "rm.report.executiveTitle": "Executive summary",
  "rm.report.executiveHint": "Key points for your client conversation",
  "rm.report.metricsSummary":
    "vs {anchor}: return {cagrDelta}, max drawdown {mddDelta}",
  "rm.report.noOverlaySummary": "Customized portfolio based on anchor configuration.",
  "rm.report.overlayTitle": "Signed client needs",
  "rm.report.overlayHint": "Constraints and preferences confirmed in step 2",
  "rm.report.overlaySigned": "Signed {date}",
  "rm.report.metricsTitle": "Key metrics vs anchor",
  "rm.report.metricsHint": "Green = better than anchor for this metric",
  "rm.report.holdingsTitle": "Holdings changes",
  "rm.report.holdingsHint": "What shifted from the anchor portfolio",
  "rm.report.talkingTitle": "Suggested talking points",
  "rm.report.talkingHint": "Plain-language angles for the client meeting",
  "rm.report.disclaimerTitle": "Compliance notice",
  "rm.report.disclaimerBody":
    "For internal RM review only. Not investment advice. All figures are backtested simulations — past performance does not guarantee future results. Human review required before any client communication.",
  "rm.report.openQuant": "Open quant analysis",
  "rm.report.revise": "Revise client needs",
  "rm.report.candidateTitle": "Trial strategy",
  "rm.report.candidateHint":
    "Compare Optuna trials for the customized run. Champion is selected by default.",
  "rm.report.candidateChampion": "★",
  "rm.quant.championWhyTitle": "Why this champion was selected",
  "rm.quant.championWhyCode": "Champion strategy: {code}",
  "proposal.ctaTitle": "Investment Proposal",
  "proposal.ctaHint":
    "Generate a print-ready private-bank style proposal (cover, allocation table, dual-track performance) from this run",
  "proposal.generate": "Generate Investment Proposal",
  "proposal.title": "Investment Proposal (draft)",
  "proposal.subtitle": "Internal RM draft — numbers from dual backtest; review before client use",
  "proposal.print": "Print / Save as PDF",
  "proposal.close": "Close",
  "proposal.draftBanner":
    "Working draft only. JASPER does not place trades. Formal client documents still require RM and compliance review.",
  "proposal.toc": "Contents",
  "proposal.cover.docTitle": "Investment Proposal",
  "proposal.cover.firm": "Private Banking · RM Copilot",
  "proposal.cover.confidential": "Confidential — for intended recipient only",
  "proposal.cover.clientFallback": "Valued client",
  "proposal.cover.rmFallback": "Relationship Manager",
  "proposal.cover.amountPending": "To be confirmed",
  "proposal.cover.strategyLine":
    "Anchor: {am} · {theme}. Recommended path: {customized}.",
  "proposal.letter.dear": "Dear {client},",
  "proposal.letter.thanks":
    "Thank you for discussing your {amount} investment mandate anchored on {strategy}. Please find below our proposed portfolio and supporting analysis.",
  "proposal.letter.recommend":
    "We recommend progressing from {anchor} toward the customized allocation ({customized}), subject to your confirmation and bank suitability review.",
  "proposal.letter.close": "Kind regards,",
  "proposal.field.client": "Client",
  "proposal.field.preparedBy": "Prepared by",
  "proposal.field.date": "Date",
  "proposal.field.investment": "Illustrative investment amount",
  "proposal.field.segment": "Segment",
  "proposal.field.age": "Age",
  "proposal.field.risk": "Risk profile",
  "proposal.field.horizon": "Investment horizon",
  "proposal.field.horizonYears": "Horizon (overlay)",
  "proposal.field.years": "{n} years",
  "proposal.field.aum": "AUM",
  "proposal.field.cash": "Cash",
  "proposal.field.liquidity": "Liquidity needs",
  "proposal.field.overlayLiquidity": "Liquidity (overlay)",
  "proposal.field.withinMonths": "Within {n} months",
  "proposal.field.esg": "ESG preference",
  "proposal.field.objective": "Optimization objective",
  "proposal.field.marketStance": "Market stance",
  "proposal.field.profile": "Profile",
  "proposal.table.fund": "Fund / ETF",
  "proposal.table.holding": "Holding",
  "proposal.table.pct": "Allocation %",
  "proposal.table.amount": "Monetary allocation",
  "proposal.table.total": "Total",
  "proposal.table.metric": "Metric",
  "proposal.table.delta": "Delta",
  "proposal.table.anchorPct": "Anchor %",
  "proposal.table.customPct": "Proposed %",
  "proposal.section.executive": "Executive Summary",
  "proposal.section.profile": "Client Profile & Objectives",
  "proposal.section.current": "Current Situation / Holdings",
  "proposal.section.strategy": "Recommended Strategy",
  "proposal.section.allocation": "Proposed Allocation",
  "proposal.section.rationale": "Rationale & Talking Points",
  "proposal.section.performance": "Risk & Performance Illustration",
  "proposal.section.implementation": "Implementation",
  "proposal.section.disclaimers": "Disclaimers & Suitability",
  "proposal.section.market": "Market Context & Rationale",
  "proposal.section.construction": "Strategy Construction & Constraints",
  "proposal.section.validation": "Historical Validation (Backtest)",
  "proposal.section.risk": "Risk Analysis",
  "proposal.body.letterIntro":
    "This proposal outlines a customized ETF portfolio for {client} (illustrative size {amount}), using {am} · {theme} as the model-portfolio anchor.",
  "proposal.body.executive":
    "Recommended direction: customize {anchor} into {customized}, validated by dual-track backtest.",
  "proposal.body.metricsPending": "Key performance deltas will appear after metrics load.",
  "proposal.body.profileFallback": "Client preferences were captured in the overlay workflow.",
  "proposal.body.currentAnchor": "Starting point (anchor model portfolio): {anchor}",
  "proposal.body.currentFootnote":
    "Current holdings snapshot as of {asOf}. Demo data — not a custodian feed.",
  "proposal.body.market":
    "Adjustment rationale centers on moving from {anchor} toward {customized} while respecting signed client needs.",
  "proposal.body.strategyAnchor":
    "Anchor model portfolio: {am} · {theme} (risk band: {risk}). This is the AM-themed starting product.",
  "proposal.body.strategyCustomize":
    "Customized recommendation ({customized}) personalizes the anchor ({anchor}) using signed overlay constraints and dual backtest validation.",
  "proposal.body.allocationFallback": "Customized holdings will appear after weights resolve.",
  "proposal.body.allocationFootnote":
    "Weights from the customized champion (or selected trial). Monetary figures are illustrative using the client cash / AUM snapshot.",
  "proposal.body.constructionFallback":
    "Backtest window {start} → {end}; objective {objective}. Overlay prompts and excludes apply.",
  "proposal.body.excludes": "Excluded tickers: {tickers}",
  "proposal.body.objectiveLine": "Optimization objective: {objective}",
  "proposal.body.validationNote":
    "Figures come from the engine dual backtest (anchor vs customized), not generative AI invention. Past performance is not a reliable guide to future performance.",
  "proposal.body.chartCaption":
    "Illustrative dual equity (rebased to 100) over {start} → {end}. Actual policy values will differ after fees, taxes, and timing.",
  "proposal.body.riskMdd": "Customized max drawdown {customized} vs anchor {anchor}.",
  "proposal.body.riskFallback": "Review drawdown and concentration in the quant tab.",
  "proposal.body.implDca":
    "Consider dollar-cost averaging (DCA) into equity sleeves if lump-sum market timing is a concern.",
  "proposal.body.implRebalance":
    "Rebalance according to the signed backtest window assumptions ({start} → {end}) unless the bank policy specifies otherwise.",
  "proposal.body.implLiquidity":
    "Retain a liquidity buffer aligned to near-term cash needs before full deployment.",
  "proposal.body.implClientLiquidity": "Client liquidity note: {note}",
  "proposal.body.impl1": "Phase entries if liquidity or market impact is a concern.",
  "proposal.body.impl2": "Confirm fees, taxes, and suitability under bank policy before client delivery.",
  "proposal.body.impl3": "Rebalance cadence follows the signed backtest configuration unless amended.",
  "proposal.body.signOffNote": "RM sign-off note: {note}",
  "proposal.body.disclaimer1": "Past performance is not indicative of future results.",
  "proposal.body.disclaimer2": "This draft is for RM internal use until compliance clearance.",
  "proposal.body.disclaimerSuitability":
    "Suitability, KYC, and product approval remain bank-controlled processes; JASPER does not certify regulatory fitness.",
  "proposal.body.nextSteps":
    "Next steps: RM review → compliance / suitability check → client discussion → implementation instructions (outside JASPER).",
  "proposal.warning.pastPerformance":
    "Warning: Past performance is not a reliable guide to future performance.",
  "proposal.warning.valueFluctuation":
    "Warning: The value of an investment may go down as well as up, and you may lose some or all of the money invested.",
  "proposal.warning.currency":
    "Warning: Returns may be affected by changes in currency exchange rates.",
  "proposal.warning.estimates":
    "Warning: These figures are estimates / backtested illustrations only.",
  "proposal.warning.noAdvice":
    "Warning: This material is for information and discussion purposes only and does not constitute an offer or investment advice.",
  "rm.holdings.change": "Change",
  "rm.holdings.added": "Added",
  "rm.holdings.removed": "Removed",
  "rm.holdings.increased": "Increased",
  "rm.holdings.decreased": "Decreased",
  "rm.holdings.unchanged": "Unchanged",
  "rm.talking.portfolioStructure":
    "This customized portfolio allocates {assetMix}, with top holdings {topHoldings}. Open by explaining how this structure reflects the client's signed asset scope and needs.",
  "rm.talking.portfolioHoldingsOnly":
    "Top holdings are {topHoldings}. Walk the client through how these names form the core of the customized allocation.",
  "rm.talking.vsAnchorChanges":
    "Versus {anchor}: {changes} — frame these as intentional shifts toward signed client goals, not random turnover.",
  "rm.talking.changeAdded": "added {ticker} ({pct}%)",
  "rm.talking.changeRemoved": "removed {ticker}",
  "rm.talking.changeIncreased": "increased {ticker} (+{delta} pp)",
  "rm.talking.changeDecreased": "decreased {ticker} (-{delta} pp)",
  "rm.talking.clientLiquidity":
    "The client needs liquidity within {months} months{amount} — highlight how the allocation preserves a cashable buffer.",
  "rm.talking.liquidityAmount": " (USD {amount})",
  "rm.talking.clientRiskTolerance":
    "Client risk tolerance is {tolerance}; the portfolio tilts {tilt} — connect this to their signed downside-risk preference.",
  "rm.talking.clientMarketView":
    "Signed market view ({stance}): {summary} — anchor the conversation on how holdings express this view.",
  "rm.talking.clientUniverse":
    "Signed universe rules: {rules} — explain how the final holdings respect these constraints.",
  "rm.talking.riskTolerance.conservative": "conservative",
  "rm.talking.riskTolerance.moderate": "moderate",
  "rm.talking.riskTolerance.aggressive": "aggressive",
  "rm.talking.tilt.defensive": "defensive (higher bond / lower equity)",
  "rm.talking.tilt.growth": "growth-oriented (higher equity)",
  "rm.talking.tilt.balanced": "balanced across growth and defense",
  "rm.talking.objective.min_max_drawdown":
    "We optimized for {objective}; customized max drawdown is {customized} vs anchor {anchor} ({delta}) — use this as evidence the objective was met.",
  "rm.talking.objective.max_sharpe":
    "We optimized for {objective}; customized Sharpe is {customized} vs anchor {anchor} ({delta}) — emphasize risk-adjusted efficiency.",
  "rm.talking.objective.max_return":
    "We optimized for {objective}; customized CAGR is {customized} vs anchor {anchor} ({delta}) — link return outcome to the signed goal.",
  "rm.talking.objective.generic":
    "Optimization objective: {objective}. Key outcome vs anchor: {customized} vs {anchor} ({delta}).",
  "rm.talking.performanceWin":
    "Customized CAGR is {cagrDelta} above anchor{extras} — emphasize return potential while honoring signed constraints.",
  "rm.talking.extraMddImproved": "max drawdown improved {delta}",
  "rm.talking.extraVolReduced": "volatility reduced {delta}",
  "rm.talking.performanceTradeoff":
    "CAGR is {cagrDelta} below anchor, but {tradeoffs} — present this as a deliberate risk / liquidity trade-off.",
  "rm.talking.tradeoffMdd": "max drawdown improved {delta}",
  "rm.talking.tradeoffVol": "volatility reduced {delta}",
  "rm.talking.tradeoffSharpe": "Sharpe ratio improved vs anchor",
  "rm.talking.tradeoffGeneric": "lower risk and smoother ride vs anchor",
  "rm.talking.performanceSimilar":
    "Returns are close to anchor ({highlights}) — focus on how allocation better matches signed client needs.",
  "rm.talking.similarGeneric": "allocation fit matters more than small return gaps",
  "rm.talking.compliance":
    "Reminder: illustrative backtest for discussion only — not investment advice. Confirm suitability and compliance before any implementation.",
  "rm.overlay.signed":
    "Overlay signed off. Universe is pinned — review the summary and run the dual backtest.",

  "progress.dual.anchor": "Anchor backtest",
  "progress.dual.customized": "Customized backtest",

  // RM Copilot nav + Client / Pool / Models
  "nav.aria": "Primary navigation",
  "nav.clients": "Clients",
  "nav.pool": "Investment Pool",
  "nav.models": "Model Portfolios",
  "nav.personalization": "Benchmark Personalization",

  "clients.listTitle": "Client Dashboard",
  "clients.listSubtitle": "Demo clients",
  "clients.listHint": "Select a client to review profile and holdings, then launch Benchmark Personalization.",
  "clients.detailSubtitle": "Client profile",
  "clients.backToList": "Back to clients",
  "clients.notFound": "Client not found.",
  "clients.profile": "Profile",
  "clients.holdings": "Current holdings",
  "clients.holdingsHint": "Illustrative snapshot for demo — not a custodian feed.",
  "clients.aum": "AUM",
  "clients.cash": "Cash",
  "clients.clientId": "Client ID",
  "clients.age": "Age",
  "clients.risk": "Risk profile",
  "clients.horizon": "Horizon",
  "clients.rm": "RM owner",
  "clients.liquidity": "Liquidity notes",
  "clients.asOf": "As of",
  "clients.weight": "Weight",
  "clients.suggestedAnchor": "Suggested model portfolio",
  "clients.launchCta": "Start customized analysis",
  "clients.launchHint": "Opens Benchmark Personalization with this client’s risk profile and suggested anchor prefilled.",
  "clients.launchBanner": "Loaded client context for {name}. Review the anchor, then describe needs in Overlay.",
  "clients.contextBanner": "Active client: {name} · risk {risk}",
  "clients.viewDashboard": "View dashboard",
  "clients.esg": "ESG preference",
  "clients.ageUnit": "yo",
  "clients.holding.cash": "Cash",
  "clients.holding.cashMoneyMarket": "Cash / money market",
  "clients.notes": "Notes",
  "clients.notePrefix": "Note:",
  "clients.upcomingEvents": "Upcoming events",

  "enum.risk.conservative": "Conservative",
  "enum.risk.moderate": "Moderate",
  "enum.risk.aggressive": "Aggressive",
  "enum.risk.moderate_conservative": "Moderately conservative",
  "enum.risk.moderate_aggressive": "Moderately aggressive",

  "enum.esg.none": "None",
  "enum.esg.light": "Light",
  "enum.esg.moderate": "Moderate",
  "enum.esg.strong": "Strong",
  "enum.esg.strict": "Strict",

  "institutional.cash": "Cash",
  "institutional.fixed_income": "Fixed income",

  "pool.title": "Investment Pool",
  "pool.subtitle": "Global product shelf",
  "pool.countBadge": "{enabled} / {total} enabled",
  "pool.loadDemo": "Load demo ETFs",
  "pool.loadFull": "Load full ETF universe",
  "pool.importCsv": "Import CSV",
  "pool.exportCsv": "Export CSV",
  "pool.importReport": "Import: {upserted} upserted, {skipped} skipped",
  "pool.searchPlaceholder": "Search ticker or name…",
  "pool.filter.allClasses": "All asset classes",
  "pool.filter.allRegions": "All regions",
  "pool.filter.enabledOnly": "Enabled only",
  "pool.col.enabled": "On",
  "pool.col.ticker": "Ticker",
  "pool.col.name": "Name",
  "pool.col.assetClass": "Asset class",
  "pool.col.region": "Region",
  "pool.col.productType": "Product type",
  "pool.empty": "No tickers match these filters.",
  "pool.toggleEnabled": "Enable {ticker}",
  "pool.region.us": "US",
  "pool.region.intl": "International",
  "pool.region.global": "Global",
  "pool.product.etf": "ETF",
  "pool.product.fund": "Fund",
  "pool.product.structured": "Structured",
  "pool.product.bond": "Bond",
  "pool.product.other": "Other",

  "models.title": "Model Portfolios",
  "models.subtitle": "AM anchor catalog",
  "models.countBadge": "{ready} ready / {total} total",
  "models.resetBundled": "Reset to bundled",
  "models.importCsv": "Import CSV",
  "models.exportCsv": "Export CSV",
  "models.importReport": "Import: {count} portfolios, {skipped} rows skipped",
  "models.conflict": "Pool conflict",
  "models.conflictBadge": "Conflict",
  "models.conflictTickers": "Missing from enabled pool",
  "models.disabled": "Disabled",
  "models.enabled": "Enabled",
  "models.showHoldings": "Show holdings",
  "models.hideHoldings": "Hide holdings",
  "models.col.am": "Asset Manager",
  "models.col.theme": "Theme",
  "models.risk": "Risk",
  "models.benchmark": "Benchmark",
  "models.issuerHoldingsHint": "All constituents are ETFs from this Asset Manager",

  "anchor.poolConflicts": "{count} model(s) hidden due to Investment Pool conflicts — fix Pool or Models.",
  "anchor.empty": "No selectable anchors. Enable Model Portfolios whose holdings are in the enabled Investment Pool.",
};

const zh: Dict = {
  // Header / shell
  "header.phase.scenario": "—",
  "header.phase.anchor": "基準配置",
  "header.phase.overlay": "客戶需求",
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
  "config.notifyEmailSmtpDisabled":
    "此伺服器尚未設定郵件（SMTP），即使填了信箱也不會收到通知。",

  // Pro rounds tabs
  "pro.tabsHint":
    "每個分頁代表一輪：當前領先者與它的挑戰者。★ 標示該輪優勝者。總覽分頁列出目前嘗試過的所有策略。",
  "pro.allRounds": "所有輪次",
  "pro.role.incoming": "當前領先者",
  "pro.role.challenger": "挑戰者",
  "pro.role.winner": "本輪優勝者",

  // Results dashboard
  "results.runObjectiveLabel": "本次最佳化目標",
  "results.title": "結果",
  "results.model": "策略",
  "results.fullNarrative": "完整摘要",
  "results.fullPeriod": "完整期間",
  "results.rmChampionLine": "冠軍模型 {model} · 夏普 {sharpe} · 年化報酬 {cagr}",
  "results.refineHint": "點擊套用調整 · 雙擊套用並重新執行。",
  "results.editConfig": "編輯設定",
  "results.belowBenchmarkTitle": "客觀結果：本次測試未能勝過基準",
  "results.belowBenchmarkBody":
    "在此區間內，沒有任何一組試驗在所選目標上勝過 {benchmark}。這是真實的結果，並非工具的問題——你可以從本次執行繼續迭代：調整因子、限制條件、標的池或目標後重新執行，無需從頭開始。",
  "results.iterateFromHere": "調整並重新執行",
  "results.continueRefinementTitle": "未超越基準，是否繼續優化？",
  "results.continueRefinementBody":
    "在此區間內，沒有任何試驗在所選目標上勝過 {benchmark}。可追加 Pro 輪次（或每輪試驗數），並帶入本次的冠軍、學習紀錄與 AI 脈絡繼續搜尋。",
  "results.continueRefinementCta": "繼續優化",
  "results.continueRefinementRunning": "延續優化中…",
  "results.continueRefinementHint": "帶入 job {job}… 的冠軍池與先前輪次紀錄",
  "results.extraRoundsLabel": "追加輪次",
  "results.extraTrialsPerRoundLabel": "每輪試驗數（挑戰者）",
  "results.extraTrialsLabel": "追加 Optuna 試驗",
  "results.continueFromRound": "將從第 {round} 輪繼續",
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
  "chat.continueRefinementUser": "從本次結果繼續優化",
  "chat.continueRefinementAck": "帶入先前冠軍與學習紀錄，追加輪次進行中…",

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
  "progress.msg.queuedStatic": "靜態重播作業已排入佇列…",
  "progress.msg.queuedPro": "Pro 最佳化作業已排入佇列…",
  "progress.msg.fetching": "正在擷取市場資料，開始最佳化…",
  "progress.msg.fetchingStatic": "靜態重播：正在擷取市場資料…",
  "progress.msg.staticSimulating": "靜態重播：模擬固定權重組合…",
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
  "assetFilter.selectedBase": "已選 {base} / {total} 檔 ETF",
  "assetFilter.selectedCombined": "已選 {combined} / {total} 檔 ETF",
  "assetFilter.layer1Intro": "選擇要投資的資產類別（{base} 檔 ETF）。",
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
  "assetFilter.resultsPoolWithSupplement":
    "資產類別內 {base} 檔 ETF · 搜尋新增 {supplement} 檔（一律納入）· 共 {combined} 檔 ETF。",
  "assetFilter.resultsPoolNoSupplement":
    "資產類別內 {base} 檔 ETF。執行搜尋可在選取範圍外新增更多 ETF。",
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
  "linkedChart.assetClassTitle": "資產類別配置隨時間變化",
  "linkedChart.otherCapHint": "較小的持股歸為「其他」",
  "linkedChart.rebalanceSnapshotHint":
    "再平衡之間權重維持不變（僅在再平衡日跳變）",
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
  "institutional.monthlyFull": "月報酬",
  "institutional.annualInSample": "年報酬（樣本內{range}）",
  "institutional.annualFull": "年報酬",
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
  "institutional.commodity": "商品",
  "institutional.real_estate": "REIT",
  "institutional.alternative": "另類",
  "institutional.other": "其他",
  "institutional.durationProxy": "平均存續期間（年）",
  "institutional.riskContributionTop": "主要風險貢獻者",
  "institutional.coreHoldingsTitle": "核心持股",
  "institutional.coreHoldingsNote": "這檔策略最倚重的標的——它們平常占投資組合多大比重，以及在每次再平衡中被持有的頻率高不高。",
  "institutional.avgWeight": "平均權重",
  "institutional.avgWeightHint": "在所有再平衡日期中，該標的平均占投資組合的比重。數字越高，代表它是越核心、越重要的持股。",
  "institutional.holdFrequency": "持有比例",
  "institutional.holdFrequencyHint": "該標的被持有的頻率（權重高於 0.5% 的再平衡日期占比）。100% 代表整段期間都持有。",
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
  "results.meta.rounds": "共 {rounds} 輪優化，測試了 {trials} 種候選策略",
  "results.meta.convergedEarly": "已提前收斂（不再有明顯進步）",
  "results.meta.fullSearch": "已完成完整搜尋",
  "results.meta.search": "參數搜尋，測試了 {trials} 種候選策略",
  "results.meta.reported": "找到 {feasible} 個有效策略，已納入報告 {reported} 個",
  "results.meta.catalog": "（累計嘗試 {catalog} 個）",
  "results.meta.rebalance": "{freq}再平衡（預定的 {count} 次中實際套用 {applied} 次）",
  "results.meta.rebalanceSkipped": "（{skipped} 次略過 — 首次再平衡前需要更長的價格歷史）",
  "results.meta.rebalanceChartDownsampled":
    "持股圖表顯示 {total} 次再平衡快照中的 {shown} 次",
  "results.freq.weekly": "每週",
  "results.freq.monthly": "每月",
  "results.freq.quarterly": "每季",
  "results.freq.yearly": "每年",
  "results.freq.daily": "每日",
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
  "results.leaderboardTitleOutOfSample":
    "排行榜 · 依樣本外期間為策略排名",
  "results.leaderboardTitleFull": "排行榜 · 依全樣本期間為策略排名",
  "results.leaderboardTitleGap":
    "排行榜 · 依樣本內減樣本外落差為策略排名",
  "results.sortTableBy": "表格排序依據",
  "results.inSampleSelection": "樣本內（挑選）",
  "results.gapSelection": "落差（樣本內 − 樣本外）",
  "results.engine": "引擎",
  "results.warmStartExact": "以先前冠軍 {code} 為起點繼續優化（job {job}）",
  "results.warmStartFuzzy": "以先前冠軍 {code} 為起點繼續優化（job {job}；回測終點不同）",
  "results.warmStartImproved": "新冠軍超越快取基準",
  "results.warmStartKept": "快取冠軍仍具競爭力",
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
  "results.championWhyHorizonNote":
    "★ 依挑選期間選定（啟用 OOS 保留段時為樣本內；否則為完整樣本）。報告格的完整期間指標可能不同——更高的完整期間夏普不會讓樣本內目標勝出者落敗。過擬合／IS–OOS 差距僅供診斷。",
  "results.championWhyFallbackLead":
    "在目標「{objective}」下，{code} 於「{horizon}」挑選期間勝出（樣本內夏普 {sharpe}、年化 {cagr}、最大回撤 {mdd}）。完整期間：夏普 {fullSharpe}、年化 {fullCagr}。",
  "results.championWhyFallbackLeadFull":
    "在目標「{objective}」下，{code} 於完整樣本期間勝出（夏普 {sharpe}、年化 {cagr}、最大回撤 {mdd}）。",
  "results.championWhyFallbackAlt":
    "次優 {alt} 在同一挑選期間分數較低（樣本內夏普 {altSharpe}、年化 {altCagr}），即使其完整期間夏普（{altFullSharpe}）看起來更高。",
  "results.championWhyFallbackAltFull":
    "相對於次優 {alt}（夏普 {altSharpe}、年化 {altCagr}）。",
  "results.championHorizonInSample": "樣本內",
  "results.championHorizonFullSample": "完整樣本",
  "results.anchorBenchmarkNote":
    "錨點模型組合：{anchor}。績效基準代碼（價格序列）：{ticker} — 圖表是與該代碼報酬比較，並非複製錨點的每一檔持股。",
  "results.anchorPortfolioBaselineNote":
    "比較基準：錨點模型組合（{anchor}）的靜態重播績效，而非僅市場代碼。",
  "results.championFullSharpe": "完整期間夏普",
  "results.championFullMaxDd": "完整期間最大回撤",
  "results.championFullCagr": "完整期間年化報酬",
  "results.leaderboardDynamicNote":
    "數值為各期間的動態綜合分數（越高越好）。冠軍（★）依挑選期間的目標排序（啟用 OOS 時為樣本內）。OOS／過擬合指標僅供參考，不會讓目標勝出者落敗。",
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
  "results.targetWeightPct": "目標權重 %",
  "results.actualClassWeights": "實際資產類別配置（持股）",
  "results.actualClassWeightsRegime": "實際配置（{regime} 再平衡期間平均）",
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
  "report.group.summary": "重點摘要",
  "report.group.summaryHint": "AI 結論、冠軍模型與關鍵指標",
  "report.group.performance": "績效表現",
  "report.group.performanceHint": "各模型與基準的比較",
  "report.group.journey": "投資歷程",
  "report.group.journeyHint": "淨值成長與持股隨時間的變化",
  "report.group.holdings": "持股與風險",
  "report.group.holdingsHint": "投資組合的持股與資產類別配置",
  "report.group.strategy": "策略深入分析",
  "report.group.strategyHint": "風險/報酬取捨與因子驅動",
  "report.group.institutional": "機構級分析",
  "report.group.institutionalHint": "基準、曝險、滾動風險與回撤",
  "report.group.reproducibility": "可重現性",
  "report.group.reproducibilityHint": "本次執行的完整設定與參數",
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
  "config.enforceClassWeights": "強制落實資產類別目標配置",
  "config.enforceClassWeightsHint":
    "開啟後，債券／股票等目標權重（含各市場狀態配額）會直接約束最終持倉比重，而不只影響 Top-N 篩選名單。",
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
    "要測試多少種策略。標準模式下每個試驗都使用 AI 產生的種子（不混入隨機探索）。報告數量請在下方設定。",
  "config.benchmarkLine": "基準：{benchmark} · 無風險利率：4%",

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

  // Optimization objectives (dropdown)
  "objective.dynamic": "動態 — 因應市場狀態（綜合評分）",
  "objective.max_sharpe": "最大化夏普比率",
  "objective.max_return": "最大化年化報酬（CAGR）",
  "objective.min_max_drawdown": "最小化最大回撤",
  "objective.max_sortino": "最大化索提諾比率",
  "objective.min_cvar": "最小化 CVaR（尾端風險）",
  "objective.risk_parity_erc": "風險平價（等風險貢獻）",
  "objective.max_diversification": "最大化分散程度",
  "objective.mean_variance_utility": "均值—變異數效用",
  "objective.custom": "自訂目標",

  // Allocator modes (dropdown)
  "allocator.auto": "自動（交給 Jasper 決定）",
  "allocator.mean_variance": "均值—變異數",
  "allocator.min_var": "最小變異數",
  "allocator.risk_parity": "風險平價",
  "allocator.max_diversification": "最大分散",

  // Factor indicators — factor name + friendly description
  "factorInd.mom_indicator.label": "動能",
  "factorInd.mom_indicator.hint": "報酬水準、風險調整後報酬，或 12-1 跳月動能",
  "factorInd.reversal_indicator.label": "反轉",
  "factorInd.reversal_indicator.hint": "短期反轉、距高點幅度，或 RSI 超賣",
  "factorInd.value_indicator.label": "價值",
  "factorInd.value_indicator.hint": "低於均線、區間相對便宜，或長期逆勢報酬",
  "factorInd.lowvol_indicator.label": "低波動",
  "factorInd.lowvol_indicator.hint": "總波動、下檔波動，或相對等權指數的低 Beta",
  "factorInd.trend_indicator.label": "趨勢",
  "factorInd.trend_indicator.hint": "價格對均線、均線斜率，或快慢均線交叉",
  "factorInd.drawdown_indicator.label": "回撤",
  "factorInd.drawdown_indicator.hint": "回撤深度、距前高時間，或潰瘍痛苦指數",

  // Factor indicator options (dropdown values)
  "factorOpt.cumulative_return": "累積報酬",
  "factorOpt.risk_adjusted_return": "風險調整後報酬",
  "factorOpt.skip_month_12_1": "12-1 跳月",
  "factorOpt.negative_return": "負向報酬",
  "factorOpt.off_peak": "距離高點",
  "factorOpt.rsi_mean_reversion": "RSI 均值回歸",
  "factorOpt.ma_price_ratio": "均線／價格比",
  "factorOpt.price_percentile": "價格分位",
  "factorOpt.inverse_long_momentum": "反向長期動能",
  "factorOpt.negative_vol": "負向波動",
  "factorOpt.negative_downside_dev": "負向下檔偏差",
  "factorOpt.negative_beta_market": "負向市場 Beta",
  "factorOpt.price_ma_ratio": "價格／均線比",
  "factorOpt.ma_slope": "均線斜率",
  "factorOpt.dual_ma_crossover": "雙均線交叉",
  "factorOpt.max_drawdown_depth": "最大回撤深度",
  "factorOpt.time_since_peak": "距前高時間",
  "factorOpt.ulcer_index": "潰瘍指數",

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
    "{label} — {status}。調整後分數 {score}，來自 {trials} 次試驗、共 {models} 種策略。",

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
  "institutional.rmCompactHint": "客戶溝通用的基準與資產配置重點",
  "institutional.benchmarkStaleNote":
    "以下 Beta、Alpha、IR 係以 {computed} 計算。請重新執行回測以更新為所選基準的指標。",
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

  // Anchor / benchmark personalization
  "anchor.title": "基準配置",
  "anchor.subtitle":
    "選擇資產管理公司（AM）發布的主題模型組合作為客戶起點基準；每個組合的成分均為該發行機構在投資標的池中的 ETF。JASPER 會在其上建立客製化變體。",
  "anchor.universeNote": "示範標的池：{count} 檔主流 ETF（SPY、IVV、QQQ、VTI、AGG 等）",
  "anchor.placeholderHoldingsHint": "成分均為該發行機構 ETF",
  "anchor.selected": "已選基準",
  "anchor.continue": "下一步：描述客戶需求",
  "anchor.am": "資產管理人",
  "anchor.theme": "主題",

  // Overlay conversation step
  "overlay.skipToConfig": "略過，直接進階設定",
  "overlay.continueToConfig": "前往回測設定",
  "overlay.interpret.error.apiKeyMissing":
    "無法解讀客戶需求：尚未設定 Gemini API 金鑰。",
  "overlay.interpret.error.geminiUnavailable":
    "解讀失敗：Gemini 暫時無法使用，請稍後再試。",
  "overlay.interpret.error.parseFailed":
    "解讀失敗：AI 回應無法解析，請再試一次。",
  "overlay.interpret.error.validationFailed":
    "解讀失敗：AI 回應格式不符預期，請再試一次。",
  "overlay.interpret.error.responseInvalid":
    "解讀失敗：AI 回應無法使用，請再試一次。",
  "overlay.interpret.error.generic":
    "客戶需求解讀失敗，請稍後再試或聯絡支援。",
  "chat.speakerYou": "您：",
  "chat.speakerJasper": "JASPER：",
  "chat.speakerSystem": "系統：",

  // Base vs customized comparison
  "compare.title": "基準 vs 客製化配置",
  "compare.subtitle": "並行回測的績效並列比較。",
  "compare.col.metric": "指標",
  "compare.col.delta": "差異",
  "compare.metric.cagr": "年化報酬",
  "compare.metric.sharpe": "夏普比率",
  "compare.metric.mdd": "最大回撤",
  "compare.metric.vol": "波動度",
  "compare.chart.title": "權益曲線",
  "compare.chart.anchor": "基準",
  "compare.chart.customized": "客製化",

  "rm.mode.label": "模式",
  "rm.mode.rm": "RM 模式",
  "rm.mode.advanced": "進階模式",
  "rm.step.nav": "工作流程",
  "rm.step.anchor": "選基準",
  "rm.step.overlay": "客戶需求",
  "rm.step.execute": "一鍵執行",
  "rm.step.report": "RM 報告",
  "rm.step.skipped": "已略過",
  "rm.run.title": "準備執行回測",
  "rm.run.subtitle": "請確認已簽核的客戶需求摘要，然後執行「基準 vs 客製化」雙軌回測。",
  "rm.run.clientNeeds": "客戶需求摘要",
  "rm.run.whatWillRun": "即將執行",
  "rm.run.period": "回測區間：{start} → {end}",
  "rm.run.dualTrack": "雙軌：基準重播 ＋ 客製化最佳化",
  "rm.run.proSearchTitle": "Jasper Pro Search",
  "rm.run.proSearchHint":
    "開啟 Pro Search 會進行 AI 多輪參數最佳化（冠軍–挑戰者），通常需要更長時間。",
  "rm.run.proSearchOn": "Jasper Pro Search：開啟（多輪 AI 最佳化）",
  "rm.run.proSearchOff":
    "Jasper Pro Search：關閉（單次通過 — 所有試驗皆使用 AI 種子）",
  "rm.run.execute": "一鍵執行回測",
  "rm.run.showAdvanced": "進階設定",
  "rm.run.hideAdvanced": "收合進階設定",
  "rm.universe.resolving": "正在依客戶需求固定投資標的…",
  "rm.universe.fixedTitle": "投資標的（已固定）",
  "rm.universe.fixedCount": "已固定 {n} 檔標的",
  "rm.report.title": "RM 客戶報告",
  "rm.report.tabRm": "RM 摘要",
  "rm.report.tabQuant": "量化分析",
  "rm.report.executiveTitle": "執行摘要",
  "rm.report.executiveHint": "與客戶會議的關鍵重點",
  "rm.report.metricsSummary":
    "相對「{anchor}」：年化報酬 {cagrDelta}、最大回撤 {mddDelta}",
  "rm.report.noOverlaySummary": "依基準配置產出的客製化投資組合。",
  "rm.report.overlayTitle": "客戶需求摘要",
  "rm.report.overlayHint": "步驟 2 簽核的約束條件與客戶偏好",
  "rm.report.overlaySigned": "已簽核 · {date}",
  "rm.report.metricsTitle": "相對基準的關鍵指標",
  "rm.report.metricsHint": "綠燈代表該指標優於基準",
  "rm.report.holdingsTitle": "持股變化",
  "rm.report.holdingsHint": "相對基準配置的主要調整",
  "rm.report.talkingTitle": "建議說法",
  "rm.report.talkingHint": "客戶會議可用的白話說明角度",
  "rm.report.disclaimerTitle": "合規聲明",
  "rm.report.disclaimerBody":
    "僅供 RM 內部審閱，非投資建議。所有數字均為回測模擬結果，過去績效不代表未來表現。對客戶說明前須經人工審核。",
  "rm.report.openQuant": "開啟量化分析",
  "rm.report.revise": "修改客戶需求",
  "rm.report.candidateTitle": "試驗策略",
  "rm.report.candidateHint":
    "切換客製化回測的 Optuna 試驗；預設為冠軍策略。",
  "rm.report.candidateChampion": "★",
  "rm.quant.championWhyTitle": "為何選為冠軍策略",
  "rm.quant.championWhyCode": "冠軍策略：{code}",
  "proposal.ctaTitle": "Investment Proposal",
  "proposal.ctaHint":
    "從本次回測產生可列印的私人銀行風格建議書（封面、配置表、雙軌績效）",
  "proposal.generate": "生成 Investment Proposal",
  "proposal.title": "Investment Proposal（草案）",
  "proposal.subtitle": "RM 內部草案 — 數字來自雙軌回測；對客前請審核",
  "proposal.print": "列印／另存為 PDF",
  "proposal.close": "關閉",
  "proposal.draftBanner":
    "僅為作業草案。JASPER 不下單。正式對客文件仍須 RM／合規審核。",
  "proposal.toc": "目錄 Contents",
  "proposal.cover.docTitle": "Investment Proposal",
  "proposal.cover.firm": "私人銀行 · RM Copilot",
  "proposal.cover.confidential": "機密 — 僅供指定收件人",
  "proposal.cover.clientFallback": "貴賓客戶",
  "proposal.cover.rmFallback": "理財經理",
  "proposal.cover.amountPending": "待確認",
  "proposal.cover.strategyLine":
    "錨點：{am} · {theme}。建議路徑：{customized}。",
  "proposal.letter.dear": "親愛的 {client}：",
  "proposal.letter.thanks":
    "感謝與您討論約 {amount} 的投資配置，錨點為 {strategy}。以下為建議組合與相關分析。",
  "proposal.letter.recommend":
    "我們建議自 {anchor} 朝客製化配置（{customized}）推進，最終仍須您的確認與本行之適配審查。",
  "proposal.letter.close": "此致",
  "proposal.field.client": "客戶",
  "proposal.field.preparedBy": "編製人",
  "proposal.field.date": "日期",
  "proposal.field.investment": "參考投資金額",
  "proposal.field.segment": "客群",
  "proposal.field.age": "年齡",
  "proposal.field.risk": "風險屬性",
  "proposal.field.horizon": "投資年期",
  "proposal.field.horizonYears": "年期（Overlay）",
  "proposal.field.years": "{n} 年",
  "proposal.field.aum": "管理資產",
  "proposal.field.cash": "現金",
  "proposal.field.liquidity": "流動性需求",
  "proposal.field.overlayLiquidity": "流動性（Overlay）",
  "proposal.field.withinMonths": "{n} 個月內",
  "proposal.field.esg": "ESG 偏好",
  "proposal.field.objective": "最佳化目標",
  "proposal.field.marketStance": "市場觀點",
  "proposal.field.profile": "輪廓",
  "proposal.table.fund": "基金／ETF",
  "proposal.table.holding": "持倉",
  "proposal.table.pct": "配置比例",
  "proposal.table.amount": "金額配置",
  "proposal.table.total": "合計",
  "proposal.table.metric": "指標",
  "proposal.table.delta": "差異",
  "proposal.table.anchorPct": "錨點 %",
  "proposal.table.customPct": "建議 %",
  "proposal.section.executive": "執行摘要 Executive Summary",
  "proposal.section.profile": "客戶輪廓與目標 Client Profile & Objectives",
  "proposal.section.current": "現況與持倉 Current Situation / Holdings",
  "proposal.section.strategy": "建議策略 Recommended Strategy",
  "proposal.section.allocation": "建議配置 Proposed Allocation",
  "proposal.section.rationale": "理由與話術 Rationale & Talking Points",
  "proposal.section.performance": "風險與績效示意 Risk & Performance",
  "proposal.section.implementation": "執行規劃 Implementation",
  "proposal.section.disclaimers": "免責與適配 Disclaimers & Suitability",
  "proposal.section.market": "市場脈絡與建議理由 Market Context & Rationale",
  "proposal.section.construction": "策略建構與約束 Strategy Construction & Constraints",
  "proposal.section.validation": "歷史驗證（回測）Historical Validation",
  "proposal.section.risk": "風險分析 Risk Analysis",
  "proposal.body.letterIntro":
    "本建議書為 {client} 之客製化 ETF 配置草案（參考規模 {amount}），以 {am} · {theme} 為模型組合錨點。",
  "proposal.body.executive":
    "建議方向：將 {anchor} 客製化為 {customized}，並以雙軌回測驗證。",
  "proposal.body.metricsPending": "關鍵績效差異將於指標載入後顯示。",
  "proposal.body.profileFallback": "客戶偏好已於 Overlay 流程確認。",
  "proposal.body.currentAnchor": "起點（錨點模型組合）：{anchor}",
  "proposal.body.currentFootnote":
    "現況持倉截至 {asOf}。Demo 資料 — 非保管行正式進帳。",
  "proposal.body.market":
    "調整理由聚焦於從 {anchor} 移向 {customized}，並遵循已簽核客戶需求。",
  "proposal.body.strategyAnchor":
    "錨點模型組合：{am} · {theme}（風險帶：{risk}）。此為資產管理公司主題產品起點。",
  "proposal.body.strategyCustomize":
    "客製化建議（{customized}）依已簽核 Overlay 約束，對錨點（{anchor}）進行個人化，並以雙軌回測驗證。",
  "proposal.body.allocationFallback": "客製化持股將於權重解析後顯示。",
  "proposal.body.allocationFootnote":
    "權重來自客製化冠軍（或選定試驗）。金額為示意，依客戶現金／AUM 快照推估。",
  "proposal.body.constructionFallback":
    "回測區間 {start} → {end}；目標 {objective}。Overlay 提示與排除條件仍適用。",
  "proposal.body.excludes": "排除標的：{tickers}",
  "proposal.body.objectiveLine": "最佳化目標：{objective}",
  "proposal.body.validationNote":
    "數字來自引擎雙軌回測（錨點 vs 客製化），非 AI 編造。過往績效並非未來表現之可靠指引。",
  "proposal.body.chartCaption":
    "雙軌淨值示意（均 rebase 至 100），區間 {start} → {end}。實際保單／帳戶價值將受費用、稅負與進出時點影響。",
  "proposal.body.riskMdd": "客製化最大回撤 {customized}，錨點為 {anchor}。",
  "proposal.body.riskFallback": "請於量化分析分頁檢視回撤與集中度。",
  "proposal.body.implDca":
    "若顧慮一次性進場時機，可對股票部位採定期定額（DCA）分批布局。",
  "proposal.body.implRebalance":
    "再平衡依已簽核回測假設（{start} → {end}），除非銀行政策另有規定。",
  "proposal.body.implLiquidity":
    "全額投入前，請保留足以因應短期現金需求的流動性緩衝。",
  "proposal.body.implClientLiquidity": "客戶流動性備註：{note}",
  "proposal.body.impl1": "若流動性或市場衝擊敏感，可分批建倉。",
  "proposal.body.impl2": "對客前請確認費用、稅務與適配性（依機構規範）。",
  "proposal.body.impl3": "再平衡頻率依已簽核回測設定，除非另行修訂。",
  "proposal.body.signOffNote": "RM 簽核備註：{note}",
  "proposal.body.disclaimer1": "過往績效不代表未來結果。",
  "proposal.body.disclaimer2": "本草案僅供 RM 內部使用，待合規放行後再對客。",
  "proposal.body.disclaimerSuitability":
    "適配性、KYC 與產品核准仍為銀行可控流程；JASPER 不對法規適配出具認證。",
  "proposal.body.nextSteps":
    "下一步：RM 審閱 → 合規／適配檢查 → 客戶討論 → 執行指示（於 JASPER 外完成）。",
  "proposal.warning.pastPerformance":
    "警語：過往績效並非未來表現之可靠指引。",
  "proposal.warning.valueFluctuation":
    "警語：投資價值可升可跌，您可能損失部分或全部本金。",
  "proposal.warning.currency":
    "警語：報酬可能受匯率波動影響。",
  "proposal.warning.estimates":
    "警語：數字僅為估計／回測示意。",
  "proposal.warning.noAdvice":
    "警語：本資料僅供資訊與討論，不構成要約或投資建議。",
  "rm.holdings.change": "變化",
  "rm.holdings.added": "新增",
  "rm.holdings.removed": "移除",
  "rm.holdings.increased": "加碼",
  "rm.holdings.decreased": "減碼",
  "rm.holdings.unchanged": "持平",
  "rm.talking.portfolioStructure":
    "本客製化配置以{assetMix}為主，前三大持股為{topHoldings}。開場可先說明：這是在客戶簽核的資產範圍內，依需求調整後的實際組成。",
  "rm.talking.portfolioHoldingsOnly":
    "前三大持股為{topHoldings}。可先帶客戶看核心標的，說明客製化配置的骨架。",
  "rm.talking.vsAnchorChanges":
    "相對基準（{anchor}）：{changes}——強調這些是為達成簽核目標而做的有意義調整，而非隨意換股。",
  "rm.talking.changeAdded": "新增 {ticker}（{pct}%）",
  "rm.talking.changeRemoved": "移除 {ticker}",
  "rm.talking.changeIncreased": "加碼 {ticker}（+{delta} 個百分點）",
  "rm.talking.changeDecreased": "減碼 {ticker}（-{delta} 個百分點）",
  "rm.talking.clientLiquidity":
    "客戶需在 {months} 個月內保留流動性{amount}——說明配置如何維持可變現緩衝，呼應簽核時的資金需求。",
  "rm.talking.liquidityAmount": "（約 USD {amount}）",
  "rm.talking.clientRiskTolerance":
    "客戶風險取向為{tolerance}，配置明顯偏{tilt}——可連結到簽核時對下行風險的關注。",
  "rm.talking.clientMarketView":
    "簽核市場觀點（{stance}）：{summary}——說明持股如何體現此觀點。",
  "rm.talking.clientUniverse":
    "簽核投資標的規則：{rules}——說明最終持股如何符合這些限制。",
  "rm.talking.riskTolerance.conservative": "保守",
  "rm.talking.riskTolerance.moderate": "中等",
  "rm.talking.riskTolerance.aggressive": "積極",
  "rm.talking.tilt.defensive": "防禦（債券權重較高）",
  "rm.talking.tilt.growth": "成長（股票權重較高）",
  "rm.talking.tilt.balanced": "均衡（成長與防禦並重）",
  "rm.talking.objective.min_max_drawdown":
    "本次優化目標為「{objective}」；客製化最大回撤為 {customized}，優於基準的 {anchor}（改善 {delta}）——以此說明目標確實反映在績效上。",
  "rm.talking.objective.max_sharpe":
    "本次優化目標為「{objective}」；客製化夏普比率為 {customized}，相對基準 {anchor}（{delta}）——強調風險調整後的效率提升。",
  "rm.talking.objective.max_return":
    "本次優化目標為「{objective}」；客製化年化報酬為 {customized}，相對基準 {anchor}（{delta}）——連結報酬結果與簽核目標。",
  "rm.talking.objective.generic":
    "優化目標：{objective}。相對基準的關鍵結果：{customized} vs {anchor}（{delta}）。",
  "rm.talking.performanceWin":
    "客製化年化報酬較基準高 {cagrDelta}{extras}——可強調在滿足客戶約束下仍維持或提升長期報酬潛力。",
  "rm.talking.extraMddImproved": "最大回撤改善 {delta}",
  "rm.talking.extraVolReduced": "波動度降低 {delta}",
  "rm.talking.performanceTradeoff":
    "年化報酬略低於基準（{cagrDelta}），但{tradeoffs}——建議向客戶說明這是為換取更低回撤與更平穩體驗所做的取捨。",
  "rm.talking.tradeoffMdd": "最大回撤改善 {delta}",
  "rm.talking.tradeoffVol": "波動度降低 {delta}",
  "rm.talking.tradeoffSharpe": "夏普比率優於基準",
  "rm.talking.tradeoffGeneric": "整體風險較基準更低、路徑更平穩",
  "rm.talking.performanceSimilar":
    "報酬與基準相近（{highlights}）——著重說明配置如何更貼合簽核的客戶需求。",
  "rm.talking.similarGeneric": "配置契合度比小幅報酬差距更重要",
  "rm.talking.compliance":
    "提醒：以上為回測示意，僅供討論之用，並非投資建議；實際執行前請確認適合度與合規要求。",
  "rm.overlay.signed":
    "客戶需求已簽核，投資標的已固定。請確認摘要後一鍵執行雙軌回測。",

  "progress.dual.anchor": "基準回測",
  "progress.dual.customized": "客製化回測",

  "nav.aria": "主導覽",
  "nav.clients": "客戶儀表板",
  "nav.pool": "投資標的池",
  "nav.models": "模型組合",
  "nav.personalization": "基準客製化",

  "clients.listTitle": "客戶儀表板",
  "clients.listSubtitle": "示範客戶",
  "clients.listHint": "選擇客戶檢視輪廓與持倉，再啟動基準客製化。",
  "clients.detailSubtitle": "客戶輪廓",
  "clients.backToList": "返回客戶列表",
  "clients.notFound": "找不到此客戶。",
  "clients.profile": "客戶輪廓",
  "clients.holdings": "現況持倉",
  "clients.holdingsHint": "示範用持倉摘要，非託管系統即時資料。",
  "clients.aum": "管理資產",
  "clients.cash": "現金",
  "clients.clientId": "客戶編號",
  "clients.age": "年齡",
  "clients.risk": "風險屬性",
  "clients.horizon": "投資年期",
  "clients.rm": "負責理專",
  "clients.liquidity": "流動性備註",
  "clients.asOf": "資料基準日",
  "clients.weight": "權重",
  "clients.suggestedAnchor": "建議模型組合",
  "clients.launchCta": "啟動基準客製化",
  "clients.launchHint": "將帶入此客戶風險屬性與建議錨點，進入基準客製化流程。",
  "clients.launchBanner": "已載入客戶「{name}」上下文。請確認錨點，再於 Overlay 描述需求。",
  "clients.contextBanner": "目前客戶：{name} · 風險 {risk}",
  "clients.viewDashboard": "查看儀表板",
  "clients.esg": "ESG 偏好",
  "clients.ageUnit": " 歲",
  "clients.holding.cash": "現金",
  "clients.holding.cashMoneyMarket": "現金／貨幣市場",
  "clients.notes": "備註",
  "clients.notePrefix": "備註:",
  "clients.upcomingEvents": "即將發生的事件提醒",

  "enum.risk.conservative": "保守",
  "enum.risk.moderate": "穩健",
  "enum.risk.aggressive": "積極",
  "enum.risk.moderate_conservative": "偏保守",
  "enum.risk.moderate_aggressive": "偏積極",

  "enum.esg.none": "無",
  "enum.esg.light": "輕度",
  "enum.esg.moderate": "中度",
  "enum.esg.strong": "高度",
  "enum.esg.strict": "嚴格",

  "institutional.cash": "現金",
  "institutional.fixed_income": "固定收益",

  "pool.title": "投資標的池",
  "pool.subtitle": "全局示範貨架",
  "pool.countBadge": "已啟用 {enabled} / {total}",
  "pool.loadDemo": "載入示範 ETF",
  "pool.loadFull": "載入完整 ETF Universe",
  "pool.importCsv": "匯入 CSV",
  "pool.exportCsv": "匯出 CSV",
  "pool.importReport": "匯入：更新 {upserted} 筆，略過 {skipped} 筆",
  "pool.searchPlaceholder": "搜尋代碼或名稱…",
  "pool.filter.allClasses": "全部資產類別",
  "pool.filter.allRegions": "全部區域",
  "pool.filter.enabledOnly": "僅顯示已啟用",
  "pool.col.enabled": "啟用",
  "pool.col.ticker": "代碼",
  "pool.col.name": "名稱",
  "pool.col.assetClass": "資產類別",
  "pool.col.region": "區域",
  "pool.col.productType": "產品類型",
  "pool.empty": "沒有符合條件的標的。",
  "pool.toggleEnabled": "啟用 {ticker}",
  "pool.region.us": "美國",
  "pool.region.intl": "國際",
  "pool.region.global": "全球",
  "pool.product.etf": "ETF",
  "pool.product.fund": "基金",
  "pool.product.structured": "結構型",
  "pool.product.bond": "債券",
  "pool.product.other": "其他",

  "models.title": "模型組合",
  "models.subtitle": "AM 錨點目錄",
  "models.countBadge": "可用 {ready} / 共 {total}",
  "models.resetBundled": "重設為內建組合",
  "models.importCsv": "匯入 CSV",
  "models.exportCsv": "匯出 CSV",
  "models.importReport": "匯入：{count} 組組合，略過 {skipped} 列",
  "models.conflict": "標的池衝突",
  "models.conflictBadge": "衝突",
  "models.conflictTickers": "未在啟用標的池中",
  "models.disabled": "已停用",
  "models.enabled": "啟用",
  "models.showHoldings": "顯示持倉",
  "models.hideHoldings": "收合持倉",
  "models.col.am": "資產管理人",
  "models.col.theme": "主題",
  "models.risk": "風險",
  "models.benchmark": "基準",
  "models.issuerHoldingsHint": "成分均為該發行機構 ETF",

  "anchor.poolConflicts": "有 {count} 組模型因標的池衝突而隱藏 — 請修正標的池或模型組合。",
  "anchor.empty": "沒有可選錨點。請啟用成分皆在標的池中的模型組合。",
};

const ko: Dict = {
  // Header / shell
  "header.phase.scenario": "—",
  "header.phase.anchor": "기준 구성",
  "header.phase.overlay": "고객 니즈",
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
  "config.notifyEmailSmtpDisabled":
    "이 서버에는 이메일(SMTP)이 설정되어 있지 않아 주소를 입력해도 알림을 받을 수 없습니다.",

  // Pro rounds tabs
  "pro.tabsHint":
    "각 탭은 한 라운드입니다: 현재 선두와 그 도전자들. ★는 라운드 우승자를 표시합니다. 카탈로그 탭에는 지금까지 시도한 모든 전략이 나열됩니다.",
  "pro.allRounds": "전체 라운드",
  "pro.role.incoming": "현재 선두",
  "pro.role.challenger": "도전자",
  "pro.role.winner": "라운드 우승자",

  // Results dashboard
  "results.runObjectiveLabel": "이번 최적화 목표",
  "results.title": "결과",
  "results.model": "전략",
  "results.fullNarrative": "전체 요약",
  "results.fullPeriod": "전체 기간",
  "results.rmChampionLine": "챔피언 모델 {model} · 샤프 {sharpe} · 연환산 수익 {cagr}",
  "results.refineHint": "클릭하면 조정 적용 · 더블클릭하면 적용 후 다시 실행.",
  "results.editConfig": "설정 편집",
  "results.belowBenchmarkTitle": "솔직한 평가: 이번 실행은 벤치마크를 밑돌았습니다",
  "results.belowBenchmarkBody":
    "이 기간 동안 선택한 목표에서 {benchmark}를 이긴 시도가 하나도 없습니다. 이는 도구의 문제가 아니라 실제 결과입니다 — 처음부터 다시 시작할 필요 없이 이번 실행에서 계속 반복할 수 있습니다: 팩터, 제약, 유니버스 또는 목표를 조정한 뒤 다시 실행하세요.",
  "results.iterateFromHere": "조정 후 다시 실행",
  "results.continueRefinementTitle": "벤치마크 미달 — 최적화를 이어갈까요?",
  "results.continueRefinementBody":
    "이 기간 동안 선택한 목표에서 {benchmark}를 이긴 시도가 없습니다. Pro 라운드(또는 시도 수)를 추가하고, 이번 실행의 챔피언·학습 기록·AI 맥락을 이어서 탐색할 수 있습니다.",
  "results.continueRefinementCta": "최적화 계속",
  "results.continueRefinementRunning": "이어서 실행 중…",
  "results.continueRefinementHint": "job {job}… 의 챔피언 풀과 이전 라운드 기록을 유지합니다",
  "results.extraRoundsLabel": "추가 라운드",
  "results.extraTrialsPerRoundLabel": "라운드당 시도 수(도전자)",
  "results.extraTrialsLabel": "추가 Optuna 시도",
  "results.continueFromRound": "{round}라운드부터 재개",
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
  "chat.continueRefinementUser": "이번 실행에서 최적화 이어하기",
  "chat.continueRefinementAck": "이전 챔피언과 학습 기록을 유지한 채 추가 라운드를 실행합니다…",

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
  "progress.msg.queuedStatic": "정적 재생 작업이 대기열에 추가되었습니다…",
  "progress.msg.queuedPro": "Pro 최적화 작업이 대기열에 추가되었습니다…",
  "progress.msg.fetching": "시장 데이터를 가져오는 중, 최적화를 시작합니다…",
  "progress.msg.fetchingStatic": "정적 재생: 시장 데이터를 가져오는 중…",
  "progress.msg.staticSimulating": "정적 재생: 고정 비중 포트폴리오 시뮬레이션 중…",
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
  "assetFilter.selectedBase": "{total}개 ETF 중 {base}개 선택됨",
  "assetFilter.selectedCombined": "{total}개 ETF 중 {combined}개 선택됨",
  "assetFilter.layer1Intro": "투자할 자산군을 선택하세요({base}개 ETF).",
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
  "assetFilter.resultsPoolWithSupplement":
    "자산군 내 {base}개 ETF · 검색으로 {supplement}개 추가(항상 포함) · 총 {combined}개 ETF.",
  "assetFilter.resultsPoolNoSupplement":
    "자산군 내 {base}개 ETF. 검색을 실행하면 선택 범위 밖 ETF를 더 추가할 수 있습니다.",
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
  "linkedChart.assetClassTitle": "기간별 자산군 비중",
  "linkedChart.otherCapHint": "비중이 작은 종목은 ‘기타’로 묶음",
  "linkedChart.rebalanceSnapshotHint":
    "리밸런싱 사이에는 비중이 고정됩니다(리밸런싱일에만 계단식 변화)",
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
  "objectiveLab.isSharpe": "인샘플 샤프",
  "objectiveLab.oosSharpe": "아웃오브샘플 샤프",
  "objectiveLab.isReturn": "인샘플 수익률",
  "objectiveLab.isMaxDd": "인샘플 최대 낙폭",
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
  "institutional.monthlyFull": "월별 수익률",
  "institutional.annualInSample": "연간 수익률(인샘플{range})",
  "institutional.annualFull": "연간 수익률",
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
  "institutional.commodity": "원자재",
  "institutional.real_estate": "REIT",
  "institutional.alternative": "대체",
  "institutional.other": "기타",
  "institutional.durationProxy": "평균 듀레이션(년)",
  "institutional.riskContributionTop": "주요 위험 기여 종목",
  "institutional.coreHoldingsTitle": "핵심 보유 종목",
  "institutional.coreHoldingsNote": "이 전략이 가장 많이 활용한 종목입니다. 평소 포트폴리오에서 차지한 비중과 리밸런싱마다 얼마나 꾸준히 보유했는지를 보여줍니다.",
  "institutional.avgWeight": "평균 비중",
  "institutional.avgWeightHint": "모든 리밸런싱 시점에서 해당 종목이 포트폴리오에서 차지한 평균 비중. 높을수록 더 크고 핵심적인 포지션입니다.",
  "institutional.holdFrequency": "보유 비율",
  "institutional.holdFrequencyHint": "해당 종목을 보유한 빈도(비중이 0.5%를 넘은 리밸런싱 시점의 비율). 100%면 전체 기간 내내 보유했다는 뜻입니다.",
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
  "results.proRefinement": "Pro 최적화",
  "results.meta.rounds": "총 {rounds}회 개선 라운드, 후보 전략 {trials}개 테스트",
  "results.meta.convergedEarly": "조기에 수렴함 (추가 개선 없음)",
  "results.meta.fullSearch": "전체 탐색 완료",
  "results.meta.search": "파라미터 검색, 후보 전략 {trials}개 테스트",
  "results.meta.reported": "유효 전략 {feasible}개 발견, 보고서에 {reported}개 포함",
  "results.meta.catalog": "(총 {catalog}개 탐색)",
  "results.meta.rebalance": "{freq} 리밸런싱 (예정된 {count}회 중 {applied}회 적용)",
  "results.meta.rebalanceSkipped": "({skipped}회 건너뜀 — 첫 리밸런싱 전 더 긴 가격 이력 필요)",
  "results.meta.rebalanceChartDownsampled":
    "보유 차트에 {total}회 리밸런싱 스냅샷 중 {shown}회 표시",
  "results.freq.weekly": "매주",
  "results.freq.monthly": "매월",
  "results.freq.quarterly": "분기별",
  "results.freq.yearly": "매년",
  "results.freq.daily": "매일",
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
  "results.leaderboardTitleOutOfSample":
    "리더보드 · 아웃오브샘플 기간으로 순위를 매긴 전략",
  "results.leaderboardTitleFull":
    "리더보드 · 전체 표본 기간으로 순위를 매긴 전략",
  "results.leaderboardTitleGap":
    "리더보드 · 인샘플−아웃오브샘플 격차로 순위를 매긴 전략",
  "results.sortTableBy": "표 정렬 기준",
  "results.inSampleSelection": "인샘플(선택)",
  "results.gapSelection": "격차(인샘플 − 아웃오브샘플)",
  "results.engine": "엔진",
  "results.warmStartExact": "이전 챔피언 {code}에서 최적화 재개 (job {job})",
  "results.warmStartFuzzy": "이전 챔피언 {code}에서 최적화 재개 (job {job}; 기간 종료일 다름)",
  "results.warmStartImproved": "새 챔피언이 캐시 기준을 상회",
  "results.warmStartKept": "캐시 챔피언이 여전히 경쟁력 있음",
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
  "results.championWhyHorizonNote":
    "★는 선정 구간(OOS 홀드아웃이 켜져 있으면 인샘플, 아니면 전체 샘플)에서 골라집니다. 보고서 표의 전체 기간 지표는 다를 수 있으며, 더 높은 Full Sharpe가 IS 목표 승자를 밀어내지는 않습니다. 과적합/IS–OOS 격차는 진단용입니다.",
  "results.championWhyFallbackLead":
    "목표 “{objective}” 기준으로 {code}가 {horizon} 선정 구간에서 우승했습니다(IS 샤프 {sharpe}, CAGR {cagr}, 최대낙폭 {mdd}). 전체 기간: 샤프 {fullSharpe}, CAGR {fullCagr}.",
  "results.championWhyFallbackLeadFull":
    "목표 “{objective}” 기준으로 {code}가 전체 샘플 구간에서 우승했습니다(샤프 {sharpe}, CAGR {cagr}, 최대낙폭 {mdd}).",
  "results.championWhyFallbackAlt":
    "차순위 {alt}는 같은 선정 구간에서 점수가 더 낮습니다(IS 샤프 {altSharpe}, CAGR {altCagr}). 전체 기간 샤프({altFullSharpe})가 더 높아 보여도 마찬가지입니다.",
  "results.championWhyFallbackAltFull":
    "차순위 {alt} 대비(샤프 {altSharpe}, CAGR {altCagr}).",
  "results.championHorizonInSample": "인샘플",
  "results.championHorizonFullSample": "전체 샘플",
  "results.anchorBenchmarkNote":
    "앵커 모델 포트폴리오: {anchor}. 성과 벤치마크 티커(가격 시계열): {ticker} — 차트는 이 티커 수익률과 비교하며, 앵커 보유 종목을 그대로 복제하지는 않습니다.",
  "results.anchorPortfolioBaselineNote":
    "비교 기준선: 앵커 모델 포트폴리오({anchor})의 정적 리플레이 성과이며, 시장 티커만 쓰지 않습니다.",
  "results.championFullSharpe": "전체 기간 샤프",
  "results.championFullMaxDd": "전체 기간 최대 낙폭",
  "results.championFullCagr": "전체 기간 CAGR",
  "results.leaderboardDynamicNote":
    "값은 각 기간의 동적 종합 점수입니다(높을수록 좋음). 챔피언(★)은 선정 구간의 목표로 순위가 매겨집니다(OOS가 켜져 있으면 인샘플). OOS/과적합 지표는 참고용이며 목표 승자를 강등하지 않습니다.",
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
  "results.targetWeightPct": "목표 비중 %",
  "results.actualClassWeights": "실제 자산군 구성(보유 종목)",
  "results.actualClassWeightsRegime": "실제 구성({regime} 리밸런싱 기간 평균)",
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
  "report.group.summary": "핵심 요약",
  "report.group.summaryHint": "AI 결론, 챔피언 선택 및 주요 지표",
  "report.group.performance": "성과",
  "report.group.performanceHint": "벤치마크 대비 모델 비교",
  "report.group.journey": "포트폴리오 여정",
  "report.group.journeyHint": "자산 성장과 시간에 따른 보유 종목 변화",
  "report.group.holdings": "보유 종목 및 리스크",
  "report.group.holdingsHint": "포트폴리오 보유 종목과 자산군 구성",
  "report.group.strategy": "전략 심층 분석",
  "report.group.strategyHint": "위험/수익 트레이드오프와 팩터 요인",
  "report.group.institutional": "기관급 분석",
  "report.group.institutionalHint": "벤치마크, 익스포저, 롤링 리스크 및 드로다운",
  "report.group.reproducibility": "재현성",
  "report.group.reproducibilityHint": "이 실행의 전체 설정 및 파라미터",
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
  "config.enforceClassWeights": "자산군 목표 비중 강제 적용",
  "config.enforceClassWeightsHint":
    "켜면 채권/주식 목표(국면별 할당 포함)가 Top-N 선정뿐 아니라 최종 비중까지 직접 반영됩니다.",
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
    "테스트할 전략 수. 표준 모드에서는 모든 트라이얼이 AI 생성 시드를 사용합니다(랜덤 채우기 없음). 보고서 크기는 아래에서 설정하세요.",
  "config.benchmarkLine": "벤치마크: {benchmark} · 무위험 수익률: 4%",

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

  // Optimization objectives (dropdown)
  "objective.dynamic": "동적 — 국면 적응(종합 점수)",
  "objective.max_sharpe": "샤프 비율 최대화",
  "objective.max_return": "연평균 수익률(CAGR) 최대화",
  "objective.min_max_drawdown": "최대 낙폭 최소화",
  "objective.max_sortino": "소르티노 비율 최대화",
  "objective.min_cvar": "CVaR(꼬리 위험) 최소화",
  "objective.risk_parity_erc": "리스크 패리티(균등 위험 기여)",
  "objective.max_diversification": "분산 효과 최대화",
  "objective.mean_variance_utility": "평균-분산 효용",
  "objective.custom": "사용자 지정 목표",

  // Allocator modes (dropdown)
  "allocator.auto": "자동(Jasper가 선택)",
  "allocator.mean_variance": "평균-분산",
  "allocator.min_var": "최소 분산",
  "allocator.risk_parity": "리스크 패리티",
  "allocator.max_diversification": "최대 분산",

  // Factor indicators — factor name + friendly description
  "factorInd.mom_indicator.label": "모멘텀",
  "factorInd.mom_indicator.hint": "수익 수준, 변동성 조정 수익, 또는 12-1 스킵 모멘텀",
  "factorInd.reversal_indicator.label": "리버설",
  "factorInd.reversal_indicator.hint": "단기 반전, 고점 대비 하락폭, 또는 RSI 과매도",
  "factorInd.value_indicator.label": "가치",
  "factorInd.value_indicator.hint": "이동평균 하회, 구간 내 저평가, 또는 장기 역발상 수익",
  "factorInd.lowvol_indicator.label": "저변동성",
  "factorInd.lowvol_indicator.hint": "총 변동성, 하방 변동성, 또는 동일가중 지수 대비 저베타",
  "factorInd.trend_indicator.label": "추세",
  "factorInd.trend_indicator.hint": "가격 대비 이동평균, 이동평균 기울기, 또는 단·장기 이동평균 교차",
  "factorInd.drawdown_indicator.label": "낙폭",
  "factorInd.drawdown_indicator.hint": "낙폭 깊이, 고점 이후 경과, 또는 얼서 지수",

  // Factor indicator options (dropdown values)
  "factorOpt.cumulative_return": "누적 수익",
  "factorOpt.risk_adjusted_return": "위험 조정 수익",
  "factorOpt.skip_month_12_1": "12-1 스킵",
  "factorOpt.negative_return": "음의 수익",
  "factorOpt.off_peak": "고점 이탈",
  "factorOpt.rsi_mean_reversion": "RSI 평균회귀",
  "factorOpt.ma_price_ratio": "이동평균/가격 비율",
  "factorOpt.price_percentile": "가격 백분위",
  "factorOpt.inverse_long_momentum": "역장기 모멘텀",
  "factorOpt.negative_vol": "음의 변동성",
  "factorOpt.negative_downside_dev": "음의 하방 편차",
  "factorOpt.negative_beta_market": "음의 시장 베타",
  "factorOpt.price_ma_ratio": "가격/이동평균 비율",
  "factorOpt.ma_slope": "이동평균 기울기",
  "factorOpt.dual_ma_crossover": "이중 이동평균 교차",
  "factorOpt.max_drawdown_depth": "최대 낙폭 깊이",
  "factorOpt.time_since_peak": "고점 이후 경과",
  "factorOpt.ulcer_index": "얼서 지수",

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
    "{label} — {status}. 조정 점수 {score}, 시행 {trials}회 · 전략 {models}개.",

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
  "institutional.rmCompactHint": "고객 설명용 벤치마크·배분 핵심",
  "institutional.benchmarkStaleNote":
    "아래 Beta·Alpha·IR은 {computed} 대비로 계산되었습니다. 선택한 기준 벤치마크로 갱신하려면 백테스트를 다시 실행하세요.",
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

  // Anchor / benchmark personalization
  "anchor.title": "기준 구성",
  "anchor.subtitle":
    "자산운용사(AM)가 발행한 테마 모델 포트폴리오를 고객의 시작 벤치마크로 선택하세요. 각 모델은 해당 운용사 ETF로만 구성되며, JASPER가 그 위에 맞춤 변형을 만듭니다.",
  "anchor.universeNote": "데모 유니버스: 주요 ETF {count}개 (SPY, IVV, QQQ, VTI, AGG 등)",
  "anchor.placeholderHoldingsHint": "구성은 모두 해당 운용사 ETF",
  "anchor.selected": "선택된 기준",
  "anchor.continue": "다음: 고객 니즈",
  "anchor.am": "자산운용사",
  "anchor.theme": "테마",

  "overlay.skipToConfig": "건너뛰고 고급 설정으로",
  "overlay.continueToConfig": "백테스트 설정으로",
  "overlay.interpret.error.apiKeyMissing":
    "고객 니즈 해석 불가: Gemini API 키가 설정되지 않았습니다.",
  "overlay.interpret.error.geminiUnavailable":
    "해석 실패: Gemini를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도하세요.",
  "overlay.interpret.error.parseFailed":
    "해석 실패: AI 응답을 파싱할 수 없습니다. 다시 시도하세요.",
  "overlay.interpret.error.validationFailed":
    "해석 실패: AI 응답 형식이 예상과 다릅니다. 다시 시도하세요.",
  "overlay.interpret.error.responseInvalid":
    "해석 실패: AI 응답을 사용할 수 없습니다. 다시 시도하세요.",
  "overlay.interpret.error.generic":
    "고객 니즈 해석에 실패했습니다. 잠시 후 다시 시도하거나 지원팀에 문의하세요.",
  "chat.speakerYou": "나:",
  "chat.speakerJasper": "JASPER:",
  "chat.speakerSystem": "시스템:",

  "compare.title": "기준 vs 맞춤 구성",
  "compare.subtitle": "병렬 백테스트 성과 비교.",
  "compare.col.metric": "지표",
  "compare.col.delta": "차이",
  "compare.metric.cagr": "연환산 수익",
  "compare.metric.sharpe": "샤프",
  "compare.metric.mdd": "최대 낙폭",
  "compare.metric.vol": "변동성",
  "compare.chart.title": "자산 곡선",
  "compare.chart.anchor": "기준",
  "compare.chart.customized": "맞춤",

  "rm.mode.label": "모드",
  "rm.mode.rm": "RM 모드",
  "rm.mode.advanced": "고급 모드",
  "rm.step.nav": "워크플로",
  "rm.step.anchor": "기준 선택",
  "rm.step.overlay": "고객 니즈",
  "rm.step.execute": "실행",
  "rm.step.report": "RM 보고서",
  "rm.step.skipped": "건너뜀",
  "rm.run.title": "백테스트 실행 준비",
  "rm.run.subtitle":
    "서명된 고객 오버레이를 확인한 뒤 기준 vs 맞춤 이중 백테스트를 실행하세요.",
  "rm.run.clientNeeds": "고객 니즈 요약",
  "rm.run.whatWillRun": "실행 내용",
  "rm.run.period": "기간: {start} → {end}",
  "rm.run.dualTrack": "이중: 기준 재현 + 맞춤 최적화",
  "rm.run.proSearchTitle": "Jasper Pro Search",
  "rm.run.proSearchHint":
    "Pro Search를 켜면 AI 다중 라운드 파라미터 최적화(챔피언–챌린저)가 실행되며, 보통 더 오래 걸립니다.",
  "rm.run.proSearchOn": "Jasper Pro Search: ON (다중 라운드 AI 최적화)",
  "rm.run.proSearchOff":
    "Jasper Pro Search: OFF (단일 패스 — 모든 트라이얼이 AI 시드 사용)",
  "rm.run.execute": "백테스트 실행",
  "rm.run.showAdvanced": "고급 설정",
  "rm.run.hideAdvanced": "고급 설정 숨기기",
  "rm.universe.resolving": "고객 니즈에 따라 투자 유니버스를 고정하는 중…",
  "rm.universe.fixedTitle": "투자 유니버스 (고정됨)",
  "rm.universe.fixedCount": "{n}개 종목 고정",
  "rm.report.title": "RM 고객 보고서",
  "rm.report.tabRm": "RM 요약",
  "rm.report.tabQuant": "퀀트 분석",
  "rm.report.executiveTitle": "요약",
  "rm.report.executiveHint": "고객 미팅 핵심 포인트",
  "rm.report.metricsSummary":
    "「{anchor}」 대비: 수익 {cagrDelta}, 최대 낙폭 {mddDelta}",
  "rm.report.noOverlaySummary": "기준 구성을 바탕으로 한 맞춤 포트폴리오.",
  "rm.report.overlayTitle": "고객 니즈 요약",
  "rm.report.overlayHint": "2단계에서 서명 확인된 제약 및 고객 선호",
  "rm.report.overlaySigned": "서명 완료 · {date}",
  "rm.report.metricsTitle": "기준 대비 핵심 지표",
  "rm.report.metricsHint": "녹색 = 해당 지표에서 기준보다 우수",
  "rm.report.holdingsTitle": "보유 종목 변화",
  "rm.report.holdingsHint": "기준 대비 주요 조정",
  "rm.report.talkingTitle": "권장 설명 포인트",
  "rm.report.talkingHint": "고객 미팅용 쉬운 설명",
  "rm.report.disclaimerTitle": "컴플라이언스",
  "rm.report.disclaimerBody":
    "RM 내부 검토용. 투자 권유 아님. 모든 수치는 백테스트 시뮬레이션. 고객 설명 전 인간 검토 필수.",
  "rm.report.openQuant": "퀀트 분석 열기",
  "rm.report.revise": "고객 니즈 수정",
  "rm.report.candidateTitle": "시험 전략",
  "rm.report.candidateHint":
    "맞춤 실행의 Optuna 시험을 비교합니다. 기본값은 챔피언 전략입니다.",
  "rm.report.candidateChampion": "★",
  "rm.quant.championWhyTitle": "챔피언 전략으로 선정된 이유",
  "rm.quant.championWhyCode": "챔피언 전략: {code}",
  "proposal.ctaTitle": "Investment Proposal",
  "proposal.ctaHint":
    "이번 실행으로 인쇄 가능한 프라이빗뱅크형 제안서(표지·배분표·듀얼 성과)를 생성합니다",
  "proposal.generate": "Investment Proposal 생성",
  "proposal.title": "Investment Proposal (초안)",
  "proposal.subtitle": "RM 내부 초안 — 수치는 듀얼 백테스트 기반; 고객 전달 전 검토 필요",
  "proposal.print": "인쇄 / PDF로 저장",
  "proposal.close": "닫기",
  "proposal.draftBanner":
    "작업용 초안입니다. JASPER는 주문을 실행하지 않습니다. 정식 고객 문서는 RM/컴플라이언스 검토가 필요합니다.",
  "proposal.toc": "목차 Contents",
  "proposal.cover.docTitle": "Investment Proposal",
  "proposal.cover.firm": "Private Banking · RM Copilot",
  "proposal.cover.confidential": "기밀 — 지정 수신인 전용",
  "proposal.cover.clientFallback": "고객",
  "proposal.cover.rmFallback": "담당 RM",
  "proposal.cover.amountPending": "확인 예정",
  "proposal.cover.strategyLine":
    "앵커: {am} · {theme}. 권장 경로: {customized}.",
  "proposal.letter.dear": "{client} 님께,",
  "proposal.letter.thanks":
    "{strategy}를 앵커로 한 약 {amount} 투자 논의를 감사드립니다. 아래는 제안 포트폴리오와 분석입니다.",
  "proposal.letter.recommend":
    "{anchor}에서 맞춤 배분({customized})으로 진행하시길 권고드리며, 최종 확인과 은행 적합성 심사가 필요합니다.",
  "proposal.letter.close": "감사합니다,",
  "proposal.field.client": "고객",
  "proposal.field.preparedBy": "작성자",
  "proposal.field.date": "일자",
  "proposal.field.investment": "참고 투자금액",
  "proposal.field.segment": "세그먼트",
  "proposal.field.age": "연령",
  "proposal.field.risk": "위험성향",
  "proposal.field.horizon": "투자기간",
  "proposal.field.horizonYears": "기간(오버레이)",
  "proposal.field.years": "{n}년",
  "proposal.field.aum": "AUM",
  "proposal.field.cash": "현금",
  "proposal.field.liquidity": "유동성 니즈",
  "proposal.field.overlayLiquidity": "유동성(오버레이)",
  "proposal.field.withinMonths": "{n}개월 이내",
  "proposal.field.esg": "ESG 선호",
  "proposal.field.objective": "최적화 목표",
  "proposal.field.marketStance": "시장 관점",
  "proposal.field.profile": "프로필",
  "proposal.table.fund": "펀드 / ETF",
  "proposal.table.holding": "보유",
  "proposal.table.pct": "배분 %",
  "proposal.table.amount": "금액 배분",
  "proposal.table.total": "합계",
  "proposal.table.metric": "지표",
  "proposal.table.delta": "차이",
  "proposal.table.anchorPct": "앵커 %",
  "proposal.table.customPct": "제안 %",
  "proposal.section.executive": "요약 Executive Summary",
  "proposal.section.profile": "고객 프로필 및 목표 Client Profile & Objectives",
  "proposal.section.current": "현재 상황 / 보유 Current Situation / Holdings",
  "proposal.section.strategy": "권장 전략 Recommended Strategy",
  "proposal.section.allocation": "제안 배분 Proposed Allocation",
  "proposal.section.rationale": "근거 및 설명 포인트 Rationale & Talking Points",
  "proposal.section.performance": "리스크·성과 예시 Risk & Performance",
  "proposal.section.implementation": "실행 Implementation",
  "proposal.section.disclaimers": "면책 및 적합성 Disclaimers & Suitability",
  "proposal.section.market": "시장 맥락 및 제안 근거 Market Context & Rationale",
  "proposal.section.construction": "전략 구성 및 제약 Strategy Construction & Constraints",
  "proposal.section.validation": "역사적 검증(백테스트) Historical Validation",
  "proposal.section.risk": "리스크 분석 Risk Analysis",
  "proposal.body.letterIntro":
    "본 제안서는 {client}의 맞춤 ETF 포트폴리오 초안이며(참고 규모 {amount}), {am} · {theme}를 모델 포트폴리오 앵커로 사용합니다.",
  "proposal.body.executive":
    "권장 방향: {anchor}를 {customized}로 맞춤화하고 듀얼 백테스트로 검증.",
  "proposal.body.metricsPending": "핵심 성과 차이는 지표 로드 후 표시됩니다.",
  "proposal.body.profileFallback": "고객 선호는 오버레이 워크플로에서 확인되었습니다.",
  "proposal.body.currentAnchor": "출발점(앵커 모델 포트폴리오): {anchor}",
  "proposal.body.currentFootnote":
    "현재 보유 스냅샷 기준일 {asOf}. 데모 데이터 — 커스터디 피드가 아닙니다.",
  "proposal.body.market":
    "조정 근거는 서명된 고객 니즈를 존중하며 {anchor}에서 {customized}로 이동하는 데 초점을 둡니다.",
  "proposal.body.strategyAnchor":
    "앵커 모델 포트폴리오: {am} · {theme} (리스크 밴드: {risk}). AM 테마 상품 출발점입니다.",
  "proposal.body.strategyCustomize":
    "맞춤 권고({customized})는 서명된 오버레이 제약으로 앵커({anchor})를 개인화하고 듀얼 백테스트로 검증합니다.",
  "proposal.body.allocationFallback": "맞춤 보유 종목은 가중치 해석 후 표시됩니다.",
  "proposal.body.allocationFootnote":
    "가중치는 맞춤 챔피언(또는 선택 트라이얼) 기준입니다. 금액은 고객 현금/AUM 스냅샷의 예시입니다.",
  "proposal.body.constructionFallback":
    "백테스트 구간 {start} → {end}; 목표 {objective}. 오버레이 프롬프트와 제외 종목이 적용됩니다.",
  "proposal.body.excludes": "제외 티커: {tickers}",
  "proposal.body.objectiveLine": "최적화 목표: {objective}",
  "proposal.body.validationNote":
    "수치는 엔진 듀얼 백테스트(앵커 vs 맞춤)에서 오며 AI가 만들어 낸 것이 아닙니다. 과거 성과는 미래 성과의 신뢰할 수 있는 지표가 아닙니다.",
  "proposal.body.chartCaption":
    "듀얼 에쿼티 예시(100 리베이스), 구간 {start} → {end}. 실제 계좌 가치는 수수료·세금·타이밍에 따라 달라집니다.",
  "proposal.body.riskMdd": "맞춤 최대낙폭 {customized}, 앵커 {anchor}.",
  "proposal.body.riskFallback": "퀀트 탭에서 낙폭과 집중도를 검토하세요.",
  "proposal.body.implDca":
    "일시 투자 타이밍이 우려되면 주식 슬리브에 DCA(분할 매수)를 고려하세요.",
  "proposal.body.implRebalance":
    "리밸런싱은 서명된 백테스트 가정({start} → {end})을 따르며, 은행 정책이 우선합니다.",
  "proposal.body.implLiquidity":
    "전액 투입 전 단기 현금 수요에 맞는 유동성 버퍼를 유지하세요.",
  "proposal.body.implClientLiquidity": "고객 유동성 메모: {note}",
  "proposal.body.impl1": "유동성·시장충격이 우려되면 분할 진입을 고려하세요.",
  "proposal.body.impl2": "고객 전달 전 수수료·세금·적합성(은행 정책)을 확인하세요.",
  "proposal.body.impl3": "리밸런싱 주기는 별도 수정이 없으면 서명된 백테스트 설정을 따릅니다.",
  "proposal.body.signOffNote": "RM 서명 메모: {note}",
  "proposal.body.disclaimer1": "과거 성과가 미래 결과를 보장하지 않습니다.",
  "proposal.body.disclaimer2": "본 초안은 컴플라이언스 승인 전까지 RM 내부용입니다.",
  "proposal.body.disclaimerSuitability":
    "적합성·KYC·상품 승인은 은행 프로세스이며, JASPER는 규제 적합성을 인증하지 않습니다.",
  "proposal.body.nextSteps":
    "다음 단계: RM 검토 → 컴플라이언스/적합성 → 고객 논의 → 실행 지시(JASPER 외부).",
  "proposal.warning.pastPerformance":
    "경고: 과거 성과는 미래 성과의 신뢰할 수 있는 지표가 아닙니다.",
  "proposal.warning.valueFluctuation":
    "경고: 투자 가치는 하락할 수 있으며 원금 일부 또는 전부를 잃을 수 있습니다.",
  "proposal.warning.currency":
    "경고: 수익률은 환율 변동의 영향을 받을 수 있습니다.",
  "proposal.warning.estimates":
    "경고: 수치는 추정/백테스트 예시일 뿐입니다.",
  "proposal.warning.noAdvice":
    "경고: 본 자료는 정보·논의 목적이며 청약/투자 권유가 아닙니다.",
  "rm.holdings.change": "변화",
  "rm.holdings.added": "추가",
  "rm.holdings.removed": "제거",
  "rm.holdings.increased": "증가",
  "rm.holdings.decreased": "감소",
  "rm.holdings.unchanged": "유지",
  "rm.talking.portfolioStructure":
    "맞춤 포트폴리오는 {assetMix} 비중이며, 상위 보유 종목은 {topHoldings}입니다. 고객이 서명한 자산 범위와 니즈를 반영한 실제 구성임을 먼저 설명하세요.",
  "rm.talking.portfolioHoldingsOnly":
    "상위 보유 종목: {topHoldings}. 핵심 종목을 중심으로 맞춤 구성의 뼈대를 설명하세요.",
  "rm.talking.vsAnchorChanges":
    "기준({anchor}) 대비: {changes} — 서명된 고객 목표를 위한 의도적 조정이며 임의 매매가 아님을 강조하세요.",
  "rm.talking.changeAdded": "{ticker} 추가 ({pct}%)",
  "rm.talking.changeRemoved": "{ticker} 제거",
  "rm.talking.changeIncreased": "{ticker} 비중 확대 (+{delta}pp)",
  "rm.talking.changeDecreased": "{ticker} 비중 축소 (-{delta}pp)",
  "rm.talking.clientLiquidity":
    "고객은 {months}개월 이내 유동성{amount}이 필요합니다 — 현금화 가능한 완충을 유지하는 배분임을 설명하세요.",
  "rm.talking.liquidityAmount": " (USD {amount})",
  "rm.talking.clientRiskTolerance":
    "고객 위험 성향은 {tolerance}이며, 포트폴리오는 {tilt} 성향입니다 — 서명 시 하방 리스크 선호와 연결하세요.",
  "rm.talking.clientMarketView":
    "서명된 시장 관점({stance}): {summary} — 보유 종목이 이 관점을 어떻게 반영하는지 설명하세요.",
  "rm.talking.clientUniverse":
    "서명된 투자 유니버스 규칙: {rules} — 최종 보유가 이 제약을 어떻게 준수하는지 설명하세요.",
  "rm.talking.riskTolerance.conservative": "보수적",
  "rm.talking.riskTolerance.moderate": "중립",
  "rm.talking.riskTolerance.aggressive": "공격적",
  "rm.talking.tilt.defensive": "방어적(채권 비중 높음)",
  "rm.talking.tilt.growth": "성장 지향(주식 비중 높음)",
  "rm.talking.tilt.balanced": "균형(성장·방어 병행)",
  "rm.talking.objective.min_max_drawdown":
    "최적화 목표는 「{objective}」입니다. 맞춤 최대 낙폭 {customized}, 기준 {anchor}({delta}) — 목표 달성 근거로 활용하세요.",
  "rm.talking.objective.max_sharpe":
    "최적화 목표는 「{objective}」입니다. 맞춤 샤프 {customized}, 기준 {anchor}({delta}) — 위험 조정 수익 효율을 강조하세요.",
  "rm.talking.objective.max_return":
    "최적화 목표는 「{objective}」입니다. 맞춤 CAGR {customized}, 기준 {anchor}({delta}) — 서명 목표와 수익 결과를 연결하세요.",
  "rm.talking.objective.generic":
    "최적화 목표: {objective}. 기준 대비 핵심 결과: {customized} vs {anchor}({delta}).",
  "rm.talking.performanceWin":
    "맞춤 CAGR이 기준보다 {cagrDelta} 높습니다{extras} — 고객 제약을 지키면서 장기 수익 잠재력을 강조하세요.",
  "rm.talking.extraMddImproved": "최대 낙폭 {delta} 개선",
  "rm.talking.extraVolReduced": "변동성 {delta} 감소",
  "rm.talking.performanceTradeoff":
    "CAGR이 기준보다 {cagrDelta} 낮지만 {tradeoffs} — 의도적 리스크·유동성 트레이드오프로 설명하세요.",
  "rm.talking.tradeoffMdd": "최대 낙폭 {delta} 개선",
  "rm.talking.tradeoffVol": "변동성 {delta} 감소",
  "rm.talking.tradeoffSharpe": "샤프 비율 기준 대비 개선",
  "rm.talking.tradeoffGeneric": "기준 대비 전반적 리스크가 낮고 경로가 더 안정적",
  "rm.talking.performanceSimilar":
    "수익은 기준과 유사합니다({highlights}) — 서명된 고객 니즈에 더 잘 맞는 배분에 초점을 맞추세요.",
  "rm.talking.similarGeneric": "소폭 수익 차이보다 배분 적합성이 더 중요",
  "rm.talking.compliance":
    "참고: 위 내용은 논의용 백테스트 시연일 뿐이며 투자 권유가 아닙니다. 실행 전 적합성·컴플라이언스를 확인하세요.",
  "rm.overlay.signed":
    "오버레이 서명 완료. 투자 유니버스가 고정되었습니다. 요약을 확인한 뒤 이중 백테스트를 실행하세요.",

  "progress.dual.anchor": "기준 백테스트",
  "progress.dual.customized": "맞춤 백테스트",

  "nav.aria": "주 메뉴",
  "nav.clients": "고객 대시보드",
  "nav.pool": "투자 유니버스",
  "nav.models": "모델 포트폴리오",
  "nav.personalization": "벤치마크 맞춤화",

  "clients.listTitle": "고객 대시보드",
  "clients.listSubtitle": "데모 고객",
  "clients.listHint": "고객을 선택해 프로필·보유를 확인한 뒤 벤치마크 맞춤화를 시작하세요.",
  "clients.detailSubtitle": "고객 프로필",
  "clients.backToList": "고객 목록으로",
  "clients.notFound": "고객을 찾을 수 없습니다.",
  "clients.profile": "프로필",
  "clients.holdings": "현재 보유",
  "clients.holdingsHint": "데모용 스냅샷이며 커스터디 실시간 데이터가 아닙니다.",
  "clients.aum": "AUM",
  "clients.cash": "현금",
  "clients.clientId": "고객번호",
  "clients.age": "연령",
  "clients.risk": "위험성향",
  "clients.horizon": "투자기간",
  "clients.rm": "담당 RM",
  "clients.liquidity": "유동성 메모",
  "clients.asOf": "기준일",
  "clients.weight": "비중",
  "clients.suggestedAnchor": "권장 모델 포트폴리오",
  "clients.launchCta": "맞춤 분석 시작",
  "clients.launchHint": "이 고객의 위험성향과 권장 앵커를 반영해 벤치마크 맞춤화로 이동합니다.",
  "clients.launchBanner": "고객「{name}」컨텍스트를 불러왔습니다. 앵커를 확인한 뒤 Overlay에서 니즈를 설명하세요.",
  "clients.contextBanner": "활성 고객: {name} · 위험 {risk}",
  "clients.viewDashboard": "대시보드 보기",
  "clients.esg": "ESG 선호",
  "clients.ageUnit": "세",
  "clients.holding.cash": "현금",
  "clients.holding.cashMoneyMarket": "현금 / 단기금융",
  "clients.notes": "메모",
  "clients.notePrefix": "메모:",
  "clients.upcomingEvents": "다가오는 일정 알림",

  "enum.risk.conservative": "보수적",
  "enum.risk.moderate": "중립",
  "enum.risk.aggressive": "공격적",
  "enum.risk.moderate_conservative": "다소 보수적",
  "enum.risk.moderate_aggressive": "다소 공격적",

  "enum.esg.none": "없음",
  "enum.esg.light": "약함",
  "enum.esg.moderate": "보통",
  "enum.esg.strong": "강함",
  "enum.esg.strict": "엄격",

  "institutional.cash": "현금",
  "institutional.fixed_income": "채권",

  "pool.title": "투자 유니버스",
  "pool.subtitle": "전역 상품 선반",
  "pool.countBadge": "활성 {enabled} / {total}",
  "pool.loadDemo": "데모 ETF 불러오기",
  "pool.loadFull": "전체 ETF 유니버스 불러오기",
  "pool.importCsv": "CSV 가져오기",
  "pool.exportCsv": "CSV 내보내기",
  "pool.importReport": "가져오기: {upserted}건 반영, {skipped}건 건너뜀",
  "pool.searchPlaceholder": "티커 또는 이름 검색…",
  "pool.filter.allClasses": "전체 자산군",
  "pool.filter.allRegions": "전체 지역",
  "pool.filter.enabledOnly": "활성만",
  "pool.col.enabled": "활성",
  "pool.col.ticker": "티커",
  "pool.col.name": "이름",
  "pool.col.assetClass": "자산군",
  "pool.col.region": "지역",
  "pool.col.productType": "상품유형",
  "pool.empty": "조건에 맞는 종목이 없습니다.",
  "pool.toggleEnabled": "{ticker} 활성화",
  "pool.region.us": "미국",
  "pool.region.intl": "해외",
  "pool.region.global": "글로벌",
  "pool.product.etf": "ETF",
  "pool.product.fund": "펀드",
  "pool.product.structured": "구조화",
  "pool.product.bond": "채권",
  "pool.product.other": "기타",

  "models.title": "모델 포트폴리오",
  "models.subtitle": "AM 앵커 카탈로그",
  "models.hint": "벤치마크 맞춤화용 자산운용사(AM) 모델 포트폴리오를 관리합니다. 각 포트폴리오는 단일 운용사 ETF만 사용해야 하며, 구성 종목은 활성 투자 유니버스에 있어야 합니다. CSV: portfolio_id, portfolio_name, asset_manager, am_id, theme, risk_profile, ticker, weight, benchmark_ticker, enabled.",
  "models.countBadge": "사용가능 {ready} / 전체 {total}",
  "models.resetBundled": "기본 모델로 재설정",
  "models.importCsv": "CSV 가져오기",
  "models.exportCsv": "CSV 내보내기",
  "models.importReport": "가져오기: 포트폴리오 {count}개, 행 {skipped}개 건너뜀",
  "models.conflict": "유니버스 충돌",
  "models.conflictBadge": "충돌",
  "models.conflictTickers": "활성 유니버스에 없음",
  "models.disabled": "비활성",
  "models.enabled": "활성",
  "models.showHoldings": "보유 보기",
  "models.hideHoldings": "보유 접기",
  "models.col.am": "자산운용사",
  "models.col.theme": "테마",
  "models.risk": "위험",
  "models.benchmark": "벤치마크",
  "models.issuerHoldingsHint": "구성은 모두 해당 운용사 ETF",

  "anchor.poolConflicts": "유니버스 충돌로 {count}개 모델이 숨겨졌습니다 — Pool 또는 Models를 수정하세요.",
  "anchor.empty": "선택 가능한 앵커가 없습니다. 활성 유니버스에 구성이 있는 모델을 활성화하세요.",
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

/** Localized top-level asset-class label (equity, bond, commodity, cash, …). */
export function assetClassLabel(t: TFn, key?: string | null): string {
  if (!key) return "";
  const normalized = key === "fixed_income" ? "fixed_income" : key;
  const tk = `institutional.${normalized}`;
  const val = t(tk);
  if (val !== tk) return val;
  if (normalized === "fixed_income") return assetClassLabel(t, "bond");
  return String(key).replace(/_/g, " ");
}

/** Client / model risk profile label (conservative, moderate, …). */
export function riskProfileLabel(t: TFn, value?: string | null): string {
  if (!value) return "";
  const key = `enum.risk.${value}`;
  const val = t(key);
  return val === key ? value.replace(/_/g, " ") : val;
}

/** ESG preference label (none, light, moderate, strong, …). */
export function esgPreferenceLabel(t: TFn, value?: string | null): string {
  if (!value) return "";
  const key = `enum.esg.${value}`;
  const val = t(key);
  return val === key ? value.replace(/_/g, " ") : val;
}

/** Investment Pool region label (us, intl, global, …). */
export function regionLabel(t: TFn, value?: string | null): string {
  if (!value) return "";
  const key = `pool.region.${value}`;
  const val = t(key);
  return val === key ? value.replace(/_/g, " ") : val;
}

/** Investment Pool product type label (etf, fund, …). */
export function productTypeLabel(t: TFn, value?: string | null): string {
  if (!value) return "";
  const key = `pool.product.${value}`;
  const val = t(key);
  return val === key ? value.replace(/_/g, " ") : val;
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

/**
 * Turn a pandas-style rebalance frequency code (ME, QE, YE, W-FRI, WE, D, …)
 * into a plain, localized word ("Monthly", "每月", "매월"). Falls back to the
 * raw code only if it is completely unrecognized.
 */
export function rebalanceFreqLabel(t: TFn, code?: string | null): string {
  if (!code) return "";
  const c = String(code).trim().toUpperCase();
  if (c.startsWith("W")) return t("results.freq.weekly");
  if (c === "ME" || c === "M" || c === "MS" || c.startsWith("MON")) return t("results.freq.monthly");
  if (c.startsWith("Q")) return t("results.freq.quarterly");
  if (c.startsWith("Y") || c.startsWith("A")) return t("results.freq.yearly");
  if (c === "D" || c.startsWith("DAY") || c === "B") return t("results.freq.daily");
  return String(code);
}

/** Localized optimization-objective label (max_return, max_sharpe, …). */
export function objectiveLabel(t: TFn, key?: string | null): string {
  if (!key) return "";
  const tk = `objective.${key}`;
  const val = t(tk);
  return val === tk ? String(key).replace(/_/g, " ") : val;
}

/** Localized allocator-mode label (auto, mean_variance, …). */
export function allocatorLabel(t: TFn, key?: string | null): string {
  if (!key) return "";
  const tk = `allocator.${key}`;
  const val = t(tk);
  return val === tk ? String(key).replace(/_/g, " ") : val;
}

/** Localized factor name for a factor-indicator control key (mom_indicator, …). */
export function factorIndicatorLabel(t: TFn, key: string): string {
  const tk = `factorInd.${key}.label`;
  const val = t(tk);
  return val === tk ? key.replace(/_indicator$/, "").replace(/_/g, " ") : val;
}

/** Localized friendly description for a factor-indicator control key. */
export function factorIndicatorHint(t: TFn, key: string): string {
  const tk = `factorInd.${key}.hint`;
  const val = t(tk);
  return val === tk ? "" : val;
}

/** Localized label for a factor-indicator option code (cumulative_return, …). */
export function indicatorOptionLabel(t: TFn, option: string): string {
  const tk = `factorOpt.${option}`;
  const val = t(tk);
  return val === tk ? option.replace(/_/g, " ") : val;
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
