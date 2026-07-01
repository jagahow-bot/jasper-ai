import type { TFn } from "./i18n";

/**
 * Localize live job-progress strings emitted by the backend.
 *
 * The API streams English progress templates (see apps/api backtest.py /
 * jobs.py). We match those templates on the client and re-render them in the
 * active UI language so the running phase respects the selected locale, and so
 * switching language mid-run updates the copy immediately. Anything we can't
 * confidently parse falls back to the original message.
 */

function scopeText(t: TFn, scope: string): string {
  if (scope === "in-sample") return t("progress.msg.scope.inSample");
  if (scope === "full window") return t("progress.msg.scope.fullWindow");
  return scope;
}

const LABEL_KEYS: Record<string, string> = {
  Sharpe: "progress.label.sharpe",
  CAGR: "progress.label.cagr",
  "max DD": "progress.label.maxdd",
  Sortino: "progress.label.sortino",
  CVaR: "progress.label.cvar",
  vol: "progress.label.vol",
  comprehensive: "progress.label.comprehensive",
  metric: "progress.label.metric",
};

function labelText(t: TFn, label: string): string {
  const key = LABEL_KEYS[label];
  return key ? t(key) : label;
}

const EXACT: Record<string, string> = {
  "Backtest job queued…": "progress.msg.queued",
  "Pro convergence job queued…": "progress.msg.queuedPro",
  "Fetching market data, starting optimization…": "progress.msg.fetching",
  "Pro: fetching data, starting iterative search…": "progress.msg.fetchingPro",
  "Backtest complete": "progress.msg.complete",
  "Pro convergence complete": "progress.msg.completePro",
  "Pro: enable holdout split — trial selection uses in-sample only; OOS for final diagnostics…":
    "progress.msg.proHoldout",
  "Pro: champion-challenger loop (AI learns from history)…": "progress.msg.proLoop",
};

/** Localize the inner phrase of a "Packaging report: …" / "Round N report: …". */
function translatePackagingInner(t: TFn, inner: string): string {
  let m: RegExpMatchArray | null;

  m = inner.match(/^Packaging (\S+) (.+?) from search cache \((\d+)\/(\d+)\)…?$/);
  if (m) {
    return t("progress.msg.pkgFromCache", {
      code: m[1],
      label: m[2],
      rank: m[3],
      total: m[4],
    });
  }

  m = inner.match(/^Packaging (\S+) metrics only \((\d+)\/(\d+)\)…?$/);
  if (m) {
    return t("progress.msg.pkgMetricsOnly", { code: m[1], rank: m[2], total: m[3] });
  }

  m = inner.match(
    /^Packaging (\S+) \((\d+)\/(\d+)\): no search cache — running backtest\(s\) for charts…?$/,
  );
  if (m) {
    return t("progress.msg.pkgNoCache", { code: m[1], rank: m[2], total: m[3] });
  }

  m = inner.match(
    /^Packaging (\S+) \((\d+)\/(\d+)\): search cache IS\/OOS — one full-period backtest for weights…?$/,
  );
  if (m) {
    return t("progress.msg.pkgIsOos", { code: m[1], rank: m[2], total: m[3] });
  }

  m = inner.match(
    /^Packaging (\S+) \((\d+)\/(\d+)\): cache incomplete \((.+?)\) — running backtest\(s\)…?$/,
  );
  if (m) {
    return t("progress.msg.pkgIncomplete", {
      code: m[1],
      rank: m[2],
      total: m[3],
      missing: m[4],
    });
  }

  m = inner.match(/^top (\d+) of (\d+) pool models \(using search cache when available\)…?$/);
  if (m) {
    return t("progress.msg.pkgTop", { top: m[1], feasible: m[2] });
  }

  return inner;
}

