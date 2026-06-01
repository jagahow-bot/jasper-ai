import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export async function GET() {
  const file = path.join(
    process.cwd(),
    "..",
    "..",
    "shared",
    "strategy-profiles.json",
  );
  const raw = await readFile(file, "utf-8");
  const data = JSON.parse(raw) as { scenarios: unknown[] };
  return NextResponse.json(data.scenarios);
}
