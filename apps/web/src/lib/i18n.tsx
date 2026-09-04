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
  "header.phase.anchor": "BASELINE",
  "header.phase.overlay": "CLIENT NEEDS",
  "header.phase.constraints": "SETUP",
  "header.phase.running": "RUNNING",
  "header.phase.results": "RESULTS",
  "header.phase.export": "EXPORT",
  "live.trial": "Proposal {n} of {total}",
  "results.needsFloorTitle": "Client floor check",
  "results.needsFloorPass":
    "Training-period max drawdown {actual} (floor {floor}) — within tolerance",
  "results.needsFloorFail":
    "Training-period max drawdown {actual} (floor {floor}) — breached by {breach}",
  "header.apiOffline": "Service offline",
  "header.apiOfflineHint":
    "We can’t reach the analytics service right now. Please try again in a moment.",
  "header.apiLinked": "Analytics engine connected",
  "lang.label": "LANG",
  "lang.aria": "Language",
  // Backtest history panel
  "history.title": "Strategy history",
  "history.refresh": "Refresh",
  "history.syncing": "Syncing…",
  "history.apiOffline": "Offline — showing local results",
  "history.record": "{count} result",
  "history.records": "{count} results",
  "history.empty":
    "Completed projections show up here after you run one.",
  "history.load": "OPEN",
  "history.status.completed": "completed",
  "history.status.failed": "failed",
  "history.status.running": "running",
  "history.status.queued": "queued",
  // Constraints / config form
  "config.title": "Strategy setup",
  "config.subtitle":
    "Set your proposal below. At each review, Jasper selects the strongest candidates and sizes positions to balance risk and return.",
  "config.maxWeight": "Max position size: {pct}%",
  "config.minWeight": "Min position size: {pct}%",
  "config.minWeightHint":
    "Positions smaller than this are trimmed at each review, and the freed-up cash is spread across your remaining positions.",
  "config.maxTurnover": "Max turnover per review: {pct}%",
  "config.maxTurnoverHint":
    "Limits how much of the portfolio Jasper can trade at each review, helping keep trading costs in check.",
  "config.customizationDrift": "Customization room (max): {pct}%",
  "config.customizationDriftHint":
    "Ceiling for how far Jasper may deviate from the baseline model (0% = identical, 100% = full reshape). By default AI searches within this room; set Advanced → Customization drift to Fixed to lock the slider value.",
  "config.maxHoldings": "Max positions: {n}",
  "config.maxHoldingsHint":
    "Must be greater than 100% ÷ single-name cap (min {min} when cap is {pct}%). Otherwise every name hits the cap and weights collapse to equal.",
  "config.topN": "Candidate shortlist: {n}",
  "config.topNHint":
    "Jasper ranks every candidate and keeps the top {n} to build your portfolio from.",
  "config.objective": "Investment goal",
  "config.customObjective": "Describe your goal",
  "config.start": "Start",
  "config.startHint":
    "Extra price history before this date is included, so day-one positions start from reliable signals.",
  "config.end": "End",
  "config.trials": "Search depth: {n} proposals",
  "config.topModels": "Models in report: {n}",
  "config.holdout":
    "Validate on recent data (Jasper trains on the earlier period, then checks results on the unseen part)",
  "config.inSampleRatio":
    "Train on the first {pct}% (the rest is reserved for validation)",
  "config.fee": "Trading cost: {bps} bps",
  "config.rebalanceFreq": "Review frequency",
  "config.rebalance.weekly": "Weekly (Fridays)",
  "config.rebalance.monthly": "Monthly",
  "config.rebalance.quarterly": "Quarterly",
  "config.rebalance.yearly": "Yearly",
  "config.runStandard": "Run portfolio projection",
  "config.runPro": "Run Pro optimization",
  "config.notifyEmail": "Email me when done (optional)",
  "config.notifyEmailPlaceholder": "you@example.com",
  "config.notifyEmailHint":
    "You can close this tab while it runs — we'll email you when it finishes or fails.",
  "config.notifyEmailSmtpDisabled":
    "Email notifications are not enabled in this environment.",

  // Pro rounds tabs
  "pro.tabsHint":
    "Each tab is one round: the current top pick plus its challenger proposals. ★ marks the round winner. The catalog tab lists every proposal tried so far.",
  "pro.allRounds": "ALL ROUNDS",
  "pro.roundChip": "Round {n}",
  "pro.role.incoming": "Current leading proposal",
  "pro.role.challenger": "Challenger proposal",
  "pro.role.winner": "Round winner",
  // Results dashboard
  "results.runObjectiveLabel": "Investment goal for this run",
  "results.title": "Results",
  "results.model": "strategy",
  "results.fullNarrative": "Full summary",
  "results.fullPeriod": "Full period",
  "results.rmChampionLine":
    "Recommended proposal {model} · Sharpe {sharpe} · CAGR {cagr}",
  "results.refineHint":
    "Click to apply an adjustment · double-click to apply and rerun.",
  "results.editConfig": "Edit setup",
  "results.exportCsv": "Export CSV",
  "results.belowBenchmarkTitle":
    "Honest read: this run underperformed the benchmark",
  "results.belowBenchmarkBody":
    "None of the proposals beat {benchmark} on the selected goal over this window. You can keep refining from this run — adjust the signals, constraints, candidate list, or goal and re-run without starting over.",
  "results.iterateFromHere": "Adjust & re-run",
  "results.continueRefinementTitle": "Below benchmark — continue refining?",
  "results.continueRefinementBody":
    "None of the proposals beat {benchmark} on the goal over this window. You can add more Pro rounds and carry over the leading model, learning history, and AI context from this run.",
  "results.continueRefinementCta": "Continue optimization",
  "results.continueRefinementRunning": "Continuing…",
  "results.continueRefinementHint":
    "Carries top-pick pool and prior rounds from run {job}…",
  "results.extraRoundsLabel": "Additional rounds",
  "results.extraTrialsPerRoundLabel": "Challenger proposals per round",
  "results.extraTrialsLabel": "Extended evaluation proposals",
  "results.continueFromRound": "Will resume at round {round}",
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
  "common.objective": "Goal",
  "common.inSample": "Training period",
  "common.outOfSample": "Validation period",
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
  "proPanel.title": "Pro optimization",
  "proPanel.desc.beforeDynamic":
    "Jasper runs rounds of challenger proposals against the current top pick. The AI proposes new settings based on what worked before, and keeps refining until results stop improving.",
  "proPanel.dynamic": "Dynamic",
  "proPanel.desc.afterDynamic":
    "goal tunes a separate proposal for each market mood (risk-off, neutral, risk-on) and applies the right one as conditions change.",
  "proPanel.estimationPrefix":
    "Pro mode manages the search effort for you. It will run up to about",
  "proPanel.estimationUnit": "projections",
  "proPanel.estimationSuffix":
    ", and may finish early once results stop improving.",
  "proPanel.highTrialsWarning":
    "Higher settings run many more projections and take longer. Each round uses one AI suggestion to guide the search.",
  "proPanel.round1Batch": "First-round proposals",
  "proPanel.round1BatchHint":
    "How many proposals to try in the first round (3–100).",
  "proPanel.challengersPerRound": "Challenger proposals per round",
  "proPanel.challengersPerRoundHint":
    "New proposals tested against the top pick each round (2–100).",
  "proPanel.maxRounds": "Max rounds",
  "proPanel.maxRoundsHint":
    "The most rounds to run, including the first (2–30).",
  "proPanel.patienceRounds": "Early-stop patience (rounds)",
  "proPanel.holdoutTip":
    "Tip: turn on a holdout so proposals are ranked on the training period, then checked on unseen data.",

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
  // Live progress messages (localized on the client from backend templates)
  "progress.msg.queued": "Strategy test queued…",
  "progress.msg.queuedStatic": "Baseline replay queued…",
  "progress.msg.queuedPro": "Smart multi-round optimization queued…",
  "progress.msg.fetching": "Fetching market data, starting optimization…",
  "progress.msg.fetchingStatic": "Static replay: fetching market data…",
  "progress.msg.staticSimulating":
    "Static replay: simulating fixed-weight portfolio…",
  "progress.msg.fetchingPro": "Pro: fetching data, starting iterative search…",
  "progress.msg.complete": "Strategy test complete",
  "progress.msg.completePro": "Pro optimization complete",
  "progress.msg.loaded":
    "Loaded {tickers} tickers, {rows} trading days. Each rebalance shortlists the strongest holdings, then sizes positions.",
  "progress.msg.loadedRegimeSuffix":
    " Regime-adaptive: allocator preset is set per rebalance.",
  "progress.msg.proHoldout":
    "Pro: proposals are ranked on the training period; the holdout is used for final checks…",
  "progress.msg.proLoop":
    "Pro: running challenger rounds (AI learns from history)…",
  "progress.msg.startingAi": "AI planning {trials} starting proposals…",
  "progress.msg.aiDone":
    "AI prepared {used} starting proposals — starting projections…",
  "progress.msg.aiDoneCapped":
    "AI prepared {used} starting proposals — starting projections…",
  "progress.msg.aiOff":
    "Smart optimization unavailable — switched to automatic search…",
  "progress.msg.optuna": "Proposal {trial}/{total} ({scope})",
  "progress.msg.optunaBest":
    "Proposal {trial}/{total} ({scope}), best {label} {value}",
  "progress.msg.searchDone":
    "Search done ({feasible} feasible) — packaging top {top} for the report…",
  "progress.msg.packaging": "Preparing report: {inner}",
  "progress.msg.roundReport": "Round {round} report: {inner}",
  "progress.msg.proRound":
    "Round {round}/{max}: {carry}, preparing {n} challenger proposals…",
  "progress.msg.roundOptuna":
    "Round {round} · proposal {trial}/{total} ({scope})",
  "progress.msg.roundOptunaBest":
    "Round {round} · proposal {trial}/{total} ({scope}), round best {label} {value}",
  "progress.msg.roundAiLearning":
    "Round {round}: AI learning from {n} weaker challenger proposals, target score {score}…",
  "progress.msg.roundDone":
    "Round {round} done: round best {best}, leader {champ} (no-gain streak {streak}/{patience})",
  "progress.msg.roundDoneAlphaSuffix":
    " · training-period alpha vs {benchmark} {alpha} (below benchmark)",
  "progress.msg.pkgFromCache": "Preparing {code} ({rank}/{total})…",
  "progress.msg.pkgMetricsOnly": "Preparing {code} ({rank}/{total})…",
  "progress.msg.pkgNoCache":
    "Preparing {code} ({rank}/{total})…",
  "progress.msg.pkgIsOos":
    "Preparing {code} ({rank}/{total})…",
  "progress.msg.pkgIncomplete":
    "Preparing {code} ({rank}/{total})…",
  "progress.msg.pkgTop": "top {top} of {feasible} pool proposals…",
  "progress.msg.scope.inSample": "training period",
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
    "Describe your macro, sector, or risk outlook, and Jasper turns it into a proposal you can project.",
  "customScenario.placeholder":
    "e.g. Sticky US inflation, Fed higher for longer, growth multiples under pressure — tilt toward short-duration bonds and defensives...",
  "customScenario.analyzing": "Building…",
  "customScenario.analyzeButton": "Build scenario",
  "customScenario.analysisFailed": "Couldn’t build that scenario",
  "customScenario.analysisFailedRetry":
    "We couldn’t build that scenario. Please try again.",
  "assetFilter.assetClasses": "ASSET CLASSES",
  "assetFilter.selectedBase": "{base} of {total} ETFs selected",
  "assetFilter.selectedCombined": "{combined} of {total} ETFs selected",
  "assetFilter.layer1Intro":
    "Pick the asset classes to invest across ({base} ETFs).",
  "assetFilter.aiFilter": "AI INVESTMENT SEARCH",
  "assetFilter.clearAiFilter": "CLEAR",
  "assetFilter.layer1Hint":
    "Your portfolio is built from the asset classes you pick and adjusted at each rebalance.",
  "assetFilter.lockedAdded":
    "Locked model universe: kept holdings and added {adds} (explicit symbols only).",
  "assetFilter.lockedUnchanged":
    "Locked model universe unchanged — name ticker symbols (e.g. GLD) to add, or use overlay supplements.",
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
  "assetFilter.guaranteedHint":
    "these tickers are always part of your projection.",
  "linkedChart.tooltipRegime": "Regime",
  "linkedChart.tooltipActiveObjective": "Active goal",
  "linkedChart.noHistory":
    "No performance or holdings history for this proposal.",
  "linkedChart.linkedCursorHint":
    "Hover any chart — performance, market regime, and holdings all line up on the same dates.",
  "linkedChart.cumulativeTitle":
    "Cumulative return % — Portfolio vs {benchmark}",
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
  "objectiveLab.oosSharpeDelta":
    "Out-of-sample Sharpe gain (switching vs. fixed):",
  "objectiveLab.regimeDetector": "Regime detector",
  "objectiveLab.detectorV2":
    "weighs risk-on vs. risk-off signals to read the market",
  "objectiveLab.detectorLegacy": "classic return and volatility thresholds",
  "objectiveLab.fastRiskOffExit":
    "Exit risk-off quickly on a rebound (21 days)",
  "objectiveLab.fixedObjective": "Fixed goal",
  "objectiveLab.switchPolicy": "Switching proposal",
  "objectiveLab.benchmarkVsRegime": "Benchmark vs. market regime",
  "objectiveLab.regimeScores": "Regime scores vs. active regime",
  "objectiveLab.hoverSyncHint":
    "Hover either chart — both line up on the same dates.",
  "objectiveLab.regimeTimeline": "Regime timeline",
  "objectiveLab.off": "Off",
  "objectiveLab.on": "On",
  "objectiveLab.predictionQualityTitle":
    "Regime prediction quality (episode-based)",
  "objectiveLab.predictionQualityDesc":
    "Scores how well each predicted market regime matches what the benchmark actually did during that regime. For reference only — does not affect proposal ranking.",
  "objectiveLab.episodeAlignment": "Episode alignment {score}/100",
  "objectiveLab.grade": "grade {grade}",
  "objectiveLab.episodes": "Episodes",
  "objectiveLab.medianDays": "Median days",
  "objectiveLab.avgReturn": "Avg return",
  "objectiveLab.hitRate": "Hit rate",
  "objectiveLab.longestEpisodes": "Longest episodes",
  "objectiveLab.largestMisses": "Largest misses",
  "objectiveLab.missesLegend":
    "Largest misses: regime episodes where the benchmark moved most against the prediction.",
  "objectiveLab.secondaryForward": "Secondary: {days}d forward (per step)",
  "objectiveLab.stepLevelAlignment":
    "Step-level alignment {score}/100 — same return-based rules on {days}d forward windows; the headline score above uses full episodes.",
  "objectiveLab.regimeSwitches": "Regime switches: {count}",
  "objectiveLab.isSharpe": "Training-period Sharpe",
  "objectiveLab.oosSharpe": "Out-of-sample Sharpe",
  "objectiveLab.isReturn": "Training-period return",
  "objectiveLab.isMaxDd": "Training-period max drawdown",
  "objectiveLab.hit": "hit",
  "objectiveLab.miss": "miss",
  "benchmarkChart.noSeries": "No benchmark data to chart.",
  "benchmarkChart.noValidDates": "No valid dates to chart.",
  "benchmarkChart.cumPct": "{ticker} cumulative %",
  "benchmarkChart.footer":
    "Top: {ticker} cumulative return (%). Shaded bands show the market regime; the amber strip marks regime switches. Hover to sync with the regime scores below.",

  "regimeScore.noScores":
    "No regime scores yet. Try the newer detector or a longer training period.",
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
  "institutional.noAnalytics":
    "No detailed analytics available — please rerun the projection.",
  "institutional.monthlyInSample": "Monthly returns (Training period{range})",
  "institutional.monthlyFull": "Monthly returns",
  "institutional.annualInSample": "Annual returns (Training period{range})",
  "institutional.annualFull": "Yearly returns",
  "institutional.annualRmHint":
    "Calendar-year portfolio returns used for planning bands. Extreme years are damped (capped at the sample average) in the goal path.",
  "institutional.monthlyOosFrom":
    "Monthly returns (Validation period from {date})",
  "institutional.monthlyOos": "Monthly returns (Validation period)",
  "institutional.annualOosFrom":
    "Annual returns (Validation period from {date})",
  "institutional.annualOos": "Annual returns (Validation period)",
  "institutional.horizonTitle":
    "Performance by horizon (Training period / Validation period / Full)",
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
  "institutional.coreHoldingsNote":
    "The names this proposal leaned on most — how large a share they usually took and how consistently they were held across rebalances.",
  "institutional.avgWeight": "Avg. weight",
  "institutional.avgWeightHint":
    "Average share of the portfolio across all rebalance dates. Higher means it was a bigger, more central position.",
  "institutional.holdFrequency": "Held",
  "institutional.holdFrequencyHint":
    "How often this name was held (share of rebalance dates with a position above 0.5%). 100% means it was held the whole time.",
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
  "results.liveData":
    "Live market data · {start} → {end} · {rows} trading days",
  "results.requested": "requested",
  "results.lateListingsDropped": "newer listings excluded",
  "results.viewing": "Viewing",
  "results.round": "round",
  "results.newRoundBest": "new round best",
  "results.proRefinement": "Pro optimization",
  "results.meta.rounds":
    "{rounds} refinement rounds across {trials} candidate proposals",
  "results.meta.convergedEarly": "converged early (no further gains)",
  "results.meta.fullSearch": "ran the full search",
  "results.meta.search": "Parameter search across {trials} candidate proposals",
  "results.meta.reported":
    "{feasible} valid proposals found, {reported} included in this report",
  "results.meta.catalog": "(of {catalog} explored in total)",
  "results.meta.rebalance":
    "{freq} rebalancing — applied {applied} of {count} scheduled dates",
  "results.meta.rebalanceSkipped":
    "({skipped} skipped — need more price history before first rebalance)",
  "results.meta.rebalanceChartDownsampled":
    "holdings chart shows {shown} of {total} rebalance snapshots",
  "results.freq.weekly": "Weekly",
  "results.freq.monthly": "Monthly",
  "results.freq.quarterly": "Quarterly",
  "results.freq.yearly": "Yearly",
  "results.freq.daily": "Daily",
  "results.sort": "sort",
  "results.rankedOnInSample": "Ranked on Training period",
  "results.gapInOut": "Gap (Training period − validation period)",
  "results.winRate": "Win rate",
  "results.avgTurnover": "Avg turnover",
  "results.totalTurnover": "Total turnover",
  "results.maxDdDays": "Max drawdown (days)",
  "results.var95": "VaR 95% (d)",
  "results.cvar95": "CVaR 95% (d)",
  "results.te": "TE",
  "results.ir": "IR",
  "results.horizonCompareTitle": "Training period / Validation period / Full",
  "results.horizonMetricsHint":
    "Key metrics across each period. Proposals are chosen on the training period only.",
  "results.metric": "Metric",
  "results.gapObjectiveSharpe": "Training period − validation period gap: goal",
  "results.positiveInSampleStronger":
    "positive means Training period is stronger",
  "results.championLeaderboard":
    "Leaderboard · proposals ranked on the training period",
  "results.leaderboardTitleOutOfSample":
    "Leaderboard · proposals ranked on the Validation period",
  "results.leaderboardTitleFull":
    "Leaderboard · proposals ranked on the full sample period",
  "results.leaderboardTitleGap":
    "Leaderboard · proposals ranked by Training period minus Validation period gap",
  "results.sortTableBy": "Sort table by",
  "results.inSampleSelection": "Training period (selection)",
  "results.gapSelection": "Gap (IS − validation)",
  "results.engine": "engine",
  "results.warmStartExact":
    "Warm-started from prior top pick {code} (run {job})",
  "results.warmStartFuzzy":
    "Warm-started from prior top pick {code} (run {job}; period end differs)",
  "results.warmStartImproved": "New top pick beat the cached baseline",
  "results.warmStartKept": "Cached top pick still competitive",
  "results.holdings": "holdings",
  "results.cap": "cap",
  "results.weightChartMayListMore":
    "the holdings chart may show more tickers across rebalances",
  "results.maxWeight": "max weight",
  "results.runCap": "run cap",
  "results.effective": "effective",
  "results.observed": "observed",
  "results.selectionHint":
    "chosen on Training period; Validation period acts as a live test",
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
  "results.champion": "recommended",
  "results.needsFloorLegend": "⚠ breaches the client's drawdown floor",
  "results.proposalSetTitle": "Proposal comparison",
  "results.proposalLabel.recommended": "Recommended",
  "results.proposalLabel.defensive": "Defensive",
  "results.proposalLabel.growth": "Growth",
  "results.proposalLabel.alternative": "Alternative",
  "results.proposalLabel.anchor_close": "Anchor-close",
  "results.proposalLabel.full_drift": "Full customization space",
  "results.proposalLabel.theme": "Theme expression",
  "results.needsTable.drawdown": "Drawdown floor",
  "results.needsTable.singleName": "Single-name cap",
  "results.needsTable.theme": "Theme cap",
  "results.needsTable.cash": "Cash reserve",
  "results.needsTable.income": "Income need",
  "results.needsTable.mustInclude": "Must-include tickers",
  "results.needsTable.drift": "Customization drift",
  "results.needsMustIncludeFail":
    "Adjustment-plan tickers missing from final portfolio: {tickers}",
  "results.needsDriftFail":
    "Portfolio drifted {actual} from the anchor (limit {cap})",
  "results.needsTable.pass": "Pass",
  "results.needsTable.fail": "Fail",
  "results.addToUniverseCta": "Add holdings to candidate list & re-run",
  "results.cashSleeveLabel": "Cash",
  "results.cagrPct": "CAGR %",
  "results.maxDdPct": "MaxDD %",
  "results.dynamicObjectives": "Dynamic goals",
  "results.dynamicObjectivesHint":
    "The market regime and the active goal are shaded in the performance and holdings charts below.",
  "results.loadingTrajectory": "Loading {model}…",
  "results.walkForwardHint":
    "Market regime and active goal over time, lined up with the performance and holdings charts.",
  "results.proChampionScorePrefix":
    "The Pro winner is chosen on the Training period",
  "results.comprehensiveScore": "composite score",
  "results.proChampionScoreFormula":
    "0.45×Sharpe + 0.25×Sortino + 0.20×(5×CAGR) − 0.35×|max drawdown| − 0.10×turnover.",
  "results.dynamicScoreTitle":
    "Dynamic composite score — this is the ranking metric",
  "results.dynamicScoreExplain":
    "In dynamic mode, proposals aren't ranked by Sharpe or return alone. They are ranked by one composite score that blends risk-adjusted return, growth, drawdown and trading cost. That's why the top pick (★) can win overall without topping any single column below.",
  "results.championWhyTitle": "Why ★ {code} is the top pick",
  "results.championWhyHorizonNote":
    "★ is chosen on the training period (or the full period when validation is off); full-period metrics are for reference only.",
  "results.championWhyFallbackLead":
    "{code} won under goal “{objective}” on the {horizon} selection horizon (IS Sharpe {sharpe}, CAGR {cagr}, max DD {mdd}). Full-period: Sharpe {fullSharpe}, CAGR {fullCagr}.",
  "results.championWhyFallbackLeadFull":
    "{code} won under goal “{objective}” on the full-period horizon (Sharpe {sharpe}, CAGR {cagr}, max DD {mdd}).",
  "results.championWhyFallbackAlt":
    "Runner-up {alt} scored lower on that same selection horizon (IS Sharpe {altSharpe}, CAGR {altCagr}) even if its full-period Sharpe ({altFullSharpe}) looks higher.",
  "results.championWhyFallbackAltFull":
    "Compared with runner-up {alt} (Sharpe {altSharpe}, CAGR {altCagr}).",
  "results.championWhyPerfTitle": "Why this proposal won on performance",
  "results.championWhyParamsTitle": "Why these parameters were set",
  "results.championWhyParamsFallback":
    "No separate AI write-up for parameter choices on this run. Below are the top pick’s key engine settings — expand for the full list and how they differ from other proposals.",
  "results.championWhyParamsConstrainedLead":
    "This customization compared a few named optimizer scenarios on the client’s fixed universe ({styles}) instead of a large random search.",
  "results.championWhyParamsConstrained.anchor_close":
    "The recommendation uses “{styleLabel}” settings: small moves within the allowed customization space, staying close to the baseline book while still pursuing the objective.",
  "results.championWhyParamsConstrained.full_drift":
    "The recommendation uses “{styleLabel}” settings: push the objective using the full customization budget, allowing larger differences from the baseline.",
  "results.championWhyParamsConstrained.defensive":
    "The recommendation uses “{styleLabel}” settings: emphasize lower volatility and drawdown within the customization space.",
  "results.championWhyParamsConstrained.theme":
    "The recommendation uses “{styleLabel}” settings: express must-include / theme names within the customization space.",
  "results.championWhyParamsConstrainedDriftBoth":
    "customization used about {drift} (cap {cap})",
  "results.championWhyParamsConstrainedDriftOnly":
    "customization used about {drift}",
  "results.championWhyParamsConstrainedCapOnly": "customization cap {cap}",
  "results.championWhyParamsConstrainedAllocator":
    "allocation engine: {allocator}",
  "results.championWhyParamsConstrainedMetricsJoin": "; ",
  "results.championWhyParamsConstrainedMetrics": "({metrics}).",
  "results.championHorizonInSample": "training-period",
  "results.championHorizonFullSample": "full-period",
  "results.anchorBenchmarkNote":
    "Baseline model portfolio: {anchor}. Performance benchmark ticker (price series): {ticker} — the chart compares proposals to this ticker’s returns, not a replica of every anchor holding.",
  "results.anchorPortfolioBaselineNote":
    "Baseline for comparison: static replay of the baseline model portfolio ({anchor}), not the market ticker alone.",
  "results.championFullSharpe": "Full Sharpe",
  "results.championFullMaxDd": "Full max DD",
  "results.championFullCagr": "Full CAGR",
  "results.leaderboardDynamicNote":
    "Values are the dynamic composite score for each period (higher is better). The top pick (★) is ranked by the objective on the selection horizon (training-period when validation is on). validation / overfitting metrics are informational and do not demote the objective winner.",
  "results.selectTrialHint":
    "Select a proposal above to see its performance and holdings.",
  "results.efficientFrontierHint":
    "Blue dots are proposals Jasper tried; orange dots are the top picks shown in your report.",
  "results.annVol": "Annualized volatility (%)",
  "results.annReturn": "Ann. return (%)",
  "results.outputModel": "Top pick",
  "results.searchTrial": "Tested proposal",
  "results.paramSamples": "Strategies tried",
  "results.outputModels": "Top picks",
  "results.universeFilter": "Candidate list filter",
  "results.universeFilterHint":
    "other asset classes are left out of the search.",
  "results.targetNamesRegime": "Target names ({regime} regime)",
  "results.targetNamesAi": "Target names (from AI)",
  "results.targetCount": "Target count",
  "results.targetWeightPct": "Target weight %",
  "results.actualClassWeights": "Actual asset-class mix (holdings)",
  "results.actualClassWeightsRegime": "Actual mix during {regime} rebalances",
  "results.classBreakdownChampion":
    "Showing the top pick’s asset-class mix — this proposal stored a condensed version.",
  "results.weightPct": "Weight %",
  "results.factorAttributionChampion":
    "Showing the top pick’s factor breakdown — this proposal didn’t store full details.",
  "results.noFactorAttribution": "No factor breakdown available",
  "results.contribPct": "Contrib %",
  "results.observations": "Observations",
  "results.rebalanceCrossSections": "rebalance snapshots",
  "results.factorMetricLogic": "How factors were measured",
  "results.noMetricLogic": "No factor detail available",
  "results.summaryOnlyModel":
    "This proposal has a summary only — no detailed holdings or charts. Pick one with a full report to explore further.",
  "results.analyticsFallback":
    "Rolling, exposure, and return tables come from the top pick; the headline metrics match the proposal you selected.",
  "results.aiParameterRationale": "Why the AI chose these settings",
  "results.generation": "Generation",
  "results.noAiRationale": "No AI explanation for this run.",
  "results.fullRunConfig": "Full setup (JSON)",
  "results.audit.tabEngine": "Engine detail",
  "results.audit.tabAudit": "Audit / Raw data",
  "results.audit.intro":
    "Audit trail for this run — key fields from the request and result.",
  "results.audit.runSummary": "Run summary",
  "results.audit.runSummaryHint": "Run ID, window, objective, and recommended proposal",
  "results.audit.jobId": "Job ID",
  "results.audit.period": "Period",
  "results.audit.objective": "Objective",
  "results.audit.engine": "Engine",
  "results.audit.optimizationMode": "Optimization mode",
  "results.audit.dataSource": "Data source",
  "results.audit.champion": "Recommended proposal",
  "results.audit.scenario": "Scenario",
  "results.audit.backtestMode": "Projection mode",
  "results.audit.request": "Request & constraints",
  "results.audit.requestHint": "Key fields from the submitted projection request",
  "results.audit.field": "Field",
  "results.audit.value": "Value",
  "results.audit.fullRequestJson": "Full request JSON",
  "results.audit.universe": "Universe & tickers",
  "results.audit.universeHint":
    "Holdings, whitelist, supplements, and benchmark — filter and page large lists",
  "results.audit.benchmark": "Benchmark",
  "results.audit.tradableCount": "Tradable count",
  "results.audit.universeSize": "Universe size",
  "results.audit.assetClasses": "Asset classes",
  "results.audit.supplements": "Supplement tickers",
  "results.audit.filterText": "Universe filter",
  "results.audit.tickerFilter": "Ticker filter",
  "results.audit.ticker": "Ticker",
  "results.audit.role": "Role",
  "results.audit.roleHolding": "Holding",
  "results.audit.roleUniverse": "Universe",
  "results.audit.tickers": "Tickers",
  "results.audit.modelParams": "Model parameters",
  "results.audit.modelParamsHint": "Recommended proposal's parameters; Pro rounds / scenarios when present",
  "results.audit.noParams": "No parameters stored for the recommended proposal on this result.",
  "results.audit.proRounds": "Pro refinement rounds",
  "results.audit.round": "Round",
  "results.audit.improved": "Improved",
  "results.audit.trials": "Trials",
  "results.audit.winner": "Winner",
  "results.audit.score": "Score",
  "results.audit.scenarios": "Constrained scenarios",
  "results.audit.yes": "Yes",
  "results.audit.no": "No",
  "results.audit.provenance": "Market data provenance",
  "results.audit.provenanceHint":
    "Requested vs effective panel window, warmup, and exclusions",
  "results.audit.rowsCols": "Rows × columns",
  "results.audit.requestedStart": "Requested start",
  "results.audit.effectiveStart": "Effective start",
  "results.audit.panelEnd": "Panel end",
  "results.audit.warmupStart": "Warmup download start",
  "results.audit.warmupCovers": "Warmup covers report start",
  "results.audit.excludedCount": "Excluded late listings",
  "results.audit.excludedListings": "Excluded tickers",
  "results.audit.noPricePanelNote":
    "Full price history is not stored with this result; the summary above shows the data sources used.",
  "results.audit.weights": "Weights & rebalance",
  "results.audit.weightsHint": "Final weights of the recommended proposal and weight-history summary",
  "results.audit.weightPct": "Weight",
  "results.audit.rebalanceCount": "Rebalance count",
  "results.audit.rebalanceSpan": "Rebalance span",
  "results.audit.date": "Date",
  "results.audit.holdingsCount": "Holdings",
  "results.audit.topHoldings": "Top holdings",
  "results.audit.rebalances": "Rebalances",
  "results.audit.noWeightHistory":
    "This result does not include weight history.",
  "results.audit.performance": "Performance evidence",
  "results.audit.performanceHint": "Core metrics and equity series (filter + paginate)",
  "results.audit.metric": "Metric",
  "results.audit.dateFrom": "From",
  "results.audit.dateTo": "To",
  "results.audit.equityValue": "Equity",
  "results.audit.equitySeries": "Equity series",
  "results.audit.clientContext": "Client / adjustment context",
  "results.audit.clientContextHint":
    "Signed adjustment audit and client context sent with the request",
  "results.audit.clientRef": "Client ref",
  "results.audit.anchorPortfolio": "Anchor portfolio",
  "results.audit.anchorJob": "Anchor job",
  "results.audit.clientContextJson": "Client context (JSON)",
  "results.audit.overlayAuditJson": "Adjustment audit JSON",
  "results.audit.engineCapabilities": "Engine capabilities used",
  "results.audit.engineCapabilitiesHint":
    "Non-default stage pins, contrib capabilities, or capability gaps for this run — for RM review only.",
  "results.audit.engineLegacyNote":
    "This report was produced by the pre-refactor engine (v0-legacy).",
  "results.audit.stageCatalogVersion": "Stage catalog version",
  "results.audit.paramCatalogVersion": "Param catalog version",
  "results.audit.stageImplementations": "Stage implementations",
  "results.audit.capabilitiesUsed": "Capabilities used",
  "results.audit.capabilityPendingSignoff": "pending supervisor sign-off",
  "results.audit.capabilityGaps": "Capability gaps (this overlay)",
  "results.audit.fullNarrativeFacts": "Full summary data (JSON)",
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
  "report.group.summaryHint": "AI verdict, top pick, and headline metrics",
  "report.group.performance": "Performance",
  "report.group.performanceHint":
    "How the models stack up against the benchmark",
  "report.group.journey": "Portfolio journey",
  "report.group.journeyHint":
    "Equity growth and how holdings shifted over time",
  "report.group.holdings": "Holdings & risk",
  "report.group.holdingsHint":
    "What the portfolio owns and its asset-class mix",
  "report.group.strategy": "Strategy deep-dive",
  "report.group.strategyHint": "Risk/return trade-offs and factor drivers",
  "report.group.institutional": "Institutional analytics",
  "report.group.institutionalHint":
    "Benchmark, exposure, rolling risk, and drawdowns",
  "report.group.reproducibility": "Reproducibility",
  "report.group.reproducibilityHint":
    "Exact settings and parameters behind this run",
  "results.factor.momentum": "Momentum",
  "results.factor.reversal": "Reversal",
  "results.factor.value": "Value",
  "results.factor.lowvol": "Low vol",
  "results.factor.trend": "Trend",
  "results.factor.drawdown": "Drawdown",
  // Constraints — offline + hints
  "config.runOfflineHint":
    "The analytics service is offline right now, so projections can’t run. Please try again in a moment.",
  "config.assetClassSyncHint":
    "Your selected asset classes and their target weights stay in sync — anything you leave out is held at zero.",
  "config.enforceClassWeights": "Enforce class allocation targets",
  "config.enforceClassWeightsHint":
    "When on, bond/equity targets (and per-regime quotas) set final sleeve weights — not just which names enter Top-N screening.",
  "config.limitsHint":
    "The sliders above set the upper limits Jasper works within. It tries a range of values up to each limit to find the best fit for your goal.",
  "config.quantMode": "Expert mode",
  "config.quantModeHint": "Show advanced portfolio-engineering controls",
  "config.objectiveHint.dynamic":
    "Dynamic shifts the portfolio by market regime — defensive when risk is high, growth-seeking when conditions are strong. Proposals are ranked on one blended score. To rank on a single goal instead, pick that goal and turn on Regime-adaptive allocation below.",
  "config.objectiveHint.default":
    "With a holdout turned on, proposals are ranked on the training period; the holdout and full-period results are shown for comparison only.",
  "config.regimeAdaptive": "Regime-adaptive allocation",
  "config.regimeAdaptiveHint.dynamic":
    "Always on with the Dynamic goal: the allocator switches preset by market regime (defensive / balanced / growth) every rebalance.",
  "config.regimeAdaptiveHint.on":
    "On: the allocator switches preset by market regime (risk-off / neutral / risk-on) each rebalance, while your chosen goal above still decides how proposals are ranked.",
  "config.regimeAdaptiveHint.off":
    "Off: one allocation style is used across all market conditions. Turn on to let the allocator adapt by regime while keeping your ranking goal above.",
  "config.customObjectivePlaceholder":
    "e.g. low drawdown first, then return, keep turnover modest",
  "config.customObjectiveHint":
    "Jasper turns this into a goal it can optimize for.",
  "config.trialsHint.pro":
    "Pro mode manages this for you using the round settings above.",
  "config.trialsHint.standard":
    "How many proposals to test. Each one starts from AI-suggested parameters. Set the report size below.",
  "config.benchmarkLine": "Benchmark: {benchmark} · Risk-free rate: 4%",
  // Constraints — advanced controls
  "config.advanced.title": "Expert controls (optional)",
  "config.advanced.maxWeightNote":
    "The single-name limit search cannot exceed {pct}% (run slider).",
  "config.advanced.categorical": "Choice",
  "config.advanced.factorIndicators": "Signal style",
  "config.advanced.search": "Search",
  "config.advanced.fixed": "Fixed",
  "config.advanced.off": "Off",
  "config.advanced.searchHint":
    "AI explores all options; your choice is the starting preference",
  "config.advanced.fixedHint": "Fixed signal style for this factor",
  // Optimization objectives (dropdown)
  "objective.dynamic": "Dynamic — adapt to market conditions",
  "objective.max_sharpe": "Best risk-adjusted return",
  "objective.max_return": "Highest total return",
  "objective.min_max_drawdown": "Smallest peak-to-trough decline",
  "objective.max_sortino": "Best return vs downside risk",
  "objective.min_cvar": "Limit tail risk",
  "objective.risk_parity_erc": "Balance risk contributions",
  "objective.max_diversification": "Most diversified portfolio",
  "objective.mean_variance_utility": "Balance return and risk",
  "objective.custom": "Custom goal",
  // Allocator modes (dropdown)
  "allocator.auto": "Auto (let Jasper choose)",
  "allocator.mean_variance": "Return-risk balance",
  "allocator.min_var": "Lowest volatility",
  "allocator.risk_parity": "Equal risk contribution",
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
    "Drawdown depth, time since peak, or pain index",

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
  "factorOpt.ulcer_index": "pain index",
  // Constraints — categorical labels
  "config.categorical.objective_mode": "Investment goal",
  "config.categorical.allocator_mode": "Portfolio engine",
  "config.categorical.rebalance_freq": "Rebalance frequency",
  // Constraints — advanced numeric control labels
  "config.control.subPrefix": "{label} sleeve",
  "config.control.lookback_days": "Market memory (days)",
  "config.control.shrinkage": "Noise filter",
  "config.control.risk_aversion": "Risk budget",
  "config.control.max_weight_actual": "Single-name limit (trial)",
  "config.control.top_n_actual": "Shortlist size",
  "config.control.max_holdings_actual": "Portfolio breadth",
  "config.control.factor_lookback_days": "Signal window (days)",
  "config.control.reversal_lookback_days": "Mean-reversion window (days)",
  "config.control.value_lookback_days": "Value signal window (days)",
  "config.control.no_trade_tol": "Rebalance threshold",
  "config.control.turnover_penalty_mult": "Trading cost pressure",
  "config.control.max_turnover_actual": "Max turnover / rebalance",
  "config.control.customization_drift_actual": "Customization drift",
  "config.control.w_mom": "Momentum signal",
  "config.control.w_reversal": "Reversal signal",
  "config.control.w_value": "Value signal",
  "config.control.w_lowvol": "Low-volatility signal",
  "config.control.w_trend": "Trend signal",
  "config.control.w_drawdown": "Drawdown quality signal",
  "config.control.w_equity": "Equity sleeve",
  "config.control.w_bond": "Bond sleeve",
  "config.control.w_commodity": "Commodity sleeve",
  "config.control.w_real_estate": "Real estate sleeve",
  "config.control.w_alternative": "Alternative sleeve",
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
    "Portfolio return trails the benchmark ({benchmark}) in this sample. Consider wider exploration or proposal tweaks next round.",
  "pro.banner.stats":
    "Portfolio return {portfolio} · Benchmark {benchmark} · Alpha {alpha}",
  "pro.seed.regimeMatrix":
    "Market-regime presets (portfolio engine per market condition)",
  "pro.seed.regimeQuotas":
    "Market-regime sleeve targets (asset-class mix per condition)",
  "pro.seed.assessment": "AI performance assessment",
  "pro.seed.strategy": "AI optimization proposal",
  "pro.seed.roundSetup": "Round setup (applies to every proposal this round)",
  "pro.seed.factorSearch": "Factor search (ranges Jasper explored)",
  "pro.seed.fixed": "fixed",
  "pro.prefix.improved": "Round winner — replaced the incoming top pick",
  "pro.prefix.held": "Incoming top pick held (improvement below threshold)",
  "pro.prefix.body":
    "{label} — {status}. Adjusted score {score}, from {trials} candidates across {models} proposals.",

  // Pro rounds — parameter labels
  "pro.param.mode": "Portfolio engine",
  "pro.param.lookback_days": "Market memory",
  "pro.param.shrinkage": "Noise filter",
  "pro.param.risk_aversion": "Risk budget",
  "pro.param.max_weight_actual": "Single-name limit",
  "pro.param.top_n_actual": "Shortlist size",
  "pro.param.max_holdings_actual": "Holdings count",
  "pro.param.max_turnover_actual": "Max turnover",
  "pro.param.customization_drift_actual": "Customization space",
  "pro.param.no_trade_tol": "Rebalance threshold",
  "pro.param.turnover_penalty_mult": "Trading cost pressure",
  "pro.param.rebalance_freq": "Rebalance frequency",
  "pro.param.objective_mode": "Investment goal",
  "pro.param.factor_lookback_days": "Signal window",
  "pro.param.reversal_lookback_days": "Mean-reversion window",
  "pro.param.value_lookback_days": "Value signal window",
  "pro.param.w_mom": "Momentum signal",
  "pro.param.w_reversal": "Reversal signal",
  "pro.param.w_value": "Value signal",
  "pro.param.w_lowvol": "Low-volatility signal",
  "pro.param.w_trend": "Trend signal",
  "pro.param.w_drawdown": "Drawdown quality signal",
  "pro.param.w_equity": "Equity sleeve",
  "pro.param.w_bond": "Bond sleeve",
  "pro.param.w_commodity": "Commodity sleeve",
  "pro.param.w_real_estate": "Real estate sleeve",
  "pro.param.w_alternative": "Alternative sleeve",
  "pro.param.mom_indicator": "Momentum signal",
  "pro.param.reversal_indicator": "Reversal signal",
  "pro.param.value_indicator": "Value signal",
  "pro.param.lowvol_indicator": "Low-volatility signal",
  "pro.param.trend_indicator": "Trend signal",
  "pro.param.drawdown_indicator": "Drawdown quality signal",
  // AI params disclosure (summary / expand / timeline)
  "params.summary.objective": "Objective",
  "params.summary.allocator": "Allocation mode",
  "params.summary.holdings": "Holdings",
  "params.summary.customization": "Customization space",
  "params.summary.mustInclude": "Must-include names",
  "params.summary.scenario": "Scenario",
  "pro.param.scenario_style": "Scenario style",
  "params.expand.title": "This proposal's parameters",
  "params.expand.diffHint":
    "Showing differences vs recommended ({code}). Unchanged rows are hidden.",
  "params.expand.identical":
    "Same engine parameters as recommended ({code}).",
  "params.expand.empty": "No displayable parameters for this proposal.",
  "params.category.objective": "Objective",
  "params.category.risk": "Risk constraints",
  "params.category.universe": "Universe & screening",
  "params.category.allocation": "Allocation & weights",
  "params.category.rebalance": "Cash & rebalance",
  "params.category.other": "Other",
  "params.info.aria": "About {param}",
  "params.info.scenario_style":
    "Which named customization scenario this proposal came from (stay close to anchor, use full drift budget, defensive, or theme).",
  "params.info.objective_mode":
    "What this backtest optimizes for — e.g. max Sharpe, max return, or minimize max drawdown.",
  "params.info.mode":
    "How final weights are solved: return–risk balance, lowest volatility, equal risk contribution, or max diversification.",
  "params.info.allocator_mode":
    "How final weights are solved: return–risk balance, lowest volatility, equal risk contribution, or max diversification.",
  "params.info.lookback_days":
    "How many past trading days are used to estimate returns and risk. Longer = more stable; shorter = more reactive.",
  "params.info.shrinkage":
    "Pulls noisy correlation estimates toward a safer diagonal. 0 = raw data; 1 = fully diagonal.",
  "params.info.risk_aversion":
    "Risk penalty inside mean-variance. Higher = more defensive allocation.",
  "params.info.max_weight_actual":
    "Maximum weight any single name can take in the portfolio.",
  "params.info.max_holdings_actual": "Maximum number of holdings allowed.",
  "params.info.top_n_actual":
    "After factor screening, how many names remain as candidates before weight allocation.",
  "params.info.max_turnover_actual":
    "Upper bound on how much the book can trade at each rebalance.",
  "params.info.customization_drift_actual":
    "How far this book may drift from the anchor portfolio (0 ≈ stay put; 1 = fully rebuild).",
  "params.info.no_trade_tol":
    "Ignore weight changes smaller than this threshold to cut micro-trades.",
  "params.info.turnover_penalty_mult":
    "Extra cost pressure on turnover; higher = prefer less trading.",
  "params.info.rebalance_freq":
    "How often the portfolio is rebalanced (weekly / monthly / quarterly / yearly).",
  "params.info.factor_lookback_days":
    "Lookback window used to compute most factor signals.",
  "params.info.reversal_lookback_days":
    "Lookback window for the short-term mean-reversion signal.",
  "params.info.value_lookback_days":
    "Lookback window for the value / valuation signal.",
  "params.info.w_mom":
    "Weight on momentum: how strongly recent winners are preferred.",
  "params.info.w_reversal":
    "Weight on short-term reversal: how strongly recent losers / oversold names are preferred.",
  "params.info.w_value":
    "Weight on value: how strongly cheaper / higher-yield names are preferred.",
  "params.info.w_lowvol":
    "Weight on low volatility: how strongly calmer names are preferred.",
  "params.info.w_trend":
    "Weight on medium/long-term trend: how strongly uptrending names are preferred.",
  "params.info.w_drawdown":
    "Weight on drawdown quality: how strongly names with milder recent drawdowns are preferred.",
  "params.info.w_income":
    "Weight on income: how strongly higher-yielding names are preferred.",
  "params.info.w_equity": "Target sleeve weight for equities.",
  "params.info.w_bond": "Target sleeve weight for bonds.",
  "params.info.w_commodity": "Target sleeve weight for commodities.",
  "params.info.w_real_estate": "Target sleeve weight for real estate.",
  "params.info.w_alternative": "Target sleeve weight for alternatives.",
  "params.info.mom_indicator":
    "Which momentum formula is used (e.g. skip-month, trailing return).",
  "params.info.reversal_indicator":
    "Which short-term reversal formula is used.",
  "params.info.value_indicator": "Which value / valuation formula is used.",
  "params.info.lowvol_indicator":
    "Which low-volatility formula is used (e.g. negative volatility).",
  "params.info.trend_indicator": "Which trend formula is used.",
  "params.info.drawdown_indicator":
    "Which drawdown-quality formula is used (e.g. time since trough).",
  "params.info.income_indicator": "Which income / yield formula is used.",
  "params.timeline.title": "Search round timeline",
  "params.timeline.hint":
    "How Pro rounds evolved — objective, key param changes, round champion, headline metrics.",
  "params.timeline.improved": "Improved",
  "params.timeline.held": "Held",
  "params.timeline.trials": "{n} trials",
  "params.timeline.objective": "Objective",
  "params.timeline.champion": "Round champion",
  "params.timeline.score": "Score",
  "params.timeline.noParamChange": "No key setup changes vs prior round",
  // Institutional report — extended
  "institutional.loadingFor": "for {model}",
  "institutional.through": "through {date}",
  "institutional.horizonNote":
    "Training and validation rows are slices of the same continuous projection, not separate runs.",
  "institutional.gapNote":
    "Training period − Validation period gap: goal {objective}, Sharpe {sharpe} (positive = Training period stronger).",
  "institutional.vsBenchmark": "vs {benchmark}",
  "institutional.rmCompactHint":
    "Key benchmark and allocation context for client discussions",
  "institutional.benchmarkStaleNote":
    "Beta, alpha, and IR below were computed vs {computed}. Re-run the projection to refresh metrics for the selected baseline benchmark.",
  "institutional.trackingErr": "Tracking err",
  "institutional.ir": "IR",
  "institutional.metricHelpAria": "What does {metric} mean?",
  "institutional.betaHint":
    "How much the portfolio moves with the benchmark. Near 1.0 tracks it closely; above 1.0 amplifies market swings; below 1.0 is usually less sensitive.",
  "institutional.alphaHint":
    "Annualized excess return after adjusting for beta (CAPM-style). Positive means the portfolio earned more than its market exposure alone would explain.",
  "institutional.irHint":
    "Active return versus the benchmark, divided by tracking error (annualized). Higher means more consistent outperformance relative to how much the path diverged.",
  "institutional.upCapture": "Up capture",
  "institutional.downCapture": "Down capture",
  "institutional.riskPct": "Risk %",
  "institutional.rollingSharpe": "Rolling Sharpe (252-day)",
  "institutional.rollingVol": "Rolling volatility (252-day)",
  "institutional.inSampleNote":
    "Selection and ranking use Training period only; periods below exclude the Validation period tail.",
  "institutional.ddStart": "Start",
  "institutional.ddTrough": "Trough",
  "institutional.ddEnd": "End",
  "institutional.ddDepth": "Depth",
  "institutional.ddDays": "Days",
  // Anchor / benchmark personalization
  "anchor.title": "Anchor portfolio",
  "anchor.subtitle":
    "Choose a house model as the starting benchmark — or use current holdings with no model.",
  "anchor.universeNote":
    "Demo candidate list: {count} mainstream ETFs (SPY, IVV, QQQ, VTI, AGG, …)",
  "anchor.placeholderHoldingsHint":
    "Mix of ETFs, mutual funds, and stocks from the house model catalog",
  "anchor.currentHoldingsHint":
    "If you are only optimizing a satellite / stock sleeve (not a model book), choose “Current holdings (no model)”.",
  "anchor.noModelBadge": "No model",
  "anchor.selected": "Selected anchor",
  "anchor.continue": "Continue to client needs",
  "anchor.am": "Asset Manager",
  "anchor.theme": "Theme",
  "composition.title": "Composition",
  "composition.view.assetClass": "Asset class",
  "composition.view.sector": "Sector",
  "composition.view.region": "Region",
  "composition.other": "Other",
  "composition.empty": "No holdings to display.",
  "composition.detailsExpand": "Show all holdings",
  "composition.detailsCollapse": "Hide holdings",
  "composition.holdingsUnit": "holdings",
  // Overlay conversation step
  "overlay.skipToConfig": "Skip AI needs summary — go to advanced setup",
  "overlay.continueToConfig": "Continue to projection setup",
  "overlay.contextSummaryTitle": "Confirmed customization context",
  "overlay.contextSelectHint":
    "Select which groups to customize and the baseline portfolio for this run.",
  "overlay.contextGroups": "Groups to customize",
  "overlay.contextGroupsFallback":
    "Current selection will use the active scope.",
  "overlay.contextAnchor": "Baseline portfolio",
  "overlay.interpret.error.apiKeyMissing":
    "AI interpretation is not available — the AI API key is not configured. Ask an administrator to set it up in Settings.",
  "overlay.interpret.error.aiUnavailable":
    "Couldn't interpret the request. Please try again.",
  "overlay.interpret.error.parseFailed":
    "Couldn't interpret the request. Please try again.",
  "overlay.interpret.error.validationFailed":
    "Couldn't interpret the request. Please try again.",
  "overlay.interpret.error.responseInvalid":
    "Couldn't interpret the request. Please try again.",
  "overlay.interpret.error.generic":
    "Couldn't interpret the request. Please try again or contact support.",
  "overlay.chat.title": "Client needs conversation",
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
  "overlay.thinking.label":
    "Jasper is analyzing the request (typically 10–30 seconds)…",
  "overlay.thinking.step1": "Understanding intent…",
  "overlay.thinking.step2": "Extracting risk profile & goals…",
  "overlay.thinking.step3": "Mapping to the ticker candidate list…",
  "overlay.thinking.step4": "Drafting recommendations…",
  "overlay.proposedTickers.title": "Suggested tickers (select to add)",
  "overlay.proposedTickers.all": "Select all",
  "overlay.proposedTickers.none": "Select none",
  "overlay.proposedTickers.addSelected":
    "Add selected ({count}) to candidate list",
  "overlay.proposedTickers.confirmMessage":
    "Added {tickers} to the candidate list.",
  "overlay.proposedTickers.skipNoAdds": "No new tickers",
  "overlay.proposedTickers.skipNoAddsMessage":
    "Acknowledged: no new tickers will be added for this customization.",
  "overlay.proposedTickers.reviewRequired":
    "Review suggested tickers (or confirm no new tickers) before signing off.",
  "overlay.proposedTickers.emptyNeedsHint":
    "This overlay needs investable names for the stated themes. Confirm suggestions below, or acknowledge no new tickers.",
  "overlay.asks.title": "Client requirement highlights",
  "overlay.asks.softHint":
    "Soft targets — results show target vs actual; missing one is not a failure",
  "overlay.asks.summaryLabel": "Requirement summary",
  "overlay.clarify.title": "Clarification questions",
  "overlay.clarify.clickHint": "Click a question to answer inline",
  "overlay.clarify.answerPlaceholder": "Type your answer…",
  "overlay.clarify.composerPending": "Additional notes (optional)…",
  "overlay.clarify.answered": "Answered",
  "overlay.clarify.sendHint":
    "Fill what you can, then send below — you don’t need to answer every question",
  "overlay.clarify.send": "Send clarification answers",
  "overlay.clarify.pickMany": "Multi-select",
  "overlay.clarify.pickOne": "Pick one",
  "overlay.clarify.selected": "Selected: {labels}",
  "overlay.clarify.other": "Other…",
  "overlay.clarify.otherPlaceholder": "Type your answer…",
  "overlay.clarify.changeAnswer": "Change",
  "overlay.clarify.answeredReadonly": "Answered · read-only",
  "overlay.clarify.questionProgress": "Question {current} / {total}",
  "overlay.chat.summaryCard": "Adjustment summary",
  "overlay.chat.summaryCardCollapsed": "Previous summary ▸",
  "overlay.driftHint.need":
    "This overlay needs at least {pct}% customization drift (current cap {current}%) — it will auto-raise to {suggested}% on confirm",
  "overlay.driftHint.ok":
    "Drift cap is sufficient (need {pct}% ≤ current {current}%)",
  "overlay.driftHint.supervisor":
    "Suggested {pct}% exceeds 60% — supervisor approval will be recorded",
  "overlay.driftHint.title": "Drift requirement",
  "overlay.driftSync.raised":
    "Customization drift auto-raised from {from}% to {to}% to match the overlay.",
  "overlay.driftSync.raisedSupervisor":
    "Auto-raised to {to}%; above 60% — supervisor approval will be recorded.",
  "overlay.driftSync.sourceLine": "Sources: {sources}",
  "overlay.clarify.sendCount": "Send {count} answer",
  "overlay.clarify.sendCountPlural": "Send {count} answers",
  "overlay.clarify.sending": "Analyzing…",
  "chat.speakerYou": "You:",
  "chat.speakerJasper": "Jasper:",
  "chat.speakerSystem": "System:",
  // Base vs customized comparison
  "compare.title": "Anchor vs customized",
  "compare.subtitle": "Side-by-side metrics on the same window as the equity curves above.",
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
  "rm.step.backTo": "Back to {step}",
  "rm.step.anchor": "Anchor",
  "rm.step.overlay": "Client needs",
  "rm.step.execute": "Run",
  "rm.step.report": "Report",
  "rm.step.skipped": "skipped",
  "rm.run.title": "Ready to run",
  "rm.run.subtitle":
    "Review the signed client adjustments, then run the anchor vs customized dual-track projection.",
  "rm.run.clientNeeds": "Client needs summary",
  "rm.run.whatWillRun": "What will run",
  "rm.run.period": "Period: {start} → {end}",
  "rm.run.dualTrack": "Dual track: anchor replay + customized optimization",
  "rm.run.singleTrackNoAnchor":
    "Single track: customized run only (no compare vs baseline portfolio)",
  "rm.run.skipAnchorCompare": "Do not compare vs baseline portfolio",
  "rm.run.skipAnchorCompareHint":
    "Available when a cash sleeve is in play. Skips the anchor replay and dual-track report; keeps the investable book and market ticker for risk metrics.",
  "rm.run.proSearchTitle": "Pro optimization",
  "rm.run.proSearchHint":
    "Turning on Pro optimization runs AI multi-round parameter search (top-pick vs challenger proposals). It usually takes longer.",
  "rm.run.proSearchOn": "Pro optimization: ON (multi-round AI search)",
  "rm.run.proSearchOff":
    "Pro optimization: OFF (single round — faster)",
  "rm.run.execute": "Start trial comparison",
  "rm.run.showAdvanced": "Advanced settings",
  "rm.run.hideAdvanced": "Hide advanced settings",
  "rm.run.driftFloorMarker": "Overlay minimum {pct}%",
  "rm.run.driftBelowFloorWarning":
    "Current cap {current}% is below the overlay minimum {pct}% — some allocation targets cannot be fully met.",
  "rm.run.driftLowerConfirmTitle": "Lower anyway?",
  "rm.run.driftLowerConfirmBody":
    "Lowering to {to}% goes below the overlay minimum {pct}%; some targets will not be met.",
  "rm.run.driftLowerConfirmOk": "Lower anyway",
  "rm.run.driftLowerConfirmCancel": "Cancel",
  "rm.run.driftSupervisorBadge": ">60% needs supervisor",
  "rm.universe.fixedTitle": "Investment candidate list (fixed)",
  "rm.universe.fixedCount": "{n} tickers pinned for projection",
  "rm.universe.lockedTitle": "Model portfolio holdings (locked)",
  "rm.universe.lockedHint":
    "Base candidate list is the target model portfolio holdings. Client requirements may only add or remove specific tickers — not browse the full fund pool.",
  "rm.universe.lockedCount":
    "{n} tickers locked from model holdings ± requirements",
  "rm.report.title": "RM report",
  "rm.report.subtitle": "Client needs → constraint check → recommended portfolio",
  "rm.report.tabRm": "Client report",
  "rm.report.tabQuant": "Engine detail",
  "rm.report.tabAudit": "Audit / Raw data",
  "rm.report.quantTabHint":
    "Search rounds, leaderboards, and factor diagnostics — for RM deep-dive, not the client conversation.",
  "rm.report.heroEyebrow": "Recommended portfolio",
  "rm.report.heroTitle": "{code}{star}",
  "rm.report.heroHint": "Top pick of this run vs \"{anchor}\"",
  "rm.report.heroEyebrowViewing": "Viewing · {label}",
  "rm.report.needsTitle": "Needs fulfillment",
  "rm.report.needsHint":
    "Did this run keep the commitments signed in the adjustment plan?",
  "rm.report.askEvidenceTitle": "Requirement evidence",
  "rm.report.askEvidenceHint":
    "Target vs actual for each signed requirement — gaps are shown as-is.",
  "rm.report.askEvidenceAllMet": "All asks met",
  "rm.report.askEvidenceGapsOk": "Some gaps — still acceptable",
  "rm.report.askEvidenceSoftNote":
    "Requirements are soft targets — a missed band does not fail the run. Use this ledger in the client conversation.",
  "rm.report.askColTarget": "Target",
  "rm.report.askColActual": "Actual",
  "rm.report.askStatus.met": "Met",
  "rm.report.askStatus.partial": "Partial",
  "rm.report.askStatus.missed": "Missed",
  "rm.report.askStatus.unknown": "—",
  "rm.report.needsOverallPass": "All checks passed",
  "rm.report.needsOverallFail": "Gaps vs signed needs",
  "rm.report.needsColConstraint": "Commitment",
  "rm.report.needsColDetail": "Actual / limit",
  "rm.report.needsColStatus": "Status",
  "rm.report.needsDetailHint":
    "For must-include, detail lists missing tickers when failed, otherwise the required set.",
  "rm.report.expand": "Show",
  "rm.report.collapse": "Hide",
  "rm.report.talkingCollapsedHint": "Talking points for the client meeting",
  "rm.report.executiveTitle": "Executive summary",
  "rm.report.executiveHint": "Key points for your client conversation",
  "rm.report.metricsSummary":
    "vs {anchor}: return {cagrDelta}, max drawdown {mddDelta}",
  "rm.report.noOverlaySummary":
    "Customized portfolio based on anchor configuration.",
  "rm.report.overlayTitle": "Signed client needs",
  "rm.report.overlayHint": "Constraints and preferences confirmed in step 2",
  "rm.report.overlaySigned": "Signed {date}",
  "rm.report.metricsTitle": "Key metrics vs anchor",
  "rm.report.metricsHint": "Green = better than anchor for this metric",
  "rm.report.holdingsTitle": "Holdings changes",
  "rm.report.holdingsHint": "What shifted from the baseline portfolio",
  "rm.report.holdingsPrecisionHint":
    "Weights are end-of-period values (2 d.p.). Near-equal splits usually mean the single-name cap conflicts with max holdings or asset-class budgets — raise the cap, allow more holdings, or loosen class budgets.",
  "rm.report.talkingTitle": "Strategy summary",
  "rm.report.talkingLoading": "AI is drafting the proposal summary…",
  "rm.report.performanceFlag": "Projection result is below expectations",
  "rm.report.rerun": "Rerun projection",
  "compliance.badgeCompact": "Internal review only",
  "compliance.badgeDefault":
    "Internal review only — not investment advice. Supervisor approval required before client use.",
  "rm.report.disclaimerTitle": "Compliance notice",
  "rm.report.disclaimerBody":
    "For internal RM review only. This document is not an offer, recommendation, or solicitation to buy or sell any security. All figures are from historical simulations and assume the proposal was implemented exactly as modeled; past performance does not guarantee future results. A licensed supervisor must review and approve any client-facing material before use.",
  "rm.report.openQuant": "Open engine detail",
  "rm.report.revise": "Revise client needs",
  "rm.report.candidateTitle": "Candidate proposal",
  "rm.report.candidateHint":
    "Compare candidate proposals for the customized run. The leading model is selected by default.",
  "rm.report.candidateLabel": "View portfolio",
  "rm.report.candidateChampion": "★",
  "rm.quant.championWhyTitle": "Why this top pick was selected",
  "rm.quant.championWhyCode": "Recommended proposal: {code}",
  "proposal.ctaTitle": "Investment Proposal",
  "proposal.ctaHint":
    "Turn this run's top-recommended portfolio into an Investment Proposal",
  "proposal.generate": "Generate Investment Proposal",
  "proposal.title": "Investment Proposal (draft)",
  "proposal.subtitle":
    "Internal RM draft — numbers from dual-track projection; review before client use",
  "proposal.print": "Print / Save as PDF",
  "proposal.close": "Close",
  "proposal.draftBanner":
    "Working draft only. Jasper does not place trades. Formal client documents still require RM and compliance review.",
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
  "proposal.field.horizonYears": "Horizon (adjustment)",
  "proposal.field.years": "{n} years",
  "proposal.field.aum": "AUM",
  "proposal.field.cash": "Cash",
  "proposal.field.liquidity": "Liquidity needs",
  "proposal.field.overlayLiquidity": "Liquidity (adjustment)",
  "proposal.field.withinMonths": "Within {n} months",
  "proposal.field.esg": "ESG preference",
  "proposal.field.objective": "Investment goal",
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
  "proposal.section.strategy": "Recommended Proposal",
  "proposal.section.allocation": "Proposed Allocation",
  "proposal.section.rationale": "Rationale & Talking Points",
  "proposal.section.performance": "Risk & Performance Illustration",
  "proposal.section.implementation": "Implementation",
  "proposal.section.disclaimers": "Disclaimers & Suitability",
  "proposal.section.market": "Market Context & Rationale",
  "proposal.section.construction": "Strategy Construction & Constraints",
  "proposal.section.validation": "Historical Simulation",
  "proposal.section.risk": "Risk Analysis",
  "proposal.body.letterIntro":
    "This proposal outlines a customized ETF portfolio for {client} (illustrative size {amount}), using {am} · {theme} as the model-portfolio anchor.",
  "proposal.body.executive":
    "Recommended direction: customize {anchor} into {customized}, validated by dual-track projection.",
  "proposal.body.metricsPending":
    "Key performance deltas will appear after metrics load.",
  "proposal.body.profileFallback":
    "Client preferences were captured in the customization workflow.",
  "proposal.body.currentAnchor":
    "Starting point (anchor model portfolio): {anchor}",
  "proposal.body.currentFootnote":
    "Current holdings snapshot as of {asOf}. Demo data — not a custodian feed.",
  "proposal.body.market":
    "Adjustment rationale centers on moving from {anchor} toward {customized} while respecting signed client needs.",
  "proposal.body.strategyAnchor":
    "Baseline model portfolio: {am} · {theme} (risk band: {risk}). This is the AM-themed starting product.",
  "proposal.body.strategyCustomize":
    "Customized recommendation ({customized}) personalizes the anchor ({anchor}) using signed adjustment constraints and dual-track projection validation.",
  "proposal.body.allocationFallback":
    "Customized holdings will appear after weights resolve.",
  "proposal.body.allocationFootnote":
    "Weights from the customized top pick (or selected candidate). Monetary figures are illustrative using the client cash / AUM snapshot.",
  "proposal.body.constructionFallback":
    "Simulation window {start} → {end}; goal {objective}. Adjustment prompts and excludes apply.",
  "proposal.body.excludes": "Excluded tickers: {tickers}",
  "proposal.body.objectiveLine": "Investment goal: {objective}",
  "proposal.body.validationNote":
    "All figures are computed from historical data and can be traced and reproduced. Past performance is not a reliable guide to future performance.",
  "proposal.body.chartCaption":
    "Illustrative dual equity (rebased to 100) over {start} → {end}. Actual policy values will differ after fees, taxes, and timing.",
  "proposal.body.riskMdd":
    "Customized max drawdown {customized} vs anchor {anchor}.",
  "proposal.body.riskFallback":
    "Review drawdown and concentration in the quant tab.",
  "proposal.body.implDca":
    "Consider dollar-cost averaging (DCA) into equity sleeves if lump-sum market timing is a concern.",
  "proposal.body.implRebalance":
    "Rebalance according to the signed projection window assumptions ({start} → {end}) unless the bank policy specifies otherwise.",
  "proposal.body.implLiquidity":
    "Retain a liquidity buffer aligned to near-term cash needs before full deployment.",
  "proposal.body.implClientLiquidity": "Client liquidity note: {note}",
  "proposal.body.impl1":
    "Phase entries if liquidity or market impact is a concern.",
  "proposal.body.impl2":
    "Confirm fees, taxes, and suitability under bank policy before client delivery.",
  "proposal.body.impl3":
    "Rebalance cadence follows the signed projection configuration unless amended.",
  "proposal.body.signOffNote": "RM sign-off note: {note}",
  "proposal.body.disclaimer1":
    "Past performance is not indicative of future results.",
  "proposal.body.disclaimer2":
    "This draft is for RM internal use until compliance clearance.",
  "proposal.body.disclaimerSuitability":
    "Suitability, KYC, and product approval remain bank-controlled processes; Jasper does not certify regulatory fitness.",
  "proposal.body.nextSteps":
    "Next steps: RM review → compliance / suitability check → client discussion → implementation instructions (outside Jasper).",
  "proposal.warning.pastPerformance":
    "Warning: Past performance is not a reliable guide to future performance.",
  "proposal.warning.valueFluctuation":
    "Warning: The value of an investment may go down as well as up, and you may lose some or all of the money invested.",
  "proposal.warning.currency":
    "Warning: Returns may be affected by changes in currency exchange rates.",
  "proposal.warning.estimates":
    "Warning: These figures are estimates / simulated illustrations only.",
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
    "Signed candidate list rules: {rules} — explain how the final holdings respect these constraints.",
  "rm.talking.riskTolerance.conservative": "conservative",
  "rm.talking.riskTolerance.moderate": "moderate",
  "rm.talking.riskTolerance.aggressive": "aggressive",
  "rm.talking.tilt.defensive": "defensive (higher bond / lower equity)",
  "rm.talking.tilt.growth": "growth-oriented (higher equity)",
  "rm.talking.tilt.balanced": "balanced across growth and defense",
  "rm.talking.objective.min_max_drawdown":
    "We designed for {objective}; customized max drawdown is {customized} vs anchor {anchor} ({delta}) — use this as evidence the goal was met.",
  "rm.talking.objective.max_sharpe":
    "We designed for {objective}; customized Sharpe is {customized} vs anchor {anchor} ({delta}) — emphasize risk-adjusted efficiency.",
  "rm.talking.objective.max_return":
    "We designed for {objective}; customized CAGR is {customized} vs anchor {anchor} ({delta}) — link return outcome to the agreed goal.",
  "rm.talking.objective.generic":
    "Investment goal: {objective}. Key outcome vs anchor: {customized} vs {anchor} ({delta}).",
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
  "rm.talking.similarGeneric":
    "allocation fit matters more than small return gaps",
  "rm.talking.compliance":
    "Reminder: illustrative projection for discussion only — not investment advice. Confirm suitability and compliance before any implementation.",

  "progress.dual.anchor": "Baseline projection",
  "progress.dual.customized": "Customized projection",
  // RM Copilot nav + Client / Pool / Models
  "nav.aria": "Primary navigation",
  "nav.menu": "Open navigation menu",
  "nav.clients": "Clients",
  "nav.pool": "Investment Pool",
  "nav.models": "Model Portfolios",
  "nav.personalization": "Customization",
  "nav.settings": "Admin Settings",
  "nav.tools": "Tools",
  "gaps.title": "Capability gap backlog",
  "gaps.subtitle": "Product backlog",
  "gaps.lead": "Gaps detected in overlay conversations, sorted by reuse count.",
  "gaps.empty": "No gap tickets yet.",
  "engineDocs.title": "Engine capabilities",
  "engineDocs.subtitle": "Stage cards",
  "engineDocs.lead": "Auto-generated from the stage registry — never stale by design.",
  "settings.subtitle": "Import & export",
  "settings.hint":
    "Manage Investment Pool and Model Portfolios CSV data here. Browse and enable items on their own pages.",
  "settings.poolTitle": "Investment Pool",
  "settings.validationUnavailable": "Validation service unavailable",
  "settings.validationUnavailableDetail": "Validation service unavailable: {message}",
  "settings.poolHint": "Import or export the global product list CSV.",
  "settings.modelsTitle": "Model Portfolios",
  "settings.modelsHint":
    "Import or export AM model portfolio CSV (flat rows per holding).",
  "clients.listTitle": "Client Dashboard",
  "clients.listSubtitle": "Demo clients",
  "clients.listHint":
    "Select a client to review profile and holdings, then launch Portfolio Customization.",
  "clients.detailSubtitle": "Client profile",
  "clients.backToList": "Back to clients",
  "clients.notFound": "Client not found.",
  "clients.profile": "Profile",
  "clients.holdings": "Current holdings",
  "clients.aum": "AUM",
  "clients.cash": "Cash",
  "clients.clientId": "Client ID",
  "clients.segment": "Client category",
  "clients.age": "Age",
  "clients.risk": "Risk profile",
  "clients.horizon": "Horizon",
  "clients.rm": "RM owner",
  "clients.liquidity": "Notes",
  "clients.asOf": "As of",
  "clients.weight": "Weight",
  "clients.amount": "Investment amount",
  "clients.return": "Cum. return",
  "clients.return.cumulativeSub": "Since invested",
  "clients.return.reportedFallback":
    "Reported value — real price history unavailable for this holding.",
  "clients.investedAt": "Invested",
  "clients.cagr": "年化報酬",
  "clients.suggestedAnchor": "Suggested model portfolio",
  "clients.launchCta": "Customize portfolio for this client",
  "clients.launchScopeSummary":
    "Will customize {count} group(s) · ~{pct}% of AUM",
  "clients.noClientBanner":
    "No client selected — start from the client dashboard for the best handoff.",
  "clients.noClientBannerCta": "Go to clients",
  "clients.contextBanner": "Active client: {name}",
  "clients.viewDashboard": "View dashboard",
  "clients.esg": "ESG preference",
  "clients.ageUnit": "yrs",
  "clients.holding.cash": "Cash",
  "clients.holding.cashMoneyMarket": "Cash / money market",
  "clients.notePrefix": "Note:",
  "clients.upcomingEvents": "Upcoming events",
  "clients.chart.performance": "Performance trend",
  "clients.chart.allocation": "Holdings mix",
  "clients.chart.nav": "NAV",
  "clients.chart.return": "Return",
  "clients.chart.tf.1M": "1M",
  "clients.chart.tf.3M": "3M",
  "clients.chart.tf.6M": "6M",
  "clients.chart.tf.YTD": "YTD",
  "clients.chart.tf.1Y": "1Y",
  "clients.chart.tf.MAX": "Max",
  "clients.chart.alloc.individual": "Holdings",
  "clients.chart.alloc.portfolio": "Portfolios",
  "clients.holdings.individual": "Individual / satellite sleeve",
  "clients.holdings.cash": "Cash",
  "clients.holdings.groupSubtotal": "Subtotal",
  "clients.holdings.total": "Total",
  "clients.chart.includeGroups": "Include in charts",
  "clients.chart.noGroupsSelected": "Select at least one group to show charts.",
  "clients.chart.noPerformanceData":
    "No reported holding returns for this selection — performance chart is unavailable.",
  "clients.chart.loadingPerformance": "Loading real price history…",
  "clients.add": "Add",
  "clients.add.content": "Content",
  "clients.add.date": "Date",
  "clients.add.label": "Label",
  "clients.add.save": "Save",
  "clients.add.cancel": "Cancel",
  "clients.add.notePlaceholder": "Add a note…",
  "clients.add.eventPlaceholder": "Event label…",
  "clients.add.noEvents": "No upcoming events yet.",
  "clients.history.title": "Customized portfolio history",
  "clients.history.record": "{count} result",
  "clients.history.records": "{count} results",
  "clients.history.empty":
    "Customized portfolios generated for this client will appear here.",
  "clients.history.emptyCta": "Customize a portfolio",
  "customization.confirmTitle": "Confirm scope & baseline",
  "customization.confirmHint":
    "Brought from the client dashboard. Confirm to continue, or edit below.",
  "customization.confirmContinue": "Confirm and continue",
  "customization.editScope": "Edit scope & baseline",
  "customization.collapseScope": "Hide editors",
  "customization.scopeGroupsLabel": "Groups",
  "customization.scopeAnchorLabel": "Baseline",
  "customization.scopeNameLabel": "Portfolio name",
  "rm.report.moreActions": "Other actions",
  "rm.report.moreActionsHint": "Export, engine details, or revise needs",
  "clients.history.open": "OPEN",
  "clients.history.untitled": "Customized portfolio",
  "clients.goalSimCta": "Financial goal simulator",
  "goalSim.title": "Financial goal simulator",
  "goalSim.notesLabel": "RM notes",
  "goalSim.notesPlaceholder":
    "e.g. Client wants a house down payment of USD 1.5M in 12 months, kids’ tuition ~200k in 3 years, expect 5% return and can add 120k per year…",
  "goalSim.extract": "AI extract into form",
  "goalSim.extractReplaceAll": "Replace all from notes",
  "goalSim.extractConfirmReplace":
    "Replace the entire goals table and path assumptions with the AI extract? Manual edits will be lost.",
  "goalSim.extractMergeSummary":
    "Merged: {updated} fields updated, {added} goals added, {kept} manual edits kept",
  "goalSim.extracting": "Extracting…",
  "goalSim.extractFailed": "Could not extract goals from notes.",
  "goalSim.source.ai": "AI",
  "goalSim.rulesFallback": "Rule-based estimate",
  "goalSim.assumptionsTitle": "Path assumptions",
  "goalSim.annualReturn": "Expected annual return (%)",
  "goalSim.annualContribution": "Annual contribution (USD)",
  "goalSim.annualContributionHint": "Stops at retirement start (working years only).",
  "goalSim.contributionGrowth": "Contribution growth (% / yr)",
  "goalSim.inflation": "Goal inflation (% / yr)",
  "goalSim.optimisticDelta": "Optimistic return delta (pp)",
  "goalSim.conservativeDelta": "Conservative return delta (pp)",
  "goalSim.returnDefaults.loading":
    "Estimating returns from current holdings…",
  "goalSim.returnDefaults.realized":
    "Return fields auto-filled from the client book’s realized performance — editable.",
  "goalSim.returnDefaults.backcast":
    "Return fields are pre-filled from your current holdings' past performance — editable.",
  "goalSim.returnDefaults.refresh": "Re-apply portfolio estimate",
  "goalSim.returnDefaults.unavailable":
    "Portfolio performance unavailable — keeping manual defaults.",
  "goalSim.returnDefaults.retry": "Retry estimate",
  "goalSim.goalsTitle": "Goals (timeline)",
  "goalSim.addGoal": "Add goal",
  "goalSim.goalsEmpty": "No goals yet — extract from notes or add manually.",
  "goalSim.goalType": "Type",
  "goalSim.goalLabel": "Label",
  "goalSim.goalAmount": "Amount (USD)",
  "goalSim.goalAmountDownPayment": "Down payment / cash at purchase (USD)",
  "goalSim.goalAmountAnnualSpend": "Annual living spend (USD / yr)",
  "goalSim.retirementSpendYears": "Spend years after retirement",
  "goalSim.retirementSpendHint": "≈ {monthly} / month from retirement onward",
  "goalSim.retirementLongevityHint":
    "(auto: life expectancy {le} − retire age → {years}y; male 78 / female 85)",
  "goalSim.goalMonths": "Within (months)",
  "goalSim.goalPriority": "Priority (1–5)",
  "goalSim.removeGoal": "Remove",
  "goalSim.mortgageTitle": "Mortgage (after purchase)",
  "goalSim.mortgageHint":
    "Loan principal is purchased after the down payment; monthly amortizing payments reduce wealth from the next month.",
  "goalSim.mortgageLoan": "Principal (USD)",
  "goalSim.mortgageRate": "Rate %/yr",
  "goalSim.mortgageTermYears": "Term (yr)",
  "goalSim.mortgagePayment": "Est. monthly payment: {amount}",
  "goalSim.type.home": "Home / property",
  "goalSim.type.retirement": "Retirement",
  "goalSim.type.education": "Education",
  "goalSim.type.liquidity": "Liquidity",
  "goalSim.type.other": "Other",
  "goalSim.chartTitle": "Wealth path (multi-scenario)",
  "goalSim.chartHorizon": "Horizon",
  "goalSim.chartHorizon.months": "{n}m",
  "goalSim.chartHorizon.years": "{n}y",
  "goalSim.chartHorizon.max": "Full path",
  "goalSim.axis.m": "{n}m",
  "goalSim.axis.y": "{n}y",
  "goalSim.timeLabel.years": "{y}y (m{m})",
  "goalSim.chart.mortgageMarker": "{name} · mortgage {payment}/mo",
  "goalSim.chart.mortgageShort": "{name} · mortgage",
  "goalSim.chart.mortgageEndMarker": "{name} · mortgage paid off",
  "goalSim.chart.retirementMarker": "{name} · spend {payment}/mo",
  "goalSim.chart.retirementShort": "{name} · retire",
  "goalSim.chart.tag.home": "Home",
  "goalSim.chart.tag.retirement": "Retire",
  "goalSim.chart.tag.mortgageEnd": "Paid off",
  "goalSim.chart.tag.inheritance": "Estate",
  "goalSim.chart.inheritanceMarker": "Estimated inheritance {amount}",
  "goalSim.chartEmpty": "Add at least one goal with amount and timing to project paths.",
  "goalSim.scenario.base": "Base",
  "goalSim.scenario.optimistic": "Optimistic",
  "goalSim.scenario.conservative": "Conservative",
  "goalSim.monthLabel": "Month {n}",
  "goalSim.endingWealth": "Ending wealth (base)",
  "goalSim.inheritance": "Estimated inheritance (base)",
  "goalSim.inheritanceHint": "At planning life expectancy age {age} (~{years}y)",
  "goalSim.totalShortfall": "Total shortfall (base)",
  "goalSim.totalMortgagePaid": "Mortgage paid on path (base)",
  "goalSim.totalRetirementPaid": "Retirement spend on path (base)",
  "goalSim.totalLivingPaid": "Living spend on path (base, pre-retirement)",
  "goalSim.eventsTitle": "Goal events",
  "goalSim.eventCovered": "Covered",
  "goalSim.eventShortfall": "Short {amount}",
  "goalSim.eventMortgageStart": "{name} — mortgage starts ({payment}/mo)",
  "goalSim.eventMortgageLoan": "Loan {amount}",
  "goalSim.eventMortgageEnd": "{name} — mortgage paid off",
  "goalSim.eventMortgageEndDone": "Paid off",
  "goalSim.eventInheritance": "Life expectancy — remaining wealth as inheritance",
  "goalSim.eventRetirementStart": "{name} — monthly spend starts ({payment}/mo)",
  "goalSim.eventRetirementTotal": "Plan total ~{amount}",
  "goalSim.actionsTitle": "Suggested next steps",
  "goalSim.insightsTitle": "Customization priorities",
  "goalSim.insightsSubtitle":
    "AI flags issues on the wealth forecast so the next customization step can solve them.",
  "goalSim.insightsLoading": "Generating AI priorities…",
  "goalSim.insightsFailed": "AI priorities unavailable. Please retry.",
  "goalSim.insightsRetry": "Retry AI",
  "goalSim.insightsTalkingPoint": "RM talking point: {text}",
  "goalSim.insightsSolveInNext": "Solve via: {actions}",
  "goalSim.hook.liquidity_buffer": "raise liquidity buffer",
  "goalSim.hook.horizon": "align investment horizon",
  "goalSim.hook.contribution": "adjust contributions / timing",
  "goalSim.hook.deployment": "stage capital deployment",
  "goalSim.hook.min_drawdown": "minimize max drawdown",
  "goalSim.hook.risk": "rebalance risk sleeves",
  "goalSim.hook.return": "seek higher expected return",
  "goalSim.hook.refine_risk": "refine risk preference",
  "goalSim.action.shortfall":
    "Base path shows a funding gap — raise contributions, stretch timing, or trim a goal.",
  "goalSim.action.onTrack": "Base path covers listed goals under current assumptions.",
  "goalSim.action.tuneAssumptions": "Stress return / contribution / inflation bands above.",
  "goalSim.action.customize":
    "Hand off near-term liquidity and horizon into customization.",
  "goalSim.action.addressInsight": "Address \"{title}\" — {hooks}",
  "goalSim.action.customizeFromInsights":
    "Carry these priorities into customization (liquidity, objective, and buffers prefilled).",
  "goalSim.action.waitInsights": "Wait for AI priorities before customizing, or proceed with goals only.",
  "goalSim.action.retryInsightsFirst":
    "Retry AI priorities so customization can target the findings.",
  "goalSim.handoffCta": "Continue to portfolio customization",
  "goalSim.handoffCtaFromInsights": "Customize portfolio to solve these priorities",
  "goalCompare.title": "Financial plan path — before vs customized",
  "goalCompare.subtitle":
    "Same goals and spending schedule as the original plan. Pick the customized portfolio / target model above; the blue path uses that selection’s overall investment performance.",
  "goalCompare.portfolioLabel": "Selected portfolio",
  "goalCompare.modelLabel": "Target model",
  "goalCompare.confidence": "Confidence floor",
  "goalCompare.confidenceOption": "{pct}% not below…",
  "goalCompare.returnNote":
    "Dashed gray = original plan ({before}). Blue = customized ({customized} · {model}) base {after} from {source} (winsorized {years}-yr sample, ≤ sample avg {ceiling}, vol {vol}). Conservative ≈ {conf}% of years ≥ {floor}.",
  "goalCompare.returnSource.overall": "overall portfolio performance",
  "goalCompare.returnSource.cagrFallback": "headline CAGR (equity curve unavailable)",
  "goalCompare.returnSource.realized": "the client book’s realized performance",
  "goalCompare.returnSource.backcast": "past performance of the target holdings",
  "goalCompare.percentileNote":
    "Annual distribution — P10 {p10} · median {p50} · P90 {p90}.",
  "goalCompare.backcastProxyNote":
    "Late listings proxied by same-category peers: {tickers} ({months} months).",
  "goalCompare.backcastUnavailable":
    "Holdings performance unavailable — using the portfolio projection instead.",
  "goalCompare.glideTitle": "Consider gliding risk into cash",
  "goalCompare.glideBody":
    "Projected ending wealth ({ending}) is about {multiple}× listed goal needs ({need}) with no shortfall. Gradually raise the cash sleeve and trim equity so surplus is protected before retirement spend.",
  "goalCompare.endingWealth": "Ending / estate (full path)",
  "goalCompare.endingWealthHint": "Through life-expectancy / full projection.",
  "goalCompare.atGoalsHorizon": "Wealth at goals window",
  "goalCompare.atGoalsHorizonHint": "Around the last listed goal / mortgage / retirement spend.",
  "goalCompare.totalShortfall": "Total funding shortfall",
  "goalCompare.delta": "Δ {amount}",
  "goalCompare.shortfallImproved": "Shortfall reduced vs the original plan.",
  "goalCompare.shortfallStillCovered": "Goals still covered on both paths.",
  "goalCompare.shortfallNotImproved": "Shortfall not reduced — refine the adjustment or contributions.",
  "goalCompare.series.before": "Original plan",
  "goalCompare.series.after": "Customized (base)",
  "goalCompare.series.afterOptimistic": "Customized (optimistic)",
  "goalCompare.series.afterConservative": "Customized (conservative)",
  "goalCompare.axisYear": "Y{n}",
  "goalCompare.axisMonth": "M{n}",
  "goalCompare.monthLabel": "Month {n}",
  "goalCompare.timeLabel.years": "Y{y} (m{m})",
  "goalSegment.title": "AI goal path — segmented strategies",
  "goalSegment.subtitle":
    "AI splits the plan into short / mid / long periods and assigns one strategy per period. The median line compounds each period at its own planning return (from the holdings projection or the model series); the shaded band is the conservative–optimistic range.",
  "goalSegment.loading": "AI is segmenting goals into periods…",
  "goalSegment.source.ai": "AI segmentation",
  "goalSegment.source.rules": "Rule-based estimate",
  "goalSegment.segment.short": "Short term",
  "goalSegment.segment.mid": "Mid term",
  "goalSegment.segment.long": "Long term",
  "goalSegment.strategy.holdings": "Current holdings",
  "goalSegment.strategy.holdingsShort": "Holdings",
  "goalSegment.card.returns": "Base {base} · {floor} ~ {ceiling}",
  "goalSegment.card.goals": "{n} goal(s)",
  "goalSegment.series.median": "Median path",
  "goalSegment.series.band": "P{lo}–P{hi} band",
  "goalSegment.bandNote":
    "Shaded band = P{lo}–P{hi} of each segment strategy's calendar-year outcomes at the selected confidence; median = per-segment base rate.",
  "goalSegment.priorFallbackNote":
    "Some segments use the plan prior return (no projection curve available).",
  "customization.optimizeScopeTitle": "Optimize these holdings",
  "customization.optimizeScopeHint":
    "Choose which holdings groups (model books or satellite sleeves) to include in this run.",
  "customization.multiModelNotice":
    "Multiple model portfolios are selected. They will be customized together into one resulting portfolio. Uncheck any group you do not want changed.",
  "customization.portfolioName": "Portfolio name",
  "customization.portfolioNamePlaceholder":
    "Name for this customized portfolio",
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
  "pool.subtitle": "Global product list",
  "pool.countBadge": "{enabled} / {total} enabled",
  "pool.loadDemo": "Load demo ETFs",
  "pool.loadFull": "Load full ETF candidate list",
  "pool.importCsv": "Import CSV",
  "pool.exportCsv": "Export CSV",
  "pool.importReport": "Import: {upserted} upserted, {skipped} skipped",
  "pool.searchPlaceholder": "Search ticker or name…",
  "pool.filter.allClasses": "All asset classes",
  "pool.filter.allRegions": "All regions",
  "pool.filter.allProducts": "All product types",
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
  "pool.product.stock": "Stock",
  "pool.product.fund": "Fund",
  "pool.product.cash": "Cash",
  "pool.product.structured": "Structured",
  "pool.product.bond": "Bond",
  "pool.product.other": "Other",
  "models.title": "Model Portfolios",
  "models.subtitle": "House model catalog",
  "models.hint":
    "Manage model portfolios for Benchmark Personalization. Holdings may mix ETFs, mutual funds, and stocks from the Investment Pool. CSV: portfolio_id, portfolio_name, asset_manager, am_id, theme, risk_profile, ticker, weight, benchmark_ticker, enabled.",
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
  "models.issuerHoldingsHint":
    "Mix of ETFs, mutual funds, and stocks from the house model catalog",
  "models.filter.am": "Filter by asset manager",
  "models.filter.risk": "Filter by risk",
  "models.filter.theme": "Filter by theme",
  "models.filter.allAm": "All asset managers",
  "models.filter.allRisk": "All risk profiles",
  "models.filter.allThemes": "All themes",
  "models.sort.label": "Sort by",
  "models.sort.name": "Sort: Name",
  "models.sort.issuer": "Sort: Issuer",
  "models.sort.risk": "Sort: Risk",
  "models.sort.theme": "Sort: Theme",
  "models.empty": "No model portfolios match these filters.",
  "anchor.poolConflicts":
    "{count} model(s) hidden due to Investment Pool conflicts — fix Pool or Models.",
  "anchor.empty":
    "No selectable anchors. Enable Model Portfolios whose holdings are in the enabled Investment Pool.",
};

