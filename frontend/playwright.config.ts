import { defineConfig, devices } from "@playwright/test";

// The console against a mocked API and a mocked identity provider (http://idp.test): no backend,
// no Keycloak. Its own port, so a developer's console on :5186 is left alone.
const PORT = 5298;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    env: { PUBLIC_OIDC_ISSUER: "http://idp.test", PUBLIC_OIDC_CLIENT_ID: "ernest-spa" },
  },
});
