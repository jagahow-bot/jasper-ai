"use client";

import type {
  ClarificationDraft,
  ClarificationSnapshot,
} from "@/lib/overlay-clarifications";
import {
  buildClarificationAnswer,
  clarificationAllowsMultiple,
} from "@/lib/overlay-clarifications";
import type { OverlayClarification } from "@/lib/overlay-schema";
import { useI18n } from "@/lib/i18n";

type Props = {
  clarifications: OverlayClarification[];
  drafts: ClarificationDraft[];
  history: ClarificationSnapshot[];
  disabled?: boolean;
  onDraftChange: (index: number, draft: ClarificationDraft) => void;
};

function ReadonlySnapshot({ snapshot }: { snapshot: ClarificationSnapshot }) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border border-[var(--border)]/70 bg-[var(--surface-2)]/80 px-3 py-2 opacity-90">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">
        {t("overlay.clarify.answeredReadonly")}
      </p>
      <ul className="mt-1.5 space-y-1">
        {snapshot.items.map((item, i) => (
          <li key={`${snapshot.id}-${i}`} className="text-xs leading-snug">
            <span className="font-medium text-[var(--foreground)]">
              {item.question}
            </span>
            <span className="text-dim"> — {item.answer}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ClarificationCard({
  clarification,
  index,
  total,
  draft,
  disabled,
  lang,
  onDraftChange,
}: {
  clarification: OverlayClarification;
  index: number;
  total: number;
  draft: ClarificationDraft;
  disabled?: boolean;
  lang: "zh" | "en" | "ko";
  onDraftChange: (draft: ClarificationDraft) => void;
}) {
  const { t } = useI18n();
  const multi = clarificationAllowsMultiple(clarification);
  const selected = new Set(draft.selectedOptionIds);
  const answerPreview = buildClarificationAnswer(clarification, draft, lang);

  const toggleOption = (optionId: string) => {
    if (disabled) return;
    const next = new Set(draft.selectedOptionIds);
    if (next.has(optionId)) {
      next.delete(optionId);
    } else if (multi) {
      next.add(optionId);
    } else {
      next.clear();
      next.add(optionId);
    }
    onDraftChange({
      ...draft,
      selectedOptionIds: [...next],
    });
  };

  return (
    <div className="rounded-lg border border-[var(--primary)]/25 bg-[var(--surface)] px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">
        {t("overlay.clarify.questionProgress", { current: index + 1, total })}{" "}
        · {multi ? t("overlay.clarify.pickMany") : t("overlay.clarify.pickOne")}
      </p>
      <p className="mt-1 text-sm font-medium leading-snug text-[var(--foreground)]">
        {clarification.question}
      </p>
      {clarification.options.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {clarification.options.map((opt) => {
            const active = selected.has(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                disabled={disabled}
                onClick={() => toggleOption(opt.id)}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
                  active
                    ? "border-[var(--primary)] bg-[var(--primary-muted)] font-medium text-[var(--primary)]"
                    : "border-[var(--border)] bg-white text-[var(--ui-color-body)] hover:border-[var(--primary)]/40"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              onDraftChange({ ...draft, otherOpen: !draft.otherOpen })
            }
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
              draft.otherOpen || draft.freeText.trim()
                ? "border-[var(--primary)] bg-[var(--primary-muted)] font-medium text-[var(--primary)]"
                : "border-dashed border-[var(--border)] text-dim hover:border-[var(--primary)]/40"
            }`}
          >
            {t("overlay.clarify.other")}
          </button>
        </div>
      ) : null}
      {draft.otherOpen || !clarification.options.length ? (
        <textarea
          value={draft.freeText}
          disabled={disabled}
          rows={2}
          onChange={(e) =>
            onDraftChange({ ...draft, freeText: e.target.value, otherOpen: true })
          }
          placeholder={t("overlay.clarify.otherPlaceholder")}
          className="pixel-input mt-2 max-h-24 w-full resize-y text-xs leading-snug"
        />
      ) : null}
      {answerPreview ? (
        <p className="mt-1.5 text-[10px] text-dim">
          {t("overlay.clarify.selected", {
            labels: answerPreview,
          })}
        </p>
      ) : null}
    </div>
  );
}

export function OverlayClarificationCards({
  clarifications,
  drafts,
  history,
  disabled,
  onDraftChange,
}: Props) {
  const { lang } = useI18n();

  return (
    <div className="space-y-2">
      {history.map((snapshot) => (
        <ReadonlySnapshot key={snapshot.id} snapshot={snapshot} />
      ))}
      {clarifications.map((c, i) => (
        <ClarificationCard
          key={c.id}
          clarification={c}
          index={i}
          total={clarifications.length}
          draft={drafts[i] ?? { selectedOptionIds: [], freeText: "", otherOpen: false }}
          disabled={disabled}
          lang={lang}
          onDraftChange={(draft) => onDraftChange(i, draft)}
        />
      ))}
    </div>
  );
}
