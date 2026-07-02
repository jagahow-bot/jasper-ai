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

function formatApiError(status: number, body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return resStatusLabel(status);
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

function resStatusLabel(status: number): string {
  if (status === 404) return "Resource not found";
  if (status === 409) return "Job still running";
  if (status === 422) return "Invalid request";
  return `Request failed (${status})`;
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

export async function checkApiHealth(): Promise<boolean> {
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(`${getApiBase()}/health`, { cache: "no-store" });
      if (res.ok) return true;
    } catch {
      /* retry — API may still be starting (uvicorn reload on Windows) */
    }
    if (i < 4) await new Promise((r) => setTimeout(r, 600));
  }
  return false;
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