const zh: Dict = {
  // Header / shell
  "header.phase.scenario": "—",
  "header.phase.anchor": "基準組合",
  "header.phase.overlay": "客戶需求",
  "header.phase.constraints": "設定",
  "header.phase.running": "執行中",
  "header.phase.results": "結果",
  "header.phase.export": "匯出",
  "live.trial": "方案 {n}/{total}",
  "results.needsFloorTitle": "客戶底線檢核",
  "results.needsFloorPass": "訓練期最大回撤 {actual}（容忍線 {floor}）— 守住了",
  "results.needsFloorFail":
    "訓練期最大回撤 {actual}（容忍線 {floor}）— 超過 {breach}",
  "header.apiOffline": "服務離線",
  "header.apiOfflineHint": "目前無法連線到分析服務，請稍後再試。",
  "header.apiLinked": "分析引擎已連線",
  "lang.label": "語言",
  "lang.aria": "語言",
  // Backtest history panel
  "history.title": "方案紀錄",
  "history.refresh": "重新整理",
  "history.syncing": "同步中…",
  "history.apiOffline": "離線 — 顯示本機結果",
  "history.record": "{count} 筆結果",
  "history.records": "{count} 筆結果",
  "history.empty": "執行一次試算後，結果會顯示在這裡。",
  "history.load": "開啟",
  "history.status.completed": "已完成",
  "history.status.failed": "失敗",
  "history.status.running": "執行中",
  "history.status.queued": "排隊中",
  // Constraints / config form
  "config.title": "方案設定",
  "config.subtitle":
    "在下方設定你的方案。每次再平衡時，Jasper 會挑出表現最強的標的，再分配權重以兼顧風險與報酬。",
  "config.maxWeight": "單一檔最大比重：{pct}%",
  "config.minWeight": "單一檔最小比重：{pct}%",
  "config.minWeightHint":
    "每次再平衡時，低於此比重的部位會被調整，釋出的資金會分配到其餘持股。",
  "config.maxTurnover": "每次檢視最大換手率：{pct}%",
  "config.maxTurnoverHint":
    "限制 Jasper 每次再平衡能調動的部位比例，有助於控制交易成本。",
  "config.customizationDrift": "客製化空間（上限）：{pct}%",
  "config.customizationDriftHint":
    "允許偏離目標模型的上限（0% = 完全一致，100% = 可在標的池中全面重構）。預設由 AI 在此範圍內搜尋；若要鎖定滑桿值，請在進階參數將「客製化偏離」設為固定。",
  "config.maxHoldings": "最多持倉檔數：{n}",
  "config.maxHoldingsHint":
    "必須大於 100%÷單檔上限（上限 {pct}% 時至少 {min} 檔）。否則每檔都會卡在上限、權重變成均分，優化失去意義。",
  "config.topN": "候選標的清單：{n}",
  "config.topNHint":
    "Jasper 會為所有候選標的排名，保留前 {n} 名來建構你的投資組合。",
  "config.objective": "投資目標",
  "config.customObjective": "描述你的目標",
  "config.start": "開始日期",
  "config.startHint":
    "系統會額外載入開始日之前的行情，確保第一天就有可靠訊號。",
  "config.end": "結束日期",
  "config.trials": "搜尋深度：{n} 種模型",
  "config.topModels": "報告顯示模型數：{n}",
  "config.holdout":
    "保留近期資料作驗證（Jasper 先在較早期間訓練，再用未看過的資料驗證結果）",
  "config.inSampleRatio": "以前 {pct}% 的資料訓練（其餘保留作驗證）",
  "config.fee": "交易成本：{bps} 個基點",
  "config.rebalanceFreq": "再平衡頻率",
  "config.rebalance.weekly": "每週（週五）",
  "config.rebalance.monthly": "每月",
  "config.rebalance.quarterly": "每季",
  "config.rebalance.yearly": "每年",
  "config.runStandard": "執行試算",
  "config.runPro": "執行 Pro 最佳化",
  "config.notifyEmail": "完成後寄信通知我（選填）",
  "config.notifyEmailPlaceholder": "you@example.com",
  "config.notifyEmailHint":
    "試算期間可以關閉此分頁——完成或失敗時會寄信通知你。",
  "config.notifyEmailSmtpDisabled":
    "此環境未開放郵件通知。",

  // Pro rounds tabs
  "pro.tabsHint":
    "每個分頁代表一輪：當前領先方案與它的對照方案。★ 標示該輪優勝者。總覽分頁列出目前嘗試過的所有方案。",
  "pro.allRounds": "所有輪次",
  "pro.roundChip": "第 {n} 輪",
  "pro.role.incoming": "當前領先方案",
  "pro.role.challenger": "對照方案",
  "pro.role.winner": "本輪優勝者",
  // Results dashboard
  "results.runObjectiveLabel": "本次投資目標",
  "results.title": "結果",
  "results.model": "模型",
  "results.fullNarrative": "完整摘要",
  "results.fullPeriod": "完整期間",
  "results.rmChampionLine":
    "建議方案 {model} · 夏普 {sharpe} · 年化報酬 {cagr}",
  "results.refineHint": "點擊套用調整 · 雙擊套用並重新執行。",
  "results.editConfig": "編輯設定",
  "results.belowBenchmarkTitle": "客觀解讀：本次試算未勝過基準",
  "results.belowBenchmarkBody":
    "在此區間內，沒有任何方案在所選目標上勝過 {benchmark}。可直接從本次結果調整訊號、限制、標的池或目標後再跑，不必重頭開始。",
  "results.iterateFromHere": "調整並重新執行",
  "results.continueRefinementTitle": "未超越基準，是否繼續搜尋？",
  "results.continueRefinementBody":
    "在此區間內，沒有任何試算在所選目標上勝過 {benchmark}。可追加 Pro 輪次，並帶入本次的領先模型、學習紀錄與 AI 脈絡繼續搜尋。",
  "results.continueRefinementCta": "繼續搜尋",
  "results.continueRefinementRunning": "延續搜尋中…",
  "results.continueRefinementHint":
    "帶入執行紀錄 {job}… 的領先模型與先前輪次紀錄",
  "results.extraRoundsLabel": "追加輪次",
  "results.extraTrialsPerRoundLabel": "每輪對照方案數",
  "results.extraTrialsLabel": "延伸評估方案數",
  "results.continueFromRound": "將從第 {round} 輪繼續",
  "results.exportCsv": "匯出 CSV",
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
  "common.inSample": "訓練期",
  "common.outOfSample": "驗證期",
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
  "proPanel.title": "Pro 最佳化",
  "proPanel.desc.beforeDynamic":
    "Jasper 會讓對照方案一輪輪挑戰當前領先方案。AI 會根據先前有效的設定提出新方案，持續優化直到結果不再進步。",
  "proPanel.dynamic": "動態",
  "proPanel.desc.afterDynamic":
    "目標會為每種市場氛圍（避險、中性、偏多）各自調校一套方案，並隨情勢變化套用最合適的那一套。",
  "proPanel.estimationPrefix": "Pro 模式會替你管理搜尋強度，最多約執行",
  "proPanel.estimationUnit": "次",
  "proPanel.estimationSuffix": "試算，並可能在結果不再進步時提前結束。",
  "proPanel.highTrialsWarning":
    "設定越高，執行的試算越多、耗時也越長。每一輪都會用一則 AI 建議來引導搜尋。",
  "proPanel.round1Batch": "首輪方案數",
  "proPanel.round1BatchHint": "首輪要嘗試的方案數量（3–100）。",
  "proPanel.challengersPerRound": "每輪對照方案數",
  "proPanel.challengersPerRoundHint":
    "每一輪挑戰領先方案的新方案數量（2–100）。",
  "proPanel.maxRounds": "最大輪數",
  "proPanel.maxRoundsHint": "最多執行的輪數，含首輪（2–30）。",
  "proPanel.patienceRounds": "提前停止容忍輪數",
  "proPanel.holdoutTip":
    "提示：開啟保留資料，方案會先以訓練期排名，再用未看過的資料驗證。",

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
  // Live progress messages (localized on the client from backend templates)
  "progress.msg.queued": "試算排隊中…",
  "progress.msg.queuedStatic": "基準重播排隊中…",
  "progress.msg.queuedPro": "Pro 最佳化排隊中…",
  "progress.msg.fetching": "正在擷取市場資料，開始最佳化…",
  "progress.msg.fetchingStatic": "基準重播：正在擷取市場資料…",
  "progress.msg.staticSimulating": "基準重播：模擬固定權重組合…",
  "progress.msg.fetchingPro": "Pro：正在擷取資料，開始迭代搜尋…",
  "progress.msg.complete": "試算完成",
  "progress.msg.completePro": "Pro 最佳化完成",
  "progress.msg.loaded":
    "已載入 {tickers} 檔標的、{rows} 個交易日。每次再平衡會挑出最強的持股，再分配部位權重。",
  "progress.msg.loadedRegimeSuffix":
    " 隨市場狀態調整：每次再平衡設定配置器預設。",
  "progress.msg.proHoldout": "Pro：方案以訓練期排名；保留資料用於最終驗證…",
  "progress.msg.proLoop": "Pro：執行對照方案輪次（AI 從歷史學習）…",
  "progress.msg.startingAi": "正在啟動 AI — 為 {trials} 種方案規劃初始參數…",
  "progress.msg.aiDone":
    "AI 已備妥 {used} 組起始方案，開始試算…",
  "progress.msg.aiDoneCapped":
    "AI 已備妥 {used} 組起始方案，開始試算…",
  "progress.msg.aiOff": "智慧優化暫不可用，已切換自動搜尋…",
  "progress.msg.optuna": "方案 {trial}/{total}（{scope}）",
  "progress.msg.optunaBest":
    "方案 {trial}/{total}（{scope}），目前最佳 {label} {value}",
  "progress.msg.searchDone":
    "搜尋完成（{feasible} 個可行）— 正在為報告整理前 {top} 名…",
  "progress.msg.packaging": "整理中報告：{inner}",
  "progress.msg.roundReport": "第 {round} 輪報告：{inner}",
  "progress.msg.proRound": "第 {round}/{max} 輪：{carry}，準備 {n} 位對照方案…",
  "progress.msg.roundOptuna": "第 {round} 輪 · 方案 {trial}/{total}（{scope}）",
  "progress.msg.roundOptunaBest":
    "第 {round} 輪 · 方案 {trial}/{total}（{scope}），本輪最佳 {label} {value}",
  "progress.msg.roundAiLearning":
    "第 {round} 輪：AI 從 {n} 位較弱的對照方案學習，目標分數 {score}…",
  "progress.msg.roundDone":
    "第 {round} 輪完成：本輪最佳 {best}，領先方案 {champ}（無進步輪數 {streak}/{patience}）",
  "progress.msg.roundDoneAlphaSuffix":
    " · 訓練期 Alpha 相對 {benchmark} {alpha}（低於基準）",
  "progress.msg.pkgFromCache": "正在準備 {code}（{rank}/{total}）…",
  "progress.msg.pkgMetricsOnly": "正在準備 {code}（{rank}/{total}）…",
  "progress.msg.pkgNoCache":
    "正在準備 {code}（{rank}/{total}）…",
  "progress.msg.pkgIsOos":
    "正在準備 {code}（{rank}/{total}）…",
  "progress.msg.pkgIncomplete":
    "正在準備 {code}（{rank}/{total}）…",
  "progress.msg.pkgTop": "資料池中前 {top}／{feasible} 個方案…",
  "progress.msg.scope.inSample": "訓練期",
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
    "描述你對總體經濟、產業或風險的看法，Jasper 會把它轉化為可試算的方案。",
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
    "投組會從你勾選的類別中自動產生，並在每次再平衡時調整。",
  "assetFilter.lockedAdded":
    "已鎖定模型標的池：保留持倉並加入 {adds}（僅限明確代碼）。",
  "assetFilter.lockedUnchanged":
    "已鎖定模型標的池未變更——輸入代碼（如 GLD）即可加入，或使用調整方案補充標的。",
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
  "assetFilter.guaranteedHint": "這些標的一定會納入你的試算。",
  "linkedChart.tooltipRegime": "市場狀態",
  "linkedChart.tooltipActiveObjective": "現行目標",
  "linkedChart.noHistory": "此方案沒有績效或持股歷史。",
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
  "objectiveLab.oosSharpeDelta": "驗證期夏普值提升（切換 vs. 固定）：",
  "objectiveLab.regimeDetector": "市場狀態偵測器",
  "objectiveLab.detectorV2": "權衡偏多與避險訊號來判讀市場",
  "objectiveLab.detectorLegacy": "傳統的報酬與波動度門檻",
  "objectiveLab.fastRiskOffExit": "反彈時快速退出避險狀態（21 天）",
  "objectiveLab.fixedObjective": "固定目標",
  "objectiveLab.switchPolicy": "切換方案",
  "objectiveLab.benchmarkVsRegime": "基準 vs. 市場狀態",
  "objectiveLab.regimeScores": "市場狀態分數 vs. 現行狀態",
  "objectiveLab.hoverSyncHint":
    "將游標移到任一圖表上 — 兩者都會對齊到相同日期。",
  "objectiveLab.regimeTimeline": "市場狀態時間軸",
  "objectiveLab.off": "關",
  "objectiveLab.on": "開",
  "objectiveLab.predictionQualityTitle": "市場狀態預測品質（以區段為基礎）",
  "objectiveLab.predictionQualityDesc":
    "依各狀態區段的實際市場表現評分；僅供參考，不影響方案排名。",
  "objectiveLab.episodeAlignment": "區段一致度 {score}/100",
  "objectiveLab.grade": "等級 {grade}",
  "objectiveLab.episodes": "區段數",
  "objectiveLab.medianDays": "中位天數",
  "objectiveLab.avgReturn": "平均報酬",
  "objectiveLab.hitRate": "命中率",
  "objectiveLab.longestEpisodes": "最長區段",
  "objectiveLab.largestMisses": "最大誤判",
  "objectiveLab.missesLegend":
    "最大誤判：基準實際走勢與狀態判斷落差最大的區段。",
  "objectiveLab.secondaryForward": "次要：{days} 天前瞻（逐步）",
  "objectiveLab.stepLevelAlignment":
    "逐步一致度 {score}/100 —— 以相同的報酬規則套用於 {days} 天前瞻窗口；上方主要分數採用完整區段。",
  "objectiveLab.regimeSwitches": "市場狀態切換次數：{count}",
  "objectiveLab.isSharpe": "訓練期夏普",
  "objectiveLab.oosSharpe": "驗證期夏普",
  "objectiveLab.isReturn": "訓練期報酬",
  "objectiveLab.isMaxDd": "訓練期最大回撤",
  "objectiveLab.hit": "命中",
  "objectiveLab.miss": "誤判",
  "benchmarkChart.noSeries": "沒有可繪製的基準資料。",
  "benchmarkChart.noValidDates": "沒有可繪製的有效日期。",
  "benchmarkChart.cumPct": "{ticker} 累積 %",
  "benchmarkChart.footer":
    "上方：{ticker} 累積報酬（%）。陰影區帶顯示市場狀態；琥珀色條標示狀態切換。移動游標可與下方的市場狀態分數同步。",

  "regimeScore.noScores":
    "尚無市場狀態分數。請改用較新的偵測器，或拉長訓練期。",
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
  "institutional.noAnalytics": "沒有可用的詳細分析 — 請重新執行試算。",
  "institutional.monthlyInSample": "月報酬（訓練期{range}）",
  "institutional.monthlyFull": "月報酬",
  "institutional.annualInSample": "年報酬（訓練期{range}）",
  "institutional.annualFull": "年報酬",
  "institutional.annualRmHint":
    "投組各曆年報酬，為財富路徑規劃的樣本來源；極端年份會被壓縮處理（不超過樣本平均上限）。",
  "institutional.monthlyOosFrom": "月報酬（驗證期，自 {date} 起）",
  "institutional.monthlyOos": "月報酬（驗證期）",
  "institutional.annualOosFrom": "年報酬（驗證期，自 {date} 起）",
  "institutional.annualOos": "年報酬（驗證期）",
  "institutional.horizonTitle": "各期間績效（訓練期 / 驗證期 / 完整）",
  "institutional.horizon": "期間",
  "institutional.maxDd": "最大回撤",
  "institutional.rebalanceExecution": "再平衡執行",
  "institutional.freq": "頻率",
  "institutional.count": "次數",
  "institutional.sampleDates": "期間日期",
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
  "institutional.coreHoldingsNote":
    "這檔方案最倚重的標的——它們平常占投資組合多大比重，以及在每次再平衡中被持有的頻率高不高。",
  "institutional.avgWeight": "平均權重",
  "institutional.avgWeightHint":
    "在所有再平衡日期中，該標的平均占投資組合的比重。數字越高，代表它是越核心、越重要的持股。",
  "institutional.holdFrequency": "持有比例",
  "institutional.holdFrequencyHint":
    "該標的被持有的頻率（權重高於 0.5% 的再平衡日期占比）。100% 代表整段期間都持有。",
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
  "results.proRefinement": "Pro 最佳化",
  "results.meta.rounds": "共 {rounds} 輪優化，測試了 {trials} 種候選方案",
  "results.meta.convergedEarly": "已提前收斂（不再有明顯進步）",
  "results.meta.fullSearch": "已完成完整搜尋",
  "results.meta.search": "參數搜尋，測試了 {trials} 種候選方案",
  "results.meta.reported":
    "找到 {feasible} 個有效方案，已納入報告 {reported} 個",
  "results.meta.catalog": "（累計嘗試 {catalog} 個）",
  "results.meta.rebalance":
    "{freq}再平衡（預定的 {count} 次中實際套用 {applied} 次）",
  "results.meta.rebalanceSkipped":
    "（{skipped} 次略過 — 首次再平衡前需要更長的價格歷史）",
  "results.meta.rebalanceChartDownsampled":
    "持股圖表顯示 {total} 次再平衡快照中的 {shown} 次",
  "results.freq.weekly": "每週",
  "results.freq.monthly": "每月",
  "results.freq.quarterly": "每季",
  "results.freq.yearly": "每年",
  "results.freq.daily": "每日",
  "results.sort": "排序",
  "results.rankedOnInSample": "依訓練期排名",
  "results.gapInOut": "落差（訓練期 − 驗證期）",
  "results.winRate": "勝率",
  "results.avgTurnover": "平均換手率",
  "results.totalTurnover": "總換手率",
  "results.maxDdDays": "最大回撤天數",
  "results.var95": "VaR 95%（日）",
  "results.cvar95": "CVaR 95%（日）",
  "results.te": "追蹤誤差",
  "results.ir": "資訊比率",
  "results.horizonCompareTitle": "訓練期 / 驗證期 / 完整",
  "results.horizonMetricsHint": "各期間的關鍵指標。方案僅依訓練期挑選。",
  "results.metric": "指標",
  "results.gapObjectiveSharpe": "訓練期 − 驗證期落差：投資目標",
  "results.positiveInSampleStronger": "正值代表訓練期表現較強",
  "results.championLeaderboard": "排行榜 · 依訓練期為方案排名",
  "results.leaderboardTitleOutOfSample": "排行榜 · 依驗證期為方案排名",
  "results.leaderboardTitleFull": "排行榜 · 依完整期間為方案排名",
  "results.leaderboardTitleGap": "排行榜 · 依訓練期減驗證期落差為方案排名",
  "results.sortTableBy": "表格排序依據",
  "results.inSampleSelection": "訓練期（挑選）",
  "results.gapSelection": "落差（訓練期 − 驗證期）",
  "results.engine": "引擎",
  "results.warmStartExact":
    "以先前建議方案 {code} 為起點繼續優化（執行紀錄 {job}）",
  "results.warmStartFuzzy":
    "以先前建議方案 {code} 為起點繼續優化（執行紀錄 {job}；試算終點不同）",
  "results.warmStartImproved": "新建議方案超越既有基準",
  "results.warmStartKept": "既有建議方案仍具競爭力",
  "results.holdings": "持股",
  "results.cap": "上限",
  "results.weightChartMayListMore": "持股圖表可能會顯示跨再平衡的更多標的",
  "results.maxWeight": "最大權重",
  "results.runCap": "執行上限",
  "results.effective": "有效",
  "results.observed": "實際觀察",
  "results.selectionHint": "依訓練期挑選；驗證期作為實戰驗證",
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
  "results.champion": "建議方案",
  "results.needsFloorLegend": "⚠ 超過客戶回撤容忍線",
  "results.proposalSetTitle": "方案比較",
  "results.proposalLabel.recommended": "建議方案",
  "results.proposalLabel.defensive": "防禦型",
  "results.proposalLabel.growth": "成長型",
  "results.proposalLabel.alternative": "其他方案",
  "results.proposalLabel.anchor_close": "貼近基準",
  "results.proposalLabel.full_drift": "用滿客製化空間",
  "results.proposalLabel.theme": "主題表達",
  "results.needsTable.drawdown": "回撤底線",
  "results.needsTable.singleName": "單一部位上限",
  "results.needsTable.theme": "主題曝險上限",
  "results.needsTable.cash": "現金部位",
  "results.needsTable.income": "收益需求",
  "results.needsTable.mustInclude": "必納標的",
  "results.needsTable.drift": "客製化偏離",
  "results.needsMustIncludeFail": "最終組合缺少調整方案標的：{tickers}",
  "results.needsDriftFail": "相對基準組合偏離 {actual}（上限 {cap}）",
  "results.needsTable.pass": "通過",
  "results.needsTable.fail": "未達",
  "results.addToUniverseCta": "納入標的池並重新試算",
  "results.cashSleeveLabel": "現金",
  "results.cagrPct": "年化報酬 %",
  "results.maxDdPct": "最大回撤 %",
  "results.dynamicObjectives": "動態目標",
  "results.dynamicObjectivesHint":
    "市場狀態與現行目標已在下方的績效與持股圖表中以陰影標示。",
  "results.loadingTrajectory": "載入 {model} 中…",
  "results.walkForwardHint":
    "市場狀態與現行目標隨時間的變化，與績效及持股圖表對齊。",
  "results.proChampionScorePrefix": "Pro 優勝者依訓練期的",
  "results.comprehensiveScore": "綜合分數",
  "results.proChampionScoreFormula":
    "0.45×夏普 + 0.25×索提諾 + 0.20×(5×年化報酬) − 0.35×|最大回撤| − 0.10×換手率。",
  "results.dynamicScoreTitle": "動態綜合分數 —— 這就是排名依據",
  "results.dynamicScoreExplain":
    "在動態模式下，方案不是只看夏普或報酬來排名，而是用一個綜合分數排名，該分數同時衡量風險調整後報酬、成長、回撤與交易成本。因此建議方案（★）可能整體勝出，卻不一定在下方任一欄位都最高。",
  "results.championWhyTitle": "為什麼 ★ {code} 是建議方案",
  "results.championWhyHorizonNote":
    "★ 依訓練期表現選出（未開驗證時則依完整期間）；完整期間指標僅供參考。",
  "results.championWhyFallbackLead":
    "在投資目標「{objective}」下，{code} 於「{horizon}」挑選期間勝出（訓練期夏普 {sharpe}、年化 {cagr}、最大回撤 {mdd}）。完整期間：夏普 {fullSharpe}、年化 {fullCagr}。",
  "results.championWhyFallbackLeadFull":
    "在投資目標「{objective}」下，{code} 於完整期間勝出（夏普 {sharpe}、年化 {cagr}、最大回撤 {mdd}）。",
  "results.championWhyFallbackAlt":
    "次優 {alt} 在同一挑選期間分數較低（訓練期夏普 {altSharpe}、年化 {altCagr}），即使其完整期間夏普（{altFullSharpe}）看起來更高。",
  "results.championWhyFallbackAltFull":
    "相對於次優 {alt}（夏普 {altSharpe}、年化 {altCagr}）。",
  "results.championWhyPerfTitle": "績效為何勝出",
  "results.championWhyParamsTitle": "參數為何這樣設定",
  "results.championWhyParamsFallback":
    "本次沒有另外的 AI 參數說明。以下列出建議方案實際採用的關鍵引擎設定；可展開查看完整參數，以及與其他方案的差異。",
  "results.championWhyParamsConstrainedLead":
    "本次客製化在客戶既定的持倉標的池上，比較幾個具名優化情境（{styles}），而非大規模隨機搜尋。",
  "results.championWhyParamsConstrained.anchor_close":
    "建議方案採「{styleLabel}」參數：在允許的客製化空間內小幅調整，盡量貼近基準組合並兼顧優化目標。",
  "results.championWhyParamsConstrained.full_drift":
    "建議方案採「{styleLabel}」參數：在客製化上限內盡量推進優化目標，允許與基準組合有較大配置差異。",
  "results.championWhyParamsConstrained.defensive":
    "建議方案採「{styleLabel}」參數：偏重降低波動與回撤，在客製化空間內偏向穩健配置。",
  "results.championWhyParamsConstrained.theme":
    "建議方案採「{styleLabel}」參數：在客製化空間內納入必納／主題標的，讓調整方向更貼近客戶指定主題。",
  "results.championWhyParamsConstrainedDriftBoth":
    "實際客製化偏離約 {drift}（上限 {cap}）",
  "results.championWhyParamsConstrainedDriftOnly": "實際客製化偏離約 {drift}",
  "results.championWhyParamsConstrainedCapOnly": "客製化上限 {cap}",
  "results.championWhyParamsConstrainedAllocator": "配置引擎為「{allocator}」",
  "results.championWhyParamsConstrainedMetricsJoin": "；",
  "results.championWhyParamsConstrainedMetrics": "{metrics}。",
  "results.championHorizonInSample": "訓練期",
  "results.championHorizonFullSample": "完整期間",
  "results.anchorBenchmarkNote":
    "基準模型組合：{anchor}。績效比較代碼：{ticker}——圖表與該代碼的報酬比較，並非複製基準組合的每檔持股。",
  "results.anchorPortfolioBaselineNote":
    "比較基準：基準模型組合（{anchor}）的固定權重試算績效，而非僅市場代碼。",
  "results.championFullSharpe": "完整期間夏普",
  "results.championFullMaxDd": "完整期間最大回撤",
  "results.championFullCagr": "完整期間年化報酬",
  "results.leaderboardDynamicNote":
    "數值為各期間的動態綜合分數（越高越好）。建議方案（★）依挑選期間的目標排序（啟用驗證期時為訓練期）。驗證期／過擬合指標僅供參考，不會讓目標勝出者落敗。",
  "results.selectTrialHint": "選取上方的方案以查看其績效與持股。",
  "results.efficientFrontierHint":
    "藍點是 Jasper 嘗試過的方案；橘點是報告中列出的精選方案。",
  "results.annVol": "年化波動度（%）",
  "results.annReturn": "年化報酬（%）",
  "results.outputModel": "精選方案",
  "results.searchTrial": "已測試方案",
  "results.paramSamples": "已嘗試方案數",
  "results.outputModels": "精選方案",
  "results.universeFilter": "投資範圍篩選",
  "results.universeFilterHint": "其他資產類別不納入搜尋。",
  "results.targetNamesRegime": "目標標的（{regime} 狀態）",
  "results.targetNamesAi": "目標標的（來自 AI）",
  "results.targetCount": "目標檔數",
  "results.targetWeightPct": "目標權重 %",
  "results.actualClassWeights": "實際資產類別配置（持股）",
  "results.actualClassWeightsRegime": "實際配置（{regime} 再平衡期間平均）",
  "results.classBreakdownChampion":
    "顯示建議方案的資產類別配置 — 此方案只儲存了精簡版本。",
  "results.weightPct": "權重 %",
  "results.factorAttributionChampion":
    "顯示建議方案的因子拆解 — 此方案未儲存完整明細。",
  "results.noFactorAttribution": "沒有可用的因子拆解",
  "results.contribPct": "貢獻 %",
  "results.observations": "觀察筆數",
  "results.rebalanceCrossSections": "再平衡快照",
  "results.factorMetricLogic": "因子如何衡量",
  "results.noMetricLogic": "沒有可用的因子明細",
  "results.summaryOnlyModel":
    "此方案僅有摘要 — 沒有詳細持股或圖表。請挑選有完整報告的方案以深入了解。",
  "results.analyticsFallback":
    "滾動、曝險與報酬表格取自建議方案；標題指標則對應你選取的方案。",
  "results.aiParameterRationale": "AI 為何選擇這些設定",
  "results.generation": "世代",
  "results.noAiRationale": "本次執行沒有 AI 說明。",
  "results.fullRunConfig": "完整設定（JSON）",
  "results.audit.tabEngine": "引擎細節",
  "results.audit.tabAudit": "審計／原始資料",
  "results.audit.intro":
    "本次試算的審計軌跡——來自請求與結果的關鍵欄位與摘要。",
  "results.audit.runSummary": "執行摘要",
  "results.audit.runSummaryHint": "執行識別、區間、目標與建議方案",
  "results.audit.jobId": "工作 ID",
  "results.audit.period": "期間",
  "results.audit.objective": "目標函數",
  "results.audit.engine": "引擎",
  "results.audit.optimizationMode": "優化模式",
  "results.audit.dataSource": "資料來源",
  "results.audit.champion": "建議方案",
  "results.audit.scenario": "情境",
  "results.audit.backtestMode": "試算模式",
  "results.audit.request": "請求與約束",
  "results.audit.requestHint": "送出試算請求中的關鍵欄位",
  "results.audit.field": "欄位",
  "results.audit.value": "值",
  "results.audit.fullRequestJson": "完整請求 JSON",
  "results.audit.universe": "標的池與代碼",
  "results.audit.universeHint":
    "持倉、白名單、補充標的與基準——大型清單可篩選與分頁",
  "results.audit.benchmark": "基準",
  "results.audit.tradableCount": "可交易檔數",
  "results.audit.universeSize": "標的池大小",
  "results.audit.assetClasses": "資產類別",
  "results.audit.supplements": "補充標的",
  "results.audit.filterText": "標的篩選",
  "results.audit.tickerFilter": "代碼篩選",
  "results.audit.ticker": "代碼",
  "results.audit.role": "角色",
  "results.audit.roleHolding": "持倉",
  "results.audit.roleUniverse": "標的池",
  "results.audit.tickers": "標的",
  "results.audit.modelParams": "模型參數",
  "results.audit.modelParamsHint": "建議方案參數；若有 Pro 輪次／情境可展開",
  "results.audit.noParams": "此結果未含建議方案參數。",
  "results.audit.proRounds": "Pro 精煉輪次",
  "results.audit.round": "輪次",
  "results.audit.improved": "是否改善",
  "results.audit.trials": "試驗數",
  "results.audit.winner": "勝者",
  "results.audit.score": "分數",
  "results.audit.scenarios": "約束情境",
  "results.audit.yes": "是",
  "results.audit.no": "否",
  "results.audit.provenance": "市況資料來源",
  "results.audit.provenanceHint": "請求 vs 有效面板區間、暖機與排除項",
  "results.audit.rowsCols": "列 × 欄",
  "results.audit.requestedStart": "請求起始日",
  "results.audit.effectiveStart": "有效起始日",
  "results.audit.panelEnd": "面板結束日",
  "results.audit.warmupStart": "暖機下載起始",
  "results.audit.warmupCovers": "暖機覆蓋報告起始",
  "results.audit.excludedCount": "排除遲上市檔數",
  "results.audit.excludedListings": "排除代碼",
  "results.audit.noPricePanelNote":
    "完整價格明細未隨結果儲存；上方為資料來源摘要。",
  "results.audit.weights": "權重與再平衡",
  "results.audit.weightsHint": "建議方案最終權重與權重歷史摘要",
  "results.audit.weightPct": "權重",
  "results.audit.rebalanceCount": "再平衡次數",
  "results.audit.rebalanceSpan": "再平衡區間",
  "results.audit.date": "日期",
  "results.audit.holdingsCount": "持倉數",
  "results.audit.topHoldings": "主要持倉",
  "results.audit.rebalances": "再平衡",
  "results.audit.noWeightHistory":
    "此結果未含權重歷史。",
  "results.audit.performance": "績效證據",
  "results.audit.performanceHint": "核心指標與權益曲線（可篩選與分頁）",
  "results.audit.metric": "指標",
  "results.audit.dateFrom": "起",
  "results.audit.dateTo": "迄",
  "results.audit.equityValue": "權益",
  "results.audit.equitySeries": "權益序列",
  "results.audit.clientContext": "客戶／調整方案脈絡",
  "results.audit.clientContextHint": "已簽核調整方案審計與隨請求送出的客戶脈絡",
  "results.audit.clientRef": "客戶參照",
  "results.audit.anchorPortfolio": "基準組合",
  "results.audit.anchorJob": "基準試算",
  "results.audit.clientContextJson": "客戶脈絡（JSON）",
  "results.audit.overlayAuditJson": "調整方案審計 JSON",
  "results.audit.engineCapabilities": "本次使用的引擎能力",
  "results.audit.engineCapabilitiesHint":
    "本次非預設 stage 釘版、貢獻能力或能力缺口 — 僅供 RM 覆核。",
  "results.audit.engineLegacyNote":
    "此報告由重構前引擎產出（v0-legacy）。",
  "results.audit.stageCatalogVersion": "Stage catalog 版本",
  "results.audit.paramCatalogVersion": "Param catalog 版本",
  "results.audit.stageImplementations": "Stage 實作",
  "results.audit.capabilitiesUsed": "使用的能力",
  "results.audit.capabilityPendingSignoff": "待主管簽核",
  "results.audit.capabilityGaps": "能力缺口（本次調整方案）",
  "results.audit.fullNarrativeFacts": "完整摘要資料（JSON）",
  "results.manualAdjustment": "手動調整",
  "results.disclaimer": "僅供研究與教育用途 — 非投資建議。資料：",
  "results.chart.performanceComparison": "績效比較",
  "results.chart.trajectoryHoldings": "績效與持股",
  "results.chart.efficientFrontier": "風險 vs. 報酬（效率前緣）",
  "results.chart.aiClassQuotas": "AI 資產類別目標",
  "results.chart.factorAttribution": "因子歸因",
  "results.chart.latestAllocation": "目前配置",
  "results.chart.reproducibleParameters": "重現本次執行的設定",
  "report.group.summary": "重點摘要",
  "report.group.summaryHint": "AI 結論、建議方案與關鍵指標",
  "report.group.performance": "績效表現",
  "report.group.performanceHint": "各模型與基準的比較",
  "report.group.journey": "投資歷程",
  "report.group.journeyHint": "淨值成長與持股隨時間的變化",
  "report.group.holdings": "持股與風險",
  "report.group.holdingsHint": "投資組合的持股與資產類別配置",
  "report.group.strategy": "方案深入分析",
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
  "config.runOfflineHint": "分析服務目前離線，無法執行試算。請稍後再試。",
  "config.assetClassSyncHint":
    "你選取的資產類別與目標權重會保持同步 — 未納入的部分一律維持為零。",
  "config.enforceClassWeights": "強制落實資產類別目標配置",
  "config.enforceClassWeightsHint":
    "開啟後，債券／股票等目標權重（含各市場狀態配額）會直接約束最終持倉比重，而不只影響 Top-N 篩選名單。",
  "config.limitsHint":
    "上方的滑桿設定 Jasper 運作的上限。它會在每個上限內嘗試一系列數值，找出最符合你目標的設定。",
  "config.quantMode": "專家模式",
  "config.quantModeHint": "顯示進階投資組合工程控制項",
  "config.objectiveHint.dynamic":
    "依市場狀態自動切換防守／平衡／成長配置，並以綜合分數排名。若想以單一目標（如最大年化報酬）排名，請選該目標並開啟下方「隨市場狀態調整配置」。",
  "config.objectiveHint.default":
    "開啟保留資料後，方案會以訓練期排名；保留期與完整期間的結果僅供比較參考。",
  "config.regimeAdaptive": "隨市場狀態調整配置",
  "config.regimeAdaptiveHint.dynamic":
    "選擇「動態」目標時一律開啟：配置器會在每次再平衡依市場狀態（防守／平衡／成長）切換預設配置風格。",
  "config.regimeAdaptiveHint.on":
    "開啟：配置器會在每次再平衡依市場狀態（風險趨避／中性／風險偏好）切換預設風格，而上方選定的目標仍決定方案的排名方式。",
  "config.regimeAdaptiveHint.off":
    "關閉：所有市場狀態都套用同一套配置風格。開啟後，配置會隨市場狀態調整，同時仍以上方目標排名。",
  "config.customObjectivePlaceholder":
    "例如：先求低回撤，再求報酬，換手率維持適度",
  "config.customObjectiveHint": "Jasper 會把它轉化為可最佳化的目標。",
  "config.trialsHint.pro": "Pro 模式會依上方的輪次設定替你管理。",
  "config.trialsHint.standard":
    "要測試的方案數量；每個方案都由 AI 給出起始參數。報告顯示數量在下方設定。",
  "config.benchmarkLine": "基準：{benchmark} · 無風險利率：4%",
  // Constraints — advanced controls
  "config.advanced.title": "專家控制（選用）",
  "config.advanced.maxWeightNote":
    "單一檔上限搜尋最高不得超過 {pct}%（執行滑桿）。",
  "config.advanced.categorical": "選擇型",
  "config.advanced.factorIndicators": "訊號風格（每個訊號）",
  "config.advanced.search": "搜尋",
  "config.advanced.fixed": "固定",
  "config.advanced.off": "關閉",
  "config.advanced.searchHint": "AI 會考量所有選項；你的選擇只是起始偏好",
  "config.advanced.fixedHint": "此訊號的固定風格",
  // Optimization objectives (dropdown)
  "objective.dynamic": "動態 — 因應市場狀態",
  "objective.max_sharpe": "最佳風險調整後報酬",
  "objective.max_return": "最高總報酬",
  "objective.min_max_drawdown": "最小化波段最大回撤",
  "objective.max_sortino": "最佳下行風險調整後報酬",
  "objective.min_cvar": "控制尾端風險",
  "objective.risk_parity_erc": "平衡風險貢獻",
  "objective.max_diversification": "最大化分散程度",
  "objective.mean_variance_utility": "平衡報酬與風險",
  "objective.custom": "自訂目標",
  // Allocator modes (dropdown)
  "allocator.auto": "自動（交給 Jasper 決定）",
  "allocator.mean_variance": "報酬—風險平衡",
  "allocator.min_var": "最低波動",
  "allocator.risk_parity": "等風險貢獻",
  "allocator.max_diversification": "最大分散",
  // Factor indicators — factor name + friendly description
  "factorInd.mom_indicator.label": "動能",
  "factorInd.mom_indicator.hint": "報酬水準、風險調整後報酬，或 12-1 跳月動能",
  "factorInd.reversal_indicator.label": "反轉",
  "factorInd.reversal_indicator.hint": "短期反轉、距高點幅度，或 RSI 超賣",
  "factorInd.value_indicator.label": "價值",
  "factorInd.value_indicator.hint": "低於均線、區間相對便宜，或長期逆勢報酬",
  "factorInd.lowvol_indicator.label": "低波動",
  "factorInd.lowvol_indicator.hint":
    "總波動、下檔波動，或相對等權指數的低 Beta",
  "factorInd.trend_indicator.label": "趨勢",
  "factorInd.trend_indicator.hint": "價格對均線、均線斜率，或快慢均線交叉",
  "factorInd.drawdown_indicator.label": "回撤",
  "factorInd.drawdown_indicator.hint": "回撤深度、距前高時間，或痛苦指數",
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
  "factorOpt.ulcer_index": "痛苦指數",
  // Constraints — categorical labels
  "config.categorical.objective_mode": "投資目標",
  "config.categorical.allocator_mode": "組合引擎",
  "config.categorical.rebalance_freq": "再平衡頻率",
  // Constraints — advanced numeric control labels
  "config.control.subPrefix": "{label} 子組合",
  "config.control.lookback_days": "市場記憶（日）",
  "config.control.shrinkage": "雜訊過濾",
  "config.control.risk_aversion": "風險預算",
  "config.control.max_weight_actual": "單一檔上限（試驗）",
  "config.control.top_n_actual": "候選清單大小",
  "config.control.max_holdings_actual": "組合廣度",
  "config.control.factor_lookback_days": "訊號窗口（日）",
  "config.control.reversal_lookback_days": "均值回歸窗口（日）",
  "config.control.value_lookback_days": "價值訊號窗口（日）",
  "config.control.no_trade_tol": "再平衡門檻",
  "config.control.turnover_penalty_mult": "交易成本壓力",
  "config.control.max_turnover_actual": "每次檢視最大換手率",
  "config.control.customization_drift_actual": "客製化偏離",
  "config.control.w_mom": "動能訊號",
  "config.control.w_reversal": "反轉訊號",
  "config.control.w_value": "價值訊號",
  "config.control.w_lowvol": "低波動訊號",
  "config.control.w_trend": "趨勢訊號",
  "config.control.w_drawdown": "回撤品質訊號",
  "config.control.w_equity": "股票部位",
  "config.control.w_bond": "債券部位",
  "config.control.w_commodity": "商品部位",
  "config.control.w_real_estate": "REIT 部位",
  "config.control.w_alternative": "另類部位",
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
    "本期間中，投資組合報酬落後基準（{benchmark}）。下一輪可考慮擴大探索或調整方案。",
  "pro.banner.stats":
    "投資組合報酬 {portfolio} · 基準 {benchmark} · Alpha {alpha}",
  "pro.seed.regimeMatrix": "市場狀態預設（各狀態的組合引擎）",
  "pro.seed.regimeQuotas": "市場狀態子組合目標（各狀態的資產類別配置）",
  "pro.seed.assessment": "AI 績效評估",
  "pro.seed.strategy": "AI 最佳化方案",
  "pro.seed.roundSetup": "本輪設定（套用於本輪每一個方案）",
  "pro.seed.factorSearch": "訊號搜尋（Jasper 探索的範圍）",
  "pro.seed.fixed": "固定",
  "pro.prefix.improved": "本輪優勝者 — 取代了原本的領先方案",
  "pro.prefix.held": "原領先方案保留（進步幅度低於門檻）",
  "pro.prefix.body":
    "{label} — {status}。調整後分數 {score}，來自 {trials} 次試算、共 {models} 種模型。",

  // Pro rounds — parameter labels
  "pro.param.mode": "組合引擎",
  "pro.param.lookback_days": "市場記憶",
  "pro.param.shrinkage": "雜訊過濾",
  "pro.param.risk_aversion": "風險預算",
  "pro.param.max_weight_actual": "單一檔上限",
  "pro.param.top_n_actual": "候選清單大小",
  "pro.param.max_holdings_actual": "持股數",
  "pro.param.max_turnover_actual": "最大換手率",
  "pro.param.customization_drift_actual": "客製化空間",
  "pro.param.no_trade_tol": "再平衡門檻",
  "pro.param.turnover_penalty_mult": "交易成本壓力",
  "pro.param.rebalance_freq": "再平衡頻率",
  "pro.param.objective_mode": "投資目標",
  "pro.param.factor_lookback_days": "訊號窗口",
  "pro.param.reversal_lookback_days": "均值回歸窗口",
  "pro.param.value_lookback_days": "價值訊號窗口",
  "pro.param.w_mom": "動能訊號",
  "pro.param.w_reversal": "反轉訊號",
  "pro.param.w_value": "價值訊號",
  "pro.param.w_lowvol": "低波動訊號",
  "pro.param.w_trend": "趨勢訊號",
  "pro.param.w_drawdown": "回撤品質訊號",
  "pro.param.w_equity": "股票部位",
  "pro.param.w_bond": "債券部位",
  "pro.param.w_commodity": "商品部位",
  "pro.param.w_real_estate": "不動產部位",
  "pro.param.w_alternative": "另類部位",
  "pro.param.mom_indicator": "動能訊號",
  "pro.param.reversal_indicator": "反轉訊號",
  "pro.param.value_indicator": "價值訊號",
  "pro.param.lowvol_indicator": "低波動訊號",
  "pro.param.trend_indicator": "趨勢訊號",
  "pro.param.drawdown_indicator": "回撤品質訊號",
  // AI params disclosure (summary / expand / timeline)
  "params.summary.objective": "優化目標",
  "params.summary.allocator": "配置模式",
  "params.summary.holdings": "持股數",
  "params.summary.customization": "客製化空間",
  "params.summary.mustInclude": "必納標的",
  "params.summary.scenario": "情境",
  "pro.param.scenario_style": "情境風格",
  "params.expand.title": "本方案參數",
  "params.expand.diffHint":
    "僅顯示相對建議方案（{code}）的差異；相同列已隱藏。",
  "params.expand.identical": "與建議方案（{code}）引擎參數相同。",
  "params.expand.empty": "此方案沒有可顯示的參數。",
  "params.category.objective": "目標函數",
  "params.category.risk": "風險約束",
  "params.category.universe": "標的池與篩選",
  "params.category.allocation": "權重配置",
  "params.category.rebalance": "現金／再平衡",
  "params.category.other": "其他",
  "params.info.aria": "{param} 說明",
  "params.info.scenario_style":
    "此方案來自哪個具名客製化情境（貼近錨定、用滿漂移、防禦、或主題）。",
  "params.info.objective_mode":
    "這次回測追求的目標，例如最大夏普、最大報酬，或最小最大回撤。",
  "params.info.mode":
    "最終權重怎麼算：報酬—風險平衡、最低波動、等風險貢獻，或最大分散。",
  "params.info.allocator_mode":
    "最終權重怎麼算：報酬—風險平衡、最低波動、等風險貢獻，或最大分散。",
  "params.info.lookback_days":
    "用過去多少天的資料估計報酬與風險。越長越穩定，越短越靈敏。",
  "params.info.shrinkage":
    "把噪音大的相關性估計往保守方向收斂。0＝原始資料，1＝完全對角。",
  "params.info.risk_aversion":
    "均值變異模型裡的風險懲罰。數字越大越保守。",
  "params.info.max_weight_actual": "單一標的最多能佔投組多少。",
  "params.info.max_holdings_actual": "投組最多持有幾檔。",
  "params.info.top_n_actual":
    "因子篩選後，最多留下前幾名再進入權重配置。",
  "params.info.max_turnover_actual": "每次再平衡允許的最大換手上限。",
  "params.info.customization_drift_actual":
    "相對錨定投組允許偏離多少（0≈幾乎不動，1＝完全重組）。",
  "params.info.no_trade_tol":
    "權重變動小於這個門檻就不交易，減少微調成本。",
  "params.info.turnover_penalty_mult":
    "對換手的懲罰強度；越大越傾向少動。",
  "params.info.rebalance_freq":
    "多久重新調整一次投組（週／月／季／年）。",
  "params.info.factor_lookback_days": "多數因子訊號使用的回看窗口。",
  "params.info.reversal_lookback_days": "短期均值回歸訊號的回看窗口。",
  "params.info.value_lookback_days": "價值／評價訊號的回看窗口。",
  "params.info.w_mom": "動能因子權重：近期漲多的標的加分程度。",
  "params.info.w_reversal":
    "反轉因子權重：短期超跌／超漲後回檔的標的加分程度。",
  "params.info.w_value": "價值因子權重：評價偏低的標的加分程度。",
  "params.info.w_lowvol": "低波動因子權重：波動較小的標的加分程度。",
  "params.info.w_trend": "趨勢因子權重：中長期趨勢向上的標的加分程度。",
  "params.info.w_drawdown":
    "回撤品質因子權重：近期回撤較小的標的加分程度。",
  "params.info.w_income": "收益因子權重：配息／殖利率較高的標的加分程度。",
  "params.info.w_equity": "股票部位的目標權重。",
  "params.info.w_bond": "債券部位的目標權重。",
  "params.info.w_commodity": "商品部位的目標權重。",
  "params.info.w_real_estate": "不動產部位的目標權重。",
  "params.info.w_alternative": "另類部位的目標權重。",
  "params.info.mom_indicator": "動能訊號使用哪一種計算公式。",
  "params.info.reversal_indicator": "反轉訊號使用哪一種計算公式。",
  "params.info.value_indicator": "價值訊號使用哪一種計算公式。",
  "params.info.lowvol_indicator": "低波動訊號使用哪一種計算公式。",
  "params.info.trend_indicator": "趨勢訊號使用哪一種計算公式。",
  "params.info.drawdown_indicator": "回撤品質訊號使用哪一種計算公式。",
  "params.info.income_indicator": "收益訊號使用哪一種計算公式。",
  "params.timeline.title": "搜尋輪次時間軸",
  "params.timeline.hint":
    "Pro 多輪搜尋歷程：目標、關鍵參數變更、當輪冠軍與核心指標。",
  "params.timeline.improved": "有進步",
  "params.timeline.held": "維持",
  "params.timeline.trials": "{n} 次試算",
  "params.timeline.objective": "目標",
  "params.timeline.champion": "當輪冠軍",
  "params.timeline.score": "分數",
  "params.timeline.noParamChange": "相對上一輪無關鍵設定變更",
  // Institutional report — extended
  "institutional.loadingFor": "（{model}）",
  "institutional.through": "至 {date}",
  "institutional.horizonNote":
    "訓練期與驗證期是同一段連續試算的切片，並非各自獨立執行。",
  "institutional.gapNote":
    "訓練期 − 驗證期落差：投資目標 {objective}、夏普 {sharpe}（正值代表訓練期較強）。",
  "institutional.vsBenchmark": "vs {benchmark}",
  "institutional.rmCompactHint": "客戶溝通用的基準與資產配置重點",
  "institutional.benchmarkStaleNote":
    "以下 Beta、Alpha、IR 係以 {computed} 計算。請重新執行試算以更新為所選基準的指標。",
  "institutional.trackingErr": "追蹤誤差",
  "institutional.ir": "資訊比率",
  "institutional.metricHelpAria": "{metric} 代表什麼？",
  "institutional.betaHint":
    "投組相對基準的敏感度。接近 1 表示大致跟基準同向同幅度；大於 1 會放大市場波動；小於 1 通常較不受基準漲跌牽動。",
  "institutional.alphaHint":
    "在調整 Beta（市場曝險）之後的年化超額報酬。正值代表表現優於「僅靠市場曝險」所能解釋的部分。",
  "institutional.irHint":
    "相對基準的主動報酬 ÷ 追蹤誤差（年化）。愈高代表超額表現愈穩定，而不只是偶爾大幅偏離基準。",
  "institutional.upCapture": "上行捕捉",
  "institutional.downCapture": "下行捕捉",
  "institutional.riskPct": "風險 %",
  "institutional.rollingSharpe": "滾動夏普值（252 日）",
  "institutional.rollingVol": "滾動波動度（252 日）",
  "institutional.inSampleNote":
    "挑選與排名僅使用訓練期；下方各期間不含驗證期尾段。",
  "institutional.ddStart": "起始",
  "institutional.ddTrough": "谷底",
  "institutional.ddEnd": "結束",
  "institutional.ddDepth": "深度",
  "institutional.ddDays": "天數",
  // Anchor / benchmark personalization
  "anchor.title": "基準組合",
  "anchor.subtitle":
    "可選擇自家模型組合作為起點基準，或以現況持倉為基準、不參照任一模型。",
  "anchor.universeNote":
    "示範標的池：{count} 檔主流 ETF（SPY、IVV、QQQ、VTI、AGG 等）",
  "anchor.placeholderHoldingsHint": "含 ETF、共同基金與個股的自家模型配置",
  "anchor.currentHoldingsHint":
    "若本次只優化個股／衛星部位（非模型組合），請選「現況持倉（不參照模型）」。",
  "anchor.noModelBadge": "不參照模型",
  "anchor.selected": "已選基準",
  "anchor.continue": "下一步：描述客戶需求",
  "anchor.am": "資產管理人",
  "anchor.theme": "主題",
  "composition.title": "組成",
  "composition.view.assetClass": "資產類別",
  "composition.view.sector": "產業",
  "composition.view.region": "地區",
  "composition.other": "其他",
  "composition.empty": "沒有可顯示的持倉。",
  "composition.detailsExpand": "展開全部標的",
  "composition.detailsCollapse": "收合標的",
  "composition.holdingsUnit": "檔",
  // Overlay conversation step
  "overlay.skipToConfig": "略過 AI 需求摘要，直接進階設定",
  "overlay.continueToConfig": "前往試算設定",
  "overlay.contextSummaryTitle": "已確認的客製化內容",
  "overlay.contextSelectHint":
    "可自行勾選本次要客製化的群組，並選擇基準組合（起點）。",
  "overlay.contextGroups": "要客製化的群組",
  "overlay.contextGroupsFallback": "目前選擇會沿用現行客製化範圍。",
  "overlay.contextAnchor": "基準組合（起點）",
  "overlay.interpret.error.apiKeyMissing":
    "AI 解讀尚未開放——請管理者先到設定頁設定 AI API 金鑰。",
  "overlay.interpret.error.aiUnavailable":
    "需求解讀失敗，請再試一次。",
  "overlay.interpret.error.parseFailed":
    "需求解讀失敗，請再試一次。",
  "overlay.interpret.error.validationFailed":
    "需求解讀失敗，請再試一次。",
  "overlay.interpret.error.responseInvalid":
    "需求解讀失敗，請再試一次。",
  "overlay.interpret.error.generic": "需求解讀失敗，請再試一次或聯絡支援。",
  "overlay.chat.title": "客戶需求對話",
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
"overlay.thinking.label": "Jasper 正在分析客戶需求（約需 10–30 秒）…",
  "overlay.thinking.step1": "理解語意…",
  "overlay.thinking.step2": "提取風險取向與投資目標…",
  "overlay.thinking.step3": "比對可投資標的池…",
  "overlay.thinking.step4": "生成參考建議…",
  "overlay.proposedTickers.title": "建議參考標的（請選擇後加入）",
  "overlay.proposedTickers.all": "全選",
  "overlay.proposedTickers.none": "全不選",
  "overlay.proposedTickers.addSelected": "加入選取的 {count} 檔標的",
  "overlay.proposedTickers.confirmMessage": "已將 {tickers} 加入投資標的池。",
  "overlay.proposedTickers.skipNoAdds": "無新增標的",
  "overlay.proposedTickers.skipNoAddsMessage":
    "已確認：本次客製化不新增標的。",
  "overlay.proposedTickers.reviewRequired":
    "請先確認建議標的（或明確選擇「無新增標的」）後再簽核 Overlay。",
  "overlay.proposedTickers.emptyNeedsHint":
    "此 Overlay 的主題／袖套需要可投資標的。請確認下方建議，或確認無新增標的。",
  "overlay.asks.title": "客戶需求重點",
  "overlay.asks.softHint": "軟目標：結果會並列目標與實際值，未達標不視為失敗",
  "overlay.asks.summaryLabel": "需求摘要",
  "overlay.clarify.title": "待澄清問題",
  "overlay.clarify.clickHint": "點選問題即可在下方作答",
  "overlay.clarify.answerPlaceholder": "輸入回答…",
  "overlay.clarify.composerPending": "其他補充（選填）…",
  "overlay.clarify.answered": "已填",
  "overlay.clarify.sendHint": "填完後按下方送出；可只答部分問題",
  "overlay.clarify.send": "送出澄清回覆",
  "overlay.clarify.pickMany": "可多選",
  "overlay.clarify.pickOne": "請選一項",
  "overlay.clarify.selected": "已選：{labels}",
  "overlay.clarify.other": "其他…",
  "overlay.clarify.otherPlaceholder": "請輸入您的回答",
  "overlay.clarify.changeAnswer": "重選",
  "overlay.clarify.answeredReadonly": "已回答 · 唯讀",
  "overlay.clarify.questionProgress": "問題 {current} / {total}",
  "overlay.chat.summaryCard": "調整方案摘要",
  "overlay.chat.summaryCardCollapsed": "上一輪摘要 ▸",
  "overlay.driftHint.need":
    "此 Overlay 至少需要 {pct}% 客製化偏離（目前上限 {current}%）— 確認時將自動調升至 {suggested}%",
  "overlay.driftHint.ok": "偏離上限已足夠（需求 {pct}% ≤ 目前 {current}%）",
  "overlay.driftHint.supervisor":
    "建議值 {pct}% 超過 60%，需主管核准留痕",
  "overlay.driftHint.title": "偏離需求",
  "overlay.driftSync.raised":
    "已依 Overlay 需求將客製化偏離從 {from}% 自動調升至 {to}%。",
  "overlay.driftSync.raisedSupervisor":
    "已自動調升至 {to}%；超過 60%，需主管核准留痕。",
  "overlay.driftSync.sourceLine": "來源：{sources}",
  "overlay.clarify.sendCount": "送出 {count} 則回覆",
  "overlay.clarify.sendCountPlural": "送出 {count} 則回覆",
  "overlay.clarify.sending": "分析中…",
  "chat.speakerYou": "你：",
  "chat.speakerJasper": "Jasper：",
  "chat.speakerSystem": "系統：",
  // Base vs customized comparison
  "compare.title": "基準 vs 客製化配置",
  "compare.subtitle": "與上方權益曲線同一區間計算的績效並列比較。",
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
  "rm.step.backTo": "回到「{step}」",
  "rm.step.anchor": "選基準",
  "rm.step.overlay": "客戶需求",
  "rm.step.execute": "執行",
  "rm.step.report": "RM 報告",
  "rm.step.skipped": "已略過",
  "rm.run.title": "準備執行試算",
  "rm.run.subtitle":
    "請確認已簽核的客戶需求摘要，然後執行「基準 vs 客製化」雙軌試算。",
  "rm.run.clientNeeds": "客戶需求摘要",
  "rm.run.whatWillRun": "即將執行",
  "rm.run.period": "試算區間：{start} → {end}",
  "rm.run.dualTrack": "雙軌：基準重播 ＋ 客製化最佳化",
  "rm.run.singleTrackNoAnchor": "單軌：僅客製化（不對標基準投組）",
  "rm.run.skipAnchorCompare": "不對標基準投組",
  "rm.run.skipAnchorCompareHint":
    "現金部位客製化時可用。略過基準投組重播與雙軌對照報告；仍保留可投資標的與市場基準（如 SPY）供風險指標使用。",
  "rm.run.proSearchTitle": "Pro 最佳化",
  "rm.run.proSearchHint":
    "開啟 Pro 最佳化會進行 AI 多輪參數搜尋（建議方案–對照方案），通常需要更長時間。",
  "rm.run.proSearchOn": "Pro 最佳化：開啟（多輪 AI 搜尋）",
  "rm.run.proSearchOff":
    "Pro 最佳化：關閉（單輪試算，較快完成）",
  "rm.run.execute": "開始試算比較",
  "rm.run.showAdvanced": "進階設定",
  "rm.run.hideAdvanced": "收合進階設定",
  "rm.run.driftFloorMarker": "Overlay 最低需求 {pct}%",
  "rm.run.driftBelowFloorWarning":
    "目前上限 {current}% 低於 Overlay 最低需求 {pct}%——部分配置目標將無法完整達成。",
  "rm.run.driftLowerConfirmTitle": "確定要調降嗎？",
  "rm.run.driftLowerConfirmBody":
    "調降至 {to}% 將低於 Overlay 最低需求 {pct}%，部分配置目標會無法達成。",
  "rm.run.driftLowerConfirmOk": "確定調降",
  "rm.run.driftLowerConfirmCancel": "取消",
  "rm.run.driftSupervisorBadge": ">60% 需主管核准",
  "rm.universe.fixedTitle": "投資標的（已固定）",
  "rm.universe.fixedCount": "已固定 {n} 檔標的",
  "rm.universe.lockedTitle": "模型投組持倉（已鎖定）",
  "rm.universe.lockedHint":
    "基礎標的池鎖定為目標模型投組持倉；客戶需求僅可增刪特定標的，不會開啟完整基金池。",
  "rm.universe.lockedCount": "已鎖定 {n} 檔（模型持倉 ± 需求增刪）",
  "rm.report.title": "RM 客戶報告",
  "rm.report.subtitle": "客戶需求 → 約束兌現 → 建議投組",
  "rm.report.tabRm": "客戶報告",
  "rm.report.tabQuant": "引擎細節",
  "rm.report.tabAudit": "審計／原始資料",
  "rm.report.quantTabHint":
    "搜尋輪次、排行榜與因子診斷——供 RM 深挖，不是客戶會議主畫面。",
  "rm.report.heroEyebrow": "建議投組",
  "rm.report.heroTitle": "{code}{star}",
  "rm.report.heroHint": "本次試算的首選投組，相對「{anchor}」",
  "rm.report.heroEyebrowViewing": "檢視中 · {label}",
  "rm.report.needsTitle": "需求達成檢核",
  "rm.report.needsHint": "這次試算有沒有守住調整方案簽核的承諾？",
  "rm.report.askEvidenceTitle": "需求證據",
  "rm.report.askEvidenceHint": "每張簽核需求的目標 vs 實際——落差會如實呈現。",
  "rm.report.askEvidenceAllMet": "全部達標",
  "rm.report.askEvidenceGapsOk": "有落差——仍可接受",
  "rm.report.askEvidenceSoftNote":
    "需求為軟目標，未達標不影響試算完成；請以此對照表與客戶溝通。",
  "rm.report.askColTarget": "目標",
  "rm.report.askColActual": "實際",
  "rm.report.askStatus.met": "達標",
  "rm.report.askStatus.partial": "部分",
  "rm.report.askStatus.missed": "未達",
  "rm.report.askStatus.unknown": "—",
  "rm.report.needsOverallPass": "全部達標",
  "rm.report.needsOverallFail": "與簽核需求有落差",
  "rm.report.needsColConstraint": "承諾項目",
  "rm.report.needsColDetail": "實際／上限",
  "rm.report.needsColStatus": "狀態",
  "rm.report.needsDetailHint":
    "必納標的未達時，明細列出缺少代碼；通過時列出應納入清單。",
  "rm.report.expand": "展開",
  "rm.report.collapse": "收合",
  "rm.report.talkingCollapsedHint": "客戶會議可用的說明重點",
  "rm.report.executiveTitle": "執行摘要",
  "rm.report.executiveHint": "與客戶會議的關鍵重點",
  "rm.report.metricsSummary":
    "相對「{anchor}」：年化報酬 {cagrDelta}、最大回撤 {mddDelta}",
  "rm.report.noOverlaySummary": "依基準組合產出的客製化投資組合。",
  "rm.report.overlayTitle": "客戶需求摘要",
  "rm.report.overlayHint": "步驟 2 簽核的約束條件與客戶偏好",
  "rm.report.overlaySigned": "已簽核 · {date}",
  "rm.report.metricsTitle": "相對基準的關鍵指標",
  "rm.report.metricsHint": "綠燈代表該指標優於基準",
  "rm.report.holdingsTitle": "持股變化",
  "rm.report.holdingsHint": "相對基準組合的主要調整",
  "rm.report.holdingsPrecisionHint":
    "權重為期末配置（顯示至小數點後兩位）。接近等權通常代表單檔上限與持股數或類別配置不相容——請提高單檔上限、增加持股數，或放寬類別預算。",
  "rm.report.talkingTitle": "方案摘要",
  "rm.report.talkingLoading": "AI 正在撰寫方案摘要…",
  "rm.report.performanceFlag": "試算結果未達預期",
  "rm.report.rerun": "重新試算",
  "compliance.badgeCompact": "僅供內部審閱",
  "compliance.badgeDefault":
    "僅供內部審閱 — 非投資建議。客戶使用前須經主管批准。",
  "rm.report.disclaimerTitle": "合規與審閱聲明",
  "rm.report.disclaimerBody":
    "僅供 RM 內部審閱，不構成任何證券之買賣要約、推薦或招攬。所有數字均來自歷史模擬，並假設方案完全按模型執行；過去績效不代表未來表現。任何客戶面對面資料使用前，須經具適當授權之主管審核批准。",
  "rm.report.openQuant": "開啟引擎細節",
  "rm.report.revise": "修改客戶需求",
  "rm.report.candidateTitle": "候選模型",
  "rm.report.candidateHint": "切換客製化測試的候選模型；預設為領先模型。",
  "rm.report.candidateLabel": "檢視投組",
  "rm.report.candidateChampion": "★",
  "rm.quant.championWhyTitle": "為何選為建議方案",
  "rm.quant.championWhyCode": "建議方案：{code}",
  "proposal.ctaTitle": "Investment Proposal",
  "proposal.ctaHint": "將本次最推薦的投組產出為投資建議書",
  "proposal.generate": "產出投資建議書",
  "proposal.title": "投資建議書（草案）",
  "proposal.subtitle": "RM 內部草案 — 數字來自雙軌試算；對客前請審核",
  "proposal.print": "列印／另存為 PDF",
  "proposal.close": "關閉",
  "proposal.draftBanner":
    "僅為執行草案。Jasper 不下單。正式對客文件仍須 RM／合規審核。",
  "proposal.toc": "目錄 Contents",
  "proposal.cover.docTitle": "Investment Proposal",
  "proposal.cover.firm": "私人銀行 · RM Copilot",
  "proposal.cover.confidential": "機密 — 僅供指定收件人",
  "proposal.cover.clientFallback": "貴賓客戶",
  "proposal.cover.rmFallback": "理財經理",
  "proposal.cover.amountPending": "待確認",
  "proposal.cover.strategyLine":
    "基準組合：{am} · {theme}。建議路徑：{customized}。",
  "proposal.letter.dear": "親愛的 {client}：",
  "proposal.letter.thanks":
    "感謝與您討論約 {amount} 的投資配置，基準組合為 {strategy}。以下為建議組合與相關分析。",
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
  "proposal.field.horizonYears": "年期（調整方案）",
  "proposal.field.years": "{n} 年",
  "proposal.field.aum": "管理資產",
  "proposal.field.cash": "現金",
  "proposal.field.liquidity": "流動性需求",
  "proposal.field.overlayLiquidity": "流動性（調整方案）",
  "proposal.field.withinMonths": "{n} 個月內",
  "proposal.field.esg": "ESG 偏好",
  "proposal.field.objective": "投資目標",
  "proposal.field.marketStance": "市場觀點",
  "proposal.field.profile": "輪廓",
  "proposal.table.fund": "基金／ETF",
  "proposal.table.holding": "持倉",
  "proposal.table.pct": "配置比例",
  "proposal.table.amount": "金額配置",
  "proposal.table.total": "合計",
  "proposal.table.metric": "指標",
  "proposal.table.delta": "差異",
  "proposal.table.anchorPct": "基準組合 %",
  "proposal.table.customPct": "建議 %",
  "proposal.section.executive": "執行摘要 Executive Summary",
  "proposal.section.profile": "客戶輪廓與目標 Client Profile & Objectives",
  "proposal.section.current": "現況與持倉 Current Situation / Holdings",
  "proposal.section.strategy": "建議方案 Recommended Strategy",
  "proposal.section.allocation": "建議配置 Proposed Allocation",
  "proposal.section.rationale": "理由與話術 Rationale & Talking Points",
  "proposal.section.performance": "風險與績效示意 Risk & Performance",
  "proposal.section.implementation": "執行規劃 Implementation",
  "proposal.section.disclaimers": "免責與適配 Disclaimers & Suitability",
  "proposal.section.market": "市場脈絡與建議理由 Market Context & Rationale",
  "proposal.section.construction":
    "方案建構與約束 Strategy Construction & Constraints",
  "proposal.section.validation": "歷史模擬",
  "proposal.section.risk": "風險分析 Risk Analysis",
  "proposal.body.letterIntro":
    "本建議書為 {client} 之客製化 ETF 配置草案（參考規模 {amount}），以 {am} · {theme} 為基準模型組合。",
  "proposal.body.executive":
    "建議方向：將 {anchor} 客製化為 {customized}，並以雙軌試算驗證。",
  "proposal.body.metricsPending": "關鍵績效差異將於指標載入後顯示。",
  "proposal.body.profileFallback": "客戶偏好已於客製化調整流程確認。",
  "proposal.body.currentAnchor": "起點（基準模型組合）：{anchor}",
  "proposal.body.currentFootnote":
    "現況持倉截至 {asOf}。Demo 資料 — 非保管行正式進帳。",
  "proposal.body.market":
    "調整理由聚焦於從 {anchor} 移向 {customized}，並遵循已簽核客戶需求。",
  "proposal.body.strategyAnchor":
    "基準模型組合：{am} · {theme}（風險帶：{risk}）",
  "proposal.body.strategyCustomize":
    "客製化建議（{customized}）依已簽核調整方案約束，對基準組合（{anchor}）進行個人化，並以雙軌試算驗證。",
  "proposal.body.allocationFallback": "客製化持股將於權重解析後顯示。",
  "proposal.body.allocationFootnote":
    "權重來自客製化建議方案（或選定試驗）。金額為示意，依客戶現金／AUM 快照推估。",
  "proposal.body.constructionFallback":
    "模擬區間 {start} → {end}；目標 {objective}。客製化提示與排除條件仍適用。",
  "proposal.body.excludes": "排除標的：{tickers}",
  "proposal.body.objectiveLine": "投資目標：{objective}",
  "proposal.body.validationNote":
    "所有數字皆來自歷史資料試算，可追溯、可重現。過往績效並非未來表現之可靠指引。",
  "proposal.body.chartCaption":
    "雙軌淨值示意（均 rebase 至 100），區間 {start} → {end}。實際保單／帳戶價值將受費用、稅負與進出時點影響。",
  "proposal.body.riskMdd": "客製化最大回撤 {customized}，基準組合為 {anchor}。",
  "proposal.body.riskFallback": "請於量化分析分頁檢視回撤與集中度。",
  "proposal.body.implDca":
    "若顧慮一次性進場時機，可對股票部位採定期定額（DCA）分批布局。",
  "proposal.body.implRebalance":
    "再平衡依已簽核試算假設（{start} → {end}），除非銀行政策另有規定。",
  "proposal.body.implLiquidity":
    "全額投入前，請保留足以因應短期現金需求的流動性緩衝。",
  "proposal.body.implClientLiquidity": "客戶流動性備註：{note}",
  "proposal.body.impl1": "若流動性或市場衝擊敏感，可分批建倉。",
  "proposal.body.impl2": "對客前請確認費用、稅務與適配性（依機構規範）。",
  "proposal.body.impl3": "再平衡頻率依已簽核試算設定，除非另行修訂。",
  "proposal.body.signOffNote": "RM 簽核備註：{note}",
  "proposal.body.disclaimer1": "過往績效不代表未來結果。",
  "proposal.body.disclaimer2": "本草案僅供 RM 內部使用，待合規放行後再對客。",
  "proposal.body.disclaimerSuitability":
    "適配性、KYC 與產品核准仍為銀行可控流程；Jasper 不對法規適配出具認證。",
  "proposal.body.nextSteps":
    "下一步：RM 審閱 → 合規／適配檢查 → 客戶討論 → 執行指示（於 Jasper 外完成）。",
  "proposal.warning.pastPerformance": "警語：過往績效並非未來表現之可靠指引。",
  "proposal.warning.valueFluctuation":
    "警語：投資價值可升可跌，您可能損失部分或全部本金。",
  "proposal.warning.currency": "警語：報酬可能受匯率波動影響。",
  "proposal.warning.estimates": "警語：數字僅為估計／試算示意。",
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
    "本次設計目標為「{objective}」；客製化最大回撤為 {customized}，優於基準的 {anchor}（改善 {delta}）——以此說明目標確實反映在績效上。",
  "rm.talking.objective.max_sharpe":
    "本次設計目標為「{objective}」；客製化夏普比率為 {customized}，相對基準 {anchor}（{delta}）——強調風險調整後的效率提升。",
  "rm.talking.objective.max_return":
    "本次設計目標為「{objective}」；客製化年化報酬為 {customized}，相對基準 {anchor}（{delta}）——連結報酬結果與簽核目標。",
  "rm.talking.objective.generic":
    "投資目標：{objective}。相對基準的關鍵結果：{customized} vs {anchor}（{delta}）。",
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
    "提醒：以上為試算示意，僅供討論之用，並非投資建議；實際執行前請確認適合度與合規要求。",

  "progress.dual.anchor": "基準試算",
  "progress.dual.customized": "客製化試算",
  "nav.aria": "主導覽",
  "nav.menu": "開啟導覽選單",
  "nav.clients": "客戶",
  "nav.pool": "投資標的池",
  "nav.models": "模型組合",
  "nav.personalization": "客製化",
  "nav.settings": "後台設定",
  "nav.tools": "工具",
  "gaps.title": "能力缺口 backlog",
  "gaps.subtitle": "產品 backlog",
  "gaps.lead": "對話中偵測到的能力缺口，依 reuse_count 排序。",
  "gaps.empty": "尚無缺口工單。",
  "engineDocs.title": "引擎能力卡",
  "engineDocs.subtitle": "Stage cards",
  "engineDocs.lead": "由 stage registry 自動生成，設計上永不過時。",
  "settings.subtitle": "匯入與匯出",
  "settings.hint":
    "在此管理投資標的池與模型組合的 CSV。瀏覽與啟用請至各功能頁。",
  "settings.poolTitle": "投資標的池",
  "settings.validationUnavailable": "驗證服務暫不可用",
  "settings.validationUnavailableDetail": "驗證服務暫不可用：{message}",
  "settings.poolHint": "匯入或匯出全域商品清單 CSV。",
  "settings.modelsTitle": "模型組合",
  "settings.modelsHint": "匯入或匯出 AM 模型組合 CSV（每列一筆持倉）。",
  "clients.listTitle": "客戶儀表板",
  "clients.listSubtitle": "示範客戶",
  "clients.listHint": "選擇客戶檢視輪廓與持倉，再啟動投資組合客製化。",
  "clients.detailSubtitle": "客戶輪廓",
  "clients.backToList": "返回客戶列表",
  "clients.notFound": "找不到此客戶。",
  "clients.profile": "客戶輪廓",
  "clients.holdings": "現況持倉",
  "clients.aum": "管理資產",
  "clients.cash": "現金",
  "clients.clientId": "客戶編號",
  "clients.segment": "客戶類別",
  "clients.age": "年齡",
  "clients.risk": "風險屬性",
  "clients.horizon": "投資年期",
  "clients.rm": "負責理專",
  "clients.liquidity": "備註",
  "clients.asOf": "資料基準日",
  "clients.weight": "權重",
  "clients.amount": "投資金額",
  "clients.return": "累積報酬",
  "clients.return.cumulativeSub": "自進場日起",
  "clients.return.reportedFallback": "申報數值 — 此持倉暫無真實價格歷史。",
  "clients.investedAt": "投資日",
  "clients.cagr": "年化報酬",
  "clients.suggestedAnchor": "建議模型組合",
  "clients.launchCta": "為此客戶客製投組",
  "clients.launchScopeSummary": "將客製化 {count} 個群組・約 {pct}% AUM",
  "clients.noClientBanner":
    "尚未選擇客戶 — 建議從客戶儀表板開始，以便帶入持倉範圍。",
  "clients.noClientBannerCta": "前往客戶列表",
  "clients.contextBanner": "目前客戶：{name}",
  "clients.viewDashboard": "查看儀表板",
  "clients.esg": "ESG 偏好",
  "clients.ageUnit": " 歲",
  "clients.holding.cash": "現金",
  "clients.holding.cashMoneyMarket": "現金／貨幣市場",
  "clients.notePrefix": "備註：",
  "clients.upcomingEvents": "即將發生的事件提醒",
  "clients.chart.performance": "績效走勢",
  "clients.chart.allocation": "持股配置",
  "clients.chart.nav": "淨值",
  "clients.chart.return": "報酬率",
  "clients.chart.tf.1M": "1M",
  "clients.chart.tf.3M": "3M",
  "clients.chart.tf.6M": "6M",
  "clients.chart.tf.YTD": "YTD",
  "clients.chart.tf.1Y": "1Y",
  "clients.chart.tf.MAX": "全部",
  "clients.chart.alloc.individual": "個別標的",
  "clients.chart.alloc.portfolio": "投組",
  "clients.holdings.individual": "個股／衛星部位",
  "clients.holdings.cash": "現金",
  "clients.holdings.groupSubtotal": "小計",
  "clients.holdings.total": "總計",
  "clients.chart.includeGroups": "圖表納入範圍",
  "clients.chart.noGroupsSelected": "請至少勾選一個群組以顯示圖表。",
  "clients.chart.noPerformanceData":
    "此選取範圍沒有已申報的持倉報酬資料，無法繪製績效走勢圖。",
  "clients.chart.loadingPerformance": "正在載入真實價格歷史…",
  "clients.add": "新增",
  "clients.add.content": "內容",
  "clients.add.date": "日期",
  "clients.add.label": "說明",
  "clients.add.save": "儲存",
  "clients.add.cancel": "取消",
  "clients.add.notePlaceholder": "新增備註…",
  "clients.add.eventPlaceholder": "事件說明…",
  "clients.add.noEvents": "尚無即將發生的事件。",
  "clients.history.title": "客製化投組紀錄",
  "clients.history.record": "{count} 筆結果",
  "clients.history.records": "{count} 筆結果",
  "clients.history.empty": "為此客戶產生的客製化投組會顯示在這裡。",
  "clients.history.emptyCta": "開始客製化投組",
  "customization.confirmTitle": "確認範圍與基準",
  "customization.confirmHint": "已從客戶儀表板帶入。確認後繼續，或展開編輯。",
  "customization.confirmContinue": "確認並繼續",
  "customization.editScope": "編輯範圍與基準",
  "customization.collapseScope": "收合編輯",
  "customization.scopeGroupsLabel": "群組",
  "customization.scopeAnchorLabel": "基準",
  "customization.scopeNameLabel": "投組名稱",
  "rm.report.moreActions": "其他操作",
  "rm.report.moreActionsHint": "匯出、引擎細節或修改需求",
  "clients.history.open": "開啟",
  "clients.history.untitled": "客製化投組",
  "clients.goalSimCta": "財務目標模擬器",
  "goalSim.title": "財務目標模擬器",
  "goalSim.notesLabel": "理專筆記",
  "goalSim.notesPlaceholder":
    "例如：客戶預計 12 個月內購屋頭期款 150 萬美元、3 年後子女學費約 20 萬、預期報酬 5%、每年可再投入 12 萬…",
  "goalSim.extract": "AI 擷取到表單",
  "goalSim.extractReplaceAll": "全部取代（從筆記）",
  "goalSim.extractConfirmReplace":
    "要以 AI 擷取結果完全取代目標表與路徑假設嗎？手動修改將遺失。",
  "goalSim.extractMergeSummary":
    "已合併：更新 {updated} 個欄位、新增 {added} 筆目標、保留 {kept} 處手動修改",
  "goalSim.extracting": "擷取中…",
  "goalSim.extractFailed": "無法從筆記擷取目標。",
    "goalSim.source.ai": "AI",
"goalSim.rulesFallback": "規則推估",
  "goalSim.assumptionsTitle": "路徑假設",
  "goalSim.annualReturn": "預期年報酬（%）",
  "goalSim.annualContribution": "每年投入（USD）",
  "goalSim.annualContributionHint": "僅至退休開始前；退休後不再固定投入。",
  "goalSim.contributionGrowth": "投入成長率（%/年）",
  "goalSim.inflation": "目標通膨（%/年）",
  "goalSim.optimisticDelta": "樂觀報酬加碼（百分點）",
  "goalSim.conservativeDelta": "保守報酬減碼（百分點）",
  "goalSim.returnDefaults.loading": "正在依目前持倉推估報酬…",
  "goalSim.returnDefaults.realized":
    "報酬欄位已依客戶帳戶實際績效自動帶入，可自行覆寫。",
  "goalSim.returnDefaults.backcast":
    "已依目前持倉的歷史表現自動帶入，可自行調整。",
  "goalSim.returnDefaults.refresh": "重新帶入持倉績效推估",
  "goalSim.returnDefaults.unavailable": "暫無法取得持倉績效，維持手動預設值。",
  "goalSim.returnDefaults.retry": "重試推估",
  "goalSim.goalsTitle": "目標（時間軸）",
  "goalSim.addGoal": "新增目標",
  "goalSim.goalsEmpty": "尚無目標——可從筆記擷取或手動新增。",
  "goalSim.goalType": "類型",
  "goalSim.goalLabel": "名稱",
  "goalSim.goalAmount": "金額（USD）",
  "goalSim.goalAmountDownPayment": "頭期款／購屋現金（USD）",
  "goalSim.goalAmountAnnualSpend": "年生活費（USD／年）",
  "goalSim.retirementSpendYears": "退休後提領年數",
  "goalSim.retirementSpendHint": "約 {monthly}／月，自退休起按月提領",
  "goalSim.retirementLongevityHint":
    "（自動：平均壽命 {le} 歲 − 退休年齡 → {years} 年；男 78／女 85）",
  "goalSim.goalMonths": "幾個月內",
  "goalSim.goalPriority": "優先度（1–5）",
  "goalSim.removeGoal": "移除",
  "goalSim.mortgageTitle": "房貸（購屋後）",
  "goalSim.mortgageHint":
    "貸款本金為購屋價減頭期款；自購屋次月起按月攤還，自資產路徑扣減。",
  "goalSim.mortgageLoan": "本金 USD",
  "goalSim.mortgageRate": "利率 %/年",
  "goalSim.mortgageTermYears": "年期",
  "goalSim.mortgagePayment": "估計月付：{amount}",
  "goalSim.type.home": "購屋／房產",
  "goalSim.type.retirement": "退休",
  "goalSim.type.education": "教育",
  "goalSim.type.liquidity": "流動性",
  "goalSim.type.other": "其他",
  "goalSim.chartTitle": "資產路徑（多情境）",
  "goalSim.chartHorizon": "檢視期間",
  "goalSim.chartHorizon.months": "{n} 個月",
  "goalSim.chartHorizon.years": "{n} 年",
  "goalSim.chartHorizon.max": "完整路徑",
  "goalSim.axis.m": "{n}m",
  "goalSim.axis.y": "{n}年",
  "goalSim.timeLabel.years": "{y} 年（第 {m} 個月）",
  "goalSim.chart.mortgageMarker": "{name} · 房貸 {payment}/月",
  "goalSim.chart.mortgageShort": "{name} · 房貸",
  "goalSim.chart.mortgageEndMarker": "{name} · 房貸付清",
  "goalSim.chart.retirementMarker": "{name} · 月提領 {payment}",
  "goalSim.chart.retirementShort": "{name} · 退休",
  "goalSim.chart.tag.home": "購屋",
  "goalSim.chart.tag.retirement": "退休",
  "goalSim.chart.tag.mortgageEnd": "付清",
  "goalSim.chart.tag.inheritance": "遺產",
  "goalSim.chart.inheritanceMarker": "預估遺產 {amount}",
  "goalSim.chartEmpty": "請至少新增一筆含金額與時點的目標以產生路徑。",
  "goalSim.scenario.base": "基準",
  "goalSim.scenario.optimistic": "樂觀",
  "goalSim.scenario.conservative": "保守",
  "goalSim.monthLabel": "第 {n} 個月",
  "goalSim.endingWealth": "期末資產（基準）",
  "goalSim.inheritance": "預估遺產（基準）",
  "goalSim.inheritanceHint": "規劃用餘命至 {age} 歲（約 {years} 年）",
  "goalSim.totalShortfall": "累計缺口（基準）",
  "goalSim.totalMortgagePaid": "路徑上已付房貸（基準）",
  "goalSim.totalRetirementPaid": "路徑上退休提領（基準）",
  "goalSim.totalLivingPaid": "路徑上生活開銷（基準，退休前）",
  "goalSim.eventsTitle": "目標事件",
  "goalSim.eventCovered": "可支應",
  "goalSim.eventShortfall": "缺口 {amount}",
  "goalSim.eventMortgageStart": "{name} — 開始繳房貸（{payment}/月）",
  "goalSim.eventMortgageLoan": "貸款 {amount}",
  "goalSim.eventMortgageEnd": "{name} — 房貸付清",
  "goalSim.eventMortgageEndDone": "已付清",
  "goalSim.eventInheritance": "餘命終點 — 剩餘資產視為遺產",
  "goalSim.eventRetirementStart": "{name} — 開始月提領（{payment}/月）",
  "goalSim.eventRetirementTotal": "規劃總額約 {amount}",
  "goalSim.actionsTitle": "建議下一步",
  "goalSim.insightsTitle": "客製化優先課題",
  "goalSim.insightsSubtitle":
    "AI 依財富預估標出待解問題，下一步投資組合客製化會對準這些課題。",
  "goalSim.insightsLoading": "正在產生 AI 課題…",
  "goalSim.insightsFailed": "AI 課題暫時無法取得，請重試。",
  "goalSim.insightsRetry": "重試 AI",
  "goalSim.insightsTalkingPoint": "RM 話術：{text}",
  "goalSim.insightsSolveInNext": "客製化解法：{actions}",
  "goalSim.hook.liquidity_buffer": "提高流動性緩衝",
  "goalSim.hook.horizon": "對齊投資年期",
  "goalSim.hook.contribution": "調整投入／目標時點",
  "goalSim.hook.deployment": "分批部署資金",
  "goalSim.hook.min_drawdown": "降低最大回撤",
  "goalSim.hook.risk": "調整風險配置",
  "goalSim.hook.return": "提高預期報酬取向",
  "goalSim.hook.refine_risk": "釐清風險偏好",
  "goalSim.action.shortfall":
    "基準路徑出現資金缺口——可提高投入、拉長時程或調整目標。",
  "goalSim.action.onTrack": "在目前假設下，基準路徑可支應所列目標。",
  "goalSim.action.tuneAssumptions": "可調整上方報酬／投入／通膨區間做壓力測試。",
  "goalSim.action.customize": "將近端流動性與投資年期帶入客製化調整。",
  "goalSim.action.addressInsight": "處理「{title}」— {hooks}",
  "goalSim.action.customizeFromInsights":
    "將上述課題帶入客製化調整（流動性、優化目標與緩衝會預填）。",
  "goalSim.action.waitInsights": "建議等 AI 課題產出後再客製，或先僅帶入目標。",
  "goalSim.action.retryInsightsFirst": "請先重試 AI 課題，客製化才能對準發現。",
  "goalSim.handoffCta": "繼續投資組合客製化",
  "goalSim.handoffCtaFromInsights": "依上述課題客製投組",
  "goalCompare.title": "財務規劃路徑 — 改善前／客製後",
  "goalCompare.subtitle":
    "目標與支出時程與原本規劃相同。可在上方調整選定投組／目標模型；藍色路徑帶入該選擇的整體投資績效。",
  "goalCompare.portfolioLabel": "選定投組",
  "goalCompare.modelLabel": "目標模型",
  "goalCompare.confidence": "信心下限",
  "goalCompare.confidenceOption": "{pct}% 不低於…",
  "goalCompare.returnNote":
    "灰色虛線＝原本規劃（{before}）。藍色＝客製後（{customized} · {model}）基準 {after}，來源：{source}（{years} 年樣本極端值壓縮、不高於樣本平均 {ceiling}，波動 {vol}）。保守色帶≈歷史單年有 {conf}% 機率不低於 {floor}。",
  "goalCompare.returnSource.overall": "整體投資績效",
  "goalCompare.returnSource.cagrFallback": "標題年化報酬（尚無完整權益曲線）",
  "goalCompare.returnSource.realized": "客戶帳戶實際績效",
  "goalCompare.returnSource.backcast": "持倉歷史表現",
  "goalCompare.percentileNote":
    "年度報酬分布 — P10 {p10} · 中位數 {p50} · P90 {p90}。",
  "goalCompare.backcastProxyNote":
    "晚上市標的以同類別代理補齊：{tickers}（{months} 個月）。",
  "goalCompare.backcastUnavailable":
    "暫無法取得持倉歷史表現——改用投組試算結果。",
  "goalCompare.glideTitle": "建議逐步降低持股、提高現金",
  "goalCompare.glideBody":
    "客製後終點財富（{ending}）約為所列目標需求（{need}）的 {multiple} 倍，且無資金缺口。可考慮隨目標接近逐步提高現金部位、降低股票曝險，鎖定超額安全墊。",
  "goalCompare.endingWealth": "終點／遺產（完整路徑）",
  "goalCompare.endingWealthHint": "至餘命／完整投影終點。",
  "goalCompare.atGoalsHorizon": "目標期間財富",
  "goalCompare.atGoalsHorizonHint": "約至最後一筆目標／房貸／退休支出。",
  "goalCompare.totalShortfall": "資金缺口合計",
  "goalCompare.delta": "Δ {amount}",
  "goalCompare.shortfallImproved": "相對原本規劃，缺口已縮小。",
  "goalCompare.shortfallStillCovered": "兩條路徑皆可支應目標。",
  "goalCompare.shortfallNotImproved": "缺口尚未改善 — 可再修改調整方案或投入金額。",
  "goalCompare.series.before": "原本規劃",
  "goalCompare.series.after": "客製後（基準）",
  "goalCompare.series.afterOptimistic": "客製後（樂觀）",
  "goalCompare.series.afterConservative": "客製後（保守）",
  "goalCompare.axisYear": "Y{n}",
  "goalCompare.axisMonth": "M{n}",
  "goalCompare.monthLabel": "第 {n} 月",
  "goalCompare.timeLabel.years": "Y{y}（第 {m} 月）",
  "goalSegment.title": "AI 目標路徑 — 分段策略",
  "goalSegment.subtitle":
    "AI 將計畫切分為短／中／長期區間，並為每個區間指定一種策略。中位線以各區間自身的規劃報酬率（來自持倉試算或模型序列）逐月滾動；陰影帶為保守–樂觀範圍。",
  "goalSegment.loading": "AI 正在將目標分段…",
  "goalSegment.source.ai": "AI 分段",
  "goalSegment.source.rules": "規則推估",
  "goalSegment.segment.short": "短期",
  "goalSegment.segment.mid": "中期",
  "goalSegment.segment.long": "長期",
  "goalSegment.strategy.holdings": "目前持倉",
  "goalSegment.strategy.holdingsShort": "持倉",
  "goalSegment.card.returns": "基準 {base} · {floor} ~ {ceiling}",
  "goalSegment.card.goals": "{n} 個目標",
  "goalSegment.series.median": "中位路徑",
  "goalSegment.series.band": "P{lo}–P{hi} 區間帶",
  "goalSegment.bandNote":
    "陰影帶 = 各區間策略在所選信心水準下歷年報酬的 P{lo}–P{hi}；中位線 = 各區間基準報酬率。",
  "goalSegment.priorFallbackNote":
    "部分區間因無試算曲線，採用原計畫報酬率假設。",
  "customization.optimizeScopeTitle": "針對以下持倉部位做優化",
  "customization.optimizeScopeHint": "可調整本次客製化要納入的持倉群組。",
  "customization.multiModelNotice":
    "你勾選了多個模型組合，將一併客製化並形成同一個投資組合。若有不希望更動的模型，請取消勾選。",
  "customization.portfolioName": "投組名稱",
  "customization.portfolioNamePlaceholder": "為本次客製化投組命名",
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
  "pool.subtitle": "全域示範商品清單",
  "pool.countBadge": "已啟用 {enabled} / {total}",
  "pool.loadDemo": "載入示範 ETF",
  "pool.loadFull": "載入完整 ETF Universe",
  "pool.importCsv": "匯入 CSV",
  "pool.exportCsv": "匯出 CSV",
  "pool.importReport": "匯入：更新 {upserted} 筆，略過 {skipped} 筆",
  "pool.searchPlaceholder": "搜尋代碼或名稱…",
  "pool.filter.allClasses": "全部資產類別",
  "pool.filter.allRegions": "全部區域",
  "pool.filter.allProducts": "全部產品類型",
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
  "pool.product.stock": "個股",
  "pool.product.fund": "基金",
  "pool.product.cash": "現金",
  "pool.product.structured": "結構型",
  "pool.product.bond": "債券",
  "pool.product.other": "其他",
  "models.title": "模型組合",
  "models.subtitle": "自家模型目錄",
  "models.hint":
    "管理投資組合客製化用的模型組合。持股可混搭 ETF、共同基金與個股，且須在啟用的投資標的池內。CSV：portfolio_id, portfolio_name, asset_manager, am_id, theme, risk_profile, ticker, weight, benchmark_ticker, enabled。",
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
  "models.issuerHoldingsHint": "含 ETF、共同基金與個股的自家模型配置",
  "models.filter.am": "依資產管理人篩選",
  "models.filter.risk": "依風險篩選",
  "models.filter.theme": "依投資主題篩選",
  "models.filter.allAm": "全部資產管理人",
  "models.filter.allRisk": "全部風險等級",
  "models.filter.allThemes": "全部投資主題",
  "models.sort.label": "排序",
  "models.sort.name": "排序：名稱",
  "models.sort.issuer": "排序：發行機構",
  "models.sort.risk": "排序：風險",
  "models.sort.theme": "排序：投資主題",
  "models.empty": "沒有符合篩選條件的模型組合。",
  "anchor.poolConflicts":
    "有 {count} 組模型因標的池衝突而隱藏 — 請修正標的池或模型組合。",
  "anchor.empty": "沒有可選基準組合。請啟用成分皆在標的池中的模型組合。",
};

