import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // src/auth is meant to become its own package: it must not know the host app.
  {
    files: ["src/auth/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/*", "../../*"],
              message: "src/auth must stay self-contained. Pass app specifics in via config instead.",
            },
          ],
        },
      ],
    },
  },
  // The rest of the app uses only the module's entry points.
  {
    files: ["src/**"],
    ignores: ["src/auth/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/auth/*", "!@/auth/server", "!@/auth/proxy"],
              message: "Import from @/auth, @/auth/server or @/auth/proxy only.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
