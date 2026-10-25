import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signIn } from "./fixtures";

// WCAG 2.1 AA (the level EN 301 549 requires of public-sector software in the EU), checked with
// axe on every page of the console, in light and dark themes.

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function violations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 5).map((n) => {
      const contrast = n.any.find((c) => c.id === "color-contrast")?.data;
      return contrast
        ? `${n.target.join(" ")} — ${contrast.fgColor} on ${contrast.bgColor}: ${contrast.contrastRatio}:1 (needs ${contrast.expectedContrastRatio})`
        : n.target.join(" ");
    }),
  }));
}

const PAGES = ["/", "/models", "/blocks", "/events", "/connectors", "/auditor", "/verify-receipt", "/settings/tokens", "/demo"];

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test("the sign-in page", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Sign in to Ernest" })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test("every page", async ({ page }) => {
      await signIn(page, { role: "read-write", functions: ["evidence.write", "platform.admin"] });
      const found: Record<string, unknown> = {};
      for (const path of PAGES) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        const v = await violations(page);
        if (v.length) found[path] = v;
      }
      expect(found).toEqual({});
    });
  });
}
