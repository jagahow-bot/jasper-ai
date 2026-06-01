import { NextResponse } from "next/server";
import { getLocalProgress } from "@/lib/job-store";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const progress = getLocalProgress(jobId);
  if (!progress) {
    return NextResponse.json({ detail: "Job not found" }, { status: 404 });
  }
  return NextResponse.json(progress);
}
