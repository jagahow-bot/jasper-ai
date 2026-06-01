import { NextResponse } from "next/server";
import { createLocalJob } from "@/lib/job-store";
import type { BacktestRequest } from "@/lib/types";

export async function POST(req: Request) {
  const body = (await req.json()) as BacktestRequest;
  const jobId = createLocalJob(body);
  return NextResponse.json({ job_id: jobId });
}
