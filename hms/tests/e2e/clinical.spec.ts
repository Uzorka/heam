import { expect, test, type Browser, type Page } from "@playwright/test";
import { DEMO_PASSWORD, login, uniqueName, uniquePhone } from "./helpers";

async function as(browser: Browser, who: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await login(page, who);
  return page;
}

test("Phase 2: vitals -> signed note -> lab order -> result -> independent verification -> review", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  // Reception registers and checks in a walk-in patient
  const reception = await as(browser, "reception");
  const family = uniqueName("Clin");
  const given = uniqueName("Ada");
  await reception.goto("/patients/new");
  await reception.getByLabel("First name").fill(given);
  await reception.getByLabel("Surname").fill(family);
  await reception.getByLabel("Sex at birth").selectOption("FEMALE");
  await reception.getByLabel(/^Date of birth\*?$/).fill("1988-02-02");
  await reception.getByLabel("Mobile phone").fill(uniquePhone());
  await reception.getByRole("checkbox", { name: /privacy notice/ }).check();
  await reception.getByRole("button", { name: "Register patient" }).click();
  await expect(reception).toHaveURL(/registered=1/);
  await reception.getByRole("link", { name: "Check in" }).click();
  await reception.getByRole("button", { name: "Check in" }).click();
  await expect(reception.getByText(/Checked in/)).toBeVisible();

  // Nurse records vitals in the visit workspace and sends the patient to the doctor
  const nurse = await as(browser, "nurse");
  await nurse.goto("/queue");
  await nurse
    .getByRole("listitem")
    .filter({ hasText: family })
    .getByRole("link", { name: "Open visit" })
    .click();
  await expect(nurse.getByText(/You can see and document this visit/)).toBeVisible();
  await nurse.getByRole("link", { name: /Vitals & triage/ }).click();
  await nurse.getByLabel("Temperature (°C)").fill("38.4");
  await nurse.getByLabel("Pulse (bpm)").fill("96");
  await nurse.getByRole("button", { name: "Save vitals" }).click();
  await expect(nurse.getByText("Vitals recorded.")).toBeVisible();
  await expect(nurse.getByRole("cell", { name: /38\.4/ })).toBeVisible();
  await nurse.getByRole("button", { name: /Ready for doctor/ }).click();
  await expect(nurse.getByText(/Moved to Ready for doctor/)).toBeVisible();

  // Doctor takes the patient, writes and signs a note, orders a malaria test
  const doctor = await as(browser, "doctor");
  await doctor.goto("/queue?stage=READY_FOR_DOCTOR");
  const card = doctor.getByRole("listitem").filter({ hasText: family });
  await card.getByRole("button", { name: /In consultation/ }).click();
  await expect(doctor.getByText(/Moved to In consultation/)).toBeVisible();
  await doctor.goto("/queue?mine=1");
  await doctor
    .getByRole("listitem")
    .filter({ hasText: family })
    .getByRole("link", { name: "Open visit" })
    .click();
  await doctor.getByRole("link", { name: /^Notes/ }).click();
  await doctor.getByRole("button", { name: /Consultation \(SOAP\)/ }).click();
  await doctor.getByRole("button", { name: "Start draft" }).click();
  await doctor.getByLabel("Presenting complaint", { exact: true }).fill("Fever for two days");
  await doctor.getByLabel("Plan", { exact: true }).fill("Malaria parasite test");
  await doctor.getByRole("button", { name: "Save draft" }).click();
  await expect(doctor.getByText(/^Saved \d\d:\d\d/)).toBeVisible();
  await doctor.getByRole("button", { name: "Sign note" }).click();
  await doctor.getByLabel("Your password").fill(DEMO_PASSWORD);
  await doctor.getByRole("button", { name: "Sign", exact: true }).click();
  await expect(doctor.getByText("Note signed.")).toBeVisible();
  await expect(doctor.getByText("Signed", { exact: true })).toBeVisible();
  await doctor.getByRole("link", { name: /Orders & results/ }).click();
  await doctor.getByRole("checkbox", { name: /Malaria parasite/ }).check();
  await doctor.getByLabel("Clinical indication").fill("Fever, ?malaria");
  await doctor.getByRole("button", { name: /Place 1 order/ }).click();
  await expect(doctor.getByText(/Ordered: ORD-\d{4}-\d{6}/)).toBeVisible();

  // Lab scientist 1: collect, receive, enter result
  const lab = await as(browser, "lab");
  await lab.goto("/lab?tab=TO_COLLECT");
  await lab.getByRole("row").filter({ hasText: family }).getByRole("link", { name: "Open" }).click();
  await lab.getByRole("button", { name: "Record collection" }).click();
  await lab.getByRole("dialog").getByRole("button", { name: "Record collection" }).click();
  await expect(lab.getByText(/ACC-\d{4}-\d{6}/).first()).toBeVisible();
  await lab.getByRole("button", { name: "Receive in lab" }).click();
  await lab.getByRole("dialog").getByRole("button", { name: "Receive" }).click();
  await lab.getByLabel("Malaria parasites").selectOption("Seen (+)");
  await lab.getByRole("button", { name: "Submit for verification" }).click();
  await expect(lab.getByText("Submitted for verification.")).toBeVisible();
  // The same person cannot verify
  await lab.getByRole("button", { name: "Verify & release" }).click();
  await lab.getByLabel("Your password").fill(DEMO_PASSWORD);
  await lab.getByRole("button", { name: "Sign", exact: true }).click();
  await expect(lab.getByText(/someone other than the person who entered them/)).toBeVisible();

  // Lab scientist 2 verifies
  const lab2 = await as(browser, "lab2");
  await lab2.goto("/lab?tab=TO_VERIFY");
  await lab2.getByRole("row").filter({ hasText: family }).getByRole("link", { name: "Open" }).click();
  await lab2.getByRole("button", { name: "Verify & release" }).click();
  await lab2.getByLabel("Your password").fill(DEMO_PASSWORD);
  await lab2.getByRole("button", { name: "Sign", exact: true }).click();
  await expect(lab2.getByText("Results verified and released.")).toBeVisible();

  // Doctor reviews from the results inbox
  await doctor.goto("/results");
  await doctor
    .getByRole("listitem")
    .filter({ hasText: family })
    .getByRole("link", { name: "Review" })
    .click();
  await expect(doctor.getByRole("cell", { name: "Seen (+)" })).toBeVisible();
  await doctor.getByRole("button", { name: "Mark reviewed" }).click();
  await doctor.getByRole("dialog").getByRole("button", { name: "Mark reviewed" }).click();
  await expect(doctor.getByText(/Reviewed by Chiamaka Eze/)).toBeVisible();

  // Reception still cannot open the clinical workspace by URL
  const url = doctor.url().split("?")[0]!;
  await reception.goto(url);
  await expect(reception.getByText("You don't have access to this")).toBeVisible();
});
