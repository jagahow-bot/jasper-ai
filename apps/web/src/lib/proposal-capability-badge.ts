/**
 * Investment proposal badge / print gate for pending L2 capabilities (§4.5.3).
 */

export type CapabilityUsageSnap = {
  stage: string;
  implementation_id: string;
  version: string;
  status: string;
  pending_supervisor_signoff?: boolean;
};

export function pendingSupervisorCapabilities(
  used: CapabilityUsageSnap[] | null | undefined,
): CapabilityUsageSnap[] {
  if (!used?.length) return [];
  return used.filter(
    (c) =>
      c.pending_supervisor_signoff === true || c.status === "rm_confirmed",
  );
}

export function proposalRequiresSupervisorSignoff(
  used: CapabilityUsageSnap[] | null | undefined,
  opts: { policyEnabled?: boolean } = {},
): boolean {
  const policyEnabled = opts.policyEnabled ?? true;
  if (!policyEnabled) return false;
  return pendingSupervisorCapabilities(used).length > 0;
}

/** UI badge copy — zh default with en/ko via i18n keys elsewhere. */
export function pendingCapabilitiesBadgeLabel(
  count: number,
  lang: "zh" | "en" | "ko" = "zh",
): string {
  if (lang === "en") return `Pending supervisor sign-off (${count})`;
  if (lang === "ko") return `감독자 승인 대기 (${count})`;
  return `含待簽核能力（${count}）`;
}

export function proposalPrintBlockedMessage(
  lang: "zh" | "en" | "ko" = "zh",
): string {
  if (lang === "en") {
    return "Print/export blocked until supervisor batch sign-off of pending capabilities.";
  }
  if (lang === "ko") {
    return "대기 중인 능력에 대한 감독자 일괄 승인 전까지 인쇄/내보내기가 차단됩니다.";
  }
  return "含待簽核能力：主管批次簽核完成前不得對客戶列印／匯出建議書。";
}

