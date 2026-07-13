"use client";

import { useI18n } from "@/lib/i18n";
import type { WizardPhase } from "@/lib/types";

type StepId = "anchor" | "overlay" | "execute" | "report";

const STEPS: StepId[] = ["anchor", "overlay", "execute", "report"];

function phaseToStep(phase: WizardPhase): StepId {
  if (phase === "anchor") return "anchor";
  if (phase === "overlay") return "overlay";
  if (phase === "constraints" || phase === "running") return "execute";
  return "report";
}

type Props = {
  phase: WizardPhase;
  hasOverlay: boolean;
};

export function RmWizardStepIndicator({ phase, hasOverlay }: Props) {
  const { t } = useI18n();
  const current = phaseToStep(phase);
  const currentIdx = STEPS.indexOf(current);

  const labels: Record<StepId, string> = {
    anchor: t("rm.step.anchor"),
    overlay: t("rm.step.overlay"),
    execute: t("rm.step.execute"),
    report: t("rm.step.report"),
  };

  return (
    <nav
      aria-label={t("rm.step.nav")}
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-sm"
    >
      <ol className="flex flex-wrap items-center gap-2 sm:gap-0">
        {STEPS.map((step, idx) => {
          const done = idx < currentIdx;
          const active = step === current;
          const skipped = step === "overlay" && !hasOverlay && currentIdx > 1;
          return (
            <li key={step} className="flex items-center">
              {idx > 0 && (
                <span
                  className={`mx-2 hidden h-px w-6 sm:block md:w-10 ${
                    done ? "bg-[var(--primary)]" : "bg-[var(--border)]"
                  }`}
                  aria-hidden
                />
              )}
              <div
                className={`flex items-center gap-2 rounded-lg px-2 py-1 ${
                  active
                    ? "bg-[var(--primary-muted)]"
                    : done
                      ? "opacity-100"
                      : "opacity-60"
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    active
                      ? "bg-[var(--primary)] text-white"
                      : done
                        ? "bg-[var(--primary-muted)] text-[var(--primary)]"
                        : "border border-[var(--border)] bg-white text-[var(--text-dim)]"
                  }`}
                >
                  {done ? "✓" : idx + 1}
                </span>
                <span
                  className={`ui-body whitespace-nowrap ${
                    active ? "font-medium text-[var(--primary)]" : done ? "text-[var(--foreground)]" : "text-dim"
                  }`}
                >
                  {labels[step]}
                  {skipped ? ` (${t("rm.step.skipped")})` : ""}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
