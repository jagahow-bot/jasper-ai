"use client";

import { useMemo } from "react";
import { AssetClassFilter } from "@/components/AssetClassFilter";
import { ProOptimizationPanel } from "@/components/ProOptimizationPanel";
import { QuickRefinements } from "@/components/QuickRefinements";
import {
  OBJECTIVE_LABELS,
  SUB_ASSET_CLASS_KEYS,
  SUB_ASSET_CLASS_LABELS,
  SUB_ASSET_PARAM_KEYS,
} from "@/lib/constants";
import { enforceAllocControlsForClasses } from "@/lib/asset-class-policy";
import {
  FACTOR_INDICATOR_SPECS,
  formatIndicatorOption,
} from "@/lib/factor-indicators";
import type { BacktestRequest, Objective, ParamControl } from "@/lib/types";

type Props = {
  value: BacktestRequest;
  onChange: (next: BacktestRequest) => void;
  onRun: () => void;
};

export function ConstraintsPanel({ value, onChange, onRun }: Props) {
  const isPro = value.optimization_mode === "pro_auto";
  const runMaxWeight = Math.max(0.05, value.max_weight);
  const runTopN = value.top_n;
  const runMaxTurnover = value.max_turnover;
  const controlSpecs: Array<{ key: string; label: string; min: number; max: number; step: number }> = useMemo(
    () => {
      const subAssetControlSpecs = SUB_ASSET_CLASS_KEYS.map((subKey) => ({
        key: SUB_ASSET_PARAM_KEYS[subKey],
        label: `Sub ${SUB_ASSET_CLASS_LABELS[subKey]}`,
        min: 0,
        max: 1,
        step: 0.05,
      }));
      return [
    { key: "lookback_days", label: "Allocator lookback (d)", min: 126, max: 504, step: 21 },
    { key: "shrinkage", label: "Cov shrinkage", min: 0, max: 0.5, step: 0.05 },
    { key: "risk_aversion", label: "Risk aversion", min: 0.5, max: 12, step: 0.5 },
    {
      key: "max_weight_actual",
      label: "Max single weight (trial)",
      min: 0.05,
      max: runMaxWeight,
      step: 0.01,
    },
    { key: "top_n_actual", label: "Top N (actual)", min: 5, max: Math.min(120, runTopN), step: 1 },
    { key: "factor_lookback_days", label: "Factor lookback (d)", min: 126, max: 504, step: 21 },
    { key: "reversal_lookback_days", label: "Reversal lookback (d)", min: 63, max: 252, step: 21 },
    { key: "value_lookback_days", label: "Value lookback (d)", min: 63, max: 252, step: 21 },
    { key: "no_trade_tol", label: "No-trade band", min: 0, max: 0.02, step: 0.001 },
    { key: "turnover_penalty_mult", label: "Turnover penalty", min: 0.5, max: 3, step: 0.1 },
    {
      key: "max_turnover_actual",
      label: "Max turnover / rebalance",
      min: 0.05,
      max: Math.max(0.05, runMaxTurnover),
      step: 0.05,
    },
    { key: "w_mom", label: "Wt momentum", min: 0, max: 2, step: 0.1 },
    { key: "w_reversal", label: "Wt reversal", min: 0, max: 2, step: 0.1 },
    { key: "w_value", label: "Wt value", min: 0, max: 2, step: 0.1 },
    { key: "w_lowvol", label: "Wt low-vol", min: 0, max: 2, step: 0.1 },
    { key: "w_trend", label: "Wt trend", min: 0, max: 1.5, step: 0.1 },
    { key: "w_drawdown", label: "Wt drawdown qual", min: 0, max: 1.5, step: 0.1 },
    { key: "w_equity", label: "Alloc equity", min: 0, max: 1, step: 0.05 },
    { key: "w_bond", label: "Alloc bond", min: 0, max: 1, step: 0.05 },
    { key: "w_commodity", label: "Alloc commodity", min: 0, max: 1, step: 0.05 },
    { key: "w_real_estate", label: "Alloc REIT", min: 0, max: 1, step: 0.05 },
    { key: "w_alternative", label: "Alloc alt", min: 0, max: 1, step: 0.05 },
    ...subAssetControlSpecs,
  ];
    },
    [runMaxWeight, runTopN, runMaxTurnover],
  );
  const controls = value.param_controls ?? {};
  const categoricalSpecs = [
    {
      key: "objective_mode",
      label: "Objective fn",
      options: [
        "max_sharpe",
        "max_return",
        "min_max_drawdown",
        "max_sortino",
        "min_cvar",
        "risk_parity_erc",
        "max_diversification",
        "mean_variance_utility",
        "custom",
      ],
      defaultFixed: value.objective,
    },
    {
      key: "allocator_mode",
      label: "Allocator mode",
      options: ["auto", "mean_variance", "min_var", "risk_parity", "max_diversification"],
      defaultFixed: "auto",
    },
    {
      key: "rebalance_freq",
      label: "Rebalance freq",
      options: ["W-FRI", "ME", "QE", "YE"],
      defaultFixed: value.rebalance_freq,
    },
  ] as const;
  const setControl = (key: string, patch: Partial<ParamControl>) => {
    const cur: ParamControl = controls[key] ?? { mode: "search" };
    onChange({
      ...value,
      param_controls: {
        ...controls,
        [key]: { ...cur, ...patch },
      },
    });
  };

  return (
    <div className="pixel-panel space-y-5">
      <div>
        <h3 className="font-pixel text-xs text-neon glow-title">Backtest config</h3>
        <p className="mt-2 text-sm text-dim">
          Institutional params. Each rebalance: factor screen → allocator weights.
        </p>
      </div>

      <AssetClassFilter
        value={value}
        onChange={(next) =>
          onChange({
            ...next,
            param_controls: enforceAllocControlsForClasses(
              value.param_controls,
              next.asset_classes,
            ),
          })
        }
      />
      <p className="text-xs text-dim">
        Universe filter + class alloc weights (w_equity, w_bond, …) stay aligned — disallowed
        sleeves are forced to 0 in search.
      </p>

      <QuickRefinements
        request={value}
        onApply={(next) => onChange(next)}
      />

      <ProOptimizationPanel value={value} onChange={onChange} />

      <label className="block space-y-2">
        <span className="text-sm">
          Max single weight (hard ceiling): {Math.round(value.max_weight * 100)}%
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(value.max_weight * 100)}
          onChange={(e) =>
            onChange({ ...value, max_weight: Number(e.target.value) / 100 })
          }
          className="w-full"
        />
      </label>

      <label className="block space-y-2">
        <span className="text-sm">
          Max turnover / rebalance: {Math.round(value.max_turnover * 100)}%
        </span>
        <input
          type="range"
          min={10}
          max={200}
          step={5}
          value={Math.round(value.max_turnover * 100)}
          onChange={(e) =>
            onChange({ ...value, max_turnover: Number(e.target.value) / 100 })
          }
          className="w-full"
        />
        <p className="text-xs text-dim">
          Hard cap per rebalance. AI/Optuna may only search up to this slider (never above).
        </p>
      </label>

      <p className="text-xs text-dim">
        Run sliders above are <strong>hard ceilings</strong> for AI and Optuna. Search explores
        within 0…slider (or your min/max in AI param controls, capped by the slider).{" "}
        <strong>Fixed</strong> locks an exact value; <strong>Off</strong> on max weight / turnover /
        top N means use the run slider value (not unlimited search).
      </p>

      <label className="block space-y-2">
        <span className="text-sm">Factor screen Top N: {value.top_n}</span>
        <input
          type="range"
          min={10}
          max={80}
          step={5}
          value={value.top_n}
          onChange={(e) => onChange({ ...value, top_n: Number(e.target.value) })}
          className="w-full"
        />
        <p className="text-xs text-dim">
          Cross-section rank → Top N → MPT/min-var weights with position caps.
        </p>
      </label>

      <label className="block space-y-2">
        <span className="text-sm">Objective</span>
        <select
          value={value.objective}
          onChange={(e) => {
            const objective = e.target.value as Objective;
            const objCtl = controls.objective_mode ?? {
              mode: "fixed" as const,
              options: categoricalSpecs[0].options,
            };
            onChange({
              ...value,
              objective,
              param_controls: {
                ...controls,
                objective_mode: {
                  ...objCtl,
                  mode: objCtl.mode === "search" ? "search" : "fixed",
                  fixed: objective,
                  options: [...categoricalSpecs[0].options],
                },
              },
            });
          }}
          className="pixel-input"
        >
          {Object.entries(OBJECTIVE_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <p className="text-xs text-dim">
          Optuna trials and Pro champions always score on in-sample when holdout is on;
          out-of-sample and full-period metrics are shown for comparison only.
        </p>
      </label>
      {value.objective === "custom" && (
        <label className="block space-y-2">
          <span className="text-sm">Custom objective text</span>
          <textarea
            value={value.objective_custom_text ?? ""}
            onChange={(e) => onChange({ ...value, objective_custom_text: e.target.value })}
            placeholder="e.g. low drawdown first, then return, keep turnover modest"
            className="pixel-input min-h-20"
          />
          <p className="text-xs text-dim">
            Parsed into an executable optimization target.
          </p>
        </label>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-2">
          <span className="text-sm">Start</span>
          <input
            type="date"
            value={value.start_date}
            onChange={(e) => onChange({ ...value, start_date: e.target.value })}
            className="pixel-input"
          />
        </label>
        <label className="block space-y-2">
          <span className="text-sm">End</span>
          <input
            type="date"
            value={value.end_date}
            onChange={(e) => onChange({ ...value, end_date: e.target.value })}
            className="pixel-input"
          />
        </label>
      </div>

      <label
        className={`block space-y-2 ${isPro ? "pointer-events-none opacity-50" : ""}`}
      >
        <span className="text-sm">Search trials (standard): {value.trials}</span>
        <input
          type="range"
          min={5}
          max={120}
          step={1}
          value={value.trials}
          disabled={isPro}
          onChange={(e) =>
            onChange({ ...value, trials: Number(e.target.value) })
          }
          className="w-full"
        />
        <p className="text-xs text-dim">
          {isPro
            ? "Pro uses round/challenger sliders above."
            : "Optuna trial count. Above 10 trials, only the first ~8 use Gemini seeds (one batched call); the rest are sampler-only. Output count below."}
        </p>
      </label>

      <label className="block space-y-2">
        <span className="text-sm">Models in report: {value.top_models}</span>
        <input
          type="range"
          min={1}
          max={20}
          value={value.top_models}
          onChange={(e) =>
            onChange({ ...value, top_models: Number(e.target.value) })
          }
          className="w-full"
        />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.enable_oos}
          onChange={(e) => onChange({ ...value, enable_oos: e.target.checked })}
          className="accent-[var(--neon)]"
        />
        Holdout split (optimize on in-sample only; holdout = OOS diagnostics)
      </label>

      {value.enable_oos && (
        <label className="block space-y-2">
          <span className="text-sm">
            In-sample ratio: {Math.round(value.train_ratio * 100)}% (rest = holdout tail)
          </span>
          <input
            type="range"
            min={50}
            max={85}
            value={Math.round(value.train_ratio * 100)}
            onChange={(e) =>
              onChange({ ...value, train_ratio: Number(e.target.value) / 100 })
            }
            className="w-full"
          />
        </label>
      )}

      <label className="block space-y-2">
        <span className="text-sm">Trading cost: {value.fee_bps} bps</span>
        <input
          type="range"
          min={0}
          max={30}
          value={value.fee_bps}
          onChange={(e) =>
            onChange({ ...value, fee_bps: Number(e.target.value) })
          }
          className="w-full"
        />
      </label>

      <label className="block space-y-2">
        <span className="text-sm">Rebalance frequency</span>
        <select
          value={value.rebalance_freq}
          onChange={(e) => {
            const rebalance_freq = e.target.value;
            const rebCtl = controls.rebalance_freq ?? {
              mode: "fixed" as const,
              options: categoricalSpecs[2].options,
            };
            onChange({
              ...value,
              rebalance_freq,
              param_controls: {
                ...controls,
                rebalance_freq: {
                  ...rebCtl,
                  mode: rebCtl.mode === "search" ? "search" : "fixed",
                  fixed: rebalance_freq,
                  options: [...categoricalSpecs[2].options],
                },
              },
            });
          }}
          className="pixel-input"
        >
          <option value="W-FRI">Weekly (Fri)</option>
          <option value="ME">Monthly (ME)</option>
          <option value="QE">Quarterly (QE)</option>
          <option value="YE">Yearly (YE)</option>
        </select>
      </label>

      <div className="border-2 border-[var(--border)] bg-[#050508] px-3 py-2 text-xs text-dim">
        Engine: Optuna + standardized backtest · bench SPY · RF 4%
      </div>
      <details className="border-2 border-[var(--border)] bg-[#050508] p-3">
        <summary className="cursor-pointer font-pixel text-[8px] text-[var(--cyan)]">
          AI param controls (search / fixed / off)
        </summary>
        <p className="mt-2 text-xs text-dim">
          Trial max single weight search cannot exceed {Math.round(runMaxWeight * 100)}% (run slider).
        </p>
        <div className="mt-3 space-y-2 border-b border-[var(--border)] pb-3">
          <p className="text-xs text-dim">Categorical</p>
          {categoricalSpecs.map((s) => {
            const runLevelFixed =
              s.key === "objective_mode" || s.key === "rebalance_freq";
            const c =
              controls[s.key] ??
              (runLevelFixed
                ? { mode: "fixed" as const, options: s.options, fixed: s.defaultFixed }
                : { mode: "search" as const, options: s.options, fixed: s.defaultFixed });
            return (
              <div key={s.key} className="grid grid-cols-[1fr_0.8fr_1fr] items-center gap-2 text-xs">
                <div>{s.label}</div>
                <select
                  value={c.mode}
                  onChange={(e) =>
                    setControl(s.key, {
                      mode: e.target.value as ParamControl["mode"],
                      options: [...s.options],
                      fixed: c.fixed ?? s.defaultFixed,
                    })
                  }
                  className="pixel-input py-1 text-xs"
                >
                  <option value="search">Search</option>
                  <option value="fixed">Fixed</option>
                  <option value="off">Off</option>
                </select>
                <select
                  value={String(c.fixed ?? s.defaultFixed)}
                  onChange={(e) =>
                    setControl(s.key, { fixed: e.target.value, options: [...s.options] })
                  }
                  className="pixel-input py-1 text-xs"
                >
                  {s.options.map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
        <div className="mt-3 space-y-2 border-b border-[var(--border)] pb-3">
          <p className="text-xs text-dim">Factor indicators (per sleeve)</p>
          {FACTOR_INDICATOR_SPECS.map((s) => {
            const c =
              controls[s.key] ??
              ({
                mode: "search" as const,
                options: [...s.options],
                fixed: s.defaultFixed,
              } satisfies ParamControl);
            if (c.mode === "off") {
              return null;
            }
            return (
              <div
                key={s.key}
                className="grid grid-cols-[1fr_0.8fr_1.2fr] items-start gap-2 text-xs"
              >
                <div>
                  <div>{s.label}</div>
                  <div className="mt-0.5 text-[10px] text-dim">{s.hint}</div>
                </div>
                <select
                  value={c.mode}
                  onChange={(e) =>
                    setControl(s.key, {
                      mode: e.target.value as ParamControl["mode"],
                      options: [...s.options],
                      fixed: c.fixed ?? s.defaultFixed,
                    })
                  }
                  className="pixel-input py-1 text-xs"
                >
                  <option value="search">Search</option>
                  <option value="fixed">Fixed</option>
                  <option value="off">Off</option>
                </select>
                {(c.mode === "search" || c.mode === "fixed") && (
                  <select
                    value={String(c.fixed ?? s.defaultFixed)}
                    onChange={(e) =>
                      setControl(s.key, {
                        fixed: e.target.value,
                        options: [...s.options],
                      })
                    }
                    className="pixel-input py-1 text-xs"
                    title={
                      c.mode === "search"
                        ? "Search pool uses all options; selection is AI/Optuna seed hint"
                        : "Fixed indicator for this factor"
                    }
                  >
                    {s.options.map((op) => (
                      <option key={op} value={op}>
                        {formatIndicatorOption(op)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1">
          {controlSpecs.map((s) => {
            const c = controls[s.key] ?? { mode: "search", min: s.min, max: s.max, step: s.step };
            return (
              <div
                key={s.key}
                className={`grid items-center gap-2 text-xs ${
                  c.mode === "fixed"
                    ? "grid-cols-[1.3fr_0.8fr_1fr]"
                    : "grid-cols-[1.3fr_0.8fr_1fr_1fr_1fr]"
                }`}
              >
                <div>{s.label}</div>
                <select
                  value={c.mode}
                  onChange={(e) => setControl(s.key, { mode: e.target.value as ParamControl["mode"] })}
                  className="pixel-input py-1"
                >
                  <option value="search">Search</option>
                  <option value="fixed">Fixed</option>
                  <option value="off">Off</option>
                </select>
                {c.mode === "fixed" ? (
                  <input
                    type="number"
                    value={c.fixed ?? s.min}
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    onChange={(e) => setControl(s.key, { fixed: Number(e.target.value) })}
                    className="pixel-input py-1"
                  />
                ) : (
                  <>
                    <input
                      type="number"
                      value={c.min ?? s.min}
                      min={s.min}
                      max={s.max}
                      step={s.step}
                      onChange={(e) => setControl(s.key, { min: Number(e.target.value) })}
                      className="pixel-input py-1"
                    />
                    <input
                      type="number"
                      value={c.max ?? s.max}
                      min={s.min}
                      max={s.max}
                      step={s.step}
                      onChange={(e) => setControl(s.key, { max: Number(e.target.value) })}
                      className="pixel-input py-1"
                    />
                    <input
                      type="number"
                      value={c.step ?? s.step}
                      min={s.step}
                      step={s.step}
                      onChange={(e) => setControl(s.key, { step: Number(e.target.value) })}
                      className="pixel-input py-1"
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </details>

      <button
        type="button"
        onClick={onRun}
        className={`pixel-btn w-full ${isPro ? "pixel-btn-amber" : ""}`}
      >
        {isPro ? "Run Pro auto-convergence" : "Run backtest + optimize"}
      </button>
    </div>
  );
}
