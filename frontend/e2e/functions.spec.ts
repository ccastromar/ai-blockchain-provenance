import { test, expect, type Page } from "@playwright/test";

// What a signed-in person sees depends on their governance functions (GET /api/auth/whoami).
// The backend enforces them; the console must offer only what the person may do. Everything is
// mocked: the API and the identity provider at http://idp.test.

const ISSUER = "http://idp.test";

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = (user: string) =>
  `${b64({ alg: "none" })}.${b64({
    sub: user,
    preferred_username: user,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.signature`;

type Who = { role: string; functions: string[] };

/** Signs a person in; `idp.session` is the session the identity provider reports. */
async function signIn(page: Page, who: Who, user = "alice") {
  const idp = { session: "session-a" };
  await page.addInitScript(
    ([bearer, session]) => {
      // Seed the top window once, so a sign-out during the test sticks.
      if (window.top !== window || sessionStorage.getItem("test_seeded")) return;
      sessionStorage.setItem("test_seeded", "1");
      sessionStorage.setItem("ernest_bearer", bearer);
      sessionStorage.setItem("ernest_bearer_exp", String(Date.now() + 3600_000));
      sessionStorage.setItem("ernest_oidc_session", session);
    },
    [token(user), idp.session],
  );
  await page.route(`${ISSUER}/.well-known/openid-configuration`, (route) =>
    route.fulfill({
      json: {
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/auth`,
        token_endpoint: `${ISSUER}/token`,
        end_session_endpoint: `${ISSUER}/logout`,
      },
    }),
  );
  // prompt=none: the identity provider sends the browser back with a code and its session.
  await page.route(`${ISSUER}/auth**`, (route) => {
    const asked = new URL(route.request().url());
    const back = new URL(asked.searchParams.get("redirect_uri")!);
    back.searchParams.set("state", asked.searchParams.get("state")!);
    back.searchParams.set("code", "code");
    back.searchParams.set("session_state", idp.session);
    return route.fulfill({ status: 302, headers: { location: back.toString() } });
  });
  // Later routes win: a catch-all first, the endpoints that matter after it.
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/stats", (route) =>
    route.fulfill({ json: { totalBlocks: 3, totalModels: 1, lastBlockIndex: 2, lastBlockHash: "ab" } }),
  );
  await page.route("**/api/auth/whoami", (route) => {
    const signedIn = Boolean(route.request().headers()["authorization"]);
    return route.fulfill({
      json: signedIn
        ? { ...who, openAccess: false, label: user, subject: user }
        : { role: "anonymous", openAccess: false },
    });
  });
  return idp;
}

/** Asks the console to check the identity provider session now, as when the tab regains focus. */
const checkSession = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("focus")));

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
