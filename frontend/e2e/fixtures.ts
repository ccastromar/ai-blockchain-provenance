import { type Page } from "@playwright/test";

// Shared by the browser tests: a mocked identity provider (http://idp.test) and a mocked API.

export const ISSUER = "http://idp.test";

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = (user: string) =>
  `${b64({ alg: "none" })}.${b64({
    sub: user,
    preferred_username: user,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.signature`;

export type Who = { role: string; functions: string[] };

/** Signs a person in; `idp.session` is the session the identity provider reports. */
export async function signIn(page: Page, who: Who, user = "alice") {
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
  const page1 = (items: unknown[]) => ({ items, total: items.length, page: 1, totalPages: 1 });
  await page.route("**/api/models**", (route) =>
    route.fulfill({
      json: page1([{ modelId: "credit-risk-v1", modelName: "Credit risk", version: "1.0.0", status: "active", createdAt: "2026-10-01T00:00:00Z" }]),
    }),
  );
  await page.route("**/api/blocks**", (route) =>
    route.fulfill({ json: page1([{ index: 1, hash: "ab", previousHash: "00", timestamp: "2026-10-01T00:00:00Z", data: {} }]) }),
  );
  await page.route("**/api/ingested-events**", (route) => route.fulfill({ json: page1([]) }));
  await page.route("**/api/auth/tokens", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/verify", (route) => route.fulfill({ json: { isValid: true, errors: [] } }));
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { status: "ok", subsystems: { mongo: { status: "ok" }, ethereum: { status: "not_configured" } } } }),
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
export const checkSession = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("focus")));

