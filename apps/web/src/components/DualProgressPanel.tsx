"use client";

import { ProgressPanel } from "@/components/ProgressPanel";
import { useI18n } from "@/lib/i18n";
import type { JobProgress } from "@/lib/types";

type Props = {
  anchorProgress: JobProgress;
  customizedProgress: JobProgress;
};

export function DualProgressPanel({ anchorProgress, customizedProgress }: Props) {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <ProgressPanel progress={anchorProgress} label={t("progress.dual.anchor")} />
      <ProgressPanel
        progress={customizedProgress}
        label={t("progress.dual.customized")}
        accent="cyan"
      />
    </div>
  );
}
