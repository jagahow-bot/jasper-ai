import { NextResponse } from "next/server";
import { getLocalProgress, getLocalResult } from "@/lib/job-store";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const progress = getLocalProgress(jobId);
  if (!progress) {
    return NextResponse.json({ detail: "Job not found" }, { status: 404 });
  }
  if (progress.status === "running" || progress.status === "pending") {
    return NextResponse.json({ detail: "Job still running" }, { status: 409 });
  }
  if (progress.status === "failed") {
    return NextResponse.json({ detail: progress.message }, { status: 500 });
  }
  const result = getLocalResult(jobId);
  if (!result) {
    return NextResponse.json({ detail: "Result not ready" }, { status: 404 });
  }
  return NextResponse.json(result);
}
