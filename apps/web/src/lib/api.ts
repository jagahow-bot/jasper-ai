import type {
  BacktestRequest,
  BacktestResult,
  CandidateChartsPayload,
  JobProgress,
  JobSummary,
  ObjectiveSwitchLabRequest,
  ObjectiveSwitchLabResult,
  ScenarioCard,
} from "./types";

/** Browser uses same-origin proxy (next.config rewrites) to avoid CORS / Failed to fetch. */
function getApiBase(): string {
  if (typeof window !== "undefined") {
    return "/quant-api";
  }
  return (
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://127.0.0.1:8001"
  );
}

const API_UNAVAILABLE_MSG =
  "Cannot reach quant API. From repo root run npm run dev and confirm api is on 127.0.0.1:8001 (no WinError 10013).";

function resStatusLabel(status: number): string {
  if (status === 404) return "Resource not found";
  if (status === 409) return "Job still running";
  if (status === 422) return "Invalid request";
  if (status === 502 || status === 503 || status === 504) {
    return (
      "Quant API is temporarily unavailable (server may have restarted after heavy load). " +
      "Wait 30–60 seconds and try again, or reduce search trials."
    );
  }
  return `Request failed (${status})`;
}

function formatApiError(status: number, body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return resStatusLabel(status);
  if (
    (status === 502 || status === 503 || status === 504) &&
    (trimmed.startsWith("<!") || trimmed.includes("<html"))
  ) {
    return resStatusLabel(status);
  }
  try {
    const parsed = JSON.parse(trimmed) as { detail?: unknown };
    const detail = parsed.detail;
    if (typeof detail === "string" && detail.trim()) {
      if (detail.startsWith("Unknown model_code:")) {
        const code = detail.replace("Unknown model_code:", "").trim();
        return `Model ${code} is not in this job result. Try another trial or re-run the backtest.`;
      }
      return detail;
    }
  } catch {
    /* not JSON */
  }
  return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${getApiBase()}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new Error(API_UNAVAILABLE_MSG);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(formatApiError(res.status, text || res.statusText));
  }
  return res.json() as Promise<T>;
}

export type ApiHealth = {
  status: string;
  version?: string;
  email_notifications?: "configured" | "disabled";
};

export async function fetchApiHealth(): Promise<ApiHealth | null> {
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(`${getApiBase()}/health`, { cache: "no-store" });
      if (res.ok) return (await res.json()) as ApiHealth;
    } catch {
      /* retry — API may still be starting (uvicorn reload on Windows) */
    }
    if (i < 4) await new Promise((r) => setTimeout(r, 600));
  }
  return null;
}

export async function checkApiHealth(): Promise<boolean> {
  const health = await fetchApiHealth();
  return health?.status === "ok";
}

export async function listScenarios(): Promise<ScenarioCard[]> {
  try {
    return await fetchJson<ScenarioCard[]>("/scenarios");
  } catch {
    const res = await fetch("/api/scenarios");
    if (!res.ok) throw new Error("Failed to load scenarios");
    return res.json();
  }
}

export async function listJobs(limit = 30): Promise<JobSummary[]> {
  return fetchJson<JobSummary[]>(`/jobs?limit=${encodeURIComponent(String(limit))}`);
}

export async function getJobRequest(jobId: string): Promise<BacktestRequest> {
  return fetchJson<BacktestRequest>(`/jobs/${jobId}/request`);
}

export async function createJob(req: BacktestRequest): Promise<{ job_id: string }> {
  // These knobs are kept for backward compatibility in the request type, but
  // they are intentionally not sent from the UI anymore.
  const payload = { ...req } as Partial<BacktestRequest>;
  delete payload.top_n;
  delete payload.refinement_patience;
  return fetchJson<{ job_id: string }>("/jobs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type ContinueJobOptions = {
  extra_refinement_rounds?: number;
  extra_trials_per_round?: number | null;
  extra_trials?: number | null;
};

export async function continueJob(
  priorJobId: string,
  options: ContinueJobOptions = {},
): Promise<{ job_id: string; continued_from: string }> {
  return fetchJson<{ job_id: string; continued_from: string }>(
    `/jobs/${encodeURIComponent(priorJobId)}/continue`,
    {
      method: "POST",
      body: JSON.stringify({
        extra_refinement_rounds: options.extra_refinement_rounds ?? 4,
        extra_trials_per_round: options.extra_trials_per_round ?? null,
        extra_trials: options.extra_trials ?? null,
      }),
    },
  );
}

export async function getJobProgress(jobId: string): Promise<JobProgress> {
  return fetchJson<JobProgress>(`/jobs/${jobId}/progress`);
}

export async function getJobResult(jobId: string): Promise<BacktestResult> {
  return fetchJson<BacktestResult>(`/jobs/${jobId}/result`);
}

export async function fetchCandidateCharts(
  jobId: string,
  modelCode: string,
  options?: { rank?: number },
): Promise<CandidateChartsPayload> {
  const encoded = encodeURIComponent(modelCode);
  const rankQuery =
    options?.rank != null && options.rank >= 1
      ? `?rank=${encodeURIComponent(String(options.rank))}`
      : "";
  return fetchJson<CandidateChartsPayload>(
    `/jobs/${jobId}/candidates/${encoded}/charts${rankQuery}`,
  );
}

export async function patchJobNarrativeFacts(
  jobId: string,
  patch: Record<string, unknown>,
): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>(`/jobs/${jobId}/narrative-facts`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function evaluateObjectiveSwitchLab(
  req: ObjectiveSwitchLabRequest,
): Promise<ObjectiveSwitchLabResult> {
  return fetchJson<ObjectiveSwitchLabResult>("/lab/objective-switch/evaluate", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export type PoolValidationReport = {
  upserted: number;
  skipped: number;
  errors: string[];
  items: Array<{
    ticker: string;
    name: string;
    asset_class: string;
    region: string;
    product_type: string;
    enabled: boolean;
  }>;
  valid: boolean;
};

export type ModelsValidationReport = {
  imported: number;
  skipped: number;
  errors: string[];
  portfolios: Array<{
    id: string;
    name: string;
    benchmark: string;
    holdings: Array<{ ticker: string; weight: number }>;
  }>;
  valid: boolean;
};

export async function validatePoolCsv(csvText: string): Promise<PoolValidationReport> {
  return fetchJson<PoolValidationReport>("/settings/validate-pool", {
    method: "POST",
    body: JSON.stringify({ csv_text: csvText }),
  });
}

export async function validateModelsCsv(csvText: string): Promise<ModelsValidationReport> {
  return fetchJson<ModelsValidationReport>("/settings/validate-models", {
    method: "POST",
    body: JSON.stringify({ csv_text: csvText }),
  });
}

export function downloadCsv(result: BacktestResult, scenarioTitle: string) {
  const top = result.candidates[0];
  const header = "ticker,weight\n";
  const rows = Object.entries(top.weights)
    .map(([t, w]) => `${t},${w}`)
    .join("\n");
  const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${scenarioTitle}-portfolio.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
