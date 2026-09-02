import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every route in this app is static (no API routes, middleware, or
  // next/image usage) — export plain static files so hosting doesn't need
  // any Next.js server runtime or adapter plugin at all.
  output: "export",
};

export default nextConfig;
