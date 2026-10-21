import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Many tests start an in-memory Postgres and run every migration; under parallel load that
    // takes longer than the 5 s default.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
