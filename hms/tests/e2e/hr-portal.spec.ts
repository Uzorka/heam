import { expect, test, type Page } from "@playwright/test";
import { DEMO_PASSWORD, login } from "./helpers";

async function portalLogin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("patient@demo.aduraking.test");
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/portal$/);
}

const noHorizontalOverflow = async (page: Page) =>
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);

test("Phase 6: HR records stay separate from patient records and payroll from clinicians", async ({
  page,
}) => {
  await login(page, "hr");
  await page.goto("/hr");
  await expect(page.getByRole("heading", { name: "Staff records" })).toBeVisible();
  await page
    .getByRole("row", { name: /DEMO-002/ })
    .getByRole("link", { name: "Open" })
    .click();
  await expect(page.getByText("DEMO Bank ····0000")).toBeVisible();
  await expect(page.getByText("0000000000")).toHaveCount(0);
  await page.goto("/patients");
  await expect(page.getByText("You don't have access to this")).toBeVisible();

  await page.context().clearCookies();
  await login(page, "doctor");
  await page.goto("/payroll");
  await expect(page.getByText("You don't have access to this")).toBeVisible();
});

test("Phase 6: staff self-service clock-in and leave, approved by HR", async ({ page }) => {
  await login(page, "nurse");
  await page.goto("/me");
  await expect(page.getByRole("heading", { name: "My work & pay" })).toBeVisible();
  // Approved DEMO payroll is visible to the employee.
  await expect(page.getByText(/PAY-DEMO-/)).toBeVisible();
  const clockButton = page.getByRole("button", { name: /^Clock (in|out)$/ }).first();
  const label = (await clockButton.textContent())!.trim();
  await clockButton.click();
  await page.getByRole("dialog").getByRole("button", { name: label }).click();
  await expect(page.getByText(label === "Clock in" ? /Last clocked in/ : /Last clocked out/)).toBeVisible();

  // A leave request far in the future, unique per run, so it never overlaps an earlier one.
  const year = 2040 + Math.floor(Math.random() * 50);
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
  await page.getByRole("button", { name: "Request leave" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Type/).selectOption("STUDY");
  await dialog.getByLabel(/^From/).fill(`${year}-${month}-03`);
  await dialog.getByLabel(/^To/).fill(`${year}-${month}-04`);
  await dialog.getByLabel(/^Reason/).fill("E2E study leave");
  await dialog.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByText("Leave requested.")).toBeVisible();

  await page.context().clearCookies();
  await login(page, "hr");
  await page.goto("/hr/leave");
  const row = page.getByRole("row", { name: new RegExp(`E2E study leave`) }).first();
  await row.getByRole("button", { name: "Decide" }).click();
  await page
    .getByRole("dialog")
    .getByLabel(/^Decision/)
    .selectOption("APPROVE");
  await page.getByRole("dialog").getByRole("button", { name: "Save decision" }).click();
  await expect(page.getByText("Decision recorded.")).toBeVisible();
});

test("Phase 6: reports run for the branch and exports are watermarked", async ({ page }) => {
  await login(page, "meddir");
  await page.goto("/reports");
  await page.getByLabel("Report").selectOption("visits");
  await page.getByRole("button", { name: "Run report" }).click();
  await expect(page.getByRole("heading", { name: "Visits by day and visit type" })).toBeVisible();
  const href = await page.getByRole("link", { name: "Export CSV" }).getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toContain("CONFIDENTIAL");
  expect(body).toContain("Exported by");

  await page.context().clearCookies();
  await login(page, "nurse");
  const denied = await page.request.get(href!);
  expect(denied.status()).toBe(403);
});

test("Phase 6: a patient sees only their released record in the portal", async ({ page }) => {
  await portalLogin(page);
  await expect(page.getByRole("link", { name: /Ngozi Okafor/ })).toBeVisible();
  // Staff screens are never reachable with a portal login.
  await page.goto("/patients");
  await expect(page).toHaveURL(/\/portal$/);
  await page.goto("/portal");
  await page.getByRole("link", { name: /Ngozi Okafor/ }).click();
  await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
  await expect(page.getByText("No released results.")).toHaveCount(0);
  const unknown = await page.request.get("/api/documents/00000000-0000-0000-0000-000000000000");
  expect([401, 403, 404]).toContain(unknown.status());
  // Another patient's record id gives nothing.
  const res = await page.goto("/portal/00000000-0000-0000-0000-000000000000");
  expect(res!.status()).toBe(404);
});

test.describe("Phase 6 small screens @mobile", () => {
  test("portal and self-service work at phone and tablet widths @mobile", async ({ page }) => {
    await portalLogin(page);
    await noHorizontalOverflow(page);
    await page.getByRole("link", { name: /Ngozi Okafor/ }).click();
    await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
    await noHorizontalOverflow(page);

    await page.context().clearCookies();
    await login(page, "nurse");
    await page.goto("/me");
    await expect(page.getByRole("heading", { name: "My work & pay" })).toBeVisible();
    await noHorizontalOverflow(page);
    await page.goto("/wards");
    await expect(page.getByRole("heading", { name: /Ward board/ })).toBeVisible();
    await noHorizontalOverflow(page);
  });
});
