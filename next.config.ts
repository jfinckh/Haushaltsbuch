import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/app/_lib/i18n/request.ts");

const nextConfig: NextConfig = {
  // Self-contained server (.next/standalone) for the Docker image, see Dockerfile.
  output: "standalone",
  // The version shown under "Abmelden", written into the app at build time (Dockerfile, deploy workflow).
  env: {
    APP_VERSION: process.env.APP_VERSION || "dev",
    APP_BUILT_AT: process.env.APP_BUILT_AT || "",
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withNextIntl(nextConfig);
