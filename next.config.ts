import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components is off: every HRMS page is per-user and renders at request time.
  experimental: {
    // Document uploads go through Server Actions; Vercel caps function bodies at 4.5 MB.
    serverActions: { bodySizeLimit: "4mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
