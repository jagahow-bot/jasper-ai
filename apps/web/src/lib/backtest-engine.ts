import type { BacktestRequest, BacktestResult, PortfolioCandidate } from "./types";
import { getTickers, getUniverseMeta } from "./universe";
import { buildFeasibleWeights } from "./weights";

const WEIGHT_EPS = 0.001;
const RISK_FREE = 0.04;

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function syntheticReturns(days: number, n: number) {
  const rand = mulberry32(42);
  const matrix: number[][] = [];
  for (let d = 0; d < days; d++) {
    const row: number[] = [];
    for (let i = 0; i < n; i++) {
      row.push(rand() * 0.02 - 0.008 + i * 0.0001);
    }
    matrix.push(row);
  }
  return matrix;
}

function metrics(weights: number[], returns: number[][], feeBps: number) {
  const fee = feeBps / 10_000;
  const port = returns.map((row) =>
    row.reduce((acc, r, i) => acc + r * weights[i], 0),
  );
  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  for (let i = 0; i < port.length; i++) {
    if (i > 0 && i % 63 === 0) equity *= 1 - fee;
    equity *= 1 + port[i];
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, equity / peak - 1);
  }
  const mean = port.reduce((a, b) => a + b, 0) / port.length;
  const variance =
    port.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(port.length - 1, 1);
  const vol = Math.sqrt(variance) * Math.sqrt(252);
  const sharpe = vol > 1e-8 ? (mean * 252 - RISK_FREE) / vol : 0;
  const cagr = equity ** (252 / Math.max(port.length, 1)) - 1;
  return { sharpe, maxDd, cagr, vol, port };
}

function weightsDict(tickers: string[], w: number[]) {
  const out: Record<string, number> = {};
  for (let i = 0; i < tickers.length; i++) {
    if (w[i] > WEIGHT_EPS) out[tickers[i]] = Math.round(w[i] * 10000) / 10000;
  }
  return out;
}

