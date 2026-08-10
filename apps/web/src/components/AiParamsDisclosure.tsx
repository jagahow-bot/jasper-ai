"use client";

import { useMemo, useState } from "react";
import {
  buildParamSummaryKnobs,
  buildRoundTimeline,
  diffGroupedParams,
  groupCandidateParams,
  paramCategoryLabelKey,
  paramFriendlyLabelKey,
  resolveBaselineParams,
  type ParamCategoryGroup,
  type ParamSummaryKnob,
  type RoundTimelineEntry,
} from "@/lib/ai-params-disclosure";
import {
  allocatorLabel,
  objectiveLabel,
  rebalanceFreqLabel,
  useI18n,
  type TFn,
} from "@/lib/i18n";
import type {
  PortfolioCandidate,
  ProRoundSnapshot,
  ProposalCard,
} from "@/lib/types";

function resolveKnobDisplay(knob: ParamSummaryKnob, t: TFn): string {
  if (knob.id === "objective" && knob.valueCode) {
    return objectiveLabel(t, knob.valueCode) || knob.valueCode;
  }
  if (knob.id === "allocator" && knob.valueCode) {
    return allocatorLabel(t, knob.valueCode) || knob.valueCode;
  }
  if (knob.id === "scenario" && knob.valueCode) {
    const key = `results.proposalLabel.${knob.valueCode}`;
    const localized = t(key);
    return localized !== key ? localized : knob.valueCode;
  }
  return knob.displayValue ?? knob.valueCode ?? "—";
}

function resolveParamLabel(key: string, t: TFn): string {
  const proKey = paramFriendlyLabelKey(key);
  const proVal = t(proKey);
  if (proVal !== proKey) return proVal;
  const ctlKey = `config.control.${key}`;
  const ctlVal = t(ctlKey);
  if (ctlVal !== ctlKey) return ctlVal;
  if (key === "objective_mode") return t("config.categorical.objective_mode");
  if (key === "rebalance_freq") return t("config.categorical.rebalance_freq");
  if (key === "mode") return t("config.categorical.allocator_mode");
  return key.replace(/_/g, " ");
}

function formatRowDisplay(key: string, displayValue: string, t: TFn): string {
  if (key === "objective_mode") {
    return objectiveLabel(t, displayValue) || displayValue;
  }
  if (key === "mode" || key === "allocator_mode") {
    return allocatorLabel(t, displayValue) || displayValue;
  }
  if (key === "rebalance_freq") {
    return rebalanceFreqLabel(t, displayValue) || displayValue;
  }
  return displayValue;
}

