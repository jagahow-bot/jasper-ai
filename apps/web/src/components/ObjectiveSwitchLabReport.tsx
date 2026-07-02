"use client";

import { BenchmarkRegimeChart } from "@/components/BenchmarkRegimeChart";
import { RegimeScoreChart } from "@/components/RegimeScoreChart";
import { regimeLabel, useI18n } from "@/lib/i18n";
import type { ObjectiveSwitchLabResult, RegimePredictionQuality } from "@/lib/types";

function fmt(v: number | null | undefined, digits = 3): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

type Props = {
  result: ObjectiveSwitchLabResult;
};

export function ObjectiveSwitchLabReport({ result }: Props) {
  const { t } = useI18n();
  const recLabels: Record<string, string> = {
    APPLY: t("objectiveLab.rec.apply"),
    NOT_YET: t("objectiveLab.rec.notYet"),
    NEED_MORE_DATA: t("objectiveLab.rec.needMoreData"),
  };
  const recClass =
    result.recommendation === "APPLY"
      ? "text-[var(--cyan)]"
      : result.recommendation === "NOT_YET"
        ? "text-[var(--amber)]"
        : "text-dim";

  return (
    <div className="space-y-5">
      <div className="pixel-panel border-[var(--amber)] bg-[rgba(255,176,0,0.06)] p-4">
        <p className="ui-section-title text-[var(--amber)]">{t("objectiveLab.reportCard")}</p>
        <p className="mt-2 font-terminal text-lg text-[var(--foreground)]">{result.headline}</p>
        <p className={`mt-2 ui-section-title ${recClass}`}>
          {recLabels[result.recommendation] ?? result.recommendation}
        </p>
        {result.oos_sharpe_delta_switch_minus_fixed != null && (
          <p className="mt-1 ui-hint">
            {t("objectiveLab.oosSharpeDelta")}{" "}
            {result.oos_sharpe_delta_switch_minus_fixed >= 0 ? "+" : ""}
            {result.oos_sharpe_delta_switch_minus_fixed.toFixed(3)}
          </p>
        )}
      </div>

      <p className="ui-hint">{result.limitation}</p>

      {result.detector_version && (
        <p className="ui-hint">
          {t("objectiveLab.regimeDetector")}:{" "}
          <span className="pixel-badge-cyan inline-block px-2 py-0.5 font-pixel text-[8px]">
            {result.detector_version.toUpperCase()}
          </span>
          {result.detector_version === "v2"
            ? ` — ${t("objectiveLab.detectorV2")}`
            : ` — ${t("objectiveLab.detectorLegacy")}`}
          {result.detector_version === "v2" && result.fast_risk_off_exit && (
            <> · {t("objectiveLab.fastRiskOffExit")}</>
          )}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <ArmCard title={t("objectiveLab.fixedObjective")} arm={result.fixed_arm} />
        <ArmCard title={t("objectiveLab.switchPolicy")} arm={result.switch_arm} showSwitches />
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
              <h3 className="ui-section-title">
                {t("objectiveLab.benchmarkVsRegime")}
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
                <h3 className="ui-section-title">
                  {t("objectiveLab.regimeScores")}
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
              <p className="ui-hint">
                {t("objectiveLab.hoverSyncHint")}
              </p>
            )}
        </div>
      )}

      <div className="pixel-panel p-4">
        <h3 className="ui-section-title">{t("objectiveLab.regimeTimeline")}</h3>
        <div className="mt-3 max-h-48 overflow-auto ui-chart-label">
          <table className="w-full text-left">
            <thead>
              <tr className="text-dim">
                <th className="pb-1">{t("common.date")}</th>
                <th>{t("common.regime")}</th>
                <th>{t("common.active")}</th>
                <th>{t("common.objective")}</th>
                <th>{t("common.vol")}</th>
                {result.detector_version === "v2" && (
                  <>
                    <th>{t("objectiveLab.off")}</th>
                    <th>{t("objectiveLab.on")}</th>
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
  const { t } = useI18n();
  const score = quality.overall_alignment_score;
  const grade = quality.alignment_grade;
  const regimes = ["risk_off", "neutral", "risk_on"] as const;
  const fwd = quality.forward_21d_diagnostic;
  const notable = quality.notable_segments;

  return (
    <div className="pixel-panel p-4">
      <h3 className="ui-section-title">
        {t("objectiveLab.predictionQualityTitle")}
      </h3>
      <p className="mt-1 ui-hint">
        {t("objectiveLab.predictionQualityDesc")}
      </p>
      {score != null && (
        <p className="mt-2 font-terminal text-lg text-[var(--foreground)]">
          {t("objectiveLab.episodeAlignment", { score: score.toFixed(0) })}
          {grade ? ` · ${t("objectiveLab.grade", { grade })}` : ""}
        </p>
      )}
      <ul className="mt-2 space-y-1 ui-hint">
        {quality.explanations.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <table className="mt-4 w-full text-left ui-chart-label">
        <thead>
          <tr className="text-dim">
            <th className="pb-1">{t("common.regime")}</th>
            <th>{t("objectiveLab.episodes")}</th>
            <th>{t("objectiveLab.medianDays")}</th>
            <th>{t("objectiveLab.avgReturn")}</th>
            <th>{t("objectiveLab.hitRate")}</th>
          </tr>
        </thead>
        <tbody>
          {regimes.map((r) => {
            const q = quality.regime_quality[r];
            if (!q?.segment_count) {
              return (
                <tr key={r}>
                  <td className="py-0.5">{regimeLabel(t, r)}</td>
                  <td colSpan={4} className="text-dim">
                    —
                  </td>
                </tr>
              );
            }
            return (
              <tr key={r}>
                <td className="py-0.5">{regimeLabel(t, r)}</td>
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
            <SegmentList title={t("objectiveLab.longestEpisodes")} episodes={notable.longest} />
          )}
          {notable.failed.length > 0 && (
            <div>
              <SegmentList
                title={t("objectiveLab.largestMisses")}
                episodes={notable.failed}
                highlightMiss
              />
              <p className="mt-2 ui-hint">
                {t("objectiveLab.missesLegend")}
              </p>
            </div>
          )}
        </div>
      )}
      {fwd && fwd.forward_horizon_days > 0 && (
        <div className="mt-4 rounded border border-[var(--border)] p-3">
          <p className="ui-section-title text-dim">
            {t("objectiveLab.secondaryForward", { days: fwd.forward_horizon_days })}
          </p>
          {fwd.overall_alignment_score != null && (
            <p className="mt-1 ui-hint">
              {t("objectiveLab.stepLevelAlignment", {
                score: fwd.overall_alignment_score.toFixed(0),
                days: fwd.forward_horizon_days,
              })}
            </p>
          )}
          {fwd.switch_timing.length > 0 && (
            <ul className="mt-2 max-h-32 space-y-1 overflow-auto ui-hint">
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
  const { t } = useI18n();
  return (
    <div>
      <p className="ui-section-title text-[var(--amber)]">{title}</p>
      <ul className="mt-2 space-y-1 ui-hint">
        {episodes.map((ep) => (
          <li
            key={`${ep.start_date}-${ep.regime}`}
            className={
              highlightMiss && !ep.aligned_with_regime ? "text-[var(--amber)]" : ""
            }
          >
            {ep.start_date} → {ep.end_date} · {regimeLabel(t, ep.regime)} · {ep.length_days}d ·{" "}
            {(ep.segment_return * 100).toFixed(2)}% ·{" "}
            {ep.aligned_with_regime ? t("objectiveLab.hit") : t("objectiveLab.miss")}
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
  const { t } = useI18n();
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--panel)] p-4">
      <p className="ui-section-title">{title}</p>
      <p className="mt-1 ui-body">{arm.objective}</p>
      {showSwitches && (
        <p className="ui-hint">
          {t("objectiveLab.regimeSwitches", { count: arm.switch_count })}
        </p>
      )}
      <ul className="mt-3 space-y-1 ui-hint">
        <li>{t("objectiveLab.isSharpe")} {fmt(arm.in_sample?.sharpe)}</li>
        <li>{t("objectiveLab.oosSharpe")} {fmt(arm.out_of_sample?.sharpe)}</li>
        <li>{t("objectiveLab.isReturn")} {fmt(arm.in_sample?.return_pct, 1)}%</li>
        <li>{t("objectiveLab.isMaxDd")} {fmt(arm.in_sample?.max_drawdown, 2)}</li>
      </ul>
    </div>
  );
}
