import { expect, test, type Browser, type Page } from "@playwright/test";
import { login, uniqueName, uniquePhone } from "./helpers";

async function as(browser: Browser, who: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await login(page, who);
  return page;
}

async function pickOption(page: Page, label: RegExp, text: RegExp) {
  const select = page.getByLabel(label);
  const value = await select.locator("option", { hasText: text }).first().getAttribute("value");
  await select.selectOption(value!);
}

test("Phase 4: HMO patient -> covered services -> pre-authorisation -> co-pay -> claim -> remittance", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const reception = await as(browser, "reception");
  const family = uniqueName("Hmo");
  await reception.goto("/patients/new");
  await reception.getByLabel("First name").fill(uniqueName("Tola"));
  await reception.getByLabel("Surname").fill(family);
  await reception.getByLabel("Sex at birth").selectOption("FEMALE");
  await reception.getByLabel(/^Date of birth\*?$/).fill("1990-03-03");
  await reception.getByLabel("Mobile phone").fill(uniquePhone());
  await reception.getByRole("checkbox", { name: /privacy notice/ }).check();
  await reception.getByRole("button", { name: "Register patient" }).click();
  await expect(reception).toHaveURL(/registered=1/);
  const patientUrl = reception.url().split("?")[0]!;

  // HMO officer records the cover.
  const hmo = await as(browser, "hmo");
  await hmo.goto(`${patientUrl.replace(/^https?:\/\/[^/]+/, "")}?tab=coverage`);
  await hmo.getByRole("button", { name: "Add cover" }).click();
  await pickOption(hmo, /^Payer and plan/, /DEMO Health Plan/);
  await hmo.getByLabel(/^Member \/ enrollee number/).fill(uniqueName("GOLD"));
  await hmo.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(hmo.getByText("Cover recorded.")).toBeVisible();
  await expect(hmo.getByText("Not checked")).toBeVisible();

  // Reception checks the patient in on that cover.
  await reception.goto(patientUrl);
  await reception.getByRole("link", { name: "Check in" }).click();
  await pickOption(reception, /^Visit type/, /General consultation \(new\)/);
  await reception.getByLabel(/^How will the visit be paid/).selectOption("HMO");
  await pickOption(reception, /^Cover used for this visit/, /DEMO Health Plan/);
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
  await expect(doctor).toHaveURL(/\/encounters\//);
  await doctor.getByRole("link", { name: /Orders & results/ }).click();
  await doctor.getByRole("checkbox", { name: /Full blood count/ }).check();
  await doctor.getByLabel("Clinical indication").fill("Fatigue");
  await doctor.getByRole("button", { name: /Place 1 order/ }).click();
  await expect(doctor.getByText(/Ordered: ORD-/)).toBeVisible();
  await doctor.getByRole("link", { name: /^Diagnoses/ }).click();
  await doctor.getByRole("button", { name: "Add diagnosis" }).click();
  await doctor.getByLabel(/^Diagnosis\*?$/).fill("Anaemia, unspecified");
  await doctor.getByLabel(/^ICD-10 code/).fill("D64.9");
  await doctor.getByLabel(/^Certainty/).selectOption("CONFIRMED");
  await doctor.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(doctor.getByText("Diagnosis recorded.")).toBeVisible();

  // Manual pre-authorisation for an ultrasound (recorded as the payer decided it).
  // HMO staff have no clinical access: they work from the non-clinical visit billing page.
  await hmo.goto("/hmo");
  await hmo.getByRole("row").filter({ hasText: family }).getByRole("link", { name: /^ENC-/ }).click();
  await expect(hmo.getByText(/DEMO Health Plan \(fictional\) · Gold \(demo\)/)).toBeVisible();
  await hmo.getByRole("button", { name: "Request pre-authorisation" }).click();
  await hmo.getByRole("checkbox", { name: /Obstetric ultrasound/ }).check();
  await hmo.getByLabel(/^Medical necessity/).fill("Bleeding in pregnancy, rule out complications");
  await hmo.getByRole("button", { name: "Create request" }).click();
  await expect(hmo.getByText("Pre-authorisation drafted.")).toBeVisible();
  await hmo.getByRole("link", { name: /^PA-\d{4}-\d{6}$/ }).click();
  await hmo.getByRole("button", { name: "Mark submitted to payer" }).click();
  await hmo.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(hmo.getByText("Pre-authorisation updated.")).toBeVisible();
  await hmo.getByRole("button", { name: "Payer approved", exact: true }).click();
  await hmo.getByLabel(/^Payer authorisation code/).fill("DEMO-AUTH-77");
  await hmo.getByLabel(/^Approved amount/).fill("7000");
  await hmo.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(hmo.getByText("Pre-authorisation updated.")).toBeVisible();
  await expect(hmo.getByText("DEMO-AUTH-77")).toBeVisible();

  // Cashier collects only the co-pay: 10% of (4,000 + 3,500).
  const cashier = await as(browser, "cashier");
  await cashier.goto("/billing");
  if (await cashier.getByRole("button", { name: "Open shift" }).isVisible()) {
    await cashier.getByRole("button", { name: "Open shift" }).click();
    await cashier.getByRole("dialog").getByRole("button", { name: "Open shift" }).click();
    await expect(cashier.getByText("Shift opened.")).toBeVisible();
  }
  await cashier.getByRole("row").filter({ hasText: family }).getByRole("link", { name: "Open" }).click();
  await expect(cashier.getByText("₦750.00").first()).toBeVisible();
  await expect(cashier.getByText("₦6,750.00").first()).toBeVisible();
  await cashier.getByRole("button", { name: "Take payment" }).click();
  await expect(cashier.getByLabel(/^Amount received/)).toHaveValue("750.00");
  await cashier.getByRole("dialog").getByRole("button", { name: "Record payment" }).click();
  await expect(cashier.getByText("Payment recorded.")).toBeVisible();
  await expect(cashier.getByRole("link", { name: /^RCT-\d{4}-\d{6}$/ })).toBeVisible();

  // HMO officer claims the payer share, sends it and reconciles the payment advice.
  await hmo.goto("/hmo");
  await hmo
    .getByRole("row")
    .filter({ hasText: family })
    .getByRole("button", { name: "Create claim" })
    .click();
  await hmo.getByRole("dialog").getByRole("button", { name: "Create claim" }).click();
  await expect(hmo.getByText("Draft claim created.")).toBeVisible();
  await hmo.goto("/hmo/claims?status=DRAFT");
  await hmo.getByRole("row").filter({ hasText: family }).getByRole("link", { name: "Open" }).click();
  await expect(hmo).toHaveURL(/\/hmo\/claims\/[0-9a-f-]{36}/);
  const heading = await hmo.getByRole("heading", { level: 1 }).textContent();
  const claimRef = /CLM-\d{4}-\d{6}/.exec(heading ?? "")![0];
  await expect(hmo.getByText("D64.9 Anaemia, unspecified")).toBeVisible();
  await hmo.getByRole("button", { name: "Validate" }).click();
  await hmo.getByRole("dialog").getByRole("button", { name: "Validate" }).click();
  await expect(hmo.getByText("Claim validated.")).toBeVisible();
  await hmo.goto("/hmo/claims");
  await hmo.getByRole("button", { name: /Batch & submit \d+ to DEMO Health Plan/ }).click();
  await hmo.getByRole("dialog").getByRole("button", { name: "Create batch" }).click();
  await expect(hmo.getByText(/Batch created/)).toBeVisible();
  await hmo.goto("/hmo/claims?status=open");
  await hmo.getByRole("row").filter({ hasText: claimRef }).getByRole("link", { name: "Open" }).click();
  await hmo.getByRole("button", { name: "Payer approved in full" }).click();
  await hmo.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(hmo.getByText("Claim updated.")).toBeVisible();
  // Approval is not payment.
  await expect(hmo.getByText("approved", { exact: true })).toBeVisible();

  await hmo.goto("/hmo/remittances");
  await pickOption(hmo, /^Payer\*?$/, /DEMO Health Plan/);
  await hmo.getByLabel(/^Payer's payment reference/).fill(uniqueName("RA"));
  await hmo.getByLabel(/^Total on advice/).fill("6750");
  await hmo.getByLabel(/^Claim 1/).fill(claimRef);
  await hmo.getByLabel(/^Paid/).fill("6750");
  await hmo.getByRole("button", { name: "Reconcile remittance" }).click();
  await expect(hmo.getByText(/Remittance REM-\d{4}-\d{6} reconciled/)).toBeVisible();
  await hmo.goto("/hmo/claims?status=PAID");
  await expect(hmo.getByRole("row").filter({ hasText: claimRef })).toBeVisible();
});

test("Phase 4: price list and finance pages respect roles", async ({ browser }) => {
  const finance = await as(browser, "finance");
  await finance.goto("/billing/catalogue");
  await expect(finance.getByText("Full blood count")).toBeVisible();
  await finance.goto("/finance");
  await expect(finance.getByText("Service revenue (net)")).toBeVisible();
  await finance.goto("/hmo/payers");
  await expect(
    finance.getByRole("row").filter({ hasText: "Hygeia HMO" }).getByText("Pending verification"),
  ).toBeVisible();

  const nurse = await as(browser, "nurse");
  await nurse.goto("/billing");
  await expect(nurse.getByText("You don't have access to this")).toBeVisible();
  await nurse.goto("/finance");
  await expect(nurse.getByText("You don't have access to this")).toBeVisible();
});