export function AiParamsSummaryKnobs({
  params,
  needs,
  weights,
  className = "",
}: {
  params?: Record<string, unknown> | null;
  needs?: PortfolioCandidate["needs_attainment"] | null;
  weights?: Record<string, number> | null;
  className?: string;
}) {
  const { t } = useI18n();
  const knobs = useMemo(
    () => buildParamSummaryKnobs(params, needs, weights),
    [params, needs, weights],
  );
  if (!knobs.length) return null;
  return (
    <dl
      className={`mt-2 grid gap-1.5 ui-hint ${className}`}
      data-testid="ai-params-summary"
    >
      {knobs.map((knob) => (
        <div
          key={knob.id}
          className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5"
        >
          <dt className="text-dim">{t(knob.labelKey)}</dt>
          <dd className="tabular-nums text-[var(--fg)]">
            {resolveKnobDisplay(knob, t)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ParamGroupsTable({
  groups,
  showBaseline,
}: {
  groups: ParamCategoryGroup[];
  showBaseline: boolean;
}) {
  const { t } = useI18n();
  if (!groups.length) {
    return <p className="ui-hint mt-2 text-dim">{t("params.expand.empty")}</p>;
  }
  return (
    <div className="mt-2 space-y-3">
      {groups.map((group) => (
        <div key={group.category}>
          <p className="ui-section-title mb-1 text-dim">
            {t(paramCategoryLabelKey(group.category))}
          </p>
          <table className="w-full ui-hint">
            <tbody>
              {group.rows.map((row) => (
                <tr
                  key={row.key}
                  className={`border-t border-[var(--border)] ${
                    row.changed
                      ? "bg-[rgba(255,176,0,0.08)]"
                      : ""
                  }`}
                >
                  <td className="py-1 pr-2 text-dim">
                    {resolveParamLabel(row.key, t)}
                    {row.changed ? (
                      <span className="ml-1 text-[var(--amber)]">●</span>
                    ) : null}
                  </td>
                  <td className="py-1 text-right tabular-nums text-[var(--fg)]">
                    {formatRowDisplay(row.key, row.displayValue, t)}
                    {showBaseline &&
                    row.changed &&
                    row.baselineDisplayValue != null ? (
                      <span className="ml-1 text-dim">
                        ({formatRowDisplay(row.key, row.baselineDisplayValue, t)})
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export function AiParamsExpandablePanel({
  params,
  baselineParams,
  baselineCode,
  isBaseline,
  defaultOpen = false,
  compact = false,
}: {
  params?: Record<string, unknown> | null;
  baselineParams?: Record<string, unknown> | null;
  baselineCode?: string | null;
  isBaseline?: boolean;
  defaultOpen?: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const hasBaseline =
    Boolean(baselineParams) &&
    Object.keys(baselineParams ?? {}).length > 0 &&
    !isBaseline;

  const groups = useMemo(() => {
    if (hasBaseline) {
      return diffGroupedParams(params, baselineParams, { diffOnly: true });
    }
    return groupCandidateParams(params);
  }, [params, baselineParams, hasBaseline]);

  const unchangedHint =
    hasBaseline && groups.length === 0
      ? t("params.expand.identical", {
          code: baselineCode ?? "—",
        })
      : null;

  const toggleOpen = () => setOpen((v) => !v);

  return (
    <div
      className={
        compact
          ? "mt-2"
          : "mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2"
      }
      data-testid="ai-params-expand"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {/* Non-<button> so nested use inside proposal-card buttons is valid HTML. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          toggleOpen();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleOpen();
          }
        }}
        className="flex w-full cursor-pointer items-center justify-between gap-2 text-left"
      >
        <span className="ui-body text-[var(--fg)]">{t("params.expand.title")}</span>
        <span className="ui-hint text-dim">
          {open ? t("rm.report.collapse") : t("rm.report.expand")}
        </span>
      </div>
      {open ? (
        <>
          {hasBaseline ? (
            <p className="ui-hint mt-2 text-dim">
              {t("params.expand.diffHint", { code: baselineCode ?? "—" })}
            </p>
          ) : null}
          {unchangedHint ? (
            <p className="ui-hint mt-2 text-dim">{unchangedHint}</p>
          ) : (
            <ParamGroupsTable groups={groups} showBaseline={hasBaseline} />
          )}
        </>
      ) : null}
    </div>
  );
}

/** Summary + expandable for a selected / card candidate. */
export function AiParamsDisclosureBlock({
  candidate,
  candidates,
  proposals,
  baselineCode: baselineCodeProp,
  compact = false,
  showExpand = true,
}: {
  candidate?: PortfolioCandidate | null;
  candidates?: PortfolioCandidate[] | null;
  proposals?: ProposalCard[] | null;
  baselineCode?: string | null;
  compact?: boolean;
  showExpand?: boolean;
}) {
  const baseline = useMemo(
    () =>
      resolveBaselineParams(candidates, proposals, baselineCodeProp),
    [candidates, proposals, baselineCodeProp],
  );
  const code = (candidate?.model_code || "").toUpperCase();
  const isBaseline = Boolean(baseline.code && code && baseline.code === code);

  if (!candidate?.params && !candidate?.needs_attainment) return null;

  return (
    <div>
      <AiParamsSummaryKnobs
        params={candidate?.params}
        needs={candidate?.needs_attainment}
        weights={candidate?.weights}
      />
      {showExpand ? (
        <AiParamsExpandablePanel
          params={candidate?.params}
          baselineParams={baseline.params}
          baselineCode={baseline.code}
          isBaseline={isBaseline}
          compact={compact}
        />
      ) : null}
    </div>
  );
}

function TimelineRow({
  entry,
  onSelectRound,
  active,
}: {
  entry: RoundTimelineEntry;
  onSelectRound?: (round: number) => void;
  active?: boolean;
}) {
  const { t } = useI18n();
  const objective = entry.objectiveMode
    ? objectiveLabel(t, entry.objectiveMode)
    : "—";
  const allocator = entry.allocatorMode
    ? allocatorLabel(t, entry.allocatorMode)
    : null;

  const body = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="ui-section-title text-[var(--amber)]">
          {t("pro.roundChip", { n: entry.round })}
        </span>
        {entry.improved ? (
          <span className="pixel-badge-cyan text-[10px]">
            {t("params.timeline.improved")}
          </span>
        ) : (
          <span className="pixel-badge text-[10px] text-dim">
            {t("params.timeline.held")}
          </span>
        )}
        <span className="ui-hint text-dim">
          {t("params.timeline.trials", { n: entry.trialsInRound })}
        </span>
      </div>
      <p className="ui-body mt-1 text-[var(--fg)]">
        {t("params.timeline.objective")}: {objective}
        {allocator ? ` · ${allocator}` : ""}
      </p>
      <p className="ui-hint mt-0.5 text-dim">
        {t("params.timeline.champion")}: {entry.winnerCode ?? entry.championCode ?? "—"}
        {entry.score != null ? ` · ${t("params.timeline.score")}: ${entry.score.toFixed(3)}` : ""}
        {entry.sharpe != null ? ` · Sharpe ${entry.sharpe.toFixed(2)}` : ""}
        {entry.cagr != null
          ? ` · CAGR ${(entry.cagr * 100).toFixed(1)}%`
          : ""}
        {entry.maxDrawdown != null
          ? ` · MDD ${(entry.maxDrawdown * 100).toFixed(1)}%`
          : ""}
      </p>
      {entry.keyChanges.length > 0 ? (
        <ul className="ui-hint mt-1.5 space-y-0.5 text-dim">
          {entry.keyChanges.map((ch) => (
            <li key={ch.key}>
              <span className="text-[var(--fg)]">
                {resolveParamLabel(ch.key, t)}
              </span>
              : {formatRowDisplay(ch.key, ch.from, t)} →{" "}
              {formatRowDisplay(ch.key, ch.to, t)}
            </li>
          ))}
        </ul>
      ) : entry.round > 1 ? (
        <p className="ui-hint mt-1 text-dim">{t("params.timeline.noParamChange")}</p>
      ) : null}
    </>
  );

  if (onSelectRound) {
    return (
      <button
        type="button"
        onClick={() => onSelectRound(entry.round)}
        className={`w-full rounded-lg border p-3 text-left transition-colors ${
          active
            ? "border-[var(--amber)] bg-[rgba(255,176,0,0.12)]"
            : "border-[var(--border)] bg-[rgba(0,0,0,0.12)] hover:border-[var(--amber)]/60"
        }`}
      >
        {body}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[rgba(0,0,0,0.12)] p-3">
      {body}
    </div>
  );
}

export function ProRoundTimeline({
  rounds,
  activeRound,
  onSelectRound,
}: {
  rounds: ProRoundSnapshot[] | null | undefined;
  activeRound?: number | "final" | null;
  onSelectRound?: (round: number) => void;
}) {
  const { t } = useI18n();
  const timeline = useMemo(() => buildRoundTimeline(rounds), [rounds]);
  if (timeline.length < 1) return null;

  return (
    <section
      className="border-2 border-[var(--border)] bg-[rgba(0,0,0,0.08)] p-3"
      data-testid="pro-round-timeline"
    >
      <h3 className="ui-panel-title text-[var(--amber)]">
        {t("params.timeline.title")}
      </h3>
      <p className="ui-hint mt-1 text-dim">{t("params.timeline.hint")}</p>
      <div className="mt-3 space-y-2">
        {timeline.map((entry) => (
          <TimelineRow
            key={entry.round}
            entry={entry}
            onSelectRound={onSelectRound}
            active={activeRound === entry.round}
          />
        ))}
      </div>
    </section>
  );
}
