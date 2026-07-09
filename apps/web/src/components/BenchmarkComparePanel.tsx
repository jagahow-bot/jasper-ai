"use client";



import { useMemo } from "react";

import {

  CartesianGrid,

  Legend,

  Line,

  LineChart,

  ResponsiveContainer,

  Tooltip,

  XAxis,

  YAxis,

} from "recharts";

import { resolveChampionCandidateIndex } from "@/lib/performance-compare-chart";

import {

  chartLegendFontSize,

  chartTickFontSize,

  JASPER_PERFORMANCE_CHART_SYNC,

  LAB_CHART_MARGIN,

  LAB_Y_AXIS_WIDTH,

} from "@/lib/benchmark-chart-scale";

import { useI18n } from "@/lib/i18n";

import type { BacktestResult } from "@/lib/types";



type Props = {

  anchorLabel: string;

  customizedLabel: string;

  baseResult: BacktestResult;

  adjustedResult: BacktestResult;

};



function pickChampion(result: BacktestResult) {

  const idx = resolveChampionCandidateIndex(

    result.candidates,

    result.narrative_facts,

  );

  return idx >= 0 ? result.candidates[idx] : result.candidates[0];

}



function fmtPct(v: number, digits = 2) {

  return `${(v * 100).toFixed(digits)}%`;

}



function mergeEquityCurves(

  anchor: { date: string; value: number }[],

  customized: { date: string; value: number }[],

) {

  const dates = [

    ...new Set([...anchor.map((d) => d.date), ...customized.map((d) => d.date)]),

  ].sort();

  const anchorMap = new Map(anchor.map((d) => [d.date, d.value]));

  const customizedMap = new Map(customized.map((d) => [d.date, d.value]));

  return dates.map((date) => ({

    date,

    anchor: anchorMap.get(date) ?? null,

    customized: customizedMap.get(date) ?? null,

  }));

}



export function BenchmarkComparePanel({

  anchorLabel,

  customizedLabel,

  baseResult,

  adjustedResult,

}: Props) {

  const { t } = useI18n();

  const tickFont = chartTickFontSize();

  const legendFont = chartLegendFontSize();



  const rows = useMemo(() => {

    const base = pickChampion(baseResult);

    const adj = pickChampion(adjustedResult);

    if (!base || !adj) return null;

    return [

      {

        key: "cagr",

        label: t("compare.metric.cagr"),

        anchor: fmtPct(base.cagr),

        customized: fmtPct(adj.cagr),

        delta: adj.cagr - base.cagr,

      },

      {

        key: "sharpe",

        label: t("compare.metric.sharpe"),

        anchor: base.sharpe.toFixed(2),

        customized: adj.sharpe.toFixed(2),

        delta: adj.sharpe - base.sharpe,

      },

      {

        key: "mdd",

        label: t("compare.metric.mdd"),

        anchor: fmtPct(base.max_drawdown),

        customized: fmtPct(adj.max_drawdown),

        delta: adj.max_drawdown - base.max_drawdown,

      },

      {

        key: "vol",

        label: t("compare.metric.vol"),

        anchor: fmtPct(base.volatility),

        customized: fmtPct(adj.volatility),

        delta: adj.volatility - base.volatility,

      },

    ];

  }, [baseResult, adjustedResult, t]);



  const chartData = useMemo(() => {

    const base = pickChampion(baseResult);

    const adj = pickChampion(adjustedResult);

    const anchorCurve =

      base?.equity_curve ?? baseResult.equity_curve ?? [];

    const customizedCurve =

      adj?.equity_curve ?? adjustedResult.equity_curve ?? [];

    if (!anchorCurve.length && !customizedCurve.length) return null;

    return mergeEquityCurves(anchorCurve, customizedCurve);

  }, [baseResult, adjustedResult]);



  if (!rows) return null;



  return (

    <div className="pixel-panel pixel-panel-cyan space-y-4">

      <div>

        <h2 className="font-pixel text-xs text-neon">{t("compare.title")}</h2>

        <p className="mt-2 text-sm text-dim">{t("compare.subtitle")}</p>

      </div>



      {chartData && chartData.length > 0 && (

        <div className="border-2 border-[var(--border)] bg-[#050508] p-2">

          <p className="mb-2 px-1 text-[10px] uppercase tracking-wide text-dim">

            {t("compare.chart.title")}

          </p>

          <ResponsiveContainer width="100%" height={220}>

            <LineChart

              {...JASPER_PERFORMANCE_CHART_SYNC}

              data={chartData}

              margin={LAB_CHART_MARGIN}

            >

              <CartesianGrid stroke="#334155" strokeDasharray="3 3" />

              <XAxis

                dataKey="date"

                stroke="#94a3b8"

                fontSize={tickFont}

                minTickGap={28}

                tickFormatter={(v) => String(v).slice(2)}

              />

              <YAxis

                domain={["auto", "auto"]}

                stroke="#94a3b8"

                fontSize={tickFont}

                width={LAB_Y_AXIS_WIDTH}

                tickFormatter={(v) => `${Number(v).toFixed(0)}`}

              />

              <Tooltip labelFormatter={(v) => String(v)} />

              <Legend wrapperStyle={{ fontSize: legendFont }} />

              <Line

                type="monotone"

                dataKey="anchor"

                name={anchorLabel || t("compare.chart.anchor")}

                stroke="#ffb000"

                dot={false}

                strokeWidth={2}

                connectNulls

              />

              <Line

                type="monotone"

                dataKey="customized"

                name={customizedLabel || t("compare.chart.customized")}

                stroke="#00f5ff"

                dot={false}

                strokeWidth={2}

                connectNulls

              />

            </LineChart>

          </ResponsiveContainer>

        </div>

      )}



      <div className="overflow-x-auto">

        <table className="w-full min-w-[480px] border-collapse text-sm">

          <thead>

            <tr className="border-b border-[var(--border)] text-left text-dim">

              <th className="py-2 pr-3 font-normal">{t("compare.col.metric")}</th>

              <th className="py-2 pr-3 font-normal">{anchorLabel}</th>

              <th className="py-2 pr-3 font-normal">{customizedLabel}</th>

              <th className="py-2 font-normal">{t("compare.col.delta")}</th>

            </tr>

          </thead>

          <tbody>

            {rows.map((row) => {

              const improved =

                row.key === "mdd" || row.key === "vol"

                  ? row.delta < 0

                  : row.delta > 0;

              const deltaClass = improved

                ? "text-[var(--neon)]"

                : row.delta === 0

                  ? "text-dim"

                  : "text-[var(--magenta)]";

              const deltaPrefix = row.delta > 0 ? "+" : "";

              const deltaDisplay =

                row.key === "sharpe"

                  ? `${deltaPrefix}${row.delta.toFixed(2)}`

                  : `${deltaPrefix}${(row.delta * 100).toFixed(2)}%`;

              return (

                <tr key={row.key} className="border-b border-[var(--border)]/50">

                  <td className="py-2 pr-3 text-dim">{row.label}</td>

                  <td className="py-2 pr-3 font-terminal">{row.anchor}</td>

                  <td className="py-2 pr-3 font-terminal text-[var(--cyan)]">

                    {row.customized}

                  </td>

                  <td className={`py-2 font-terminal ${deltaClass}`}>{deltaDisplay}</td>

                </tr>

              );

            })}

          </tbody>

        </table>

      </div>

    </div>

  );

}


