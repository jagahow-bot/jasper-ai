"use client";

import type { ObjectiveSwitchLabResult } from "@/lib/types";

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

      <div className="grid gap-4 md:grid-cols-2">
        <ArmCard title="Fixed objective" arm={result.fixed_arm} />
        <ArmCard title="Switch policy" arm={result.switch_arm} showSwitches />
      </div>

      <div className="pixel-panel p-4">
        <h3 className="font-pixel text-[8px] text-[var(--cyan)]">Regime timeline</h3>
        <div className="mt-3 max-h-48 overflow-auto font-terminal text-xs">
          <table className="w-full text-left">
            <thead>
              <tr className="text-dim">
                <th className="pb-1">Date</th>
                <th>Regime</th>
                <th>Objective</th>
                <th>Vol</th>
              </tr>
            </thead>
            <tbody>
              {result.regime_timeline.slice(-24).map((row) => (
                <tr key={row.date} className={row.switched ? "text-[var(--amber)]" : ""}>
                  <td className="py-0.5">{row.date}</td>
                  <td>{row.regime}</td>
                  <td>{row.objective}</td>
                  <td>{fmt(row.annualized_vol, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
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
