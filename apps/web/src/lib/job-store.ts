import { runBacktestEngine } from "./backtest-engine";
import type { BacktestRequest, BacktestResult, JobProgress } from "./types";

type JobRecord = {
  progress: JobProgress;
  result?: BacktestResult;
};

const store = new Map<string, JobRecord>();

export function createLocalJob(req: BacktestRequest): string {
  const jobId = crypto.randomUUID();
  store.set(jobId, {
    progress: {
      status: "pending",
      message: "Job queued…",
      trial: 0,
      trials_total: req.trials,
      best_sharpe: null,
    },
  });

  void runJobAsync(jobId, req);
  return jobId;
}

async function runJobAsync(jobId: string, req: BacktestRequest) {
  const record = store.get(jobId);
  if (!record) return;

  for (let t = 1; t <= req.trials; t++) {
    record.progress = {
      status: "running",
      message: `Rolling analysis ${req.start_date}–${req.end_date}…`,
      trial: t,
      trials_total: req.trials,
      best_sharpe: 0.8 + (t / req.trials) * 0.5,
    };
    await new Promise((r) => setTimeout(r, 8));
  }

  const result = runBacktestEngine(req, jobId);
  record.progress = {
    status: "completed",
    message: "Backtest complete",
    trial: req.trials,
    trials_total: req.trials,
    best_sharpe: result.candidates[0]?.sharpe ?? null,
  };
  record.result = result;
}

export function getLocalProgress(jobId: string): JobProgress | undefined {
  return store.get(jobId)?.progress;
}

export function getLocalResult(jobId: string): BacktestResult | undefined {
  return store.get(jobId)?.result;
}
