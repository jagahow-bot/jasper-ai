import { NextRequest, NextResponse } from "next/server";

const API_ORIGIN =
  process.env.QUANT_API_URL?.replace(/\/$/, "") ??
  `http://127.0.0.1:${process.env.QUANT_API_PORT ?? "8001"}`;

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailers",
  "upgrade",
  "host",
  "content-length",
]);

async function proxy(req: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await context.params;
  const suffix = path.length ? path.join("/") : "";
  const url = new URL(req.url);
  const target = `${API_ORIGIN}/${suffix}${url.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  let body: string | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await req.text();
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(300_000),
      });
      const resHeaders = new Headers();
      upstream.headers.forEach((value, key) => {
        if (!HOP_BY_HOP.has(key.toLowerCase())) {
          resHeaders.set(key, value);
        }
      });
      return new NextResponse(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: resHeaders,
      });
    } catch (err) {
      lastErr = err;
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
      }
    }
  }

  console.error("[quant-api proxy] failed:", target, lastErr);
  return NextResponse.json(
    {
      error: "api_proxy_failed",
      detail: lastErr instanceof Error ? lastErr.message : String(lastErr),
      target,
    },
    { status: 502 },
  );
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
