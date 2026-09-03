import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

/** Serve synced stage capability cards (design §2.6.2). */
export async function GET() {
  try {
    const file = path.join(process.cwd(), "src", "data", "stage-cards.json");
    const raw = await readFile(file, "utf8");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    try {
      const shared = path.join(
        process.cwd(),
        "..",
        "..",
        "shared",
        "stage-cards.json",
      );
      const raw = await readFile(shared, "utf8");
      return NextResponse.json(JSON.parse(raw));
    } catch (err) {
      return NextResponse.json(
        {
          error: "stage_cards_missing",
          detail: err instanceof Error ? err.message : "missing",
        },
        { status: 404 },
      );
    }
  }
}
