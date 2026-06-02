"use client";

import { useEffect, useState } from "react";
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
import {
  resolveUniverseFilterPrompts,
  type UniverseFilterRuleResult,
} from "@/lib/universe-filter-merge";
import type { BacktestRequest } from "@/lib/types";

type Props = {
  value: BacktestRequest;
  onChange: (next: BacktestRequest) => void;
};

function ruleKey(index: number, rule: string) {
  return `rule-${index}-${rule.slice(0, 32)}`;
}

export function AssetClassFilter({ value, onChange }: Props) {
  const [draftText, setDraftText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rationale, setRationale] = useState<string | null>(null);
  const [perRuleResults, setPerRuleResults] = useState<
    UniverseFilterRuleResult[] | null
  >(null);
  const [expandedRules, setExpandedRules] = useState<Record<number, boolean>>(
    {},
  );

  const pendingRules = resolveUniverseFilterPrompts(value);
  const hasAiApplied =
    pendingRules.length > 0 ||
    Boolean(value.universe_categories?.length) ||
    Boolean(value.universe_tickers?.length);

  useEffect(() => {
    if (!hasAiApplied) {
      setRationale(null);
      setPerRuleResults(null);
      setExpandedRules({});
    }
  }, [hasAiApplied]);

  const total = getUniverseMeta().count;
  const baseCount = countUniverse({ assetClasses: value.asset_classes });
  const selectedCount = countUniverse(universeFilterFromRequest(value));

  const toggle = (ac: AssetClass) => {
    const classes = value.asset_classes;
    const nextClasses = classes.includes(ac)
      ? classes.filter((x) => x !== ac)
      : [...classes, ac];
    onChange({
      ...value,
      asset_classes: nextClasses.length ? nextClasses : [...ASSET_CLASSES],
    });
  };

  const syncPrompts = (next: string[]) => {
    onChange({
      ...value,
      universe_filter_prompts: next.length ? next : null,
      universe_filter_text: next.length ? next.join("; ") : null,
    });
  };

  const addDraftRule = () => {
    const line = draftText.trim();
    if (!line) return;
    if (pendingRules.some((r) => r === line)) {
      setDraftText("");
      setError(null);
      return;
    }
    syncPrompts([...pendingRules, line]);
    setDraftText("");
    setError(null);
    setPerRuleResults(null);
  };

  const removeRule = (index: number) => {
    const next = pendingRules.filter((_, i) => i !== index);
    onChange({
      ...value,
      universe_filter_prompts: next.length ? next : null,
      universe_filter_text: next.length ? next.join("; ") : null,
      ...(next.length
        ? {}
        : {
            universe_categories: null,
            universe_tickers: null,
          }),
    });
    if (!next.length) {
      setRationale(null);
      setPerRuleResults(null);
      setExpandedRules({});
    } else {
      setPerRuleResults(null);
    }
  };

  const applyWithAi = async () => {
    const prompts = pendingRules;
    if (!prompts.length) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/universe/filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          texts: prompts,
          asset_classes: value.asset_classes,
        }),
      });
      const data = (await res.json()) as {
        asset_classes?: AssetClass[];
        categories?: string[];
        tickers?: string[];
        rationale?: string;
        per_rule?: UniverseFilterRuleResult[];
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
        universe_filter_prompts: prompts,
        universe_filter_text: prompts.join("; "),
      });
      setRationale(data.rationale ?? null);
      setPerRuleResults(data.per_rule ?? null);
      setExpandedRules(
        Object.fromEntries(prompts.map((_, i) => [i, prompts.length <= 2])),
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Filter analysis failed. Try again later.",
      );
    } finally {
      setLoading(false);
    }
  };

  const clearCustomFilter = () => {
    setDraftText("");
    setRationale(null);
    setError(null);
    setPerRuleResults(null);
    setExpandedRules({});
    onChange({
      ...value,
      universe_categories: null,
      universe_tickers: null,
      universe_filter_text: null,
      universe_filter_prompts: null,
    });
  };

  const toggleRuleExpanded = (index: number) => {
    setExpandedRules((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-pixel text-[10px] uppercase tracking-wide text-[var(--foreground)]">
            ASSET CLASSES
          </span>
          <span className="text-xs text-dim">
            {hasAiApplied ? (
              <>
                {selectedCount} / {baseCount} (in class) · universe {total}
              </>
            ) : (
              <>
                {baseCount} / {total} names
              </>
            )}
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
        <p className="text-xs text-dim">
          Narrow the pool by asset class first ({baseCount} names). AI rules below
          filter within selected classes only—they never widen them.
        </p>
      </div>

      <div className="space-y-2 border-t border-[var(--border)] pt-4">
        <div className="flex items-center justify-between">
          <span className="font-pixel text-[10px] uppercase tracking-wide text-[var(--foreground)]">
            AI UNIVERSE FILTER
          </span>
          {hasAiApplied && (
            <button
              type="button"
              onClick={clearCustomFilter}
              className="text-xs text-[var(--cyan)] hover:underline"
            >
              CLEAR AI FILTER
            </button>
          )}
        </div>
        <p className="text-xs text-dim">
          Add one rule at a time with ADD RULE, then APPLY AI FILTER to run all
          rules together (AND). Each rule stays a separate line in the list.
        </p>

        {pendingRules.length > 0 && (
          <ol className="space-y-1.5">
            {pendingRules.map((rule, index) => (
              <li
                key={ruleKey(index, rule)}
                className="flex items-start gap-2 rounded border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-xs"
              >
                <span className="shrink-0 font-pixel text-[10px] text-[var(--cyan)]">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 text-[var(--foreground)]">{rule}</span>
                <button
                  type="button"
                  onClick={() => removeRule(index)}
                  className="shrink-0 text-[var(--magenta)] hover:underline"
                  aria-label={`Remove rule ${index + 1}`}
                >
                  REMOVE
                </button>
              </li>
            ))}
          </ol>
        )}

        <textarea
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          placeholder="e.g. US tech and healthcare only; exclude bonds; short-duration Treasuries"
          className="pixel-input min-h-20"
        />
        {error && <p className="text-sm text-[var(--magenta)]">{error}</p>}
        {rationale && (
          <p className="text-xs text-[var(--cyan)]">{rationale}</p>
        )}
        {perRuleResults && perRuleResults.length > 0 && (
          <div className="space-y-2 rounded border border-[var(--border)] bg-[var(--panel)] p-2">
            <p className="font-pixel text-[10px] uppercase tracking-wide text-[var(--foreground)]">
              FILTER RESULTS
            </p>
            <p className="text-xs text-dim">
              Combined pool: {selectedCount} ETF
              {selectedCount === 1 ? "" : "s"} selected (all rules applied).
            </p>
            <ul className="space-y-1">
              {perRuleResults.map((row) => (
                <li key={ruleKey(row.rule_index, row.rule_text)} className="text-xs">
                  <button
                    type="button"
                    onClick={() => toggleRuleExpanded(row.rule_index)}
                    className="flex w-full items-start gap-2 text-left hover:text-[var(--cyan)]"
                  >
                    <span className="shrink-0 font-pixel text-[10px] text-[var(--cyan)]">
                      {row.rule_index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-[var(--foreground)]">
                        &quot;{row.rule_text}&quot;
                      </span>
                      <span className="text-dim">
                        {" "}
                        → {row.tickers.length} ticker
                        {row.tickers.length === 1 ? "" : "s"}
                        {expandedRules[row.rule_index] ? "" : " (expand)"}
                      </span>
                    </span>
                  </button>
                  {expandedRules[row.rule_index] && (
                    <div className="mt-1 pl-5 text-dim">
                      {row.categories?.length ? (
                        <p>Categories: {row.categories.join(", ")}</p>
                      ) : null}
                      <p className="break-words">
                        Tickers:{" "}
                        {row.tickers.length
                          ? row.tickers.join(", ")
                          : "(none in universe for this rule)"}
                      </p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {!perRuleResults && value.universe_categories?.length ? (
          <p className="text-xs text-dim">
            Category tags: {value.universe_categories.join(", ")}
            {value.universe_tickers?.length
              ? ` · ${value.universe_tickers.length} tickers`
              : ""}
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={addDraftRule}
            disabled={!draftText.trim()}
            className="pixel-btn flex-1 disabled:opacity-40"
          >
            ADD RULE
          </button>
          <button
            type="button"
            onClick={() => void applyWithAi()}
            disabled={loading || pendingRules.length === 0}
            className="pixel-btn flex-1 disabled:opacity-40"
          >
            {loading ? "APPLYING…" : "APPLY AI FILTER"}
          </button>
        </div>
      </div>
    </div>
  );
}
