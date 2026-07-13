"use client";

import { useMemo } from "react";
import { AssetClassFilter } from "@/components/AssetClassFilter";
import { ProOptimizationPanel } from "@/components/ProOptimizationPanel";
import { QuickRefinements } from "@/components/QuickRefinements";
import {
  OBJECTIVE_KEYS,
  SUB_ASSET_CLASS_KEYS,
  SUB_ASSET_CLASS_LABELS,
  SUB_ASSET_PARAM_KEYS,
} from "@/lib/constants";
import { enforceAllocControlsForClasses } from "@/lib/asset-class-policy";
import { FACTOR_INDICATOR_SPECS } from "@/lib/factor-indicators";
import {
  allocatorLabel,
  factorIndicatorHint,
  factorIndicatorLabel,
  indicatorOptionLabel,
  objectiveLabel,
  rebalanceFreqLabel,
  useI18n,
  type TFn,
} from "@/lib/i18n";
import type { BacktestRequest, Objective, ParamControl } from "@/lib/types";

/** Human-readable label for a categorical parameter option code. */
function formatCategoricalOption(key: string, op: string, t: TFn): string {
  if (key === "objective_mode") return objectiveLabel(t, op);
  if (key === "rebalance_freq") return rebalanceFreqLabel(t, op);
  if (key === "allocator_mode") return allocatorLabel(t, op);
  return op;
}

type Props = {
  value: BacktestRequest;
  onChange: (next: BacktestRequest) => void;
  onRun: () => void;
  apiOnline?: boolean | null;
  emailNotificationsEnabled?: boolean | null;
  /** RM mode: universe is fixed at overlay sign-off. */
  universeReadOnly?: boolean;
};

