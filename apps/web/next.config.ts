import type { NextConfig } from "next";

/** API proxy: apps/web/src/app/quant-api/[[...path]]/route.ts (more stable than dev rewrites on Windows). */
const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
