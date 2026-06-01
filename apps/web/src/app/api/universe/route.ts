import { NextResponse } from "next/server";
import { getUniverseItems, getUniverseMeta } from "@/lib/universe";

export async function GET() {
  return NextResponse.json({
    meta: getUniverseMeta(),
    items: getUniverseItems(),
  });
}
