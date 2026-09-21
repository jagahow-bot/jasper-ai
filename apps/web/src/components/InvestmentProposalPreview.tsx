"use client";

import { ProposalSlideDeck } from "@/components/ProposalSlideDeck";
import type { DemoClient } from "@/lib/clients";
import type { ClientOverlay } from "@/lib/overlay-schema";
import type { ModelPortfolio } from "@/lib/model-portfolios";
import type { PersonalizationCompare } from "@/lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
  compare: PersonalizationCompare;
  overlay: ClientOverlay | null;
  anchorPortfolio: ModelPortfolio;
  client?: DemoClient | null;
  /** Selected trial on the RM report; defaults to champion. */
  customizedModelCode?: string | null;
};

/**
 * Thin shell — slide deck fully replaces the former scrolling document mode (Q5-B).
 */
export function InvestmentProposalPreview(props: Props) {
  return <ProposalSlideDeck {...props} />;
}