export function runBacktestEngine(
  req: BacktestRequest,
  jobId: string,
): BacktestResult {
  // Locked whitelist: universe_tickers ∪ supplements (do not open asset-class pool).
  // Open pool: asset classes ∪ pinned/guaranteed AI supplement tickers.
  const guaranteed = (req.universe_supplement_tickers ?? []).filter(Boolean);
  const locked = (req.universe_tickers ?? []).filter(Boolean);
  const tickers = getTickers(
    locked.length
      ? {
          tickers: [...new Set([...locked, ...guaranteed])],
        }
      : guaranteed.length
        ? {
            tickers: [
              ...new Set([
                ...getTickers({ assetClasses: req.asset_classes }),
                ...guaranteed,
              ]),
            ],
          }
        : {
            assetClasses: req.asset_classes,
            categories: req.universe_categories,
            tickers: req.universe_tickers,
          },
  );
  const meta = getUniverseMeta();
  const n = tickers.length;
  const minUniverse = locked.length ? 1 : 5;
  if (n < minUniverse) {
    throw new Error(
      locked.length
        ? `Too few tickers after filter (${n})`
        : `Too few tickers after filter (${n}) — widen asset classes`,
    );
  }

  const returns = syntheticReturns(252 * 6, n);
  const trainRows = req.enable_oos
    ? Math.max(Math.floor(returns.length * req.train_ratio), 252)
    : returns.length;
  const trainReturns = returns.slice(0, trainRows);
  const valReturns = req.enable_oos ? returns.slice(trainRows - 1) : [];

  const rand = mulberry32(99);
  const records: {
    score: number;
    w: number[];
    train: ReturnType<typeof metrics>;
    val: ReturnType<typeof metrics> | null;
  }[] = [];

  for (let t = 0; t < req.trials; t++) {
    const w = buildFeasibleWeights(n, req.max_weight, rand);
    const train = metrics(w, trainReturns, req.fee_bps);
    const score =
      req.objective === "min_max_drawdown"
        ? -Math.abs(train.maxDd)
        : train.sharpe;
    const val =
      valReturns.length > 60 ? metrics(w, valReturns, req.fee_bps) : null;
    records.push({ score, w, train, val });
  }

  records.sort((a, b) => b.score - a.score);
  const top = records.slice(0, 3);

  const candidates: PortfolioCandidate[] = top.map((r, idx) => {
    const primary = r.train;
    const isObj = r.score;
    const oosObj = r.val
      ? req.objective === "min_max_drawdown"
        ? -Math.abs(r.val.maxDd)
        : r.val.sharpe
      : null;
    return {
      rank: idx + 1,
      weights: weightsDict(tickers, r.w),
      sharpe: Math.round(primary.sharpe * 1000) / 1000,
      max_drawdown: Math.round(primary.maxDd * 1000) / 1000,
      cagr: Math.round(primary.cagr * 1000) / 1000,
      volatility: Math.round(primary.vol * 1000) / 1000,
      train_sharpe: Math.round(r.train.sharpe * 1000) / 1000,
      train_max_drawdown: Math.round(r.train.maxDd * 1000) / 1000,
      validation_sharpe: r.val ? Math.round(r.val.sharpe * 1000) / 1000 : null,
      validation_max_drawdown: r.val
        ? Math.round(r.val.maxDd * 1000) / 1000
        : null,
      analytics: req.enable_oos
        ? {
            sample_metrics: {
              selection: "in_sample",
              train_ratio: req.train_ratio,
              objective: req.objective,
              in_sample: { sharpe: r.train.sharpe, objective_value: isObj },
              out_of_sample: r.val
                ? { sharpe: r.val.sharpe, objective_value: oosObj ?? 0 }
                : null,
              gap: {
                objective:
                  oosObj != null ? Math.round((isObj - oosObj) * 10000) / 10000 : null,
              },
            },
          }
        : undefined,
    };
  });

  const full = metrics(top[0].w, returns, req.fee_bps);
  const start = new Date(req.start_date);
  let eq = 1;
  const rawEquity: number[] = [];
  for (const r of full.port) {
    eq *= 1 + r;
    rawEquity.push(eq);
  }
  const base = rawEquity[0] || 1;
  const equity_curve = rawEquity.map((v, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return {
      date: d.toISOString().slice(0, 10),
      value: Math.round((v / base) * 10000) / 100,
    };
  });

  const best = candidates[0];
  const benchmarkTicker = (req.benchmark_ticker || "SPY").toUpperCase();
  return {
    job_id: jobId,
    scenario_id: req.scenario_id,
    benchmark: benchmarkTicker,
    period: { start: req.start_date, end: req.end_date },
    candidates,
    equity_curve,
    efficient_frontier: records
      .filter((_, i) => i % Math.max(1, Math.floor(req.trials / 25)) === 0)
      .slice(0, 25)
      .map((r) => ({
        volatility: Math.round(r.train.vol * 10000) / 10000,
        return: Math.round(r.train.cagr * 10000) / 10000,
        sharpe: Math.round(r.train.sharpe * 10000) / 10000,
        score: Math.round(r.score * 10000) / 10000,
      })),
    narrative_facts: {
      scenario_id: req.scenario_id,
      period: { start: req.start_date, end: req.end_date },
      oos_enabled: req.enable_oos,
      train_period: { start: req.start_date, end: "train-cutoff" },
      validation_period: req.enable_oos ? { start: "val-start", end: req.end_date } : null,
      top_sharpe: best.sharpe,
      top_max_drawdown: best.max_drawdown,
      top_cagr: best.cagr,
      train_sharpe: best.train_sharpe,
      train_max_drawdown: best.train_max_drawdown,
      validation_sharpe: best.validation_sharpe,
      validation_max_drawdown: best.validation_max_drawdown,
      max_weight_constraint: req.max_weight,
      objective: req.objective,
      data_source: "embedded_fallback",
      engine: "random-search",
      trials_completed: req.trials,
      trial_scores_select_on_is: req.enable_oos,
      universe_size: meta.count,
      tradable_count: n,
      asset_classes_filter: req.asset_classes,
      universe_categories_filter: req.universe_categories,
      universe_tickers_filter: req.universe_tickers,
      universe_supplement_tickers: req.universe_supplement_tickers ?? undefined,
      universe_filter_text: req.universe_filter_text,
      universe_filter_prompts: req.universe_filter_prompts ?? undefined,
      backtest_spec: {
        fee_bps: req.fee_bps,
        rebalance_freq: req.rebalance_freq,
        risk_free_rate: RISK_FREE,
        benchmark: benchmarkTicker,
        benchmark_metrics: {
          sharpe: 0.55,
          cagr: 0.08,
          max_drawdown: -0.18,
        },
      },
      top_holdings_count: Object.keys(best.weights).length,
    },
  };
}
