import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_PASSWORD, login } from "./helpers";

/** Automated WCAG 2.1 A/AA scan of core screens. Serious and critical violations fail the test. */
async function scan(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    serious.map(
      (v) => `${path}: ${v.id} (${v.impact}) - ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    ),
  ).toEqual([]);
}

test("core staff screens have no serious accessibility violations", async ({ page }) => {
  await page.goto("/login");
  await scan(page, "/login");
  await login(page, "doctor");
  for (const path of ["/dashboard", "/patients", "/queue", "/results", "/appointments", "/me"])
    await scan(page, path);
  await page.context().clearCookies();
  await login(page, "hr");
  for (const path of ["/hr", "/hr/roster", "/payroll"]) await scan(page, path);
  await page.context().clearCookies();
  await login(page, "meddir");
  await scan(page, "/reports?report=visits");
});

test("patient portal has no serious accessibility violations", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("patient@demo.aduraking.test");
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/portal$/);
  await scan(page, "/portal");
  await page.getByRole("link", { name: /Ngozi Okafor/ }).click();
  await scan(page, page.url().replace(/^https?:\/\/[^/]+/, ""));
});
