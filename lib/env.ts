/**
 * Load .env whether the process starts in the app directory or the repo root.
 *
 * The key lives in one file at the repo root so there is only ever one copy of
 * it. Scripts run from the app directory, so a bare '.env' misses it.
 */
export function loadEnv(): void {
  for (const path of [".env", "../.env"]) {
    try {
      process.loadEnvFile(path);
      return;
    } catch {
      /* try the next one */
    }
  }
}
