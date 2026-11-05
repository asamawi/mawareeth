import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";
import type { NextConfig } from "next";

const shared: NextConfig = {
  basePath: "/app",
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
      // Production is same-origin; in development Django runs on its own port.
      async rewrites() {
        return [
          {
            source: "/api/:path*/",
            destination: "http://localhost:8000/api/:path*/",
            basePath: false,
          },
        ];
      },
    };
  }
  return { ...shared, output: "export" };
}
