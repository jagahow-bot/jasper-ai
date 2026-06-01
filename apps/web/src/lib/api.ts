import type {
  BacktestRequest,
  BacktestResult,
  JobProgress,
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
    throw new Error(text || res.statusText);
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

export async function createJob(req: BacktestRequest): Promise<{ job_id: string }> {
  return fetchJson<{ job_id: string }>("/jobs", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function getJobProgress(jobId: string): Promise<JobProgress> {
  return fetchJson<JobProgress>(`/jobs/${jobId}/progress`);
}

export async function getJobResult(jobId: string): Promise<BacktestResult> {
  return fetchJson<BacktestResult>(`/jobs/${jobId}/result`);
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
