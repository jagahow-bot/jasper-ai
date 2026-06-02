"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FontSizeControl } from "@/components/FontSizeControl";
import { ObjectiveSwitchLabReport } from "@/components/ObjectiveSwitchLabReport";
import { checkApiHealth, evaluateObjectiveSwitchLab } from "@/lib/api";
import { ASSET_CLASSES, DEFAULT_ASSET_CLASSES } from "@/lib/constants";
import type {
  ExperimentalRegimeMode,
  Objective,
  ObjectiveSwitchLabRequest,
  ObjectiveSwitchLabResult,
} from "@/lib/types";

const OBJECTIVES: { value: Objective; label: string }[] = [
  { value: "max_sharpe", label: "Max Sharpe" },
  { value: "max_return", label: "Max return" },
  { value: "min_max_drawdown", label: "Min max DD" },
];

const REGIME_OPTIONS: { value: ExperimentalRegimeMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "risk_off", label: "Risk-off" },
  { value: "neutral", label: "Neutral" },
  { value: "risk_on", label: "Risk-on" },
];

const DEFAULT_LAB: ObjectiveSwitchLabRequest = {
  start_date: "2018-01-01",
  end_date: "2024-12-31",
  benchmark_ticker: "SPY",
  regime_mode: "auto",
  fixed_objective: "max_sharpe",
  asset_classes: [...DEFAULT_ASSET_CLASSES],
  enable_oos: true,
  train_ratio: 0.7,
  cooldown_steps: 2,
  confirm_steps: 1,
};

export default function ObjectiveSwitchLabPage() {
  const [form, setForm] = useState<ObjectiveSwitchLabRequest>(DEFAULT_LAB);
  const [result, setResult] = useState<ObjectiveSwitchLabResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);

  useEffect(() => {
    void checkApiHealth().then(setApiOnline);
  }, []);

  const onRun = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await evaluateObjectiveSwitchLab(form);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lab evaluation failed");
    } finally {
      setLoading(false);
    }
  }, [form]);

  const applyPolicyStub = () => {
    const payload = {
      regime_mode: form.regime_mode,
      fixed_objective: form.fixed_objective,
      cooldown_steps: form.cooldown_steps,
    };
    try {
      localStorage.setItem("jasper_objective_policy", JSON.stringify(payload));
    } catch {
      /* ignore */
    }
    const q = encodeURIComponent(JSON.stringify(payload));
    window.open(`/?objective_policy=${q}`, "_blank", "noopener");
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b-2 border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div>
            <h1 className="font-pixel text-sm glow-title text-neon">Objective Switch Lab</h1>
            <p className="mt-1 font-terminal text-sm text-dim">
              Standalone regime / objective evaluation — not Jasper backtest
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FontSizeControl />
            {apiOnline === true && <span className="pixel-badge-cyan">API linked</span>}
            <Link href="/" className="pixel-btn text-[8px]">
              ← Main Jasper
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <div className="pixel-panel border-[var(--amber)] p-5">
          <p className="font-pixel text-[8px] text-[var(--amber)]">Lab inputs</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-xs">
              Start
              <input
                type="date"
                className="pixel-input mt-1 w-full"
                value={form.start_date}
                onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
              />
            </label>
            <label className="block text-xs">
              End
              <input
                type="date"
                className="pixel-input mt-1 w-full"
                value={form.end_date}
                onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
              />
            </label>
            <label className="block text-xs">
              Benchmark (optional)
              <input
                className="pixel-input mt-1 w-full"
                value={form.benchmark_ticker ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, benchmark_ticker: e.target.value || "SPY" }))
                }
              />
            </label>
            <label className="block text-xs">
              Regime mode
              <select
                className="pixel-input mt-1 w-full"
                value={form.regime_mode}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    regime_mode: e.target.value as ExperimentalRegimeMode,
                  }))
                }
              >
                {REGIME_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs">
              Fixed objective (comparison arm)
              <select
                className="pixel-input mt-1 w-full"
                value={form.fixed_objective}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    fixed_objective: e.target.value as Objective,
                  }))
                }
              >
                {OBJECTIVES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs">
              Train ratio (IS / OOS)
              <input
                type="number"
                step={0.05}
                min={0.5}
                max={0.85}
                className="pixel-input mt-1 w-full"
                value={form.train_ratio}
                onChange={(e) =>
                  setForm((f) => ({ ...f, train_ratio: Number(e.target.value) }))
                }
              />
            </label>
          </div>

          <fieldset className="mt-4">
            <legend className="font-pixel text-[8px] text-dim">Asset classes (universe filter)</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {ASSET_CLASSES.map((cls) => {
                const on = form.asset_classes?.includes(cls) ?? false;
                return (
                  <button
                    key={cls}
                    type="button"
                    className={`pixel-btn text-[8px] ${on ? "" : "opacity-50"}`}
                    onClick={() =>
                      setForm((f) => {
                        const cur = f.asset_classes ?? [...DEFAULT_ASSET_CLASSES];
                        const next = on ? cur.filter((c) => c !== cls) : [...cur, cls];
                        return { ...f, asset_classes: next.length ? next : [...DEFAULT_ASSET_CLASSES] };
                      })
                    }
                  >
                    {cls}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label className="mt-4 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={form.enable_oos}
              onChange={(e) => setForm((f) => ({ ...f, enable_oos: e.target.checked }))}
            />
            Enable OOS holdout
          </label>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              className="pixel-btn pixel-btn-primary disabled:opacity-40"
              disabled={loading}
              onClick={() => void onRun()}
            >
              {loading ? "Evaluating…" : "Run lab evaluation"}
            </button>
            <button
              type="button"
              className="pixel-btn opacity-50"
              disabled={!result}
              title="Future bridge — copies policy to localStorage and opens main app"
              onClick={applyPolicyStub}
            >
              Apply policy to backtest (stub)
            </button>
          </div>
          {error && <p className="mt-3 text-sm text-[var(--amber)]">{error}</p>}
        </div>

        <p className="text-xs text-dim">
          This lab does not create backtest jobs, Pro rounds, AI universe picks, or result history
          entries. It only scores fixed vs regime-based objective presets on a lightweight simulator.
        </p>

        {result && <ObjectiveSwitchLabReport result={result} />}
      </main>
    </div>
  );
}
