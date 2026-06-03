"use client";

import { BenchmarkRegimeChart } from "@/components/BenchmarkRegimeChart";
import { RegimeScoreChart } from "@/components/RegimeScoreChart";
import type { ObjectiveSwitchLabResult, RegimePredictionQuality } from "@/lib/types";

function fmt(v: number | null | undefined, digits = 3): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

const REC_LABELS: Record<string, string> = {
  APPLY: "建議：可考慮套用",
  NOT_YET: "建議：暫不套用",
  NEED_MORE_DATA: "建議：需要更多資料",
};

type Props = {
  result: ObjectiveSwitchLabResult;
};

export function ObjectiveSwitchLabReport({ result }: Props) {
  const recClass =
    result.recommendation === "APPLY"
      ? "text-[var(--cyan)]"
      : result.recommendation === "NOT_YET"
        ? "text-[var(--amber)]"
        : "text-dim";

  return (
    <div className="space-y-5">
      <div className="pixel-panel border-[var(--amber)] bg-[rgba(255,176,0,0.06)] p-4">
        <p className="font-pixel text-[9px] text-[var(--amber)]">Lab report card</p>
        <p className="mt-2 font-terminal text-lg text-[var(--foreground)]">{result.headline}</p>
        <p className={`mt-2 font-pixel text-[8px] ${recClass}`}>
          {REC_LABELS[result.recommendation] ?? result.recommendation}
        </p>
        {result.oos_sharpe_delta_switch_minus_fixed != null && (
          <p className="mt-1 text-xs text-dim">
            OOS Sharpe Δ (switch − fixed):{" "}
            {result.oos_sharpe_delta_switch_minus_fixed >= 0 ? "+" : ""}
            {result.oos_sharpe_delta_switch_minus_fixed.toFixed(3)}
          </p>
        )}
      </div>

      <p className="text-xs text-dim">{result.limitation}</p>

      {result.detector_version && (
        <p className="text-xs text-dim">
          Regime detector:{" "}
          <span className="pixel-badge-cyan inline-block px-2 py-0.5 font-pixel text-[8px]">
            {result.detector_version.toUpperCase()}
          </span>
          {result.detector_version === "v2"
            ? " — risk-on / risk-off indicator scores with arbitration"
            : " — legacy return & volatility thresholds"}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <ArmCard title="Fixed objective" arm={result.fixed_arm} />
        <ArmCard title="Switch policy" arm={result.switch_arm} showSwitches />
      </div>

      {result.regime_prediction_quality && (
        <PredictionQualitySection quality={result.regime_prediction_quality} />
      )}

      {((result.benchmark_series && result.benchmark_series.length > 0) ||
        (result.detector_version === "v2" &&
          result.regime_score_timeline &&
          result.regime_score_timeline.length > 0)) && (
        <div className="pixel-panel p-4 space-y-6">
          {result.benchmark_series && result.benchmark_series.length > 0 && (
            <div>
              <h3 className="font-pixel text-[8px] text-[var(--cyan)]">
                Benchmark path vs regime
              </h3>
              <div className="mt-3">
                <BenchmarkRegimeChart
                  benchmarkSeries={result.benchmark_series}
                  regimeTimeline={result.regime_timeline}
                  benchmarkTicker={result.benchmark_ticker}
                />
              </div>
            </div>
          )}
          {result.detector_version === "v2" &&
            result.regime_score_timeline &&
            result.regime_score_timeline.length > 0 && (
              <div>
                <h3 className="font-pixel text-[8px] text-[var(--cyan)]">
                  Regime scores vs active label
                </h3>
                <div className="mt-3">
                  <RegimeScoreChart
                    scoreTimeline={result.regime_score_timeline}
                    benchmarkSeries={result.benchmark_series ?? []}
                    regimeTimeline={result.regime_timeline}
                  />
                </div>
              </div>
            )}
          {result.benchmark_series?.length &&
            result.regime_score_timeline?.length && (
              <p className="text-[10px] text-dim">
                Hover either chart — cursor and tooltip sync by date across both panels.
              </p>
            )}
        </div>
      )}

      <div className="pixel-panel p-4">
        <h3 className="font-pixel text-[8px] text-[var(--cyan)]">Regime timeline</h3>
        <div className="mt-3 max-h-48 overflow-auto font-terminal text-xs">
          <table className="w-full text-left">
            <thead>
              <tr className="text-dim">
                <th className="pb-1">Date</th>
                <th>Regime</th>
                <th>Active</th>
                <th>Objective</th>
                <th>Vol</th>
                {result.detector_version === "v2" && (
                  <>
                    <th>Off</th>
                    <th>On</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {result.regime_timeline.slice(-24).map((row) => (
                <tr key={row.date} className={row.switched ? "text-[var(--amber)]" : ""}>
                  <td className="py-0.5">{row.date}</td>
                  <td>{row.regime}</td>
                  <td>{row.active_regime ?? row.regime}</td>
                  <td>{row.objective}</td>
                  <td>{fmt(row.annualized_vol, 2)}</td>
                  {result.detector_version === "v2" && (
                    <>
                      <td>{fmt(row.risk_off_score, 2)}</td>
                      <td>{fmt(row.risk_on_score, 2)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PredictionQualitySection({ quality }: { quality: RegimePredictionQuality }) {
  const score = quality.overall_alignment_score;
  const grade = quality.alignment_grade;
  const regimes = ["risk_off", "neutral", "risk_on"] as const;
  const fwd = quality.forward_21d_diagnostic;
  const notable = quality.notable_segments;

  return (
    <div className="pixel-panel p-4">
      <h3 className="font-pixel text-[8px] text-[var(--cyan)]">
        Regime prediction quality (episode-based)
      </h3>
      <p className="mt-1 text-[10px] text-dim">
        Scores each contiguous active-regime episode by benchmark behavior from switch-in
        until the label changes: risk_on if return &gt; 0; risk_off if segment ann. vol ≥
        1.15× the lab episode-vol median; neutral relative to the prior episode—after
        risk_on, return ≤ 0 or below the prior risk_on segment return; after risk_off,
        segment vol below the prior risk_off segment; otherwise |return| ≤ 3%. Return and
        drawdown are for context. Unlike a fixed 21-day forward window per step. Does not
        replace Sharpe A/B.
      </p>
      {score != null && (
        <p className="mt-2 font-terminal text-lg text-[var(--foreground)]">
          Episode alignment {score.toFixed(0)}/100
          {grade ? ` · grade ${grade}` : ""}
        </p>
      )}
      <ul className="mt-2 space-y-1 text-xs text-dim">
        {quality.explanations.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <table className="mt-4 w-full text-left font-terminal text-xs">
        <thead>
          <tr className="text-dim">
            <th className="pb-1">Regime</th>
            <th>Episodes</th>
            <th>Median days</th>
            <th>Avg return</th>
            <th>Hit rate</th>
          </tr>
        </thead>
        <tbody>
          {regimes.map((r) => {
            const q = quality.regime_quality[r];
            if (!q?.segment_count) {
              return (
                <tr key={r}>
                  <td className="py-0.5">{r}</td>
                  <td colSpan={4} className="text-dim">
                    —
                  </td>
                </tr>
              );
            }
            return (
              <tr key={r}>
                <td className="py-0.5">{r}</td>
                <td>{q.segment_count}</td>
                <td>{q.median_length_days ?? "—"}</td>
                <td>
                  {q.avg_segment_return != null
                    ? `${(q.avg_segment_return * 100).toFixed(2)}%`
                    : "—"}
                </td>
                <td>{q.hit_rate != null ? `${(q.hit_rate * 100).toFixed(0)}%` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {notable && (notable.longest.length > 0 || notable.failed.length > 0) && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {notable.longest.length > 0 && (
            <SegmentList title="Longest episodes" episodes={notable.longest} />
          )}
          {notable.failed.length > 0 && (
            <div>
              <SegmentList title="Largest misses" episodes={notable.failed} highlightMiss />
              <p className="mt-2 text-[10px] text-dim">
                Hits: risk_on (return &gt; 0), risk_off (segment vol ≥ 1.15× episode-vol
                median), neutral (weakened after risk_on, calmer vol after risk_off, else
                |return| ≤ 3%). Largest misses rank by return shortfall (risk_on), vol
                shortfall (risk_off), or continued strength / insufficient vol drop
                (neutral).
              </p>
            </div>
          )}
        </div>
      )}
      {fwd && fwd.forward_horizon_days > 0 && (
        <div className="mt-4 rounded border border-[var(--border)] p-3">
          <p className="font-pixel text-[8px] text-dim">
            Secondary: {fwd.forward_horizon_days}d forward (per step)
          </p>
          {fwd.overall_alignment_score != null && (
            <p className="mt-1 text-xs text-dim">
              Step-level alignment {fwd.overall_alignment_score.toFixed(0)}/100 — same
              return-based rules on {fwd.forward_horizon_days}d forward windows; headline
              score above uses full episodes.
            </p>
          )}
          {fwd.switch_timing.length > 0 && (
            <ul className="mt-2 max-h-32 space-y-1 overflow-auto text-xs text-dim">
              {fwd.switch_timing.map((s) => (
                <li
                  key={s.date}
                  className={s.aligned_with_new_regime ? "" : "text-[var(--amber)]"}
                >
                  {s.date}: {s.from_regime} → {s.to_regime} · {s.note}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function SegmentList({
  title,
  episodes,
  highlightMiss,
}: {
  title: string;
  episodes: NonNullable<RegimePredictionQuality["notable_segments"]>["longest"];
  highlightMiss?: boolean;
}) {
  return (
    <div>
      <p className="font-pixel text-[8px] text-[var(--amber)]">{title}</p>
      <ul className="mt-2 space-y-1 text-xs text-dim">
        {episodes.map((ep) => (
          <li
            key={`${ep.start_date}-${ep.regime}`}
            className={
              highlightMiss && !ep.aligned_with_regime ? "text-[var(--amber)]" : ""
            }
          >
            {ep.start_date} → {ep.end_date} · {ep.regime} · {ep.length_days}d ·{" "}
            {(ep.segment_return * 100).toFixed(2)}% ·{" "}
            {ep.aligned_with_regime ? "hit" : "miss"}
            {!ep.aligned_with_regime && ep.miss_reason ? ` (${ep.miss_reason})` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ArmCard({
  title,
  arm,
  showSwitches,
}: {
  title: string;
  arm: ObjectiveSwitchLabResult["fixed_arm"];
  showSwitches?: boolean;
}) {
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--panel)] p-4">
      <p className="font-pixel text-[8px] text-[var(--cyan)]">{title}</p>
      <p className="mt-1 text-sm">{arm.objective}</p>
      {showSwitches && (
        <p className="text-xs text-dim">Regime switches: {arm.switch_count}</p>
      )}
      <ul className="mt-3 space-y-1 text-xs text-dim">
        <li>IS Sharpe {fmt(arm.in_sample?.sharpe)}</li>
        <li>OOS Sharpe {fmt(arm.out_of_sample?.sharpe)}</li>
        <li>IS return {fmt(arm.in_sample?.return_pct, 1)}%</li>
        <li>IS max DD {fmt(arm.in_sample?.max_drawdown, 2)}</li>
      </ul>
    </div>
  );
}
