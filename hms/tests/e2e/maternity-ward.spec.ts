import { expect, test, type Browser, type Page } from "@playwright/test";
import { DEMO_PASSWORD, login, uniqueName, uniquePhone } from "./helpers";

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

const daysAgo = (n: number) => {
  const d = new Date(Date.now() + 3_600_000 - n * 86_400_000); // Lagos is UTC+1
  return d.toISOString().slice(0, 10);
};

async function dischargeStay(doctor: Page, finance: Page, admissionUrl: string, override: boolean) {
  await doctor.goto(admissionUrl);
  await doctor.getByRole("button", { name: "Authorise discharge" }).click();
  await doctor.getByLabel(/^Discharge summary/).fill("Well. Follow up in the postnatal clinic in one week.");
  await doctor.getByLabel(/^Your password/).fill(DEMO_PASSWORD);
  await doctor.getByRole("button", { name: "Sign and authorise" }).click();
  await expect(doctor.getByText("Discharge authorised.")).toBeVisible();

  await finance.goto(admissionUrl);
  await finance.getByRole("button", { name: "Financial clearance" }).click();
  if (override) {
    await finance.getByRole("checkbox", { name: /Clear with an outstanding balance/ }).check();
    await finance.getByLabel(/^Note/).fill("Balance to be settled at the postnatal clinic (agreed)");
  }
  await finance.getByRole("dialog").getByRole("button", { name: "Clear" }).click();
  await expect(finance.getByText("Discharge cleared.")).toBeVisible();

  await doctor.goto(admissionUrl);
  await doctor.getByRole("button", { name: "Complete discharge" }).click();
  await doctor.getByRole("dialog").getByRole("button", { name: "Complete discharge" }).click();
  await expect(doctor.getByText("Patient discharged.")).toBeVisible();
  await expect(doctor.getByText("discharged", { exact: true })).toBeVisible();
}

