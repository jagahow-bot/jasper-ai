"use client";

import { useState } from "react";
import {
  ASSET_CLASSES,
  ASSET_CLASS_LABELS,
  type AssetClass,
} from "@/lib/constants";
import {
  countUniverse,
  getUniverseMeta,
  universeFilterFromRequest,
} from "@/lib/universe";
import type { BacktestRequest } from "@/lib/types";

type Props = {
  value: BacktestRequest;
  onChange: (next: BacktestRequest) => void;
};

export function AssetClassFilter({ value, onChange }: Props) {
  const [filterText, setFilterText] = useState(value.universe_filter_text ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rationale, setRationale] = useState<string | null>(null);

  const total = getUniverseMeta().count;
  const selectedCount = countUniverse(universeFilterFromRequest(value));

  const toggle = (ac: AssetClass) => {
    const classes = value.asset_classes;
    const nextClasses = classes.includes(ac)
      ? classes.filter((x) => x !== ac)
      : [...classes, ac];
    onChange({
      ...value,
      asset_classes: nextClasses.length ? nextClasses : [...ASSET_CLASSES],
      universe_categories: null,
      universe_tickers: null,
      universe_filter_text: null,
    });
    setRationale(null);
    setFilterText("");
  };

  const applyWithAi = async () => {
    if (!filterText.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/universe/filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: filterText.trim() }),
      });
      const data = (await res.json()) as {
        asset_classes?: AssetClass[];
        categories?: string[];
        tickers?: string[];
        rationale?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "Filter analysis failed");
      }
      if (!data.asset_classes?.length) {
        throw new Error("Filter analysis failed");
      }
      onChange({
        ...value,
        asset_classes: data.asset_classes,
        universe_categories: data.categories?.length ? data.categories : null,
        universe_tickers: data.tickers?.length ? data.tickers : null,
        universe_filter_text: filterText.trim(),
      });
      setRationale(data.rationale ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Filter analysis failed — try again");
    } finally {
      setLoading(false);
    }
  };

  const clearCustomFilter = () => {
    setFilterText("");
    setRationale(null);
    setError(null);
    onChange({
      ...value,
      universe_categories: null,
      universe_tickers: null,
      universe_filter_text: null,
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--foreground)]">Universe asset classes</span>
          <span className="text-xs text-dim">
            {selectedCount} / {total} tickers
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {ASSET_CLASSES.map((ac) => {
            const active = value.asset_classes.includes(ac);
            return (
              <button
                key={ac}
                type="button"
                onClick={() => toggle(ac)}
                className={`pixel-chip ${active ? "pixel-chip-active" : ""}`}
              >
                {ASSET_CLASS_LABELS[ac]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2 border-t border-[var(--border)] pt-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--foreground)]">Custom universe filter</span>
          {(value.universe_filter_text || value.universe_categories?.length || value.universe_tickers?.length) && (
            <button
              type="button"
              onClick={clearCustomFilter}
              className="text-xs text-[var(--cyan)] hover:underline"
            >
              Clear AI filter
            </button>
          )}
        </div>
        <p className="text-xs text-dim">
          Describe sectors, sleeves, or exclusions — AI maps to asset classes and category tags.
        </p>
        <textarea
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder='e.g. "US tech and healthcare sectors only", "no bonds", "treasuries and gold only"'
          className="pixel-input min-h-20"
        />
        {error && <p className="text-sm text-[var(--magenta)]">{error}</p>}
        {rationale && (
          <p className="text-xs text-[var(--cyan)]">{rationale}</p>
        )}
        {value.universe_categories?.length ? (
          <p className="text-xs text-dim">
            Categories: {value.universe_categories.join(", ")}
            {value.universe_tickers?.length
              ? ` · ${value.universe_tickers.length} tickers`
              : ""}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void applyWithAi()}
          disabled={loading || !filterText.trim()}
          className="pixel-btn w-full disabled:opacity-40"
        >
          {loading ? "Applying…" : "Apply with AI"}
        </button>
      </div>
    </div>
  );
}
