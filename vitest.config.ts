import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest needs the same `@/` alias `tsconfig.json` gives the app.
 *
 * Without it any test that reaches a module importing `@/worker/...` or
 * `@/types` fails at collection with "Failed to load url", which quietly put
 * whole modules out of reach of the suite — `lib/ingest.ts` among them, because
 * it imports the runtime.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
