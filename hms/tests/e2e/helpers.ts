import { expect, type Page } from "@playwright/test";

export const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD || "Demo-Aduraking-2026!";

export async function login(page: Page, who: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(`${who}@demo.aduraking.test`);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

export function uniqueName(prefix: string) {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  let s = "";
  let n = Date.now() + Math.floor(Math.random() * 1000);
  while (n > 0) {
    s += letters[n % 26];
    n = Math.floor(n / 26);
  }
  return `${prefix}${s}`;
}

export function uniquePhone() {
  return `0817${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
}
