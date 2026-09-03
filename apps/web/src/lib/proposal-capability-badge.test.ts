import { describe, expect, it } from "vitest";
import {
  pendingCapabilitiesBadgeLabel,
  pendingSupervisorCapabilities,
  proposalPrintBlockedMessage,
  proposalRequiresSupervisorSignoff,
} from "./proposal-capability-badge";

describe("proposal-capability-badge", () => {
  const used = [
    {
      stage: "allocator",
      implementation_id: "two_layer_sleeve_v1",
      version: "0.1.0",
      status: "rm_confirmed",
      pending_supervisor_signoff: true,
    },
  ];

  it("collects pending L2 capabilities and blocks print by default", () => {
    expect(pendingSupervisorCapabilities(used)).toHaveLength(1);
    expect(proposalRequiresSupervisorSignoff(used)).toBe(true);
    expect(pendingCapabilitiesBadgeLabel(1, "zh")).toContain("含待簽核能力");
    expect(proposalPrintBlockedMessage("zh")).toContain("簽核");
  });

  it("allows print when policy disabled", () => {
    expect(proposalRequiresSupervisorSignoff(used, { policyEnabled: false })).toBe(
      false,
    );
  });
});
