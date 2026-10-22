import { expect, test } from "@playwright/test";
import { login, uniqueName, uniquePhone } from "./helpers";

test.describe("Phase 1: registration -> appointment -> check-in -> queue", () => {
  test("reception registers a patient, books, checks in, and the doctor sees them", async ({ page, browser }) => {
    await login(page, "reception");
    const family = uniqueName("Okon");
    const given = uniqueName("Efe");
    const phone = uniquePhone();

    // Register
    await page.goto("/patients/new");
    await page.getByLabel("First name").fill(given);
    await page.getByLabel("Surname").fill(family);
    await page.getByLabel("Sex at birth").selectOption("FEMALE");
    await page.getByLabel(/^Date of birth\*?$/).fill("1992-03-04");
    await page.getByLabel("Mobile phone").fill(phone);
    await page.getByRole("checkbox", { name: /privacy notice/ }).check();
    await page.getByRole("button", { name: "Register patient" }).click();
    await expect(page).toHaveURL(/\/patients\/[0-9a-f-]{36}\?registered=1/);
    await expect(page.getByText(/Patient registered with MRN ADK\d{7}/)).toBeVisible();
    const patientUrl = page.url().split("?")[0]!;

    // A second registration with the same details triggers the duplicate warning, nothing saved
    await page.goto("/patients/new");
    await page.getByLabel("First name").fill(given);
    await page.getByLabel("Surname").fill(family);
    await page.getByLabel("Sex at birth").selectOption("FEMALE");
    await page.getByLabel(/^Date of birth\*?$/).fill("1992-03-04");
    await page.getByLabel("Mobile phone").fill(phone);
    await page.getByRole("checkbox", { name: /privacy notice/ }).check();
    await page.getByRole("button", { name: "Register patient" }).click();
    await expect(page.getByText("Possible existing record")).toBeVisible();
    await expect(page.getByRole("button", { name: "Register as new patient" })).toBeDisabled();

    // Book an appointment for today with Dr Ibrahim Musa
    await page.goto(patientUrl);
    await page.getByRole("link", { name: "Book appointment" }).click();
    // "Any available" avoids colliding with slots from earlier runs; double-booking is covered by integration tests.
    await page.getByLabel("Clinician").selectOption({ label: "Any available" });
    const now = new Date(Date.now() + 2 * 60 * 60_000);
    const lagos = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Lagos" }).format(now);
    const [h] = lagos.split(":");
    const hour = Math.min(Number(h), 22);
    await page.getByLabel("Time").fill(`${String(hour).padStart(2, "0")}:${String(Math.floor(Math.random() * 11) * 5).padStart(2, "0")}`);
    await page.getByRole("button", { name: "Book appointment" }).click();
    await expect(page).toHaveURL(/tab=appointments/);
    await expect(page.getByRole("cell", { name: "booked" })).toBeVisible();

    // Check in from the appointments list
    await page.goto("/appointments");
    const row = page.getByRole("row").filter({ hasText: family });
    await row.getByRole("link", { name: "Check in" }).click();
    await page.getByLabel("How will the visit be paid?").selectOption("CASH");
    await page.getByRole("button", { name: "Check in" }).click();
    await expect(page.getByText(/Checked in. Visit reference ENC-\d{4}-\d{6}/)).toBeVisible();

    // Queue shows the patient awaiting vitals
    await page.goto("/queue");
    const card = page.getByRole("listitem").filter({ hasText: family });
    await expect(card.getByText("Awaiting vitals").first()).toBeVisible();
    // Reception cannot take the patient into consultation (no such button)
    await expect(card.getByRole("button", { name: /In consultation/ })).toHaveCount(0);

    // Nurse moves to ready for doctor; doctor takes into consultation
    const nurseCtx = await browser.newContext();
    const nurse = await nurseCtx.newPage();
    await login(nurse, "nurse");
    await nurse.goto("/queue");
    await nurse.getByRole("listitem").filter({ hasText: family }).getByRole("button", { name: /Ready for doctor/ }).click();
    await expect(nurse.getByText("Moved to Ready for doctor.")).toBeVisible();

    const docCtx = await browser.newContext();
    const doc = await docCtx.newPage();
    await login(doc, "doctor2");
    await doc.goto("/queue?stage=READY_FOR_DOCTOR");
    await doc.getByRole("listitem").filter({ hasText: family }).getByRole("button", { name: /In consultation/ }).click();
    await expect(doc.getByText("Moved to In consultation.")).toBeVisible();
    await nurseCtx.close();
    await docCtx.close();
  });
});