const ko: Dict = {
  // Header / shell
  "header.phase.scenario": "—",
  "header.phase.anchor": "기준 포트폴리오",
  "header.phase.overlay": "고객 니즈",
  "header.phase.constraints": "설정",
  "header.phase.running": "실행 중",
  "header.phase.results": "결과",
  "header.phase.export": "내보내기",
  "live.trial": "방안 {n}/{total}",
  "results.needsFloorTitle": "고객 하단선 점검",
  "results.needsFloorPass":
    "학습 구간 최대 낙폭 {actual}（허용선 {floor}）— 준수",
  "results.needsFloorFail":
    "학습 구간 최대 낙폭 {actual}（허용선 {floor}）— {breach} 초과",
  "header.apiOffline": "서비스 오프라인",
  "header.apiOfflineHint":
    "지금은 분석 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  "header.apiLinked": "분석 엔진 연결됨",
  "lang.label": "언어",
  "lang.aria": "언어",
  // Backtest history panel
  "history.title": "방안 기록",
  "history.refresh": "새로고침",
  "history.syncing": "동기화 중…",
  "history.apiOffline": "오프라인 — 로컬 결과 표시",
  "history.record": "결과 {count}개",
  "history.records": "결과 {count}개",
  "history.empty":
    "완료된 시뮬레이션가 여기에 표시됩니다. 한 번 실행해 시작해 보세요.",
  "history.load": "열기",
  "history.status.completed": "완료됨",
  "history.status.failed": "실패",
  "history.status.running": "실행 중",
  "history.status.queued": "대기 중",
  // Constraints / config form
  "config.title": "방안 설정",
  "config.subtitle":
    "아래에서 방안을 설정하세요. 포트폴리오 검토 시마다 Jasper가 가장 강한 종목을 추려낸 뒤, 위험과 수익의 균형을 맞춰 비중을 배분합니다.",
  "config.maxWeight": "종목별 최대 비중: {pct}%",
  "config.minWeight": "종목별 최소 비중: {pct}%",
  "config.minWeightHint":
    "이 비중보다 작은 종목은 검토 시마다 제외되고, 확보된 자금은 나머지 종목에 분산됩니다.",
  "config.maxTurnover": "검토 시 최대 회전율: {pct}%",
  "config.maxTurnoverHint":
    "Jasper가 포트폴리오 검토 시 거래할 수 있는 비율을 제한해 거래 비용을 억제합니다.",
  "config.customizationDrift": "맞춤화 여유(상한): {pct}%",
  "config.customizationDriftHint":
    "기준 모델에서 벗어날 수 있는 상한입니다(0% = 동일, 100% = 후보 유니버스 내 전면 재구성). 기본값은 AI가 이 범위 안에서 탐색하며, 슬라이더 값을 고정하려면 고급 파라미터에서 「맞춤화 편차」를 Fixed로 설정하세요.",
  "config.maxHoldings": "최대 보유 종목 수: {n}",
  "config.maxHoldingsHint":
    "100%÷종목당 상한보다 커야 합니다(상한 {pct}%일 때 최소 {min}종목). 그렇지 않으면 모든 종목이 상한에 걸려 등비로 붕괴합니다.",
  "config.topN": "후보 종목 수: {n}",
  "config.topNHint":
    "Jasper가 모든 후보의 순위를 매기고 상위 {n}개를 골라 포트폴리오를 구성합니다.",
  "config.objective": "투자 목표",
  "config.customObjective": "목표를 설명하세요",
  "config.start": "시작일",
  "config.startHint":
    "이 날짜 이전의 가격 데이터를 추가로 불러와, 첫날 비중이 임시 값이 아닌 실제 신호를 기반으로 정해집니다.",
  "config.end": "종료일",
  "config.trials": "탐색 깊이: 모델 {n}개",
  "config.topModels": "보고서 모델 수: {n}",
  "config.holdout":
    "최근 데이터를 검증용으로 보류(Jasper가 이전 구간에서 훈련한 뒤, 보지 않은 데이터로 결과를 확인합니다)",
  "config.inSampleRatio": "앞쪽 {pct}%로 훈련(나머지는 검증용으로 보류)",
  "config.fee": "거래 비용: {bps} bps",
  "config.rebalanceFreq": "포트폴리오 검토 주기",
  "config.rebalance.weekly": "매주(금요일)",
  "config.rebalance.monthly": "매월",
  "config.rebalance.quarterly": "분기별",
  "config.rebalance.yearly": "매년",
  "config.runStandard": "방안 테스트 실행",
  "config.runPro": "Pro 최적화 실행",
  "config.notifyEmail": "완료되면 이메일로 알림 (선택)",
  "config.notifyEmailPlaceholder": "you@example.com",
  "config.notifyEmailHint":
    "방안 테스트는 서버에서 실행되므로 이 탭을 닫아도 됩니다. 이메일을 입력하면 실행이 완료되거나 실패할 때 알려드립니다.",
  "config.notifyEmailSmtpDisabled":
    "이 서버에는 이메일(SMTP)이 설정되어 있지 않아 주소를 입력해도 알림을 받을 수 없습니다.",

  // Pro rounds tabs
  "pro.tabsHint":
    "각 탭은 한 라운드입니다: 현재 선두와 그 대조 방안들. ★는 라운드 우승자를 표시합니다. 카탈로그 탭에는 지금까지 시도한 모든 방안이 나열됩니다.",
  "pro.allRounds": "전체 라운드",
  "pro.roundChip": "{n}라운드",
  "pro.role.incoming": "현재 선두",
  "pro.role.challenger": "대조 방안",
  "pro.role.winner": "라운드 우승자",
  // Results dashboard
  "results.runObjectiveLabel": "이번 투자 목표",
  "results.title": "결과",
  "results.model": "모델",
  "results.fullNarrative": "전체 요약",
  "results.fullPeriod": "전체 기간",
  "results.rmChampionLine":
    "추천 방안 {model} · 샤프 {sharpe} · 연환산 수익 {cagr}",
  "results.refineHint": "클릭하면 조정 적용 · 더블클릭하면 적용 후 다시 실행.",
  "results.editConfig": "설정 편집",
  "results.belowBenchmarkTitle":
    "솔직한 평가: 이번 실행은 벤치마크를 밑돌았습니다",
  "results.belowBenchmarkBody":
    "이 기간 동안 선택한 목표에서 {benchmark}를 이긴 시뮬레이션이 하나도 없습니다. 이는 도구의 문제가 아니라 실제 결과입니다 — 처음부터 다시 시작할 필요 없이 이번 실행에서 계속 다듬을 수 있습니다: 신호, 제약, 유니버스 또는 목표를 조정한 뒤 다시 실행하세요.",
  "results.iterateFromHere": "조정 후 다시 실행",
  "results.continueRefinementTitle": "벤치마크 미달 — 탐색을 이어갈까요?",
  "results.continueRefinementBody":
    "이 기간 동안 선택한 목표에서 {benchmark}를 이긴 시뮬레이션이 없습니다. Pro 라운드를 추가하고, 이번 실행의 선도 모델·학습 기록·AI 맥락을 이어서 탐색할 수 있습니다.",
  "results.continueRefinementCta": "탐색 계속",
  "results.continueRefinementRunning": "이어서 실행 중…",
  "results.continueRefinementHint":
    "실행 기록 {job}… 의 선도 모델과 이전 라운드 기록을 유지합니다",
  "results.extraRoundsLabel": "추가 라운드",
  "results.extraTrialsPerRoundLabel": "라운드당 시뮬레이션 수(대조 방안)",
  "results.extraTrialsLabel": "확장 평가 방안 수",
  "results.continueFromRound": "{round}라운드부터 재개",
  "results.exportCsv": "CSV 내보내기",
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
  "common.inSample": "학습 구간",
  "common.outOfSample": "검증 구간",
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
  "proPanel.title": "Pro 최적화",
  "proPanel.desc.beforeDynamic":
    "Jasper가 현재 선두에 맞서 대조 방안들을 라운드별로 겨루게 합니다. AI는 이전에 효과적이었던 설정을 바탕으로 새 설정을 제안하고, 결과가 더 좋아지지 않을 때까지 다듬습니다.",
  "proPanel.dynamic": "동적",
  "proPanel.desc.afterDynamic":
    "목표는 시장 분위기(위험 회피, 중립, 위험 선호)별로 방안을 따로 조정하고, 상황이 바뀌면 알맞은 방안을 적용합니다.",
  "proPanel.estimationPrefix":
    "Pro 모드가 탐색 강도를 대신 관리합니다. 최대 약",
  "proPanel.estimationUnit": "회",
  "proPanel.estimationSuffix":
    " 시뮬레이션를 실행하며, 결과가 더 좋아지지 않으면 조기에 종료될 수 있습니다.",
  "proPanel.highTrialsWarning":
    "설정이 높을수록 훨씬 많은 시뮬레이션를 실행하고 시간이 더 걸립니다. 각 라운드는 하나의 AI 제안으로 탐색을 안내합니다.",
  "proPanel.round1Batch": "첫 라운드 방안 수",
  "proPanel.round1BatchHint": "첫 라운드에서 시도할 방안 수(3–100).",
  "proPanel.challengersPerRound": "라운드당 대조 방안 수",
  "proPanel.challengersPerRoundHint":
    "라운드마다 선두에 맞서 테스트할 새 방안 수(2–100).",
  "proPanel.maxRounds": "최대 라운드",
  "proPanel.maxRoundsHint": "첫 라운드를 포함해 실행할 최대 라운드 수(2–30).",
  "proPanel.patienceRounds": "조기 종료 허용 라운드",
  "proPanel.holdoutTip":
    "팁: 홀드아웃을 켜면 방안이 학습 구간 기준으로 순위가 매겨진 뒤, 보지 않은 데이터로 검증됩니다.",

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
  // Live progress messages (localized on the client from backend templates)
  "progress.msg.queued": "방안 테스트 대기 중입니다…",
  "progress.msg.queuedStatic": "기준 리플레이 대기 중입니다…",
  "progress.msg.queuedPro": "Pro 최적화 대기 중입니다…",
  "progress.msg.fetching": "시장 데이터를 가져오는 중, 최적화를 시작합니다…",
  "progress.msg.fetchingStatic": "기준 리플레이: 시장 데이터를 가져오는 중…",
  "progress.msg.staticSimulating":
    "기준 리플레이: 고정 비중 포트폴리오 시뮬레이션 중…",
  "progress.msg.fetchingPro":
    "Pro: 데이터를 가져오는 중, 반복 탐색을 시작합니다…",
  "progress.msg.complete": "방안 테스트 완료",
  "progress.msg.completePro": "Pro 최적화 완료",
  "progress.msg.loaded":
    "티커 {tickers}개, 거래일 {rows}일을 불러왔습니다. 리밸런싱마다 가장 강한 종목을 추린 뒤 비중을 배분합니다.",
  "progress.msg.loadedRegimeSuffix":
    " 국면 적응형: 리밸런싱마다 배분기 프리셋을 설정합니다.",
  "progress.msg.proHoldout":
    "Pro: 방안은 학습 구간 기준으로 순위가 매겨지며, 홀드아웃은 최종 검증에 사용됩니다…",
  "progress.msg.proLoop": "Pro: 대조 방안 라운드 실행 중(AI가 기록에서 학습)…",
  "progress.msg.startingAi":
    "AI 시작 — 방안 {trials}개의 초기 매개변수를 계획하는 중…",
  "progress.msg.aiDone":
    "AI 완료: 방안 {trials}개를 위한 초기안 세트 {used}개 — 시뮬레이션 시작…",
  "progress.msg.aiDoneCapped":
    "AI 완료: 방안 {trials}개를 위한 초기안 세트 {used}개(AI 상한 {cap}; 나머지 방안은 탐색만) — 시뮬레이션 시작…",
  "progress.msg.aiOff": "스마트 최적화 일시 불가 — 자동 탐색으로 전환…",
  "progress.msg.optuna": "방안 {trial}/{total}({scope})",
  "progress.msg.optunaBest":
    "방안 {trial}/{total}({scope}), 현재 최고 {label} {value}",
  "progress.msg.searchDone":
    "탐색 완료(실현 가능 {feasible}개) — 보고서용 상위 {top}개 정리 중…",
  "progress.msg.packaging": "보고서 정리 중: {inner}",
  "progress.msg.roundReport": "{round}라운드 보고서: {inner}",
  "progress.msg.proRound":
    "{round}/{max}라운드: {carry}, 대조 방안 {n}명 준비 중…",
  "progress.msg.roundOptuna": "{round}라운드 · 방안 {trial}/{total}({scope})",
  "progress.msg.roundOptunaBest":
    "{round}라운드 · 방안 {trial}/{total}({scope}), 이번 라운드 최고 {label} {value}",
  "progress.msg.roundAiLearning":
    "{round}라운드: AI가 더 약한 대조 방안 {n}명에게서 학습, 목표 점수 {score}…",
  "progress.msg.roundDone":
    "{round}라운드 완료: 이번 라운드 최고 {best}, 선두 {champ}(무개선 라운드 {streak}/{patience})",
  "progress.msg.roundDoneAlphaSuffix":
    " · 학습 구간 알파 vs {benchmark} {alpha}(벤치마크 미달)",
  "progress.msg.pkgFromCache": "{code} {label} 정리 중, ({rank}/{total})…",
  "progress.msg.pkgMetricsOnly": "{code} 지표만 정리 중({rank}/{total})…",
  "progress.msg.pkgNoCache":
    "{code} 정리 중({rank}/{total}): 차트 데이터 계산…",
  "progress.msg.pkgIsOos":
    "{code} 정리 중({rank}/{total}): 비중을 위해 전체 기간 시뮬레이션 1회…",
  "progress.msg.pkgIncomplete":
    "{code} 정리 중({rank}/{total}): 차트 시계열 보완({missing})…",
  "progress.msg.pkgTop": "풀에서 상위 {top}/{feasible}개 방안…",
  "progress.msg.scope.inSample": "학습 구간",
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
    "거시, 섹터 또는 리스크 전망을 설명하면 Jasper가 시뮬레이션할 수 있는 방안으로 바꿔 줍니다.",
  "customScenario.placeholder":
    "예: 미국 인플레이션 고착, 연준 고금리 장기화, 성장주 밸류에이션 압박 — 단기 채권과 방어주로 기울이기…",
  "customScenario.analyzing": "구성 중…",
  "customScenario.analyzeButton": "시나리오 구성",
  "customScenario.analysisFailed": "시나리오를 구성하지 못했습니다",
  "customScenario.analysisFailedRetry":
    "시나리오를 구성하지 못했습니다. 다시 시도해 주세요.",
  "assetFilter.assetClasses": "자산군",
  "assetFilter.selectedBase": "{total}개 ETF 중 {base}개 선택됨",
  "assetFilter.selectedCombined": "{total}개 ETF 중 {combined}개 선택됨",
  "assetFilter.layer1Intro": "투자할 자산군을 선택하세요({base}개 ETF).",
  "assetFilter.aiFilter": "AI 투자 검색",
  "assetFilter.clearAiFilter": "지우기",
  "assetFilter.layer1Hint":
    "선택한 자산군에서 포트폴리오가 자동으로 구성되고, 리밸런싱마다 조정됩니다.",
  "assetFilter.lockedAdded":
    "잠긴 모델 유니버스: 보유 종목 유지 및 {adds} 추가(명시적 심볼만).",
  "assetFilter.lockedUnchanged":
    "잠긴 모델 유니버스 변경 없음 — 추가할 티커(예: GLD)를 입력하거나 조정안 보충 종목을 사용하세요.",
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
  "assetFilter.guaranteedHint": "이 종목들은 항상 시뮬레이션에 포함됩니다.",
  "linkedChart.tooltipRegime": "국면",
  "linkedChart.tooltipActiveObjective": "활성 목표",
  "linkedChart.noHistory": "이 방안에는 성과나 보유 종목 기록이 없습니다.",
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
  "objectiveLab.oosSharpeDelta": "검증 구간 샤프 개선(전환 vs. 고정):",
  "objectiveLab.regimeDetector": "국면 감지기",
  "objectiveLab.detectorV2": "위험 선호와 위험 회피 신호를 가늠해 시장을 읽음",
  "objectiveLab.detectorLegacy": "기존 수익률·변동성 임계값",
  "objectiveLab.fastRiskOffExit":
    "반등 시 위험 회피에서 빠르게 빠져나오기(21일)",
  "objectiveLab.fixedObjective": "고정 목표",
  "objectiveLab.switchPolicy": "전환 방안",
  "objectiveLab.benchmarkVsRegime": "벤치마크 vs. 시장 국면",
  "objectiveLab.regimeScores": "국면 점수 vs. 활성 국면",
  "objectiveLab.hoverSyncHint":
    "두 차트 중 하나에 마우스를 올리면 둘 다 같은 날짜에 정렬됩니다.",
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
  "objectiveLab.isSharpe": "학습 구간 샤프",
  "objectiveLab.oosSharpe": "검증 구간 샤프",
  "objectiveLab.isReturn": "학습 구간 수익률",
  "objectiveLab.isMaxDd": "학습 구간 최대 낙폭",
  "objectiveLab.hit": "적중",
  "objectiveLab.miss": "오차",
  "benchmarkChart.noSeries": "차트로 그릴 벤치마크 데이터가 없습니다.",
  "benchmarkChart.noValidDates": "차트로 그릴 유효한 날짜가 없습니다.",
  "benchmarkChart.cumPct": "{ticker} 누적 %",
  "benchmarkChart.footer":
    "위: {ticker} 누적 수익률(%). 음영 띠는 시장 국면을 나타내고, 황색 띠는 국면 전환을 표시합니다. 마우스를 올리면 아래 국면 점수와 동기화됩니다.",

  "regimeScore.noScores":
    "아직 국면 점수가 없습니다. 최신 감지기를 사용하거나 학습 구간을 늘려 보세요.",
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
  "institutional.noAnalytics":
    "사용 가능한 상세 분석이 없습니다 — 시뮬레이션를 다시 실행해 주세요.",
  "institutional.monthlyInSample": "월별 수익률(학습 구간{range})",
  "institutional.monthlyFull": "월별 수익률",
  "institutional.annualInSample": "연간 수익률(학습 구간{range})",
  "institutional.annualFull": "연간 수익률",
  "institutional.annualRmHint":
    "포트폴리오 역년 수익률(목표 경로 계획 표본). 극단 연도가 winsorize·평균 상한으로 완화되는 outlier입니다.",
  "institutional.monthlyOosFrom": "월별 수익률(검증 구간, {date}부터)",
  "institutional.monthlyOos": "월별 수익률(검증 구간)",
  "institutional.annualOosFrom": "연간 수익률(검증 구간, {date}부터)",
  "institutional.annualOos": "연간 수익률(검증 구간)",
  "institutional.horizonTitle": "기간별 성과(학습 구간 / 검증 구간 / 전체)",
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
  "institutional.coreHoldingsNote":
    "이 방안이 가장 많이 활용한 종목입니다. 평소 포트폴리오에서 차지한 비중과 리밸런싱마다 얼마나 꾸준히 보유했는지를 보여줍니다.",
  "institutional.avgWeight": "평균 비중",
  "institutional.avgWeightHint":
    "모든 리밸런싱 시점에서 해당 종목이 포트폴리오에서 차지한 평균 비중. 높을수록 더 크고 핵심적인 포지션입니다.",
  "institutional.holdFrequency": "보유 비율",
  "institutional.holdFrequencyHint":
    "해당 종목을 보유한 빈도(비중이 0.5%를 넘은 리밸런싱 시점의 비율). 100%면 전체 기간 내내 보유했다는 뜻입니다.",
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
  "results.meta.rounds":
    "총 {rounds}회 개선 라운드, 후보 방안 {trials}개 테스트",
  "results.meta.convergedEarly": "조기에 수렴함 (추가 개선 없음)",
  "results.meta.fullSearch": "전체 탐색 완료",
  "results.meta.search": "파라미터 검색, 후보 방안 {trials}개 테스트",
  "results.meta.reported":
    "유효 방안 {feasible}개 발견, 보고서에 {reported}개 포함",
  "results.meta.catalog": "(총 {catalog}개 탐색)",
  "results.meta.rebalance":
    "{freq} 리밸런싱 (예정된 {count}회 중 {applied}회 적용)",
  "results.meta.rebalanceSkipped":
    "({skipped}회 건너뜀 — 첫 리밸런싱 전 더 긴 가격 이력 필요)",
  "results.meta.rebalanceChartDownsampled":
    "보유 차트에 {total}회 리밸런싱 스냅샷 중 {shown}회 표시",
  "results.freq.weekly": "매주",
  "results.freq.monthly": "매월",
  "results.freq.quarterly": "분기별",
  "results.freq.yearly": "매년",
  "results.freq.daily": "매일",
  "results.sort": "정렬",
  "results.rankedOnInSample": "학습 구간 기준 순위",
  "results.gapInOut": "격차(학습 구간 − 검증 구간)",
  "results.winRate": "승률",
  "results.avgTurnover": "평균 회전율",
  "results.totalTurnover": "총 회전율",
  "results.maxDdDays": "최대 낙폭 일수",
  "results.var95": "VaR 95%(일)",
  "results.cvar95": "CVaR 95%(일)",
  "results.te": "추적 오차",
  "results.ir": "정보 비율",
  "results.horizonCompareTitle": "학습 구간 / 검증 구간 / 전체",
  "results.horizonMetricsHint":
    "기간별 주요 지표. 방안은 학습 구간 기간으로만 선택됩니다.",
  "results.metric": "지표",
  "results.gapObjectiveSharpe": "학습 구간 − 검증 구간 격차: 투자 목표",
  "results.positiveInSampleStronger": "양수면 학습 구간이 더 강함을 의미",
  "results.championLeaderboard":
    "리더보드 · 학습 구간 기준으로 순위를 매긴 방안",
  "results.leaderboardTitleOutOfSample":
    "리더보드 · 검증 구간 기준으로 순위를 매긴 방안",
  "results.leaderboardTitleFull":
    "리더보드 · 전체 기간 기준으로 순위를 매긴 방안",
  "results.leaderboardTitleGap":
    "리더보드 · 학습 구간−검증 구간 격차로 순위를 매긴 방안",
  "results.sortTableBy": "표 정렬 기준",
  "results.inSampleSelection": "학습 구간(선택)",
  "results.gapSelection": "격차(학습 구간 − 검증 구간)",
  "results.engine": "엔진",
  "results.warmStartExact":
    "이전 추천 방안 {code}에서 최적화 재개 (실행 기록 {job})",
  "results.warmStartFuzzy":
    "이전 추천 방안 {code}에서 최적화 재개 (실행 기록 {job}; 기간 종료일 다름)",
  "results.warmStartImproved": "새 추천 방안이 캐시 기준을 상회",
  "results.warmStartKept": "캐시 추천 방안이 여전히 경쟁력 있음",
  "results.holdings": "보유 종목",
  "results.cap": "상한",
  "results.weightChartMayListMore":
    "보유 종목 차트에는 리밸런싱 전반에 걸쳐 더 많은 종목이 표시될 수 있음",
  "results.maxWeight": "최대 비중",
  "results.runCap": "실행 상한",
  "results.effective": "유효",
  "results.observed": "실측",
  "results.selectionHint": "학습 구간로 선택; 검증 구간은 실전 검증 역할",
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
  "results.champion": "추천 방안",
  "results.needsFloorLegend": "⚠ 고객 낙폭 허용선 초과",
  "results.proposalSetTitle": "방안 비교",
  "results.proposalLabel.recommended": "추천 방안",
  "results.proposalLabel.defensive": "방어형",
  "results.proposalLabel.growth": "성장형",
  "results.proposalLabel.alternative": "기타 방안",
  "results.proposalLabel.anchor_close": "앵커 근접",
  "results.proposalLabel.full_drift": "맞춤화 여유 최대",
  "results.proposalLabel.theme": "테마 표현",
  "results.needsTable.drawdown": "낙폭 하한",
  "results.needsTable.singleName": "단일 종목 상한",
  "results.needsTable.theme": "테마 노출 상한",
  "results.needsTable.cash": "현금 비중",
  "results.needsTable.income": "수익 수요",
  "results.needsTable.mustInclude": "필수 편입 종목",
  "results.needsTable.drift": "맞춤화 편차",
  "results.needsMustIncludeFail": "최종 포트폴리오에 없는 조정안 종목: {tickers}",
  "results.needsDriftFail": "앵커 대비 편차 {actual} (한도 {cap})",
  "results.needsTable.pass": "충족",
  "results.needsTable.fail": "미충족",
  "results.addToUniverseCta": "보유 종목을 후보 목록에 추가하고 재실행",
  "results.cashSleeveLabel": "현금",
  "results.cagrPct": "CAGR %",
  "results.maxDdPct": "최대 낙폭 %",
  "results.dynamicObjectives": "동적 목표",
  "results.dynamicObjectivesHint":
    "시장 국면과 활성 목표가 아래 성과 및 보유 종목 차트에 음영으로 표시됩니다.",
  "results.loadingTrajectory": "{model} 불러오는 중…",
  "results.walkForwardHint":
    "기간에 따른 시장 국면과 활성 목표로, 성과 및 보유 종목 차트와 정렬됩니다.",
  "results.proChampionScorePrefix": "Pro 우승자는 학습 구간 기준",
  "results.comprehensiveScore": "종합 점수",
  "results.proChampionScoreFormula":
    "0.45×샤프 + 0.25×소르티노 + 0.20×(5×CAGR) − 0.35×|최대 낙폭| − 0.10×회전율.",
  "results.dynamicScoreTitle": "동적 종합 점수 — 이것이 순위 기준입니다",
  "results.dynamicScoreExplain":
    "동적 모드에서는 샤프나 수익률만으로 순위를 매기지 않습니다. 위험조정수익, 성장, 낙폭, 거래비용을 결합한 하나의 종합 점수로 순위를 매깁니다. 그래서 추천 방안(★)은 아래의 어떤 단일 열에서도 1위가 아니면서 전체적으로 이길 수 있습니다.",
  "results.championWhyTitle": "★ {code}가 추천 방안인 이유",
  "results.championWhyHorizonNote":
    "★는 선정 구간(OOS 홀드아웃이 켜져 있으면 학습 구간, 아니면 전체 샘플)에서 골라집니다. 보고서 표의 전체 기간 지표는 다를 수 있으며, 더 높은 Full Sharpe가 학습 구간 투자 목표 승자를 밀어내지는 않습니다. 학습 구간/검증 구간 격차는 진단용입니다.",
  "results.championWhyFallbackLead":
    "투자 목표 “{objective}” 기준으로 {code}가 {horizon} 선정 구간에서 우승했습니다(IS 샤프 {sharpe}, CAGR {cagr}, 최대낙폭 {mdd}). 전체 기간: 샤프 {fullSharpe}, CAGR {fullCagr}.",
  "results.championWhyFallbackLeadFull":
    "투자 목표 “{objective}” 기준으로 {code}가 전체 샘플 구간에서 우승했습니다(샤프 {sharpe}, CAGR {cagr}, 최대낙폭 {mdd}).",
  "results.championWhyFallbackAlt":
    "차순위 {alt}는 같은 선정 구간에서 점수가 더 낮습니다(IS 샤프 {altSharpe}, CAGR {altCagr}). 전체 기간 샤프({altFullSharpe})가 더 높아 보여도 마찬가지입니다.",
  "results.championWhyFallbackAltFull":
    "차순위 {alt} 대비(샤프 {altSharpe}, CAGR {altCagr}).",
  "results.championWhyPerfTitle": "성과에서 이긴 이유",
  "results.championWhyParamsTitle": "파라미터가 이렇게 설정된 이유",
  "results.championWhyParamsFallback":
    "이번 실행에는 별도 AI 파라미터 설명이 없습니다. 아래는 추천 방안의 핵심 엔진 설정이며, 펼치면 전체 목록과 다른 방안과의 차이를 볼 수 있습니다.",
  "results.championWhyParamsConstrainedLead":
    "이번 맞춤화는 고객의 고정된 보유 유니버스에서 명명된 최적화 시나리오({styles})를 비교하며, 대규모 무작위 탐색은 하지 않습니다.",
  "results.championWhyParamsConstrained.anchor_close":
    "추천 방안은 「{styleLabel}」 설정을 사용합니다: 허용된 맞춤화 여유 안에서 소폭 조정해 기준 포트폴리오에 가깝게 유지합니다.",
  "results.championWhyParamsConstrained.full_drift":
    "추천 방안은 「{styleLabel}」 설정을 사용합니다: 맞춤화 한도 안에서 최적화 목표를 최대한 추진합니다.",
  "results.championWhyParamsConstrained.defensive":
    "추천 방안은 「{styleLabel}」 설정을 사용합니다: 변동성과 낙폭을 낮추는 방향으로 맞춤화 여유를 씁니다.",
  "results.championWhyParamsConstrained.theme":
    "추천 방안은 「{styleLabel}」 설정을 사용합니다: 필수/테마 종목을 반영해 고객이 지정한 방향에 맞춥니다.",
  "results.championWhyParamsConstrainedDriftBoth":
    "실제 맞춤화 편차 약 {drift}(한도 {cap})",
  "results.championWhyParamsConstrainedDriftOnly": "실제 맞춤화 편차 약 {drift}",
  "results.championWhyParamsConstrainedCapOnly": "맞춤화 한도 {cap}",
  "results.championWhyParamsConstrainedAllocator": "배분 엔진 「{allocator}」",
  "results.championWhyParamsConstrainedMetricsJoin": " · ",
  "results.championWhyParamsConstrainedMetrics": "({metrics}).",
  "results.championHorizonInSample": "학습 구간",
  "results.championHorizonFullSample": "전체 샘플",
  "results.anchorBenchmarkNote":
    "기준 모델 포트폴리오: {anchor}. 성과 벤치마크 티커(가격 시계열): {ticker} — 차트는 이 티커 수익률과 비교하며, 기준 구성 보유 종목을 그대로 복제하지는 않습니다.",
  "results.anchorPortfolioBaselineNote":
    "비교 기준선: 기준 모델 포트폴리오({anchor})의 정적 리플레이 성과이며, 시장 티커만 쓰지 않습니다.",
  "results.championFullSharpe": "전체 기간 샤프",
  "results.championFullMaxDd": "전체 기간 최대 낙폭",
  "results.championFullCagr": "전체 기간 CAGR",
  "results.leaderboardDynamicNote":
    "값은 각 기간의 동적 종합 점수입니다(높을수록 좋음). 추천 방안(★)은 선정 구간의 목표로 순위가 매겨집니다(OOS가 켜져 있으면 학습 구간). OOS/과적합 지표는 참고용이며 목표 승자를 강등하지 않습니다.",
  "results.selectTrialHint":
    "위에서 방안을 선택하면 성과와 보유 종목을 볼 수 있습니다.",
  "results.efficientFrontierHint":
    "파란 점은 Jasper가 시도한 방안이고, 주황 점은 보고서에 표시된 추천 방안입니다.",
  "results.annVol": "연 변동성(%)",
  "results.annReturn": "연 수익률(%)",
  "results.outputModel": "추천 방안",
  "results.searchTrial": "테스트한 방안",
  "results.paramSamples": "시도한 방안 수",
  "results.outputModels": "추천 방안",
  "results.universeFilter": "유니버스 필터",
  "results.universeFilterHint": "다른 자산군은 검색에서 제외됩니다.",
  "results.targetNamesRegime": "목표 종목({regime} 국면)",
  "results.targetNamesAi": "목표 종목(AI 제공)",
  "results.targetCount": "목표 종목 수",
  "results.targetWeightPct": "목표 비중 %",
  "results.actualClassWeights": "실제 자산군 구성(보유 종목)",
  "results.actualClassWeightsRegime": "실제 구성({regime} 리밸런싱 기간 평균)",
  "results.classBreakdownChampion":
    "추천 방안의 자산군 구성을 표시합니다 — 이 방안은 압축 버전만 저장했습니다.",
  "results.weightPct": "비중 %",
  "results.factorAttributionChampion":
    "추천 방안의 팩터 분해를 표시합니다 — 이 방안은 전체 세부 정보를 저장하지 않았습니다.",
  "results.noFactorAttribution": "사용 가능한 팩터 분해가 없습니다",
  "results.contribPct": "기여도 %",
  "results.observations": "관측치",
  "results.rebalanceCrossSections": "리밸런싱 스냅샷",
  "results.factorMetricLogic": "팩터를 어떻게 측정했는지",
  "results.noMetricLogic": "사용 가능한 팩터 세부 정보가 없습니다",
  "results.summaryOnlyModel":
    "이 방안은 요약만 있습니다 — 상세 보유 종목이나 차트가 없습니다. 더 살펴보려면 전체 보고서가 있는 방안을 선택하세요.",
  "results.analyticsFallback":
    "롤링·익스포저·수익률 표는 추천 방안에서 가져오며, 헤드라인 지표는 선택한 방안과 일치합니다.",
  "results.aiParameterRationale": "AI가 이 설정을 선택한 이유",
  "results.generation": "세대",
  "results.noAiRationale": "이번 실행에 대한 AI 설명이 없습니다.",
  "results.fullRunConfig": "전체 설정(JSON)",
  "results.audit.tabEngine": "엔진 상세",
  "results.audit.tabAudit": "감사 / 원본 데이터",
  "results.audit.intro":
    "이번 실행의 페이지 내 감사 기록 — 작업 요청·결과의 요약과 표입니다. 큰 시계열은 페이지네이션되며, 전체 다중 티커 가격 패널은 결과에 포함되지 않습니다.",
  "results.audit.runSummary": "실행 요약",
  "results.audit.runSummaryHint": "실행 ID, 기간, 목표, 추천 방안",
  "results.audit.jobId": "작업 ID",
  "results.audit.period": "기간",
  "results.audit.objective": "목표 함수",
  "results.audit.engine": "엔진",
  "results.audit.optimizationMode": "최적화 모드",
  "results.audit.dataSource": "데이터 소스",
  "results.audit.champion": "추천 방안",
  "results.audit.scenario": "시나리오",
  "results.audit.backtestMode": "시뮬레이션 모드",
  "results.audit.request": "요청 및 제약",
  "results.audit.requestHint": "제출된 시뮬레이션 요청의 주요 필드",
  "results.audit.field": "필드",
  "results.audit.value": "값",
  "results.audit.fullRequestJson": "전체 요청 JSON",
  "results.audit.universe": "유니버스 & 티커",
  "results.audit.universeHint":
    "보유·화이트리스트·보충 티커·벤치마크 — 큰 목록은 필터·페이지",
  "results.audit.benchmark": "벤치마크",
  "results.audit.tradableCount": "거래 가능 수",
  "results.audit.universeSize": "유니버스 크기",
  "results.audit.assetClasses": "자산 클래스",
  "results.audit.supplements": "보충 티커",
  "results.audit.filterText": "유니버스 필터",
  "results.audit.tickerFilter": "티커 필터",
  "results.audit.ticker": "티커",
  "results.audit.role": "역할",
  "results.audit.roleHolding": "보유",
  "results.audit.roleUniverse": "유니버스",
  "results.audit.tickers": "티커",
  "results.audit.modelParams": "모델 파라미터",
  "results.audit.modelParamsHint": "추천 방안 파라미터; Pro 라운드/시나리오가 있으면 펼침",
  "results.audit.noParams": "이 결과에 추천 방안 파라미터가 없습니다.",
  "results.audit.proRounds": "Pro 정밀화 라운드",
  "results.audit.round": "라운드",
  "results.audit.improved": "개선",
  "results.audit.trials": "트라이얼",
  "results.audit.winner": "승자",
  "results.audit.score": "점수",
  "results.audit.scenarios": "제약 시나리오",
  "results.audit.yes": "예",
  "results.audit.no": "아니오",
  "results.audit.provenance": "시세 데이터 출처",
  "results.audit.provenanceHint": "요청 vs 유효 패널 구간, 워밍업, 제외 항목",
  "results.audit.rowsCols": "행 × 열",
  "results.audit.requestedStart": "요청 시작일",
  "results.audit.effectiveStart": "유효 시작일",
  "results.audit.panelEnd": "패널 종료일",
  "results.audit.warmupStart": "워밍업 다운로드 시작",
  "results.audit.warmupCovers": "워밍업이 보고 시작을 덮음",
  "results.audit.excludedCount": "제외된 후상장 수",
  "results.audit.excludedListings": "제외 티커",
  "results.audit.noPricePanelNote":
    "전체 가격 내역은 결과에 저장되지 않으며, 위에는 데이터 출처 요약만 표시됩니다.",
  "results.audit.weights": "가중치 & 리밸런스",
  "results.audit.weightsHint": "추천 방안 최종 가중치 및 가중치 이력 요약",
  "results.audit.weightPct": "가중치",
  "results.audit.rebalanceCount": "리밸런스 횟수",
  "results.audit.rebalanceSpan": "리밸런스 구간",
  "results.audit.date": "날짜",
  "results.audit.holdingsCount": "보유 수",
  "results.audit.topHoldings": "상위 보유",
  "results.audit.rebalances": "리밸런스",
  "results.audit.noWeightHistory":
    "이 페이로드에 아직 가중치 이력이 없습니다(다른 곳에서 차트와 함께 지연 로드될 수 있음).",
  "results.audit.performance": "성과 증거",
  "results.audit.performanceHint": "핵심 지표와 자산 곡선(필터·페이지)",
  "results.audit.metric": "지표",
  "results.audit.dateFrom": "시작",
  "results.audit.dateTo": "종료",
  "results.audit.equityValue": "자산",
  "results.audit.equitySeries": "자산 시계열",
  "results.audit.clientContext": "고객 / 조정안 맥락",
  "results.audit.clientContextHint":
    "서명된 조정안 감사와 요청에 포함된 고객 맥락",
  "results.audit.clientRef": "고객 참조",
  "results.audit.anchorPortfolio": "앵커 포트폴리오",
  "results.audit.anchorJob": "앵커 작업",
  "results.audit.clientContextJson": "Client context (JSON)",
  "results.audit.overlayAuditJson": "조정안 감사 JSON",
  "results.audit.engineCapabilities": "이번 사용 엔진 능력",
  "results.audit.engineCapabilitiesHint":
    "이번 실행의 비기본 stage 핀, 기여 능력 또는 능력 갭 — RM 검토용.",
  "results.audit.engineLegacyNote":
    "이 보고서는 리팩터 이전 엔진(v0-legacy)에서 생성되었습니다.",
  "results.audit.stageCatalogVersion": "Stage catalog 버전",
  "results.audit.paramCatalogVersion": "Param catalog 버전",
  "results.audit.stageImplementations": "Stage 구현",
  "results.audit.capabilitiesUsed": "사용된 능력",
  "results.audit.capabilityPendingSignoff": "감독자 승인 대기",
  "results.audit.capabilityGaps": "능력 갭(이번 오버레이)",
  "results.audit.fullNarrativeFacts": "전체 요약 데이터(JSON)",
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
  "report.group.summaryHint": "AI 결론, 추천 방안 선택 및 주요 지표",
  "report.group.performance": "성과",
  "report.group.performanceHint": "벤치마크 대비 모델 비교",
  "report.group.journey": "포트폴리오 여정",
  "report.group.journeyHint": "자산 성장과 시간에 따른 보유 종목 변화",
  "report.group.holdings": "보유 종목 및 리스크",
  "report.group.holdingsHint": "포트폴리오 보유 종목과 자산군 구성",
  "report.group.strategy": "방안 심층 분석",
  "report.group.strategyHint": "위험/수익 트레이드오프와 팩터 요인",
  "report.group.institutional": "기관급 분석",
  "report.group.institutionalHint":
    "벤치마크, 익스포저, 롤링 리스크 및 드로다운",
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
    "지금은 분석 서비스가 오프라인이라 시뮬레이션를 실행할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  "config.assetClassSyncHint":
    "선택한 자산군과 목표 비중은 서로 동기화됩니다 — 포함하지 않은 항목은 0으로 유지됩니다.",
  "config.enforceClassWeights": "자산군 목표 비중 강제 적용",
  "config.enforceClassWeightsHint":
    "켜면 채권/주식 목표(국면별 할당 포함)가 Top-N 선정뿐 아니라 최종 비중까지 직접 반영됩니다.",
  "config.limitsHint":
    "위 슬라이더는 Jasper가 작동하는 상한을 설정합니다. 각 상한까지 다양한 값을 시도해 목표에 가장 잘 맞는 설정을 찾습니다.",
  "config.quantMode": "전문가 모드",
  "config.quantModeHint": "고급 포트폴리오 엔지니어링 컨트롤 표시",
  "config.objectiveHint.dynamic":
    "동적 모드는 시장 국면에 따라 포트폴리오를 조정합니다: 위험이 높으면 방어적으로, 여건이 강하면 성장 추구로, 그 사이에서는 균형을 맞춥니다. 추천 방안은 단일 지표가 아니라 하나의 종합 점수(위험조정 수익 + 성장 + 낙폭 + 거래비용)로 순위가 매겨집니다. 최대 CAGR 같은 단일 목표로 순위를 매기면서도 국면에 따라 전환하려면, 그 목표를 선택하고 아래의 '국면 적응형 배분'을 켜세요.",
  "config.objectiveHint.default":
    "홀드아웃을 켜면 방안이 학습 구간 기준으로 순위가 매겨지며, 홀드아웃과 전체 기간 결과는 비교용으로만 표시됩니다.",
  "config.regimeAdaptive": "국면 적응형 배분",
  "config.regimeAdaptiveHint.dynamic":
    "동적 목표에서는 항상 켜져 있습니다: 배분기가 리밸런스마다 시장 국면(방어 / 균형 / 성장)에 따라 프리셋을 전환합니다.",
  "config.regimeAdaptiveHint.on":
    "켜짐: 배분기가 리밸런스마다 시장 국면(위험 회피 / 중립 / 위험 선호)에 따라 프리셋을 전환하며, 위에서 선택한 목표는 여전히 방안 순위를 결정합니다.",
  "config.regimeAdaptiveHint.off":
    "꺼짐: 모든 시장 상황에서 하나의 배분 방식이 사용됩니다. 켜면 위의 순위 목표는 유지하면서 배분이 국면에 따라 조정됩니다.",
  "config.customObjectivePlaceholder":
    "예: 낙폭을 먼저 낮추고, 그다음 수익, 회전율은 적정 수준 유지",
  "config.customObjectiveHint":
    "Jasper가 이를 최적화할 수 있는 목표로 바꿔 줍니다.",
  "config.trialsHint.pro":
    "Pro 모드가 위의 라운드 설정을 사용해 대신 관리합니다.",
  "config.trialsHint.standard":
    "테스트할 방안 수. 표준 모드에서는 모든 트라이얼이 AI 생성 초기안를 사용합니다(랜덤 채우기 없음). 보고서 크기는 아래에서 설정하세요.",
  "config.benchmarkLine": "벤치마크: {benchmark} · 무위험 수익률: 4%",
  // Constraints — advanced controls
  "config.advanced.title": "전문가 설정(선택)",
  "config.advanced.maxWeightNote":
    "단일 종목 한도 탐색은 {pct}%를 초과할 수 없습니다(실행 슬라이더).",
  "config.advanced.categorical": "선택형",
  "config.advanced.factorIndicators": "신호 스타일(신호별)",
  "config.advanced.search": "탐색",
  "config.advanced.fixed": "고정",
  "config.advanced.off": "끄기",
  "config.advanced.searchHint":
    "AI가 모든 옵션을 고려하며, 선택한 값은 시작 선호도로만 사용됩니다",
  "config.advanced.fixedHint": "이 신호의 고정 스타일",
  // Optimization objectives (dropdown)
  "objective.dynamic": "동적 — 시장 국면에 적응",
  "objective.max_sharpe": "최고 위험 조정 수익",
  "objective.max_return": "최고 총 수익",
  "objective.min_max_drawdown": "최대 낙폭 최소화",
  "objective.max_sortino": "최고 하방 위험 조정 수익",
  "objective.min_cvar": "꼬리 위험 제한",
  "objective.risk_parity_erc": "위험 기여 균등화",
  "objective.max_diversification": "분산 효과 최대화",
  "objective.mean_variance_utility": "수익과 위험의 균형",
  "objective.custom": "사용자 지정 목표",
  // Allocator modes (dropdown)
  "allocator.auto": "자동(Jasper가 선택)",
  "allocator.mean_variance": "수익-위험 균형",
  "allocator.min_var": "최저 변동성",
  "allocator.risk_parity": "균등 위험 기여",
  "allocator.max_diversification": "최대 분산",
  // Factor indicators — factor name + friendly description
  "factorInd.mom_indicator.label": "모멘텀",
  "factorInd.mom_indicator.hint":
    "수익 수준, 변동성 조정 수익, 또는 12-1 스킵 모멘텀",
  "factorInd.reversal_indicator.label": "리버설",
  "factorInd.reversal_indicator.hint":
    "단기 반전, 고점 대비 하락폭, 또는 RSI 과매도",
  "factorInd.value_indicator.label": "가치",
  "factorInd.value_indicator.hint":
    "이동평균 하회, 구간 내 저평가, 또는 장기 역발상 수익",
  "factorInd.lowvol_indicator.label": "저변동성",
  "factorInd.lowvol_indicator.hint":
    "총 변동성, 하방 변동성, 또는 동일가중 지수 대비 저베타",
  "factorInd.trend_indicator.label": "추세",
  "factorInd.trend_indicator.hint":
    "가격 대비 이동평균, 이동평균 기울기, 또는 단·장기 이동평균 교차",
  "factorInd.drawdown_indicator.label": "낙폭",
  "factorInd.drawdown_indicator.hint":
    "낙폭 깊이, 고점 이후 경과, 또는 통증 지수",
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
  "factorOpt.ulcer_index": "통증 지수",
  // Constraints — categorical labels
  "config.categorical.objective_mode": "투자 목표",
  "config.categorical.allocator_mode": "포트폴리오 엔진",
  "config.categorical.rebalance_freq": "포트폴리오 검토 주기",
  // Constraints — advanced numeric control labels
  "config.control.subPrefix": "{label} 하위 포트폴리오",
  "config.control.lookback_days": "시장 기억(일)",
  "config.control.shrinkage": "노이즈 필터",
  "config.control.risk_aversion": "위험 예산",
  "config.control.max_weight_actual": "단일 종목 한도(시행)",
  "config.control.top_n_actual": "후보 종목 수",
  "config.control.max_holdings_actual": "포트폴리오 폭",
  "config.control.factor_lookback_days": "신호 기간(일)",
  "config.control.reversal_lookback_days": "평균 회귀 기간(일)",
  "config.control.value_lookback_days": "가치 신호 기간(일)",
  "config.control.no_trade_tol": "재검토 임계값",
  "config.control.turnover_penalty_mult": "거래 비용 압력",
  "config.control.max_turnover_actual": "검토 시 최대 회전율",
  "config.control.customization_drift_actual": "맞춤화 편차",
  "config.control.w_mom": "모멘텀 신호",
  "config.control.w_reversal": "리버설 신호",
  "config.control.w_value": "가치 신호",
  "config.control.w_lowvol": "저변동성 신호",
  "config.control.w_trend": "추세 신호",
  "config.control.w_drawdown": "낙폭 품질 신호",
  "config.control.w_equity": "주식 하위 포트폴리오",
  "config.control.w_bond": "채권 하위 포트폴리오",
  "config.control.w_commodity": "원자재 하위 포트폴리오",
  "config.control.w_real_estate": "REIT 하위 포트폴리오",
  "config.control.w_alternative": "대체 하위 포트폴리오",
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
    "이 표본에서 포트폴리오 수익률이 벤치마크({benchmark})를 밑돌았습니다. 다음 라운드에서는 탐색 범위를 넓히거나 방안을 조정해 보세요.",
  "pro.banner.stats":
    "포트폴리오 수익률 {portfolio} · 벤치마크 {benchmark} · 알파 {alpha}",
  "pro.seed.regimeMatrix": "시장 국면 프리셋(국면별 포트폴리오 엔진)",
  "pro.seed.regimeQuotas": "시장 국면 하위 포트폴리오 목표(국면별 자산군 구성)",
  "pro.seed.assessment": "AI 성과 평가",
  "pro.seed.strategy": "AI 최적화 방안",
  "pro.seed.roundSetup": "라운드 설정(이번 라운드의 모든 방안에 적용)",
  "pro.seed.factorSearch": "신호 탐색(Jasper가 탐색한 범위)",
  "pro.seed.fixed": "고정",
  "pro.prefix.improved": "라운드 우승자 — 기존 선두를 교체함",
  "pro.prefix.held": "기존 선두 유지(개선폭이 기준 미만)",
  "pro.prefix.body":
    "{label} — {status}. 조정 점수 {score}, 시뮬레이션 {trials}회 · 모델 {models}개.",

  // Pro rounds — parameter labels
  "pro.param.mode": "포트폴리오 엔진",
  "pro.param.lookback_days": "시장 기억",
  "pro.param.shrinkage": "노이즈 필터",
  "pro.param.risk_aversion": "위험 예산",
  "pro.param.max_weight_actual": "단일 종목 한도",
  "pro.param.top_n_actual": "후보 종목 수",
  "pro.param.max_holdings_actual": "보유 종목 수",
  "pro.param.max_turnover_actual": "최대 회전율",
  "pro.param.customization_drift_actual": "맞춤화 여유",
  "pro.param.no_trade_tol": "재검토 임계값",
  "pro.param.turnover_penalty_mult": "거래 비용 압력",
  "pro.param.rebalance_freq": "리밸런싱 주기",
  "pro.param.objective_mode": "투자 목표",
  "pro.param.factor_lookback_days": "신호 기간",
  "pro.param.reversal_lookback_days": "평균 회귀 기간",
  "pro.param.value_lookback_days": "가치 신호 기간",
  "pro.param.w_mom": "모멘텀 신호",
  "pro.param.w_reversal": "리버설 신호",
  "pro.param.w_value": "가치 신호",
  "pro.param.w_lowvol": "저변동성 신호",
  "pro.param.w_trend": "추세 신호",
  "pro.param.w_drawdown": "낙폭 품질 신호",
  "pro.param.w_equity": "주식 하위 포트폴리오",
  "pro.param.w_bond": "채권 하위 포트폴리오",
  "pro.param.w_commodity": "원자재 하위 포트폴리오",
  "pro.param.w_real_estate": "부동산 하위 포트폴리오",
  "pro.param.w_alternative": "대체 하위 포트폴리오",
  "pro.param.mom_indicator": "모멘텀 신호",
  "pro.param.reversal_indicator": "리버설 신호",
  "pro.param.value_indicator": "가치 신호",
  "pro.param.lowvol_indicator": "저변동성 신호",
  "pro.param.trend_indicator": "추세 신호",
  "pro.param.drawdown_indicator": "낙폭 품질 신호",
  // AI params disclosure (summary / expand / timeline)
  "params.summary.objective": "최적화 목표",
  "params.summary.allocator": "배분 모드",
  "params.summary.holdings": "보유 종목",
  "params.summary.customization": "맞춤화 여유",
  "params.summary.mustInclude": "필수 편입",
  "params.summary.scenario": "시나리오",
  "pro.param.scenario_style": "시나리오 스타일",
  "params.expand.title": "이 제안의 파라미터",
  "params.expand.diffHint":
    "권장안({code}) 대비 차이만 표시합니다. 동일한 행은 숨깁니다.",
  "params.expand.identical": "권장안({code})과 엔진 파라미터가 같습니다.",
  "params.expand.empty": "표시할 파라미터가 없습니다.",
  "params.category.objective": "목표 함수",
  "params.category.risk": "위험 제약",
  "params.category.universe": "유니버스·스크리닝",
  "params.category.allocation": "배분·가중치",
  "params.category.rebalance": "현금·리밸런싱",
  "params.category.other": "기타",
  "params.info.aria": "{param} 설명",
  "params.info.scenario_style":
    "이 제안이 나온 맞춤화 시나리오(앵커 근접, 전체 드리프트, 방어형, 테마).",
  "params.info.objective_mode":
    "이번 백테스트가 추구하는 목표 — 예: 최대 샤프, 최대 수익, 최대 낙폭 최소화.",
  "params.info.mode":
    "최종 비중 산출 방식: 수익–위험 균형, 최저 변동성, 균등 위험 기여, 최대 분산.",
  "params.info.allocator_mode":
    "최종 비중 산출 방식: 수익–위험 균형, 최저 변동성, 균등 위험 기여, 최대 분산.",
  "params.info.lookback_days":
    "수익·위험 추정에 쓰는 과거 거래일 수. 길수록 안정적, 짧을수록 민감.",
  "params.info.shrinkage":
    "노이즈가 큰 상관 추정치를 안전한 대각 쪽으로 당깁니다. 0=원자료, 1=완전 대각.",
  "params.info.risk_aversion":
    "평균–분산 모델의 위험 패널티. 클수록 더 방어적.",
  "params.info.max_weight_actual": "단일 종목이 차지할 수 있는 최대 비중.",
  "params.info.max_holdings_actual": "보유 가능한 최대 종목 수.",
  "params.info.top_n_actual":
    "팩터 스크리닝 후 비중 배분 전에 남기는 후보 종목 수.",
  "params.info.max_turnover_actual": "리밸런싱 시 허용되는 최대 회전율.",
  "params.info.customization_drift_actual":
    "앵커 포트폴리오에서 얼마나 벗어날 수 있는지(0≈유지, 1=전면 재구성).",
  "params.info.no_trade_tol":
    "이 임계값보다 작은 비중 변화는 거래하지 않아 미세 조정을 줄입니다.",
  "params.info.turnover_penalty_mult":
    "회전에 대한 추가 비용 압력. 클수록 거래를 줄이려 합니다.",
  "params.info.rebalance_freq":
    "포트폴리오 리밸런싱 주기(주/월/분기/년).",
  "params.info.factor_lookback_days": "대부분 팩터 신호에 쓰는 룩백 창.",
  "params.info.reversal_lookback_days": "단기 평균회귀 신호의 룩백 창.",
  "params.info.value_lookback_days": "가치/밸류에이션 신호의 룩백 창.",
  "params.info.w_mom": "모멘텀 가중치: 최근 상승 종목을 얼마나 선호할지.",
  "params.info.w_reversal":
    "반전 가중치: 단기 과매도/되돌림 종목을 얼마나 선호할지.",
  "params.info.w_value": "가치 가중치: 저평가 종목을 얼마나 선호할지.",
  "params.info.w_lowvol": "저변동성 가중치: 변동성이 낮은 종목을 얼마나 선호할지.",
  "params.info.w_trend": "추세 가중치: 중장기 상승 추세 종목을 얼마나 선호할지.",
  "params.info.w_drawdown":
    "낙폭 품질 가중치: 최근 낙폭이 작은 종목을 얼마나 선호할지.",
  "params.info.w_income": "수익 가중치: 배당/수익률이 높은 종목을 얼마나 선호할지.",
  "params.info.w_equity": "주식 슬리브 목표 비중.",
  "params.info.w_bond": "채권 슬리브 목표 비중.",
  "params.info.w_commodity": "원자재 슬리브 목표 비중.",
  "params.info.w_real_estate": "부동산 슬리브 목표 비중.",
  "params.info.w_alternative": "대안 슬리브 목표 비중.",
  "params.info.mom_indicator": "모멘텀 신호에 쓰는 계산식.",
  "params.info.reversal_indicator": "반전 신호에 쓰는 계산식.",
  "params.info.value_indicator": "가치 신호에 쓰는 계산식.",
  "params.info.lowvol_indicator": "저변동성 신호에 쓰는 계산식.",
  "params.info.trend_indicator": "추세 신호에 쓰는 계산식.",
  "params.info.drawdown_indicator": "낙폭 품질 신호에 쓰는 계산식.",
  "params.info.income_indicator": "수익 신호에 쓰는 계산식.",
  "params.timeline.title": "탐색 라운드 타임라인",
  "params.timeline.hint":
    "Pro 다라운드 탐색 경과 — 목표, 핵심 파라미터 변경, 라운드 추천 방안, 핵심 지표.",
  "params.timeline.improved": "개선",
  "params.timeline.held": "유지",
  "params.timeline.trials": "시험 {n}회",
  "params.timeline.objective": "목표",
  "params.timeline.champion": "라운드 추천 방안",
  "params.timeline.score": "점수",
  "params.timeline.noParamChange": "이전 라운드 대비 핵심 설정 변경 없음",
  // Institutional report — extended
  "institutional.loadingFor": "({model})",
  "institutional.through": "{date}까지",
  "institutional.horizonNote":
    "홀드아웃이 켜져 있으면 시뮬레이션 선택은 학습 구간을 사용합니다. 학습 구간과 검증 구간 행은 동일한 연속 전체 시뮬레이션의 구간이며, 각각 새로 시작한 별개의 실행이 아닙니다. 대시보드의 순위 샤프는 이 행들과 약간 다를 수 있습니다.",
  "institutional.gapNote":
    "학습 구간 − 검증 구간 격차: 투자 목표 {objective}, 샤프 {sharpe}(양수면 학습 구간이 더 강함).",
  "institutional.vsBenchmark": "vs {benchmark}",
  "institutional.rmCompactHint": "고객 설명용 벤치마크·배분 핵심",
  "institutional.benchmarkStaleNote":
    "아래 Beta·Alpha·IR은 {computed} 대비로 계산되었습니다. 선택한 기준 벤치마크로 갱신하려면 시뮬레이션를 다시 실행하세요.",
  "institutional.trackingErr": "추적 오차",
  "institutional.ir": "정보 비율",
  "institutional.metricHelpAria": "{metric}은(는) 무엇을 의미하나요?",
  "institutional.betaHint":
    "포트폴리오가 벤치마크와 얼마나 같이 움직이는지입니다. 1에 가까우면 추종, 1보다 크면 시장 변동을 확대, 작으면 보통 덜 민감합니다.",
  "institutional.alphaHint":
    "베타(시장 노출)를 조정한 뒤의 연환산 초과 수익입니다. 양수면 시장 노출만으로 설명되는 수준보다 더 벌었다는 뜻입니다.",
  "institutional.irHint":
    "벤치마크 대비 액티브 수익을 추적 오차로 나눈 값(연환산)입니다. 높을수록 경로가 벌어지는 정도 대비 초과 성과가 더 일관됩니다.",
  "institutional.upCapture": "상승 포착",
  "institutional.downCapture": "하락 포착",
  "institutional.riskPct": "위험 %",
  "institutional.rollingSharpe": "롤링 샤프(252일)",
  "institutional.rollingVol": "롤링 변동성(252일)",
  "institutional.inSampleNote":
    "선택과 순위는 학습 구간만 사용하며, 아래 기간은 검증 구간 구간을 제외합니다.",
  "institutional.ddStart": "시작",
  "institutional.ddTrough": "저점",
  "institutional.ddEnd": "종료",
  "institutional.ddDepth": "깊이",
  "institutional.ddDays": "일수",
  // Anchor / benchmark personalization
  "anchor.title": "기준 구성",
  "anchor.subtitle":
    "하우스 모델을 시작 벤치마크로 선택하거나, 모델을 참조하지 않고 현재 보유를 기준으로 하세요.",
  "anchor.universeNote":
    "데모 유니버스: 주요 ETF {count}개 (SPY, IVV, QQQ, VTI, AGG 등)",
  "anchor.placeholderHoldingsHint":
    "하우스 모델 카탈로그의 ETF·뮤추얼펀드·개별주 혼합",
  "anchor.currentHoldingsHint":
    "모델이 아닌 개별주/위성 구간만 최적화할 때는 「현재 보유(모델 미참조)」를 선택하세요.",
  "anchor.noModelBadge": "모델 미참조",
  "anchor.selected": "선택된 기준",
  "anchor.continue": "다음: 고객 니즈",
  "anchor.am": "자산운용사",
  "anchor.theme": "테마",
  "composition.title": "구성",
  "composition.view.assetClass": "자산군",
  "composition.view.sector": "섹터",
  "composition.view.region": "지역",
  "composition.other": "기타",
  "composition.empty": "표시할 보유 종목이 없습니다.",
  "composition.detailsExpand": "전체 종목 보기",
  "composition.detailsCollapse": "종목 숨기기",
  "composition.holdingsUnit": "종목",
  "overlay.skipToConfig": "AI 니즈 요약 건너뛰고 고급 설정으로",
  "overlay.continueToConfig": "시뮬레이션 설정으로",
  "overlay.contextSummaryTitle": "확정된 맞춤화 컨텍스트",
  "overlay.contextSelectHint":
    "맞춤화할 그룹을 직접 선택하고 기준 구성(출발점)을 고르세요.",
  "overlay.contextGroups": "맞춤화할 그룹",
  "overlay.contextGroupsFallback": "현재 선택은 활성 범위를 그대로 사용합니다.",
  "overlay.contextAnchor": "기준 구성(출발점)",
  "overlay.interpret.error.apiKeyMissing":
    "AI 해석을 사용할 수 없습니다 — 관리자가 설정에서 AI API 키를 설정해야 합니다.",
  "overlay.interpret.error.aiUnavailable":
    "요구사항 해석에 실패했습니다. 다시 시도해 주세요.",
  "overlay.interpret.error.parseFailed":
    "요구사항 해석에 실패했습니다. 다시 시도해 주세요.",
  "overlay.interpret.error.validationFailed":
    "요구사항 해석에 실패했습니다. 다시 시도해 주세요.",
  "overlay.interpret.error.responseInvalid":
    "요구사항 해석에 실패했습니다. 다시 시도해 주세요.",
  "overlay.interpret.error.generic":
    "요구사항 해석에 실패했습니다. 다시 시도해 주세요.",
  "overlay.chat.title": "고객 니즈 대화",
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
"overlay.thinking.label":
    "Jasper가 고객 니즈를 분석 중입니다(보통 10–30초 소요)…",
  "overlay.thinking.step1": "의도 파악 중…",
  "overlay.thinking.step2": "리스크 성향과 목표 추출 중…",
  "overlay.thinking.step3": "투자 유니버스 대조 중…",
  "overlay.thinking.step4": "참고 제안 생성 중…",
  "overlay.proposedTickers.title": "제안 종목 (선택 후 추가)",
  "overlay.proposedTickers.all": "모두 선택",
  "overlay.proposedTickers.none": "선택 해제",
  "overlay.proposedTickers.addSelected": "선택한 {count}개 종목 추가",
  "overlay.proposedTickers.confirmMessage":
    "{tickers} 종목을 유니버스에 추가했습니다.",
  "overlay.proposedTickers.skipNoAdds": "추가 종목 없음",
  "overlay.proposedTickers.skipNoAddsMessage":
    "확인함: 이번 맞춤화에 신규 종목을 추가하지 않습니다.",
  "overlay.proposedTickers.reviewRequired":
    "서명 전에 제안 종목을 확인하거나「추가 종목 없음」을 선택하세요.",
  "overlay.proposedTickers.emptyNeedsHint":
    "이 오버레이의 테마/슬리브에는 투자 가능 종목이 필요합니다. 아래 제안을 확인하거나 추가 없음을 인정하세요.",
  "overlay.asks.title": "고객 요구사항 핵심",
  "overlay.asks.softHint":
    "소프트 목표 — 엔진이 시도하며, 결과에 목표 대비 실적 표시",
  "overlay.asks.summaryLabel": "요구사항 요약",
  "overlay.clarify.title": "확인 질문",
  "overlay.clarify.clickHint": "질문을 클릭해 바로 답하세요",
  "overlay.clarify.answerPlaceholder": "답변을 입력하세요…",
  "overlay.clarify.composerPending": "추가 메모(선택)…",
  "overlay.clarify.answered": "작성됨",
  "overlay.clarify.sendHint":
    "작성한 뒤 아래 보내기를 누르세요. 일부만 답해도 됩니다",
  "overlay.clarify.send": "확인 답변 보내기",
  "overlay.clarify.pickMany": "복수 선택",
  "overlay.clarify.pickOne": "하나 선택",
  "overlay.clarify.selected": "선택: {labels}",
  "overlay.clarify.other": "기타…",
  "overlay.clarify.otherPlaceholder": "답변을 입력하세요",
  "overlay.clarify.changeAnswer": "다시 선택",
  "overlay.clarify.answeredReadonly": "답변 완료 · 읽기 전용",
  "overlay.clarify.questionProgress": "질문 {current} / {total}",
  "overlay.chat.summaryCard": "조정 요약",
  "overlay.chat.summaryCardCollapsed": "이전 요약 ▸",
  "overlay.driftHint.need":
    "이 오버레이는 맞춤화 편차가 최소 {pct}% 필요합니다(현재 상한 {current}%) — 확인 시 {suggested}%로 자동 상향됩니다",
  "overlay.driftHint.ok":
    "편차 상한이 충분합니다(필요 {pct}% ≤ 현재 {current}%)",
  "overlay.driftHint.supervisor":
    "권장값 {pct}%가 60%를 초과하여 관리자 승인이 기록됩니다",
  "overlay.driftHint.title": "편차 요구량",
  "overlay.driftSync.raised":
    "오버레이에 맞춰 맞춤화 편차가 {from}%에서 {to}%로 자동 상향되었습니다.",
  "overlay.driftSync.raisedSupervisor":
    "{to}%로 자동 상향되었으며, 60% 초과로 관리자 승인이 기록됩니다.",
  "overlay.driftSync.sourceLine": "출처: {sources}",
  "overlay.clarify.sendCount": "답변 {count}개 보내기",
  "overlay.clarify.sendCountPlural": "답변 {count}개 보내기",
  "overlay.clarify.sending": "분석 중…",
  "chat.speakerYou": "나:",
  "chat.speakerJasper": "Jasper:",
  "chat.speakerSystem": "시스템:",
  "compare.title": "기준 vs 맞춤 구성",
  "compare.subtitle": "위 자산 곡선과 동일한 구간의 성과 비교.",
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
  "rm.step.backTo": "{step}(으)로 돌아가기",
  "rm.step.anchor": "기준 선택",
  "rm.step.overlay": "고객 니즈",
  "rm.step.execute": "실행",
  "rm.step.report": "RM 보고서",
  "rm.step.skipped": "건너뜀",
  "rm.run.title": "시뮬레이션 실행 준비",
  "rm.run.subtitle":
    "서명된 고객 조정안을 확인한 뒤 기준 vs 맞춤 이중 시뮬레이션를 실행하세요.",
  "rm.run.clientNeeds": "고객 니즈 요약",
  "rm.run.whatWillRun": "실행 내용",
  "rm.run.period": "기간: {start} → {end}",
  "rm.run.dualTrack": "이중: 기준 재현 + 맞춤 최적화",
  "rm.run.singleTrackNoAnchor":
    "단일: 맞춤 실행만 (기준 포트폴리오 대비 생략)",
  "rm.run.skipAnchorCompare": "기준 포트폴리오 대비하지 않음",
  "rm.run.skipAnchorCompareHint":
    "현금 슬리브 맞춤화 시 사용. 기준 재현과 이중 비교 보고서를 건너뛰며, 투자 가능 종목과 시장 벤치마크(예: SPY)는 위험 지표용으로 유지합니다.",
  "rm.run.proSearchTitle": "Pro 최적화",
  "rm.run.proSearchHint":
    "Pro 최적화를 켜면 AI 다중 라운드 파라미터 탐색(추천 방안–챌린저)이 실행되며, 보통 더 오래 걸립니다.",
  "rm.run.proSearchOn": "Pro 최적화: ON (다중 라운드 AI 탐색)",
  "rm.run.proSearchOff":
    "Pro 최적화: OFF (단일 라운드 — 더 빠르게 완료)",
  "rm.run.execute": "시산 비교 시작",
  "rm.run.showAdvanced": "고급 설정",
  "rm.run.hideAdvanced": "고급 설정 숨기기",
  "rm.run.driftFloorMarker": "오버레이 최소 요구 {pct}%",
  "rm.run.driftBelowFloorWarning":
    "현재 상한 {current}%가 오버레이 최소 {pct}%보다 낮아 일부 배분 목표를 완전히 충족할 수 없습니다.",
  "rm.run.driftLowerConfirmTitle": "낮추시겠습니까?",
  "rm.run.driftLowerConfirmBody":
    "{to}%로 낮추면 오버레이 최소 {pct}%보다 낮아 일부 목표를 달성할 수 없습니다.",
  "rm.run.driftLowerConfirmOk": "낮추기",
  "rm.run.driftLowerConfirmCancel": "취소",
  "rm.run.driftSupervisorBadge": "60% 초과 관리자 승인 필요",
  "rm.universe.fixedTitle": "투자 유니버스 (고정됨)",
  "rm.universe.fixedCount": "{n}개 종목 고정",
  "rm.universe.lockedTitle": "모델 포트폴리오 보유종목 (잠금)",
  "rm.universe.lockedHint":
    "기본 유니버스는 목표 모델 포트폴리오 보유종목입니다. 고객 요건은 특정 종목만 추가/제거할 수 있으며 전체 펀드 풀을 열지 않습니다.",
  "rm.universe.lockedCount": "모델 보유 ± 요건 기준 {n}개 종목 잠금",
  "rm.report.title": "RM 고객 보고서",
  "rm.report.subtitle": "고객 니즈 → 제약 이행 → 권장 포트폴리오",
  "rm.report.tabRm": "고객 보고서",
  "rm.report.tabQuant": "엔진 상세",
  "rm.report.tabAudit": "감사 / 원본 데이터",
  "rm.report.quantTabHint":
    "탐색 라운드·리더보드·팩터 진단 — RM 심화용이며 고객 미팅 메인 화면이 아닙니다.",
  "rm.report.heroEyebrow": "권장 포트폴리오",
  "rm.report.heroTitle": "{code}{star}",
  "rm.report.heroHint": "이번 시뮬레이션의 최우선 제안, 「{anchor}」 대비",
  "rm.report.heroEyebrowViewing": "보는 중 · {label}",
  "rm.report.needsTitle": "니즈 이행 점검",
  "rm.report.needsHint": "이번 실행이 조정안에서 서명한 약속을 지켰는지 확인합니다.",
  "rm.report.askEvidenceTitle": "요구사항 근거",
  "rm.report.askEvidenceHint":
    "서명된 요구사항별 목표 vs 실제 — 미달도 그대로 표시합니다.",
  "rm.report.askEvidenceAllMet": "모두 충족",
  "rm.report.askEvidenceGapsOk": "일부 미달 — 수용 가능",
  "rm.report.askEvidenceSoftNote":
    "Ask는 소프트 목표입니다. 구간 미달로 작업이 실패하지 않으며, 고객 미팅에서 이 장부를 사용하세요.",
  "rm.report.askColTarget": "목표",
  "rm.report.askColActual": "실제",
  "rm.report.askStatus.met": "충족",
  "rm.report.askStatus.partial": "부분",
  "rm.report.askStatus.missed": "미달",
  "rm.report.askStatus.unknown": "—",
  "rm.report.needsOverallPass": "전부 충족",
  "rm.report.needsOverallFail": "서명 니즈와 차이 있음",
  "rm.report.needsColConstraint": "약속 항목",
  "rm.report.needsColDetail": "실제 / 한도",
  "rm.report.needsColStatus": "상태",
  "rm.report.needsDetailHint":
    "필수 편입 미달 시 누락 티커를, 통과 시 필수 목록을 표시합니다.",
  "rm.report.expand": "펼치기",
  "rm.report.collapse": "접기",
  "rm.report.talkingCollapsedHint": "고객 미팅용 설명 포인트",
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
  "rm.report.holdingsPrecisionHint":
    "비중은 기말 배분(소수 둘째 자리). 거의 등비이면 종목당 상한이 보유 수·자산군 슬리브와 충돌한 경우가 많습니다(예: 상한 8%인데 8종목만 보유 → 최소 13종목 필요). 상한 완화, 보유 수 확대, 또는 자산군 예산을 조정하세요.",
  "rm.report.talkingTitle": "방안 요약",
  "rm.report.talkingLoading": "AI가 방안 요약을 작성 중입니다…",
  "rm.report.performanceFlag": "시뮬레이션 결과가 기대에 미치지 못합니다",
  "rm.report.rerun": "시뮬레이션 다시 실행",
  "compliance.badgeCompact": "내부 검토용",
  "compliance.badgeDefault":
    "내부 검토용 — 투자 권유가 아닙니다. 고객 사용 전 책임자 승인이 필요합니다.",
  "rm.report.disclaimerTitle": "컴플라이언스 및 검토声明",
  "rm.report.disclaimerBody":
    "RM 내부 검토용. 이 문서는 어떠한 증권의 매매 제안, 권유 또는 권고도 아닙니다. 모든 수치는 역사적 시뮬레이션 결과이며, 방안이 모델링된 그대로 정확히 실행되었다고 가정합니다. 과거 성과는 미래 성과를 보장하지 않습니다. 고객 대면 자료로 사용하기 전에 적절한 권한을 가진 책임자의 검토와 승인이 필요합니다.",
  "rm.report.openQuant": "엔진 상세 열기",
  "rm.report.revise": "고객 니즈 수정",
  "rm.report.candidateTitle": "후보 모델",
  "rm.report.candidateHint":
    "맞춤 실행의 후보 모델을 비교합니다. 기본값은 선도 모델입니다.",
  "rm.report.candidateLabel": "포트폴리오 보기",
  "rm.report.candidateChampion": "★",
  "rm.quant.championWhyTitle": "추천 방안으로 선정된 이유",
  "rm.quant.championWhyCode": "추천 방안: {code}",
  "proposal.ctaTitle": "Investment Proposal",
  "proposal.ctaHint":
    "이번 시뮬레이션 AI 최추천 포트폴리오를 투자제안서로 작성합니다",
  "proposal.generate": "Investment Proposal 생성",
  "proposal.title": "Investment Proposal (초안)",
  "proposal.subtitle":
    "RM 내부 초안 — 수치는 듀얼 시뮬레이션 기반; 고객 전달 전 검토 필요",
  "proposal.print": "인쇄 / PDF로 저장",
  "proposal.close": "닫기",
  "proposal.draftBanner":
    "실행용 초안입니다. Jasper는 주문을 실행하지 않습니다. 정식 고객 문서는 RM/컴플라이언스 검토가 필요합니다.",
  "proposal.toc": "목차 Contents",
  "proposal.cover.docTitle": "Investment Proposal",
  "proposal.cover.firm": "Private Banking · RM Copilot",
  "proposal.cover.confidential": "기밀 — 지정 수신인 전용",
  "proposal.cover.clientFallback": "고객",
  "proposal.cover.rmFallback": "담당 RM",
  "proposal.cover.amountPending": "확인 예정",
  "proposal.cover.strategyLine":
    "기준 구성: {am} · {theme}. 권장 경로: {customized}.",
  "proposal.letter.dear": "{client} 님께,",
  "proposal.letter.thanks":
    "{strategy}를 기준 구성로 한 약 {amount} 투자 논의를 감사드립니다. 아래는 제안 포트폴리오와 분석입니다.",
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
  "proposal.field.horizonYears": "기간(조정안)",
  "proposal.field.years": "{n}년",
  "proposal.field.aum": "AUM",
  "proposal.field.cash": "현금",
  "proposal.field.liquidity": "유동성 니즈",
  "proposal.field.overlayLiquidity": "유동성(조정안)",
  "proposal.field.withinMonths": "{n}개월 이내",
  "proposal.field.esg": "ESG 선호",
  "proposal.field.objective": "투자 목표",
  "proposal.field.marketStance": "시장 관점",
  "proposal.field.profile": "프로필",
  "proposal.table.fund": "펀드 / ETF",
  "proposal.table.holding": "보유",
  "proposal.table.pct": "배분 %",
  "proposal.table.amount": "금액 배분",
  "proposal.table.total": "합계",
  "proposal.table.metric": "지표",
  "proposal.table.delta": "차이",
  "proposal.table.anchorPct": "기준 구성 %",
  "proposal.table.customPct": "제안 %",
  "proposal.section.executive": "요약 Executive Summary",
  "proposal.section.profile": "고객 프로필 및 목표 Client Profile & Objectives",
  "proposal.section.current": "현재 상황 / 보유 Current Situation / Holdings",
  "proposal.section.strategy": "권장 방안 Recommended Strategy",
  "proposal.section.allocation": "제안 배분 Proposed Allocation",
  "proposal.section.rationale":
    "근거 및 설명 포인트 Rationale & Talking Points",
  "proposal.section.performance": "리스크·성과 예시 Risk & Performance",
  "proposal.section.implementation": "실행 Implementation",
  "proposal.section.disclaimers": "면책 및 적합성 Disclaimers & Suitability",
  "proposal.section.market":
    "시장 맥락 및 제안 근거 Market Context & Rationale",
  "proposal.section.construction":
    "방안 구성 및 제약 Strategy Construction & Constraints",
  "proposal.section.validation": "역사적 시뮬레이션",
  "proposal.section.risk": "리스크 분석 Risk Analysis",
  "proposal.body.letterIntro":
    "본 제안서는 {client}의 맞춤 ETF 포트폴리오 초안이며(참고 규모 {amount}), {am} · {theme}를 모델 포트폴리오 기준 구성로 사용합니다.",
  "proposal.body.executive":
    "권장 방향: {anchor}를 {customized}로 맞춤화하고 듀얼 시뮬레이션로 검증.",
  "proposal.body.metricsPending": "핵심 성과 차이는 지표 로드 후 표시됩니다.",
  "proposal.body.profileFallback":
    "고객 선호는 맞춤 조정 워크플로에서 확인되었습니다.",
  "proposal.body.currentAnchor": "출발점(기준 모델 포트폴리오): {anchor}",
  "proposal.body.currentFootnote":
    "현재 보유 스냅샷 기준일 {asOf}. 데모 데이터 — 커스터디 피드가 아닙니다.",
  "proposal.body.market":
    "조정 근거는 서명된 고객 니즈를 존중하며 {anchor}에서 {customized}로 이동하는 데 초점을 둡니다.",
  "proposal.body.strategyAnchor":
    "기준 모델 포트폴리오: {am} · {theme} (리스크 밴드: {risk}). AM 테마 상품 출발점입니다.",
  "proposal.body.strategyCustomize":
    "맞춤 권고({customized})는 서명된 조정안 제약으로 기준 구성({anchor})를 개인화하고 듀얼 시뮬레이션로 검증합니다.",
  "proposal.body.allocationFallback":
    "맞춤 보유 종목은 가중치 해석 후 표시됩니다.",
  "proposal.body.allocationFootnote":
    "가중치는 맞춤 추천 방안(또는 선택 트라이얼) 기준입니다. 금액은 고객 현금/AUM 스냅샷의 예시입니다.",
  "proposal.body.constructionFallback":
    "시뮬레이션 구간 {start} → {end}; 목표 {objective}. 맞춤 프롬프트와 제외 종목이 적용됩니다.",
  "proposal.body.excludes": "제외 티커: {tickers}",
  "proposal.body.objectiveLine": "투자 목표: {objective}",
  "proposal.body.validationNote":
    "수치는 엔진 듀얼 시뮬레이션(기준 구성 vs 맞춤)에서 오며 AI가 만들어 낸 것이 아닙니다. 과거 성과는 미래 성과의 신뢰할 수 있는 지표가 아닙니다.",
  "proposal.body.chartCaption":
    "듀얼 에쿼티 예시(100 리베이스), 구간 {start} → {end}. 실제 계좌 가치는 수수료·세금·타이밍에 따라 달라집니다.",
  "proposal.body.riskMdd": "맞춤 최대낙폭 {customized}, 기준 구성 {anchor}.",
  "proposal.body.riskFallback": "퀀트 탭에서 낙폭과 집중도를 검토하세요.",
  "proposal.body.implDca":
    "일시 투자 타이밍이 우려되면 주식 슬리브에 DCA(분할 매수)를 고려하세요.",
  "proposal.body.implRebalance":
    "리밸런싱은 서명된 시뮬레이션 가정({start} → {end})을 따르며, 은행 정책이 우선합니다.",
  "proposal.body.implLiquidity":
    "전액 투입 전 단기 현금 수요에 맞는 유동성 버퍼를 유지하세요.",
  "proposal.body.implClientLiquidity": "고객 유동성 메모: {note}",
  "proposal.body.impl1": "유동성·시장충격이 우려되면 분할 진입을 고려하세요.",
  "proposal.body.impl2":
    "고객 전달 전 수수료·세금·적합성(은행 정책)을 확인하세요.",
  "proposal.body.impl3":
    "리밸런싱 주기는 별도 수정이 없으면 서명된 시뮬레이션 설정을 따릅니다.",
  "proposal.body.signOffNote": "RM 서명 메모: {note}",
  "proposal.body.disclaimer1": "과거 성과가 미래 결과를 보장하지 않습니다.",
  "proposal.body.disclaimer2":
    "본 초안은 컴플라이언스 승인 전까지 RM 내부용입니다.",
  "proposal.body.disclaimerSuitability":
    "적합성·KYC·상품 승인은 은행 프로세스이며, Jasper는 규제 적합성을 인증하지 않습니다.",
  "proposal.body.nextSteps":
    "다음 단계: RM 검토 → 컴플라이언스/적합성 → 고객 논의 → 실행 지시(Jasper 외부).",
  "proposal.warning.pastPerformance":
    "경고: 과거 성과는 미래 성과의 신뢰할 수 있는 지표가 아닙니다.",
  "proposal.warning.valueFluctuation":
    "경고: 투자 가치는 하락할 수 있으며 원금 일부 또는 전부를 잃을 수 있습니다.",
  "proposal.warning.currency":
    "경고: 수익률은 환율 변동의 영향을 받을 수 있습니다.",
  "proposal.warning.estimates": "경고: 수치는 추정/시뮬레이션 예시일 뿐입니다.",
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
    "투자 목표는 「{objective}」입니다. 맞춤 최대 낙폭 {customized}, 기준 {anchor}({delta}) — 목표 달성 근거로 활용하세요.",
  "rm.talking.objective.max_sharpe":
    "투자 목표는 「{objective}」입니다. 맞춤 샤프 {customized}, 기준 {anchor}({delta}) — 위험 조정 수익 효율을 강조하세요.",
  "rm.talking.objective.max_return":
    "투자 목표는 「{objective}」입니다. 맞춤 CAGR {customized}, 기준 {anchor}({delta}) — 합의 목표와 수익 결과를 연결하세요.",
  "rm.talking.objective.generic":
    "투자 목표: {objective}. 기준 대비 핵심 결과: {customized} vs {anchor}({delta}).",
  "rm.talking.performanceWin":
    "맞춤 CAGR이 기준보다 {cagrDelta} 높습니다{extras} — 고객 제약을 지키면서 장기 수익 잠재력을 강조하세요.",
  "rm.talking.extraMddImproved": "최대 낙폭 {delta} 개선",
  "rm.talking.extraVolReduced": "변동성 {delta} 감소",
  "rm.talking.performanceTradeoff":
    "CAGR이 기준보다 {cagrDelta} 낮지만 {tradeoffs} — 의도적 리스크·유동성 트레이드오프로 설명하세요.",
  "rm.talking.tradeoffMdd": "최대 낙폭 {delta} 개선",
  "rm.talking.tradeoffVol": "변동성 {delta} 감소",
  "rm.talking.tradeoffSharpe": "샤프 비율 기준 대비 개선",
  "rm.talking.tradeoffGeneric":
    "기준 대비 전반적 리스크가 낮고 경로가 더 안정적",
  "rm.talking.performanceSimilar":
    "수익은 기준과 유사합니다({highlights}) — 서명된 고객 니즈에 더 잘 맞는 배분에 초점을 맞추세요.",
  "rm.talking.similarGeneric": "소폭 수익 차이보다 배분 적합성이 더 중요",
  "rm.talking.compliance":
    "참고: 위 내용은 논의용 시뮬레이션 시연일 뿐이며 투자 권유가 아닙니다. 실행 전 적합성·컴플라이언스를 확인하세요.",

  "progress.dual.anchor": "기준 시뮬레이션",
  "progress.dual.customized": "맞춤 시뮬레이션",
  "nav.aria": "주 메뉴",
  "nav.menu": "탐색 메뉴 열기",
  "nav.clients": "고객",
  "nav.pool": "투자 유니버스",
  "nav.models": "모델 포트폴리오",
  "nav.personalization": "맞춤화",
  "nav.settings": "관리자 설정",
  "nav.tools": "도구",
  "gaps.title": "능력 갭 백로그",
  "gaps.subtitle": "제품 백로그",
  "gaps.lead": "오버레이에서 감지된 능력 갭을 reuse_count 순으로 정렬합니다.",
  "gaps.empty": "갭 티켓이 없습니다.",
  "engineDocs.title": "엔진 능력 카드",
  "engineDocs.subtitle": "Stage cards",
  "engineDocs.lead": "스테이지 레지스트리에서 자동 생성되어 항상 최신입니다.",
  "settings.subtitle": "가져오기 · 내보내기",
  "settings.hint":
    "투자 유니버스와 모델 포트폴리오 CSV는 여기서 관리합니다. 목록·활성 설정은 각 페이지에서 하세요.",
  "settings.poolTitle": "투자 유니버스",
  "settings.validationUnavailable": "검증 서비스를 사용할 수 없습니다",
  "settings.validationUnavailableDetail": "검증 서비스를 사용할 수 없습니다: {message}",
  "settings.poolHint": "전역 상품 목록 CSV를 가져오거나 내보냅니다.",
  "settings.modelsTitle": "모델 포트폴리오",
  "settings.modelsHint":
    "AM 모델 포트폴리오 CSV를 가져오거나 내보냅니다(보유 1행).",
  "clients.listTitle": "고객 대시보드",
  "clients.listSubtitle": "데모 고객",
  "clients.listHint":
    "고객을 선택해 프로필·보유를 확인한 뒤 포트폴리오 맞춤화를 시작하세요.",
  "clients.detailSubtitle": "고객 프로필",
  "clients.backToList": "고객 목록으로",
  "clients.notFound": "고객을 찾을 수 없습니다.",
  "clients.profile": "프로필",
  "clients.holdings": "현재 보유",
  "clients.aum": "AUM",
  "clients.cash": "현금",
  "clients.clientId": "고객번호",
  "clients.segment": "고객 유형",
  "clients.age": "연령",
  "clients.risk": "위험성향",
  "clients.horizon": "투자기간",
  "clients.rm": "담당 RM",
  "clients.liquidity": "비고",
  "clients.asOf": "기준일",
  "clients.weight": "비중",
  "clients.amount": "투자금액",
  "clients.return": "누적 수익률",
  "clients.return.cumulativeSub": "매수일 이후",
  "clients.return.reportedFallback":
    "보고된 값 — 해당 보유 종목의 실제 가격 데이터를 사용할 수 없습니다.",
  "clients.investedAt": "투자일",
  "clients.cagr": "연환산 수익",
  "clients.suggestedAnchor": "권장 모델 포트폴리오",
  "clients.launchCta": "이 고객 맞춤 포트폴리오",
  "clients.launchScopeSummary": "{count}개 그룹 맞춤화 · AUM 약 {pct}%",
  "clients.noClientBanner":
    "고객이 선택되지 않았습니다 — 대시보드에서 시작하면 보유 범위가 이어집니다.",
  "clients.noClientBannerCta": "고객 목록으로",
  "clients.contextBanner": "활성 고객: {name}",
  "clients.viewDashboard": "대시보드 보기",
  "clients.esg": "ESG 선호",
  "clients.ageUnit": "세",
  "clients.holding.cash": "현금",
  "clients.holding.cashMoneyMarket": "현금 / 단기금융",
  "clients.notePrefix": "메모:",
  "clients.upcomingEvents": "다가오는 일정 알림",
  "clients.chart.performance": "성과 추이",
  "clients.chart.allocation": "보유 구성",
  "clients.chart.nav": "순자산가치",
  "clients.chart.return": "수익률",
  "clients.chart.tf.1M": "1M",
  "clients.chart.tf.3M": "3M",
  "clients.chart.tf.6M": "6M",
  "clients.chart.tf.YTD": "YTD",
  "clients.chart.tf.1Y": "1Y",
  "clients.chart.tf.MAX": "전체",
  "clients.chart.alloc.individual": "개별 종목",
  "clients.chart.alloc.portfolio": "포트폴리오",
  "clients.holdings.individual": "개별주/위성 구간",
  "clients.holdings.cash": "현금",
  "clients.holdings.groupSubtotal": "소계",
  "clients.holdings.total": "합계",
  "clients.chart.includeGroups": "차트에 포함할 그룹",
  "clients.chart.noGroupsSelected":
    "차트를 보려면 그룹을 하나 이상 선택하세요.",
  "clients.chart.noPerformanceData":
    "선택 범위에 보고된 보유 수익 데이터가 없어 성과 차트를 표시할 수 없습니다.",
  "clients.chart.loadingPerformance": "실제 가격 데이터를 불러오는 중…",
  "clients.add": "추가",
  "clients.add.content": "내용",
  "clients.add.date": "날짜",
  "clients.add.label": "제목",
  "clients.add.save": "저장",
  "clients.add.cancel": "취소",
  "clients.add.notePlaceholder": "메모 추가…",
  "clients.add.eventPlaceholder": "일정 제목…",
  "clients.add.noEvents": "다가오는 일정이 없습니다.",
  "clients.history.title": "맞춤 포트폴리오 기록",
  "clients.history.record": "결과 {count}개",
  "clients.history.records": "결과 {count}개",
  "clients.history.empty":
    "이 고객을 위해 생성한 맞춤 포트폴리오가 여기에 표시됩니다.",
  "clients.history.emptyCta": "맞춤 포트폴리오 만들기",
  "customization.confirmTitle": "범위·기준 확인",
  "customization.confirmHint":
    "고객 대시보드에서 가져왔습니다. 확인 후 계속하거나 아래에서 수정하세요.",
  "customization.confirmContinue": "확인하고 계속",
  "customization.editScope": "범위·기준 수정",
  "customization.collapseScope": "편집 접기",
  "customization.scopeGroupsLabel": "그룹",
  "customization.scopeAnchorLabel": "기준",
  "customization.scopeNameLabel": "포트폴리오 이름",
  "rm.report.moreActions": "기타 작업",
  "rm.report.moreActionsHint": "내보내기, 엔진 상세 또는 니즈 수정",
  "clients.history.open": "열기",
  "clients.history.untitled": "맞춤 포트폴리오",
  "clients.goalSimCta": "재무 목표 시뮬레이터",
  "goalSim.title": "재무 목표 시뮬레이터",
  "goalSim.notesLabel": "RM 노트",
  "goalSim.notesPlaceholder":
    "예: 고객이 12개월 내 주택 계약금 USD 150만, 3년 후 학비 약 20만, 기대수익률 5%, 연간 추가 투자 12만…",
  "goalSim.extract": "AI로 양식에 채우기",
  "goalSim.extractReplaceAll": "노트로 전부 교체",
  "goalSim.extractConfirmReplace":
    "AI 추출 결과로 목표 표와 경로 가정을 모두 바꿀까요? 수동 수정 내용은 사라집니다.",
  "goalSim.extractMergeSummary":
    "병합: 필드 {updated}개 갱신, 목표 {added}개 추가, 수동 수정 {kept}곳 유지",
  "goalSim.extracting": "추출 중…",
  "goalSim.extractFailed": "노트에서 목표를 추출하지 못했습니다.",
    "goalSim.source.ai": "AI",
"goalSim.rulesFallback": "규칙 기반 추정",
  "goalSim.assumptionsTitle": "경로 가정",
  "goalSim.annualReturn": "기대 연수익률 (%)",
  "goalSim.annualContribution": "연간 추가 투자 (USD)",
  "goalSim.annualContributionHint": "은퇴 시작 전까지만; 은퇴 후 고정 적립 없음.",
  "goalSim.contributionGrowth": "투자 증가율 (%/년)",
  "goalSim.inflation": "목표 물가 (%/년)",
  "goalSim.optimisticDelta": "낙관 수익률 가산 (pp)",
  "goalSim.conservativeDelta": "보수 수익률 감산 (pp)",
  "goalSim.returnDefaults.loading": "현재 보유 종목으로 수익률 추정 중…",
  "goalSim.returnDefaults.realized":
    "수익률 항목이 고객 계좌의 실현 성과로 자동 입력되었습니다 — 수정 가능.",
  "goalSim.returnDefaults.backcast":
    "수익률 항목이 보유 종목 백캐스트(현재 비중 월간 리밸런싱)로 자동 입력되었습니다 — 수정 가능.",
  "goalSim.returnDefaults.refresh": "포트폴리오 추정치 다시 적용",
  "goalSim.returnDefaults.unavailable":
    "포트폴리오 성과를 사용할 수 없어 수동 기본값을 유지합니다.",
  "goalSim.returnDefaults.retry": "추정 다시 시도",
  "goalSim.goalsTitle": "목표 (타임라인)",
  "goalSim.addGoal": "목표 추가",
  "goalSim.goalsEmpty": "목표가 없습니다. 노트에서 추출하거나 직접 추가하세요.",
  "goalSim.goalType": "유형",
  "goalSim.goalLabel": "이름",
  "goalSim.goalAmount": "금액 (USD)",
  "goalSim.goalAmountDownPayment": "계약금/매수 현금 (USD)",
  "goalSim.goalAmountAnnualSpend": "연간 생활비 (USD/년)",
  "goalSim.retirementSpendYears": "은퇴 후 인출 연수",
  "goalSim.retirementSpendHint": "약 {monthly}/월, 은퇴 후 매월 인출",
  "goalSim.retirementLongevityHint":
    "(자동: 평균 수명 {le}세 − 은퇴 연령 → {years}년; 남 78 / 여 85)",
  "goalSim.goalMonths": "몇 개월 내",
  "goalSim.goalPriority": "우선순위 (1–5)",
  "goalSim.removeGoal": "삭제",
  "goalSim.mortgageTitle": "주택담보대출 (매수 후)",
  "goalSim.mortgageHint":
    "대출 원금은 매수가에서 계약금을 뺀 금액이며, 매수 다음 달부터 원리금 균등 상환이 자산 경로에서 차감됩니다.",
  "goalSim.mortgageLoan": "원금 USD",
  "goalSim.mortgageRate": "금리 %/년",
  "goalSim.mortgageTermYears": "만기(년)",
  "goalSim.mortgagePayment": "예상 월 상환: {amount}",
  "goalSim.type.home": "주택/부동산",
  "goalSim.type.retirement": "은퇴",
  "goalSim.type.education": "교육",
  "goalSim.type.liquidity": "유동성",
  "goalSim.type.other": "기타",
  "goalSim.chartTitle": "자산 경로 (다중 시나리오)",
  "goalSim.chartHorizon": "기간",
  "goalSim.chartHorizon.months": "{n}개월",
  "goalSim.chartHorizon.years": "{n}년",
  "goalSim.chartHorizon.max": "전체 경로",
  "goalSim.axis.m": "{n}m",
  "goalSim.axis.y": "{n}년",
  "goalSim.timeLabel.years": "{y}년 ({m}개월)",
  "goalSim.chart.mortgageMarker": "{name} · 대출 {payment}/월",
  "goalSim.chart.mortgageShort": "{name} · 대출",
  "goalSim.chart.mortgageEndMarker": "{name} · 대출 완납",
  "goalSim.chart.retirementMarker": "{name} · 월 인출 {payment}",
  "goalSim.chart.retirementShort": "{name} · 은퇴",
  "goalSim.chart.tag.home": "주택",
  "goalSim.chart.tag.retirement": "은퇴",
  "goalSim.chart.tag.mortgageEnd": "완납",
  "goalSim.chart.tag.inheritance": "유산",
  "goalSim.chart.inheritanceMarker": "예상 유산 {amount}",
  "goalSim.chartEmpty": "금액과 시점이 있는 목표를 하나 이상 추가하면 경로가 표시됩니다.",
  "goalSim.scenario.base": "기준",
  "goalSim.scenario.optimistic": "낙관",
  "goalSim.scenario.conservative": "보수",
  "goalSim.monthLabel": "{n}개월",
  "goalSim.endingWealth": "기말 자산 (기준)",
  "goalSim.inheritance": "예상 유산 (기준)",
  "goalSim.inheritanceHint": "계획 수명 {age}세 (약 {years}년)",
  "goalSim.totalShortfall": "총 부족분 (기준)",
  "goalSim.totalMortgagePaid": "경로상 대출 상환액 (기준)",
  "goalSim.totalRetirementPaid": "경로상 은퇴 인출액 (기준)",
  "goalSim.totalLivingPaid": "경로상 생활비 (기준, 은퇴 전)",
  "goalSim.eventsTitle": "목표 이벤트",
  "goalSim.eventCovered": "충당됨",
  "goalSim.eventShortfall": "부족 {amount}",
  "goalSim.eventMortgageStart": "{name} — 대출 상환 시작 ({payment}/월)",
  "goalSim.eventMortgageLoan": "대출 {amount}",
  "goalSim.eventMortgageEnd": "{name} — 대출 완납",
  "goalSim.eventMortgageEndDone": "완납",
  "goalSim.eventInheritance": "수명 종료 — 잔여 자산을 유산으로 표시",
  "goalSim.eventRetirementStart": "{name} — 월 인출 시작 ({payment}/월)",
  "goalSim.eventRetirementTotal": "계획 총액 약 {amount}",
  "goalSim.actionsTitle": "다음 단계",
  "goalSim.insightsTitle": "맞춤화 우선 과제",
  "goalSim.insightsSubtitle":
    "AI가 자산 전망에서 과제를 표시하며, 다음 포트폴리오 맞춤화에서 해결합니다.",
  "goalSim.insightsLoading": "AI 과제 생성 중…",
  "goalSim.insightsFailed": "AI 과제를 가져오지 못했습니다. 다시 시도하세요.",
  "goalSim.insightsRetry": "AI 다시 시도",
  "goalSim.insightsTalkingPoint": "RM 멘트: {text}",
  "goalSim.insightsSolveInNext": "맞춤화 해법: {actions}",
  "goalSim.hook.liquidity_buffer": "유동성 버퍼 상향",
  "goalSim.hook.horizon": "투자기간 정렬",
  "goalSim.hook.contribution": "추가투자·시점 조정",
  "goalSim.hook.deployment": "자금 분할 투입",
  "goalSim.hook.min_drawdown": "최대낙폭 최소화",
  "goalSim.hook.risk": "위험 배분 재조정",
  "goalSim.hook.return": "기대수익 지향",
  "goalSim.hook.refine_risk": "위험성향 구체화",
  "goalSim.action.shortfall":
    "기준 경로에 자금 부족이 있습니다. 추가 투자·시점 조정·목표 축소를 검토하세요.",
  "goalSim.action.onTrack": "현재 가정에서 기준 경로가 목표를 충당합니다.",
  "goalSim.action.tuneAssumptions": "위에서 수익률·투자·물가 구간을 스트레스 테스트하세요.",
  "goalSim.action.customize": "단기 유동성과 투자기간을 맞춤 조정으로 넘기세요.",
  "goalSim.action.addressInsight": "「{title}」 처리 — {hooks}",
  "goalSim.action.customizeFromInsights":
    "위 과제를 맞춤 조정으로 넘깁니다(유동성·목표·버퍼 사전입력).",
  "goalSim.action.waitInsights": "AI 과제 후 맞춤화를 권장합니다. 목표만 넘길 수도 있습니다.",
  "goalSim.action.retryInsightsFirst": "먼저 AI 과제를 재시도해야 맞춤화가 발견에 맞춰집니다.",
  "goalSim.handoffCta": "포트폴리오 맞춤화 계속",
  "goalSim.handoffCtaFromInsights": "위 과제로 포트폴리오 맞춤화",
  "goalCompare.title": "재무 계획 경로 — 개선 전/맞춤 후",
  "goalCompare.subtitle":
    "목표·지출 일정은 원래 계획과 동일합니다. 위에서 선택 포트폴리오/목표 모델을 바꿀 수 있으며, 파란 경로는 해당 선택의 전체 투자 성과를 사용합니다.",
  "goalCompare.portfolioLabel": "선택 포트폴리오",
  "goalCompare.modelLabel": "목표 모델",
  "goalCompare.confidence": "신뢰 하한",
  "goalCompare.confidenceOption": "{pct}% 이상…",
  "goalCompare.returnNote":
    "회색 점선=원래 계획({before}). 파랑=맞춤 후({customized} · {model}) 기준 {after}, 출처: {source}(winsorize {years}년, 표본 평균 {ceiling} 이하, 변동성 {vol}). 보수≈연도의 {conf}%가 {floor} 이상.",
  "goalCompare.returnSource.overall": "전체 포트폴리오 성과",
  "goalCompare.returnSource.cagrFallback": "헤드라인 CAGR(완전 곡선 없음)",
  "goalCompare.returnSource.realized": "고객 계좌의 실현 성과",
  "goalCompare.returnSource.backcast": "보유 종목 백캐스트(월간 목표 비중 리밸런싱)",
  "goalCompare.percentileNote":
    "연간 수익률 분포 — P10 {p10} · 중앙값 {p50} · P90 {p90}.",
  "goalCompare.backcastProxyNote":
    "늦게 상장된 종목은 동일 카테고리 대리 종목으로 보완: {tickers}({months}개월).",
  "goalCompare.backcastUnavailable":
    "백캐스트를 사용할 수 없어 포트폴리오 시뮬레이션 결과를 사용합니다.",
  "goalCompare.glideTitle": "주식 비중을 줄이고 현금으로 이동 권고",
  "goalCompare.glideBody":
    "맞춤 후 종료 자산({ending})이 목표 필요액({need})의 약 {multiple}배이며 부족이 없습니다. 목표 시점에 가까워질수록 현금 슬리브를 늘리고 주식 위험을 줄여 잉여를 보호하세요.",
  "goalCompare.endingWealth": "종료/유산(전체 경로)",
  "goalCompare.endingWealthHint": "수명/전체 전망 종료 시점.",
  "goalCompare.atGoalsHorizon": "목표 구간 자산",
  "goalCompare.atGoalsHorizonHint": "마지막 목표·대출·은퇴 지출 전후.",
  "goalCompare.totalShortfall": "자금 부족 합계",
  "goalCompare.delta": "Δ {amount}",
  "goalCompare.shortfallImproved": "원래 계획 대비 부족액이 줄었습니다.",
  "goalCompare.shortfallStillCovered": "두 경로 모두 목표를 충당합니다.",
  "goalCompare.shortfallNotImproved": "부족액이 개선되지 않았습니다. 조정안·추가투자를 수정하세요.",
  "goalCompare.series.before": "원래 계획",
  "goalCompare.series.after": "맞춤 후(기준)",
  "goalCompare.series.afterOptimistic": "맞춤 후(낙관)",
  "goalCompare.series.afterConservative": "맞춤 후(보수)",
  "goalCompare.axisYear": "Y{n}",
  "goalCompare.axisMonth": "M{n}",
  "goalCompare.monthLabel": "{n}개월",
  "goalCompare.timeLabel.years": "Y{y} ({m}개월)",
  "goalSegment.title": "AI 목표 경로 — 구간별 전략",
  "goalSegment.subtitle":
    "AI가 계획을 단기/중기/장기 구간으로 나누고 구간마다 하나의 전략을 배정합니다. 중앙선은 각 구간의 계획 수익률(보유 시뮬레이션 또는 모델 시계열)로 매월 복리 계산되며, 음영대는 보수–낙관 범위입니다.",
  "goalSegment.loading": "AI가 목표를 구간으로 나누는 중…",
  "goalSegment.source.ai": "AI 구간화",
  "goalSegment.source.rules": "규칙 기반 추정",
  "goalSegment.segment.short": "단기",
  "goalSegment.segment.mid": "중기",
  "goalSegment.segment.long": "장기",
  "goalSegment.strategy.holdings": "현재 보유",
  "goalSegment.strategy.holdingsShort": "보유",
  "goalSegment.card.returns": "기준 {base} · {floor} ~ {ceiling}",
  "goalSegment.card.goals": "목표 {n}개",
  "goalSegment.series.median": "중앙 경로",
  "goalSegment.series.band": "P{lo}–P{hi} 밴드",
  "goalSegment.bandNote":
    "음영대 = 선택한 신뢰 수준에서 각 구간 전략의 연도별 수익 P{lo}–P{hi}; 중앙선 = 구간별 기준 수익률.",
  "goalSegment.priorFallbackNote":
    "일부 구간은 시뮬레이션 곡선이 없어 계획 사전 수익률을 사용합니다.",
  "customization.optimizeScopeTitle": "다음 보유 구간 최적화",
  "customization.optimizeScopeHint":
    "이번 맞춤화에 포함할 보유 그룹을 조정하세요.",
  "customization.multiModelNotice":
    "여러 모델 포트폴리오가 선택되었습니다. 하나의 포트폴리오로 함께 맞춤화됩니다. 변경하지 않을 슬리브는 체크를 해제하세요.",
  "customization.portfolioName": "포트폴리오 이름",
  "customization.portfolioNamePlaceholder": "이번 맞춤 포트폴리오 이름",
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
  "pool.subtitle": "전역 상품 목록",
  "pool.countBadge": "활성 {enabled} / {total}",
  "pool.loadDemo": "데모 ETF 불러오기",
  "pool.loadFull": "전체 ETF 유니버스 불러오기",
  "pool.importCsv": "CSV 가져오기",
  "pool.exportCsv": "CSV 내보내기",
  "pool.importReport": "가져오기: {upserted}건 반영, {skipped}건 건너뜀",
  "pool.searchPlaceholder": "티커 또는 이름 검색…",
  "pool.filter.allClasses": "전체 자산군",
  "pool.filter.allRegions": "전체 지역",
  "pool.filter.allProducts": "전체 상품유형",
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
  "pool.product.stock": "주식",
  "pool.product.fund": "펀드",
  "pool.product.cash": "현금",
  "pool.product.structured": "구조화",
  "pool.product.bond": "채권",
  "pool.product.other": "기타",
  "models.title": "모델 포트폴리오",
  "models.subtitle": "하우스 모델 카탈로그",
  "models.hint":
    "포트폴리오 맞춤화용 모델 포트폴리오를 관리합니다. ETF·뮤추얼펀드·개별주를 혼합할 수 있으며, 구성 종목은 활성 투자 유니버스에 있어야 합니다. CSV: portfolio_id, portfolio_name, asset_manager, am_id, theme, risk_profile, ticker, weight, benchmark_ticker, enabled.",
  "models.countBadge": "사용가능 {ready} / 전체 {total}",
  "models.resetBundled": "기본 모델로 재설정",
  "models.importCsv": "CSV 가져오기",
  "models.exportCsv": "CSV 내보내기",
  "models.importReport":
    "가져오기: 포트폴리오 {count}개, 행 {skipped}개 건너뜀",
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
  "models.issuerHoldingsHint":
    "하우스 모델 카탈로그의 ETF·뮤추얼펀드·개별주 혼합",
  "models.filter.am": "자산운용사 필터",
  "models.filter.risk": "리스크 필터",
  "models.filter.theme": "투자 테마 필터",
  "models.filter.allAm": "전체 자산운용사",
  "models.filter.allRisk": "전체 리스크",
  "models.filter.allThemes": "전체 테마",
  "models.sort.label": "정렬",
  "models.sort.name": "정렬: 이름",
  "models.sort.issuer": "정렬: 운용사",
  "models.sort.risk": "정렬: 리스크",
  "models.sort.theme": "정렬: 테마",
  "models.empty": "필터 조건에 맞는 모델 포트폴리오가 없습니다.",
  "anchor.poolConflicts":
    "유니버스 충돌로 {count}개 모델이 숨겨졌습니다 — Pool 또는 Models를 수정하세요.",
  "anchor.empty":
    "선택 가능한 기준 구성가 없습니다. 활성 유니버스에 구성이 있는 모델을 활성화하세요.",
};

const DICTS: Record<Lang, Dict> = { en, zh, ko };

function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

export type TFn = (
  key: string,
  params?: Record<string, string | number>,
) => string;

export function translate(
  lang: Lang,
  key: string,
  params?: Record<string, string | number>,
): string {
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
  if (c === "ME" || c === "M" || c === "MS" || c.startsWith("MON"))
    return t("results.freq.monthly");
  if (c.startsWith("Q")) return t("results.freq.quarterly");
  if (c.startsWith("Y") || c.startsWith("A")) return t("results.freq.yearly");
  if (c === "D" || c.startsWith("DAY") || c === "B")
    return t("results.freq.daily");
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
