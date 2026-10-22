import { expect, test, type Browser, type Page } from "@playwright/test";
import { DEMO_PASSWORD, login, uniqueName, uniquePhone } from "./helpers";

async function as(browser: Browser, who: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await login(page, who);
  return page;
}

test("Phase 3: signed prescription -> pharmacist verification -> FEFO dispense skips the expired lot", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const reception = await as(browser, "reception");
  const family = uniqueName("Rx");
  await reception.goto("/patients/new");
  await reception.getByLabel("First name").fill(uniqueName("Bola"));
  await reception.getByLabel("Surname").fill(family);
  await reception.getByLabel("Sex at birth").selectOption("MALE");
  await reception.getByLabel(/^Date of birth\*?$/).fill("1979-07-07");
  await reception.getByLabel("Mobile phone").fill(uniquePhone());
  await reception.getByRole("checkbox", { name: /privacy notice/ }).check();
  await reception.getByRole("button", { name: "Register patient" }).click();
  await expect(reception).toHaveURL(/registered=1/);
  await reception.getByRole("link", { name: "Check in" }).click();
  await reception.getByRole("button", { name: "Check in" }).click();
  await expect(reception.getByText(/Checked in/)).toBeVisible();

  const nurse = await as(browser, "nurse");
  await nurse.goto("/queue");
  await nurse
    .getByRole("listitem")
    .filter({ hasText: family })
    .getByRole("link", { name: "Open visit" })
    .click();
  await expect(nurse).toHaveURL(/\/encounters\//);
  await nurse.getByRole("button", { name: /Ready for doctor/ }).click();
  await expect(nurse.getByText(/Moved to Ready for doctor/)).toBeVisible();

  const doctor = await as(browser, "doctor");
  await doctor.goto("/queue?stage=READY_FOR_DOCTOR");
  await doctor
    .getByRole("listitem")
    .filter({ hasText: family })
    .getByRole("button", { name: /In consultation/ })
    .click();
  await expect(doctor.getByText(/Moved to In consultation/)).toBeVisible();
  await doctor.goto("/queue?mine=1");
  await doctor
    .getByRole("listitem")
    .filter({ hasText: family })
    .getByRole("link", { name: "Open visit" })
    .click();
  await doctor.getByRole("link", { name: /^Medications/ }).click();
  const med = doctor.getByLabel(/^Medicine\*?$/);
  const value = await med
    .locator("option", { hasText: /^Paracetamol 500 mg tablet/ })
    .first()
    .getAttribute("value");
  await med.selectOption(value!);
  await doctor.getByLabel(/^Dose/).fill("2");
  const freq = doctor.getByLabel(/^Frequency\*?$/);
  await freq.selectOption((await freq.locator("option", { hasText: /^TDS/ }).getAttribute("value"))!);
  await doctor.getByLabel(/^Days$/).fill("3");
  await doctor.getByRole("button", { name: "Use 18" }).click();
  await expect(doctor.getByLabel(/^Quantity to supply/)).toHaveValue("18");
  await doctor.getByLabel(/electronic signature/).fill(DEMO_PASSWORD);
  await doctor.getByRole("button", { name: "Sign prescription" }).click();
  await expect(doctor.getByText(/Prescription RX-\d{4}-\d{6} signed/)).toBeVisible();
  await expect(doctor.getByText("Awaiting pharmacist")).toBeVisible();

  const pharmacist = await as(browser, "pharmacist");
  await pharmacist.goto("/pharmacy");
  await pharmacist.getByRole("row").filter({ hasText: family }).getByRole("link", { name: "Open" }).click();
  await expect(pharmacist.getByText(/No active allergies recorded/)).toBeVisible();
  await pharmacist.getByRole("button", { name: "Verify", exact: true }).click();
  await pharmacist.getByRole("dialog").getByRole("button", { name: "Verify", exact: true }).click();
  await expect(pharmacist.getByText("Item verified.")).toBeVisible();
  // The expired demo lot is listed but cannot be chosen.
  const lot = pharmacist.getByLabel(/^Lot$/);
  await expect(lot.locator("option", { hasText: "DEMO-PCM-EXP" })).toBeDisabled();
  await pharmacist.getByRole("checkbox", { name: /counselled/ }).check();
  await pharmacist.getByRole("button", { name: "Dispense", exact: true }).click();
  await expect(pharmacist.getByText("Dispensed and stock updated.")).toBeVisible();
  // First-expiry-first-out: the near-expiry lot is used, never the expired one.
  // (On a fresh seed that is DEMO-PCM-NEAR; repeated local runs eventually use it up.)
  await expect(pharmacist.getByText(/from lot DEMO-PCM-(NEAR|L\d+A)/).first()).toBeVisible();
  await expect(pharmacist.getByText(/from lot DEMO-PCM-EXP/)).toHaveCount(0);
  await expect(pharmacist.getByText("Dispensed", { exact: true })).toBeVisible();
});

test("Phase 3: stock page shows reorder and expiry alerts; prescriber cannot open pharmacy", async ({
  browser,
}) => {
  const store = await as(browser, "store");
  await store.goto("/inventory?filter=low");
  await expect(store.getByRole("link", { name: "Folic acid 5 mg" })).toBeVisible();
  await store.goto("/inventory?filter=expiring");
  await expect(
    store
      .getByRole("row")
      .filter({ hasText: "Paracetamol 500 mg" })
      .getByText(/unusable/),
  ).toBeVisible();

  const doctor = await as(browser, "doctor");
  await doctor.goto("/pharmacy");
  await expect(doctor.getByText("You don't have access to this")).toBeVisible();
});
