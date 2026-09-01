import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:8000",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: {
    // Use the interpreter module form so a copied/relocated virtualenv cannot
    // leave the launcher shebang pointing at an old checkout.
    command: "uv run python -m uvicorn server.main:app --app-dir src --port 8000",
    // E2E tests exercise the explicit local-player path. Do not let a
    // developer's .env.chess provider (for example, an unavailable Codex
    // login) make the browser suite wait on an external service.
    env: {
      LLM_PROVIDER: "local",
      RAG_TOP_K: "0",
      AUTO_INIT_PUZZLES: "false",
    },
    port: 8000,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
