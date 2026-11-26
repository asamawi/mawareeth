import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";
import type { NextConfig } from "next";

const shared: NextConfig = {
  trailingSlash: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default function config(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    return {
      ...shared,
      // In production Django answers / (Arabic unless the language cookie says otherwise).
      async redirects() {
        return [{ source: "/", destination: "/ar/", permanent: false }];
      },
      // The local-only live run (`npm run test:e2e:live`) keeps its own build directory, so it never
      // shares a lock or a cache with a `next dev` you already run, and may point at another Django port.
      ...(process.env.E2E_LIVE_DIST ? { distDir: process.env.E2E_LIVE_DIST } : {}),
      // Production is same-origin; in development Django runs on its own port.
      async rewrites() {
        return [
          {
            source: "/api/:path*/",
            destination: `${process.env.E2E_LIVE_API ?? "http://localhost:8000"}/api/:path*/`,
          },
        ];
      },
    };
  }
  return { ...shared, output: "export" };
}
