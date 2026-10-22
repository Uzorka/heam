import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test.describe("access control in the browser", () => {
  test("unauthenticated users are redirected to sign in", async ({ page }) => {
    await page.goto("/patients");
    await expect(page).toHaveURL(/\/login\?next=%2Fpatients/);
  });

  test("wrong password gives a generic error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("reception@demo.aduraking.test");
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(/Email or password is incorrect/)).toBeVisible();
  });

  test("HR cannot open the patient registry, even by URL", async ({ page }) => {
    await login(page, "hr");
    await expect(page.getByRole("link", { name: "Patients" })).toHaveCount(0);
    await page.goto("/patients");
    await expect(page.getByText("You don't have access to this")).toBeVisible();
  });

  test("system support has no patient access and no PHI in navigation", async ({ page }) => {
    await login(page, "support");
    await page.goto("/patients/new");
    await expect(page.getByText("You don't have access to this")).toBeVisible();
    await expect(page.getByRole("searchbox")).toHaveCount(0);
  });

  test("a guessed patient id shows the same not-found page as an out-of-scope record", async ({ page }) => {
    await login(page, "reception");
    await page.goto("/patients/00000000-0000-4000-8000-000000000000");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.getByText(/not available to your account/)).toBeVisible();
  });

  test("security headers are set", async ({ page }) => {
    const res = await page.goto("/login");
    const h = res!.headers();
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-content-type-options"]).toBe("nosniff");
  });
});

test.describe("small screens @mobile", () => {
  test("front desk works on phone and tablet widths @mobile", async ({ page }) => {
    await login(page, "reception");
    await page.goto("/front-desk");
    await expect(page.getByRole("heading", { name: "Front desk" })).toBeVisible();
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("dialog", { name: "Navigation" }).getByRole("link", { name: "Patients" }).click();
    await expect(page).toHaveURL(/\/patients/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
