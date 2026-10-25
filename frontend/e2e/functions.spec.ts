import { test, expect, type Page } from "@playwright/test";
import { ISSUER, checkSession, signIn } from "./fixtures";

// What a signed-in person sees depends on their governance functions (GET /api/auth/whoami).
// The backend enforces them; the console must offer only what the person may do. Everything is
// mocked: the API and the identity provider at http://idp.test.

const anchorNow = (page: Page) => page.getByRole("button", { name: "Anchor now" });
const demoTab = (page: Page) => page.getByRole("link", { name: "Demo", exact: true });

test("an editor writes evidence and operates Ernest", async ({ page }) => {
  await signIn(page, { role: "read-write", functions: ["evidence.write", "platform.admin"] });
  await page.goto("/");
  await expect(anchorNow(page)).toBeEnabled();
  await expect(demoTab(page)).toBeVisible();
});

test("an auditor only reads", async ({ page }) => {
  await signIn(page, { role: "read-only", functions: ["audit"] }, "auditor");
  await page.goto("/");
  await expect(anchorNow(page)).toBeDisabled();
  await expect(anchorNow(page)).toHaveAttribute("title", /needs the platform\.admin function/);
  await expect(demoTab(page)).toHaveCount(0);

  await page.goto("/settings/tokens");
  await expect(page.getByText("Managing access tokens needs the platform.admin function.")).toBeVisible();
});

test("a signed-in person without a function has no access, by name", async ({ page }) => {
  await signIn(page, { role: "anonymous", functions: [] }, "visitor");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "No access to Ernest" })).toBeVisible();
  await expect(page.getByText("visitor is signed in")).toBeVisible();
});

test("the same identity provider session keeps the person signed in", async ({ page }) => {
  await signIn(page, { role: "read-only", functions: ["audit"] });
  await page.goto("/");
  await expect(anchorNow(page)).toBeVisible();
  const asked = page.waitForRequest(`${ISSUER}/auth**`);
  await checkSession(page);
  await asked;
  await page.waitForTimeout(1000);
  await expect(anchorNow(page)).toBeVisible();
});

test("another identity provider session ends ours", async ({ page }) => {
  const idp = await signIn(page, { role: "read-only", functions: ["audit"] });
  await page.goto("/");
  await expect(anchorNow(page)).toBeVisible();
  // Signed out in another app, someone else signed in: the provider reports another session.
  idp.session = "session-b";
  await checkSession(page);
  await expect(page.getByRole("heading", { name: "Sign in to Ernest" })).toBeVisible();
});