export function translateProgress(message: string | null | undefined, t: TFn): string {
  if (!message) return message ?? "";
  const m = message.trim();

  const exactKey = EXACT[m];
  if (exactKey) return t(exactKey);

  let g: RegExpMatchArray | null;

  g = m.match(
    /^Loaded (\d+) tickers, (\d+) trading days\. Each rebalance: factor Top-N screen \+ allocator weights \(not static weights\)\.(.*)$/,
  );
  if (g) {
    const base = t("progress.msg.loaded", { tickers: g[1], rows: g[2] });
    const suffix = g[3].includes("Regime-adaptive")
      ? t("progress.msg.loadedRegimeSuffix")
      : "";
    return base + suffix;
  }

  g = m.match(/^Starting AI — planning param seeds for (\d+) trials…?$/);
  if (g) return t("progress.msg.startingAi", { trials: g[1] });

  g = m.match(
    /^AI done: (\d+) seed sets for (\d+) Optuna trials(?: \(AI capped at (\d+); extra trials are sampler-only\))? — starting backtests…?$/,
  );
  if (g) {
    if (g[3]) {
      return t("progress.msg.aiDoneCapped", {
        used: g[1],
        trials: g[2],
        cap: g[3],
      });
    }
    return t("progress.msg.aiDone", { used: g[1], trials: g[2] });
  }

  g = m.match(/^AI off \((.*)\) — falling back to Optuna random search…?$/);
  if (g) return t("progress.msg.aiOff", { err: g[1] });

  // Round-scoped Optuna trial progress (Pro mode)
  g = m.match(
    /^Round (\d+) Optuna (\d+)\/(\d+) \((in-sample|full window), dynamic Top-N each rebalance\)(?:, round best (.+?) (\S+))?$/,
  );
  if (g) {
    const scope = scopeText(t, g[4]);
    if (g[5] != null && g[6] != null) {
      return t("progress.msg.roundOptunaBest", {
        round: g[1],
        trial: g[2],
        total: g[3],
        scope,
        label: labelText(t, g[5]),
        value: g[6],
      });
    }
    return t("progress.msg.roundOptuna", {
      round: g[1],
      trial: g[2],
      total: g[3],
      scope,
    });
  }

  // Standard Optuna trial progress
  g = m.match(
    /^Optuna (\d+)\/(\d+) \((in-sample|full window), dynamic Top-N each rebalance\)(?:, best (.+?) (\S+))?$/,
  );
  if (g) {
    const scope = scopeText(t, g[3]);
    if (g[4] != null && g[5] != null) {
      return t("progress.msg.optunaBest", {
        trial: g[1],
        total: g[2],
        scope,
        label: labelText(t, g[4]),
        value: g[5],
      });
    }
    return t("progress.msg.optuna", { trial: g[1], total: g[2], scope });
  }

  g = m.match(
    /^Search done \((\d+) feasible\) — packaging top (\d+) for report \(using search cache when available\)…?$/,
  );
  if (g) return t("progress.msg.searchDone", { feasible: g[1], top: g[2] });

  g = m.match(/^Round (\d+) report: (.+)$/);
  if (g) {
    return t("progress.msg.roundReport", {
      round: g[1],
      inner: translatePackagingInner(t, g[2]),
    });
  }

  g = m.match(/^Packaging report: (.+)$/);
  if (g) {
    return t("progress.msg.packaging", { inner: translatePackagingInner(t, g[1]) });
  }

  g = m.match(/^Pro round (\d+)\/(\d+): (.+), preparing (\d+) challengers…?$/);
  if (g) {
    return t("progress.msg.proRound", {
      round: g[1],
      max: g[2],
      carry: g[3],
      n: g[4],
    });
  }

  g = m.match(
    /^Round (\d+): AI learning from (\d+) failed challengers, target score (\S+?)…?$/,
  );
  if (g) {
    return t("progress.msg.roundAiLearning", { round: g[1], n: g[2], score: g[3] });
  }

  g = m.match(
    /^Round (\d+) done: round best (\S+), champion (\S+) \(flat streak (\d+)\/(\d+)\)(.*)$/,
  );
  if (g) {
    let out = t("progress.msg.roundDone", {
      round: g[1],
      best: g[2],
      champ: g[3],
      streak: g[4],
      patience: g[5],
    });
    const alpha = g[6].match(
      /^ · in-sample alpha vs (\S+) (\S+) \(below benchmark\)$/,
    );
    if (alpha) {
      out += t("progress.msg.roundDoneAlphaSuffix", {
        benchmark: alpha[1],
        alpha: alpha[2],
      });
    }
    return out;
  }

  return message;
}
