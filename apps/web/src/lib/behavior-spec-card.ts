/**
 * Behavior Spec Card builder for L1 RM confirmation (design §4.5.2).
 */

export type BehaviorSpecCard = {
  gap_ticket_id?: string;
  missing_capability: string;
  stage: string;
  what_changed: { zh: string; en: string; ko: string };
  variables: Array<{
    key: string;
    bounds?: string;
    description: { zh: string; en: string; ko: string };
  }>;
  invariants: string[];
  before_after: Array<{
    scenario: string;
    without: Record<string, number | string | null>;
    with_capability: Record<string, number | string | null>;
  }>;
  source_excerpt?: string;
};

export function buildBehaviorSpecCard(input: {
  stage: string;
  missing_capability: string;
  summary: string;
  gap_ticket_id?: string;
  requested?: Record<string, unknown>;
  nearest_supported?: Record<string, unknown> | null;
  source_excerpt?: string;
}): BehaviorSpecCard {
  const title = input.summary.slice(0, 200);
  return {
    gap_ticket_id: input.gap_ticket_id,
    missing_capability: input.missing_capability,
    stage: input.stage,
    what_changed: {
      zh: title,
      en: title,
      ko: title,
    },
    variables: Object.keys(input.requested ?? {}).slice(0, 8).map((key) => ({
      key,
      description: {
        zh: `請求欄位 ${key}`,
        en: `Requested field ${key}`,
        ko: `요청 필드 ${key}`,
      },
    })),
    invariants: [
      "sum(w) ≈ 1",
      "max_weight respected",
      "L1(w, anchor) ≤ customization_drift",
      "deterministic given seed",
    ],
    before_after: [
      {
        scenario: "canonical_nearest_supported",
        without: {
          note: "nearest_supported",
          ...(flattenNums(input.nearest_supported) as Record<
            string,
            number | string | null
          >),
        },
        with_capability: {
          note: "with_new_capability",
          ...(flattenNums(input.requested) as Record<string, number | string | null>),
        },
      },
    ],
    source_excerpt: input.source_excerpt,
  };
}

function flattenNums(
  obj: Record<string, unknown> | null | undefined,
): Record<string, number | string | null> {
  const out: Record<string, number | string | null> = {};
  if (!obj) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "number" || typeof v === "string" || v == null) {
      out[k] = v as number | string | null;
    }
  }
  return out;
}

/** Local draft PR body/files for a gap (GitHub open is stubbed). */
export function buildLocalCodegenDraft(input: {
  stage: string;
  implementation_id: string;
  missing_capability: string;
  summary: string;
  behavior_spec_card?: BehaviorSpecCard | null;
}): {
  pr_title: string;
  pr_body: string;
  files: Array<{ path: string; contents: string }>;
  github_pr_url: null;
} {
  const impl = input.implementation_id;
  const stage = input.stage;
  const base = `apps/api/app/engine/stages/contrib/${stage}/${impl}`;
  const pr_title = `feat(stages): add ${stage}/${impl} for ${input.missing_capability}`;
  const pr_body = [
    `## Summary`,
    `- Capability gap: \`${input.missing_capability}\``,
    `- Stage: \`${stage}\` / impl: \`${impl}\``,
    `- ${input.summary}`,
    ``,
    `## Behavior Spec Card`,
    "```json",
    JSON.stringify(input.behavior_spec_card ?? {}, null, 2),
    "```",
    ``,
    `## Engineer exception checklist (only if semantic_review ≠ aligned)`,
    `- [ ] AST allowlist`,
    `- [ ] No runtime IO / network / external randomness`,
    `- [ ] validate_config / feasibility bounds`,
    `- [ ] attainment hook safe when client_context=None`,
    `- [ ] i18n zh/en/ko`,
    `- [ ] Perf numbers attached`,
    `- [ ] Semantic review partial/mismatched items addressed`,
    ``,
    `> GitHub PR auto-open is stubbed — files are generated locally.`,
  ].join("\n");

  const files = [
    {
      path: `${base}/implementation.py`,
      contents: `# Draft scaffold for ${impl} — run scripts/new_stage_contribution.py to materialize.\n`,
    },
    {
      path: `${base}/BEHAVIOR_SPEC_CARD.json`,
      contents: JSON.stringify(input.behavior_spec_card ?? {}, null, 2) + "\n",
    },
    {
      path: `${base}/PR_BODY.md`,
      contents: pr_body + "\n",
    },
  ];
  return { pr_title, pr_body, files, github_pr_url: null };
}