export function ConstraintsPanel({
  value,
  onChange,
  onRun,
  apiOnline,
  emailNotificationsEnabled,
  universeReadOnly = false,
}: Props) {
  const { t } = useI18n();
  const isPro = value.optimization_mode === "pro_auto";
  const dynamicObjective = value.objective === "dynamic";
  const offline = apiOnline === false;
  const runMaxWeight = Math.max(0.05, value.max_weight);
  // `top_n` is no longer user-configurable from the UI; keep the UI limits in
  // sync with the server's default value.
  const runTopN = 50;
  const runMaxTurnover = value.max_turnover;
  const controlSpecs: Array<{ key: string; label: string; min: number; max: number; step: number }> = useMemo(
    () => {
      const subAssetControlSpecs = SUB_ASSET_CLASS_KEYS.map((subKey) => ({
        key: SUB_ASSET_PARAM_KEYS[subKey],
        label: t("config.control.subPrefix", { label: SUB_ASSET_CLASS_LABELS[subKey] }),
        min: 0,
        max: 1,
        step: 0.05,
      }));
      return [
    { key: "lookback_days", label: t("config.control.lookback_days"), min: 126, max: 504, step: 21 },
    { key: "shrinkage", label: t("config.control.shrinkage"), min: 0, max: 0.5, step: 0.05 },
    { key: "risk_aversion", label: t("config.control.risk_aversion"), min: 0.5, max: 12, step: 0.5 },
    {
      key: "max_weight_actual",
      label: t("config.control.max_weight_actual"),
      min: 0.05,
      max: runMaxWeight,
      step: 0.01,
    },
    { key: "top_n_actual", label: t("config.control.top_n_actual"), min: 5, max: Math.min(120, runTopN), step: 1 },
    { key: "factor_lookback_days", label: t("config.control.factor_lookback_days"), min: 126, max: 504, step: 21 },
    { key: "reversal_lookback_days", label: t("config.control.reversal_lookback_days"), min: 63, max: 252, step: 21 },
    { key: "value_lookback_days", label: t("config.control.value_lookback_days"), min: 63, max: 252, step: 21 },
    { key: "no_trade_tol", label: t("config.control.no_trade_tol"), min: 0, max: 0.02, step: 0.001 },
    { key: "turnover_penalty_mult", label: t("config.control.turnover_penalty_mult"), min: 0.5, max: 3, step: 0.1 },
    {
      key: "max_turnover_actual",
      label: t("config.control.max_turnover_actual"),
      min: 0.05,
      max: Math.max(0.05, runMaxTurnover),
      step: 0.05,
    },
    { key: "w_mom", label: t("config.control.w_mom"), min: 0, max: 2, step: 0.1 },
    { key: "w_reversal", label: t("config.control.w_reversal"), min: 0, max: 2, step: 0.1 },
    { key: "w_value", label: t("config.control.w_value"), min: 0, max: 2, step: 0.1 },
    { key: "w_lowvol", label: t("config.control.w_lowvol"), min: 0, max: 2, step: 0.1 },
    { key: "w_trend", label: t("config.control.w_trend"), min: 0, max: 1.5, step: 0.1 },
    { key: "w_drawdown", label: t("config.control.w_drawdown"), min: 0, max: 1.5, step: 0.1 },
    { key: "w_equity", label: t("config.control.w_equity"), min: 0, max: 1, step: 0.05 },
    { key: "w_bond", label: t("config.control.w_bond"), min: 0, max: 1, step: 0.05 },
    { key: "w_commodity", label: t("config.control.w_commodity"), min: 0, max: 1, step: 0.05 },
    { key: "w_real_estate", label: t("config.control.w_real_estate"), min: 0, max: 1, step: 0.05 },
    { key: "w_alternative", label: t("config.control.w_alternative"), min: 0, max: 1, step: 0.05 },
    ...subAssetControlSpecs,
  ];
    },
    [runMaxWeight, runTopN, runMaxTurnover, t],
  );
  const controls = value.param_controls ?? {};
  const categoricalSpecs = [
    {
      key: "objective_mode",
      label: t("config.categorical.objective_mode"),
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
      label: t("config.categorical.allocator_mode"),
      options: ["auto", "mean_variance", "min_var", "risk_parity", "max_diversification"],
      defaultFixed: "auto",
    },
    {
      key: "rebalance_freq",
      label: t("config.categorical.rebalance_freq"),
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
        <h3 className="ui-panel-title">{t("config.title")}</h3>
        <p className="mt-2 ui-body text-dim">{t("config.subtitle")}</p>
      </div>

      <AssetClassFilter
        value={value}
        readOnly={universeReadOnly}
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
      <p className="ui-hint">{t("config.assetClassSyncHint")}</p>

      <label className="ui-label flex items-center gap-2">
        <input
          type="checkbox"
          checked={value.enforce_class_weights !== false}
          onChange={(e) =>
            onChange({ ...value, enforce_class_weights: e.target.checked })
          }
          className="accent-[var(--neon)]"
        />
        {t("config.enforceClassWeights")}
      </label>
      <p className="ui-hint">{t("config.enforceClassWeightsHint")}</p>

      <QuickRefinements
        request={value}
        onApply={(next) => onChange(next)}
      />

      <ProOptimizationPanel value={value} onChange={onChange} />

      <label className="block space-y-2">
        <span className="ui-label">
          {t("config.maxWeight", { pct: Math.round(value.max_weight * 100) })}
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
        <span className="ui-label">
          {t("config.minWeight", {
            pct: ((value.min_weight ?? 0.005) * 100).toFixed(1),
          })}
        </span>
        <input
          type="range"
          min={0}
          max={50}
          step={1}
          value={Math.round((value.min_weight ?? 0.005) * 1000)}
          onChange={(e) =>
            onChange({ ...value, min_weight: Number(e.target.value) / 1000 })
          }
          className="w-full"
        />
        <p className="ui-hint">{t("config.minWeightHint")}</p>
      </label>

      <label className="block space-y-2">
        <span className="ui-label">
          {t("config.maxTurnover", { pct: Math.round(value.max_turnover * 100) })}
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
        <p className="ui-hint">{t("config.maxTurnoverHint")}</p>
      </label>

      <p className="ui-hint">{t("config.limitsHint")}</p>

      <label className="block space-y-2">
        <span className="ui-label">
          {t("config.maxHoldings", { n: value.max_holdings ?? 30 })}
        </span>
        <input
          type="range"
          min={1}
          max={50}
          step={1}
          value={value.max_holdings ?? 30}
          onChange={(e) =>
            onChange({ ...value, max_holdings: Number(e.target.value) })
          }
          className="w-full"
        />
        <p className="ui-hint">{t("config.maxHoldingsHint")}</p>
      </label>

      <label className="block space-y-2">
        <span className="ui-label">{t("config.objective")}</span>
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
          {OBJECTIVE_KEYS
            // "dynamic" is retired from the selector — regime switching is now the
            // standalone Regime-adaptive toggle below. Kept only for legacy jobs
            // that were saved with objective=dynamic so the control still renders.
            .filter((k) => k !== "dynamic" || value.objective === "dynamic")
            .map((k) => (
              <option key={k} value={k}>
                {objectiveLabel(t, k)}
              </option>
            ))}
        </select>
        <p className="ui-hint">
          {value.objective === "dynamic"
            ? t("config.objectiveHint.dynamic")
            : t("config.objectiveHint.default")}
        </p>
      </label>
      {value.objective === "custom" && (
        <label className="block space-y-2">
          <span className="ui-label">{t("config.customObjective")}</span>
          <textarea
            value={value.objective_custom_text ?? ""}
            onChange={(e) => onChange({ ...value, objective_custom_text: e.target.value })}
            placeholder={t("config.customObjectivePlaceholder")}
            className="pixel-input min-h-20"
          />
          <p className="ui-hint">{t("config.customObjectiveHint")}</p>
        </label>
      )}

      <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
        <label className="ui-label flex items-center gap-2">
          <input
            type="checkbox"
            checked={dynamicObjective || Boolean(value.regime_adaptive)}
            disabled={dynamicObjective}
            onChange={(e) =>
              onChange({ ...value, regime_adaptive: e.target.checked })
            }
            className="accent-[var(--neon)]"
          />
          {t("config.regimeAdaptive")}
        </label>
        <p className="ui-hint">
          {dynamicObjective
            ? t("config.regimeAdaptiveHint.dynamic")
            : Boolean(value.regime_adaptive)
              ? t("config.regimeAdaptiveHint.on")
              : t("config.regimeAdaptiveHint.off")}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-2">
          <span className="ui-label">{t("config.start")}</span>
          <input
            type="date"
            value={value.start_date}
            onChange={(e) => onChange({ ...value, start_date: e.target.value })}
            className="pixel-input"
          />
          <p className="ui-hint">{t("config.startHint")}</p>
        </label>
        <label className="block space-y-2">
          <span className="ui-label">{t("config.end")}</span>
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
        <span className="ui-label">{t("config.trials", { n: value.trials })}</span>
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
        <p className="ui-hint">
          {isPro
            ? t("config.trialsHint.pro")
            : t("config.trialsHint.standard")}
        </p>
      </label>

      <label className="block space-y-2">
        <span className="ui-label">{t("config.topModels", { n: value.top_models })}</span>
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

      <label className="ui-label flex items-center gap-2">
        <input
          type="checkbox"
          checked={value.enable_oos}
          onChange={(e) => onChange({ ...value, enable_oos: e.target.checked })}
          className="accent-[var(--neon)]"
        />
        {t("config.holdout")}
      </label>

      {value.enable_oos && (
        <label className="block space-y-2">
          <span className="ui-label">
            {t("config.inSampleRatio", { pct: Math.round(value.train_ratio * 100) })}
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
        <span className="ui-label">{t("config.fee", { bps: value.fee_bps })}</span>
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
        <span className="ui-label">{t("config.rebalanceFreq")}</span>
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
          <option value="W-FRI">{t("config.rebalance.weekly")}</option>
          <option value="ME">{t("config.rebalance.monthly")}</option>
          <option value="QE">{t("config.rebalance.quarterly")}</option>
          <option value="YE">{t("config.rebalance.yearly")}</option>
        </select>
      </label>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 ui-hint">
        {t("config.benchmarkLine")}
      </div>
      <details className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
        <summary className="ui-section-title cursor-pointer">
          {t("config.advanced.title")}
        </summary>
        <p className="mt-2 ui-hint">
          {t("config.advanced.maxWeightNote", { pct: Math.round(runMaxWeight * 100) })}
        </p>
        <div className="mt-3 space-y-2 border-b border-[var(--border)] pb-3">
          <p className="ui-hint">{t("config.advanced.categorical")}</p>
          {categoricalSpecs.map((s) => {
            const runLevelFixed =
              s.key === "objective_mode" || s.key === "rebalance_freq";
            const c =
              controls[s.key] ??
              (runLevelFixed
                ? { mode: "fixed" as const, options: s.options, fixed: s.defaultFixed }
                : { mode: "search" as const, options: s.options, fixed: s.defaultFixed });
            return (
              <div key={s.key} className="grid grid-cols-[1fr_0.8fr_1fr] items-center gap-2">
                <div className="ui-label">{s.label}</div>
                <select
                  value={c.mode}
                  onChange={(e) =>
                    setControl(s.key, {
                      mode: e.target.value as ParamControl["mode"],
                      options: [...s.options],
                      fixed: c.fixed ?? s.defaultFixed,
                    })
                  }
                  className="pixel-input py-1 ui-dropdown"
                >
                  <option value="search">{t("config.advanced.search")}</option>
                  <option value="fixed">{t("config.advanced.fixed")}</option>
                  <option value="off">{t("config.advanced.off")}</option>
                </select>
                <select
                  value={String(c.fixed ?? s.defaultFixed)}
                  onChange={(e) =>
                    setControl(s.key, { fixed: e.target.value, options: [...s.options] })
                  }
                  className="pixel-input py-1 ui-dropdown"
                >
                  {s.options.map((op) => (
                    <option key={op} value={op}>
                      {formatCategoricalOption(s.key, op, t)}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
        <div className="mt-3 space-y-2 border-b border-[var(--border)] pb-3">
          <p className="ui-hint">{t("config.advanced.factorIndicators")}</p>
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
                className="grid grid-cols-[1fr_0.8fr_1.2fr] items-start gap-2"
              >
                <div>
                  <div className="ui-label">{factorIndicatorLabel(t, s.key)}</div>
                  <div className="ui-hint mt-0.5">{factorIndicatorHint(t, s.key)}</div>
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
                  className="pixel-input py-1 ui-dropdown"
                >
                  <option value="search">{t("config.advanced.search")}</option>
                  <option value="fixed">{t("config.advanced.fixed")}</option>
                  <option value="off">{t("config.advanced.off")}</option>
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
                    className="pixel-input py-1 ui-dropdown"
                    title={
                      c.mode === "search"
                        ? t("config.advanced.searchHint")
                        : t("config.advanced.fixedHint")
                    }
                  >
                    {s.options.map((op) => (
                      <option key={op} value={op}>
                        {indicatorOptionLabel(t, op)}
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
                className={`grid items-center gap-2 ${
                  c.mode === "fixed"
                    ? "grid-cols-[1.3fr_0.8fr_1fr]"
                    : "grid-cols-[1.3fr_0.8fr_1fr_1fr_1fr]"
                }`}
              >
                <div className="ui-label">{s.label}</div>
                <select
                  value={c.mode}
                  onChange={(e) => setControl(s.key, { mode: e.target.value as ParamControl["mode"] })}
                  className="pixel-input py-1"
                >
                  <option value="search">{t("config.advanced.search")}</option>
                  <option value="fixed">{t("config.advanced.fixed")}</option>
                  <option value="off">{t("config.advanced.off")}</option>
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

      <label className="block space-y-2">
        <span className="ui-label">{t("config.notifyEmail")}</span>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          value={value.notify_email ?? ""}
          onChange={(e) =>
            onChange({ ...value, notify_email: e.target.value || null })
          }
          placeholder={t("config.notifyEmailPlaceholder")}
          className="pixel-input"
        />
        <p className="ui-hint">{t("config.notifyEmailHint")}</p>
        {value.notify_email?.trim() && emailNotificationsEnabled === false ? (
          <p className="ui-hint text-[var(--amber)]">
            {t("config.notifyEmailSmtpDisabled")}
          </p>
        ) : null}
      </label>

      <button
        type="button"
        onClick={onRun}
        disabled={offline}
        aria-disabled={offline}
        title={offline ? t("config.runOfflineHint") : undefined}
        className={`pixel-btn w-full ${isPro ? "pixel-btn-amber" : ""} ${
          offline ? "cursor-not-allowed opacity-50" : ""
        }`}
      >
        {isPro ? t("config.runPro") : t("config.runStandard")}
      </button>
      {offline ? (
        <p className="ui-hint text-[var(--amber)]">{t("config.runOfflineHint")}</p>
      ) : null}
    </div>
  );
}