test("Phase 5: ANC -> admission -> ward move -> twin delivery -> mother and newborn discharge", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const reception = await as(browser, "reception");
  const family = uniqueName("Mat");
  await reception.goto("/patients/new");
  await reception.getByLabel("First name").fill(uniqueName("Ife"));
  await reception.getByLabel("Surname").fill(family);
  await reception.getByLabel("Sex at birth").selectOption("FEMALE");
  await reception.getByLabel(/^Date of birth\*?$/).fill("1993-09-09");
  await reception.getByLabel("Mobile phone").fill(uniquePhone());
  await reception.getByRole("checkbox", { name: /privacy notice/ }).check();
  await reception.getByRole("button", { name: "Register patient" }).click();
  await expect(reception).toHaveURL(/registered=1/);
  const patientPath = new URL(reception.url()).pathname;
  await reception.getByRole("link", { name: "Check in" }).click();
  await reception.getByLabel(/^How will the visit be paid/).selectOption("CASH");
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

  // Antenatal record with clinician-adopted dating.
  await doctor.goto(`${patientPath}?tab=maternity`);
  await doctor.getByRole("button", { name: "Open pregnancy record" }).click();
  await doctor.getByLabel(/^Gravida/).fill("1");
  await doctor.getByRole("dialog").getByRole("button", { name: "Open record" }).click();
  await expect(doctor.getByText("Pregnancy record opened.")).toBeVisible();
  await doctor.getByRole("link", { name: /^PRG-\d{4}-\d{6}$/ }).click();
  await expect(doctor).toHaveURL(/\/maternity\//);
  const pregnancyPath = new URL(doctor.url()).pathname;
  await doctor.getByRole("button", { name: "Add dating" }).click();
  await doctor.getByLabel(/^LMP \(first day\)/).fill(daysAgo(270));
  await doctor.getByRole("checkbox", { name: /Adopt this as/ }).check();
  await doctor.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(doctor.getByText("Dating recorded.")).toBeVisible();
  await expect(doctor.getByText("38w 4d")).toBeVisible();
  await doctor.getByRole("button", { name: "Record ANC visit" }).click();
  await doctor.getByLabel(/^Systolic BP/).fill("118");
  await doctor.getByLabel(/^Diastolic BP/).fill("76");
  await doctor.getByLabel(/^Fetal heart rate/).fill("140");
  await doctor.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(doctor.getByText("Antenatal visit recorded.")).toBeVisible();

  // Admit to the labour room, then move to the maternity ward.
  await doctor.goto("/queue?mine=1");
  await doctor
    .getByRole("listitem")
    .filter({ hasText: family })
    .getByRole("link", { name: "Open visit" })
    .click();
  await expect(doctor).toHaveURL(/\/encounters\//);
  await doctor.getByRole("button", { name: "Admit", exact: true }).click();
  await pickOption(doctor, /^Ward/, /DEMO Labour Room/);
  await doctor.getByLabel(/^Reason for admission/).fill("Established labour");
  await doctor.getByRole("dialog").getByRole("button", { name: "Admit" }).click();
  await expect(doctor.getByText("Patient admitted.")).toBeVisible();
  await doctor.getByRole("link", { name: /^ADM-\d{4}-\d{6}$/ }).click();
  await expect(doctor).toHaveURL(/\/admissions\//);
  const motherAdmission = new URL(doctor.url()).pathname;
  await doctor.getByRole("button", { name: "Assign bed" }).click();
  await pickOption(doctor, /^Bed/, /DEMO Labour Room/);
  await doctor.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(doctor.getByText("Bed updated.")).toBeVisible();
  await doctor.getByRole("button", { name: "Move bed / ward" }).click();
  await pickOption(doctor, /^Bed/, /DEMO Maternity Ward/);
  await doctor.getByLabel(/^Reason/).fill("Post-delivery care");
  await doctor.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(doctor.getByText("Bed updated.")).toBeVisible();
  await expect(doctor.getByText(/DEMO Labour Room .*: .* – /)).toBeVisible();

  // Twin delivery: one delivery record, two babies with their own records.
  await doctor.goto(pregnancyPath);
  await doctor.getByLabel("Time of birth").first().fill("00:01");
  await doctor.getByLabel("Sex").first().selectOption("FEMALE");
  await doctor.getByRole("button", { name: /Add another baby/ }).click();
  await doctor.getByLabel("Time of birth").nth(1).fill("00:09");
  await doctor.getByLabel("Sex").nth(1).selectOption("MALE");
  await doctor.getByLabel(/^Your password \(signature\)/).fill(DEMO_PASSWORD);
  await doctor.getByRole("button", { name: "Sign delivery record" }).click();
  await expect(
    doctor.getByText(/Delivery DEL-\d{4}-\d{6} signed\. 2 baby record\(s\) created\./),
  ).toBeVisible();
  await expect(doctor.getByRole("link", { name: /Baby .* \(Twin 1\)/ })).toBeVisible();
  await expect(doctor.getByRole("link", { name: /Baby .* \(Twin 2\)/ })).toBeVisible();

  // Babies are rooming-in on their own stays; discharge mother and both babies.
  const finance = await as(browser, "finance");
  await dischargeStay(doctor, finance, motherAdmission, true);
  for (const twin of ["Twin 1", "Twin 2"]) {
    await doctor.goto("/wards");
    await doctor.getByRole("link", { name: new RegExp(`Baby ${family} \\(${twin}\\)`) }).click();
    await expect(doctor).toHaveURL(/\/admissions\//);
    await dischargeStay(doctor, finance, new URL(doctor.url()).pathname, false);
  }

  // Beds freed by the stay are cleaned and made ready again.
  await doctor.goto("/wards");
  while (await doctor.getByRole("button", { name: "Mark ready" }).first().isVisible()) {
    await doctor.getByRole("button", { name: "Mark ready" }).first().click();
    await doctor.getByRole("dialog").getByRole("button", { name: "Mark ready" }).click();
    await expect(doctor.getByText("Bed ready.").first()).toBeVisible();
    await doctor.reload();
  }
});
