/**
 * Local-development seed. ENTIRELY FICTIONAL data - no real patients or staff.
 *
 *  - Refuses to run when NODE_ENV=production.
 *  - Demo staff share one password from SEED_DEMO_PASSWORD (default documented in README).
 *    Set SEED_FORCE_PASSWORD_CHANGE=true for any shared/staging environment.
 *  - Public facts about the hospital are loaded as UNVERIFIED setup facts, never as truth.
 *  - Beds and wards are labelled DEMO.
 */
import "dotenv/config";
import { PrismaClient, type QueueStage, type SexAtBirth } from "@prisma/client";
import { syncPermissionCatalog } from "../src/server/authz/catalog-sync";
import { seedClinicalActivity, seedClinicalCatalogue } from "./seed-clinical";
import { seedPharmacy } from "./seed-pharmacy";
import { seedBilling } from "./seed-billing";
import { seedMaternity } from "./seed-maternity";
import { seedHr } from "./seed-hr";
import { ROLE_TEMPLATES } from "../src/server/authz/role-templates";
import { hashPassword } from "../src/server/auth/password";
import { encryptField } from "../src/server/crypto";
import { formatMrn } from "../src/server/sequence";
import { recordAudit } from "../src/server/audit";
import { identifierIndex } from "../src/server/domains/patients/service";
import { buildNameSearch } from "../src/server/domains/patients/normalize";
import { normalizePhone } from "../src/lib/phone";
import { localDateTimeToUtc, todayLocal } from "../src/lib/time";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data in production.");
  process.exit(1);
}

const prisma = new PrismaClient();
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD || "Demo-Aduraking-2026!";
const FORCE_CHANGE = process.env.SEED_FORCE_PASSWORD_CHANGE === "true";

function phone(n: string) {
  const p = normalizePhone(n);
  if (!p) throw new Error(`Invalid seed phone ${n}`);
  return p;
}

function addDays(local: string, days: number) {
  const d = new Date(`${local}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function seedAccessControl() {
  const sync = await syncPermissionCatalog(prisma);
  if (sync.granted.length)
    console.warn(`Granted ${sync.granted.length} new release permission(s) to template roles.`);
  const roles: Record<string, string> = {};
  for (const t of ROLE_TEMPLATES) {
    const existing = await prisma.role.findUnique({ where: { code: t.code } });
    if (existing) {
      roles[t.code] = existing.id;
      continue; // never overwrite a role that may have approved changes
    }
    const role = await prisma.role.create({
      data: {
        code: t.code,
        name: t.name,
        description: t.description,
        kind: t.kind,
        requiresMfa: t.requiresMfa,
        isSystemTemplate: true,
        permissions: { create: [...new Set(t.permissions)].map((permissionCode) => ({ permissionCode })) },
      },
    });
    roles[t.code] = role.id;
  }
  return roles;
}

async function seedOrganisation() {
  let org = await prisma.organization.findFirst();
  org ??= await prisma.organization.create({
    data: {
      name: "Aduraking Hospital and Maternity",
      subtitle: "Hospital & Maternity",
      tagline: "Your Health, Our Priority.",
    },
  });
  const main = await prisma.branch.upsert({
    where: { code: "MAIN" },
    create: {
      organizationId: org.id,
      code: "MAIN",
      name: "Main campus",
      addressLine: "90 Lagos Road, Haruna",
      city: "Ikorodu",
      state: "Lagos",
      status: "ACTIVE",
      verificationStatus: "AWAITING_APPROVAL",
      verificationNotes:
        "Address taken from a public facility registry. Confirm with hospital administration.",
    },
    update: {},
  });
  await prisma.branch.upsert({
    where: { code: "ANNEX" },
    create: {
      organizationId: org.id,
      code: "ANNEX",
      name: "Annex (unverified)",
      addressLine: "90 Lagos Road, Haruna",
      city: "Ikorodu",
      state: "Lagos",
      status: "PENDING_VERIFICATION",
      verificationStatus: "UNKNOWN",
      verificationNotes:
        "A separate registry listing exists with the same address. Not confirmed as a separate campus; do not combine bed or staff counts.",
    },
    update: {},
  });

  const deptDefs = [
    ["OPD", "General Outpatients", "CLINICAL"],
    ["EMG", "Emergency", "CLINICAL"],
    ["MAT", "Maternity & Antenatal", "CLINICAL"],
    ["PAED", "Paediatrics", "CLINICAL"],
    ["NUR", "Nursing & Wards", "CLINICAL"],
    ["LAB", "Laboratory", "DIAGNOSTIC"],
    ["RAD", "Imaging / Radiology", "DIAGNOSTIC"],
    ["PHM", "Pharmacy", "SUPPORT"],
    ["STORE", "Stores & Procurement", "SUPPORT"],
    ["HMO", "HMO Desk", "ADMINISTRATIVE"],
    ["FIN", "Accounts & Billing", "ADMINISTRATIVE"],
    ["ADM", "Administration", "ADMINISTRATIVE"],
    ["HR", "Human Resources", "ADMINISTRATIVE"],
  ] as const;
  const depts: Record<string, string> = {};
  for (const [code, name, kind] of deptDefs) {
    const d = await prisma.department.upsert({
      where: { branchId_code: { branchId: main.id, code } },
      create: { branchId: main.id, code, name, kind },
      update: {},
    });
    depts[code] = d.id;
  }

  const wardDefs = [
    { code: "DEMO-GEN", name: "DEMO General Ward", kind: "GENERAL" as const, dept: "NUR", beds: 4 },
    { code: "DEMO-MAT", name: "DEMO Maternity Ward", kind: "MATERNITY" as const, dept: "MAT", beds: 4 },
    { code: "DEMO-LAB", name: "DEMO Labour Room", kind: "LABOUR" as const, dept: "MAT", beds: 2 },
  ];
  for (const w of wardDefs) {
    const ward = await prisma.ward.upsert({
      where: { branchId_code: { branchId: main.id, code: w.code } },
      create: {
        branchId: main.id,
        departmentId: depts[w.dept],
        code: w.code,
        name: w.name,
        kind: w.kind,
        isDemo: true,
      },
      update: {},
    });
    for (let i = 1; i <= w.beds; i++) {
      const code = `B${String(i).padStart(2, "0")}`;
      await prisma.bed.upsert({
        where: { wardId_code: { wardId: ward.id, code } },
        create: {
          wardId: ward.id,
          code,
          label: `${w.name.replace("DEMO ", "")} bed ${i} (DEMO)`,
          isDemo: true,
        },
        update: {},
      });
    }
  }

  const visitTypes = [
    ["GOPD-NEW", "General consultation (new)", "OPD", 20],
    ["GOPD-FU", "General consultation (follow-up)", "OPD", 15],
    ["EMERGENCY", "Emergency attendance", "EMG", 30],
    ["ANC-BOOK", "Antenatal booking visit", "MAT", 30],
    ["ANC-FU", "Antenatal follow-up", "MAT", 20],
    ["PNC", "Postnatal visit", "MAT", 20],
    ["PAED", "Paediatric consultation", "PAED", 20],
  ] as const;
  for (const [code, name, dept, mins] of visitTypes) {
    await prisma.visitType.upsert({
      where: { code },
      create: { code, name, departmentId: depts[dept], defaultDurationMin: mins },
      update: {},
    });
  }

  const facts: {
    key: string;
    category: string;
    label: string;
    value: string;
    source: string;
    status?: "UNKNOWN" | "AWAITING_APPROVAL";
  }[] = [
    {
      key: "org.name",
      category: "Identity",
      label: "Hospital name",
      value: "Aduraking Hospital and Maternity",
      source: "Public facility registry; hospital website",
      status: "AWAITING_APPROVAL",
    },
    {
      key: "org.tagline",
      category: "Identity",
      label: "Public tagline",
      value: "Your Health, Our Priority.",
      source: "https://adurakinghospital.com/",
      status: "AWAITING_APPROVAL",
    },
    {
      key: "org.website",
      category: "Identity",
      label: "Website",
      value: "https://adurakinghospital.com/",
      source: "Public web",
      status: "AWAITING_APPROVAL",
    },
    {
      key: "org.phone",
      category: "Contact",
      label: "Main phone",
      value: "0704 932 2369",
      source: "Public facility registry",
    },
    {
      key: "org.email",
      category: "Contact",
      label: "Main email",
      value: "adurakinghospital@gmail.com",
      source: "Public facility registry",
    },
    {
      key: "org.ownership",
      category: "Identity",
      label: "Ownership & level",
      value: "Private, secondary care, 24-hour",
      source: "Public facility registry",
    },
    {
      key: "main.address",
      category: "Branches",
      label: "Main campus address",
      value: "90 Lagos Road, Haruna, Ikorodu, Lagos",
      source: "Public facility registry",
      status: "AWAITING_APPROVAL",
    },
    {
      key: "main.beds",
      category: "Capacity",
      label: "Main campus inpatient beds (registry)",
      value: "9",
      source: "Public facility registry - do not treat as configured beds",
    },
    {
      key: "main.clinicalStaff",
      category: "Capacity",
      label: "Main campus clinical staff (registry)",
      value: "18",
      source: "Public facility registry",
    },
    {
      key: "annex.exists",
      category: "Branches",
      label: "Annex is a separate campus",
      value: "Unconfirmed - registry lists 'Annex' at the same address",
      source: "Public facility registry",
    },
    {
      key: "annex.beds",
      category: "Capacity",
      label: "Annex inpatient beds (registry)",
      value: "10",
      source: "Public facility registry - do not add to main campus",
    },
    {
      key: "annex.clinicalStaff",
      category: "Capacity",
      label: "Annex clinical staff (registry)",
      value: "17",
      source: "Public facility registry",
    },
    {
      key: "branch.ifesowapo",
      category: "Branches",
      label: "Possible additional address",
      value: "1 Ifesowapo Street, Olosogbo Agbede, Ikorodu",
      source: "One HMO provider directory - not an established branch",
    },
    {
      key: "services.onsite",
      category: "Services",
      label: "On-site services",
      value: "Inpatient, outpatient, maternity, laboratory, imaging/radiology, pharmacy",
      source: "Public facility registry",
    },
    {
      key: "hmo.hygeia",
      category: "HMO",
      label: "Listed by Hygeia HMO",
      value: "Appears in public provider directory",
      source: "https://hygeiahmo.com/provider-directory/ - listing is not a contract",
    },
    {
      key: "hmo.reliance",
      category: "HMO",
      label: "Listed by Reliance Health (Alafia)",
      value: "Appears in public provider directory",
      source: "https://getreliancehealth.com/alafia/providers/ - listing is not a contract",
    },
    {
      key: "hmo.fountain",
      category: "HMO",
      label: "Listed by Fountain Healthcare",
      value: "Appears in public provider directory",
      source: "https://fountainhealthcareng.com/service-providers/ - listing is not a contract",
    },
    {
      key: "logo",
      category: "Identity",
      label: "Official logo",
      value: "Not provided - upload an approved logo",
      source: "None",
    },
    {
      key: "legal.dpia",
      category: "Compliance",
      label: "Data protection impact assessment (NDPA 2023)",
      value: "Not started",
      source: "Go-live requirement",
    },
    {
      key: "legal.retention",
      category: "Compliance",
      label: "Record retention schedule",
      value: "Awaiting legal sign-off",
      source: "Go-live requirement",
    },
  ];
  for (const f of facts) {
    await prisma.setupFact.upsert({
      where: { key: f.key },
      create: { ...f, status: f.status ?? "UNKNOWN" },
      update: {},
    });
  }
  return { org, main, depts };
}

interface DemoUser {
  email: string;
  given: string;
  family: string;
  title: string;
  roles: string[];
  allBranches?: boolean;
}

const DEMO_USERS: DemoUser[] = [
  {
    email: "owner",
    given: "Olufemi",
    family: "Adeyemi",
    title: "Proprietor (demo)",
    roles: ["OWNER"],
    allBranches: true,
  },
  {
    email: "admin",
    given: "Kemi",
    family: "Balogun",
    title: "Hospital Administrator",
    roles: ["HOSPITAL_ADMIN"],
    allBranches: true,
  },
  {
    email: "meddir",
    given: "Babatunde",
    family: "Oyelaran",
    title: "Medical Director",
    roles: ["MEDICAL_DIRECTOR"],
  },
  { email: "doctor", given: "Chiamaka", family: "Eze", title: "Medical Officer", roles: ["PHYSICIAN"] },
  { email: "doctor2", given: "Ibrahim", family: "Musa", title: "Medical Officer", roles: ["PHYSICIAN"] },
  {
    email: "consultant",
    given: "Folake",
    family: "Ajayi",
    title: "Visiting Obstetrician",
    roles: ["CONSULTANT"],
  },
  {
    email: "nursesup",
    given: "Grace",
    family: "Okonkwo",
    title: "Nursing Supervisor",
    roles: ["NURSING_SUPERVISOR"],
  },
  { email: "nurse", given: "Aminat", family: "Lawal", title: "Staff Nurse", roles: ["NURSE"] },
  { email: "midwife", given: "Bisola", family: "Ogunbiyi", title: "Midwife", roles: ["MIDWIFE"] },
  { email: "reception", given: "Tolu", family: "Akinola", title: "Front Desk Officer", roles: ["RECEPTION"] },
  {
    email: "records",
    given: "Emeka",
    family: "Nwosu",
    title: "Medical Records Officer",
    roles: ["MEDICAL_RECORDS"],
  },
  {
    email: "lab",
    given: "Yusuf",
    family: "Abdullahi",
    title: "Medical Laboratory Scientist",
    roles: ["LAB_SCIENTIST"],
  },
  {
    email: "lab2",
    given: "Ifeoma",
    family: "Nwachukwu",
    title: "Medical Laboratory Scientist",
    roles: ["LAB_SCIENTIST"],
  },
  { email: "imaging", given: "Ngozi", family: "Obi", title: "Radiographer", roles: ["IMAGING"] },
  { email: "pharmacist", given: "Segun", family: "Fashola", title: "Pharmacist", roles: ["PHARMACIST"] },
  { email: "store", given: "Halima", family: "Garba", title: "Storekeeper", roles: ["STOREKEEPER"] },
  { email: "hmo", given: "Adaeze", family: "Chukwu", title: "HMO Officer", roles: ["HMO_OFFICER"] },
  { email: "cashier", given: "Kunle", family: "Ilori", title: "Cashier", roles: ["CASHIER"] },
  { email: "finance", given: "Ronke", family: "Adebisi", title: "Accountant", roles: ["FINANCE"] },
  { email: "hr", given: "Uche", family: "Okafor", title: "HR & Payroll Officer", roles: ["HR_PAYROLL"] },
  {
    email: "support",
    given: "Dapo",
    family: "Salami",
    title: "IT Support",
    roles: ["SYSTEM_SUPPORT"],
    allBranches: true,
  },
  {
    email: "auditor",
    given: "Zainab",
    family: "Bello",
    title: "Compliance Officer",
    roles: ["AUDITOR"],
    allBranches: true,
  },
  {
    email: "multi",
    given: "Precious",
    family: "Edet",
    title: "Nurse & weekend front desk",
    roles: ["NURSE", "RECEPTION"],
  },
];

async function seedUsers(roles: Record<string, string>, mainId: string) {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const users: Record<string, string> = {};
  for (const u of DEMO_USERS) {
    const email = `${u.email}@demo.aduraking.test`;
    const user = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        givenName: u.given,
        familyName: u.family,
        displayName: `${u.given} ${u.family}`,
        jobTitle: u.title,
        passwordHash,
        mustChangePassword: FORCE_CHANGE,
        defaultBranchId: mainId,
        isDemo: true,
      },
      update: {},
    });
    users[u.email] = user.id;
    for (const code of u.roles) {
      const existing = await prisma.userRole.findFirst({
        where: { userId: user.id, roleId: roles[code], revokedAt: null },
      });
      if (!existing) {
        await prisma.userRole.create({
          data: {
            userId: user.id,
            roleId: roles[code]!,
            branchId: u.allBranches ? null : mainId,
            allBranches: !!u.allBranches,
            reason: "Demo seed",
          },
        });
      }
    }
  }
  return users;
}

interface DemoPatient {
  key: string;
  given: string;
  middle?: string;
  family: string;
  dob: string | null;
  sex: SexAtBirth;
  phone?: string;
  city?: string;
  nok?: [string, string, string];
  nin?: string;
  provisional?: boolean;
  allergies?: [string, "DRUG" | "FOOD" | "ENVIRONMENT", string, "MILD" | "MODERATE" | "SEVERE"][];
  nka?: boolean;
  daysAgo?: number;
  note?: string;
}

const DEMO_PATIENTS: DemoPatient[] = [
  {
    key: "A",
    given: "Tunde",
    family: "Bakare",
    dob: "1986-03-14",
    sex: "MALE",
    phone: "08090000101",
    city: "Ikorodu",
    nok: ["Bola Bakare", "Spouse", "08090000102"],
    nka: true,
    daysAgo: 200,
    note: "Scenario A: self-pay outpatient",
  },
  {
    key: "B",
    given: "Ngozi",
    middle: "Ifeoma",
    family: "Okafor",
    dob: "1979-11-02",
    sex: "FEMALE",
    phone: "08090000103",
    city: "Ikorodu",
    nok: ["Obinna Okafor", "Brother", "08090000104"],
    allergies: [["Penicillin", "DRUG", "Rash and swelling", "SEVERE"]],
    daysAgo: 400,
    note: "Scenario B: insured (DEMO Health Plan cover)",
  },
  {
    key: "C",
    given: "Aisha",
    family: "Bello",
    dob: "1995-06-21",
    sex: "FEMALE",
    phone: "08090000105",
    city: "Agbede",
    nok: ["Musa Bello", "Spouse", "08090000106"],
    nka: true,
    daysAgo: 60,
    note: "Scenario C: antenatal (DEMO pregnancy at 28 weeks)",
  },
  {
    key: "D",
    given: "Oluwaseun",
    family: "Adebayo",
    dob: "1990-01-30",
    sex: "MALE",
    phone: "08090000107",
    city: "Ikorodu",
    nok: ["Funke Adebayo", "Mother", "08090000108"],
    nin: "12345678901",
    daysAgo: 30,
  },
  // Deliberate near-duplicate of D (same phone, similar name) for the duplicate review queue
  {
    key: "D2",
    given: "Seun",
    family: "Adebayo",
    dob: "1990-01-30",
    sex: "MALE",
    phone: "08090000107",
    city: "Ikorodu",
    daysAgo: 5,
  },
  {
    key: "E",
    given: "Chinedu",
    family: "Okeke",
    dob: "1972-08-09",
    sex: "MALE",
    phone: "08090000109",
    city: "Ikorodu",
    allergies: [["Sulfonamides", "DRUG", "Hives", "MODERATE"]],
    daysAgo: 800,
  },
  {
    key: "F",
    given: "Folasade",
    family: "Ogundipe",
    dob: "1960-12-12",
    sex: "FEMALE",
    phone: "08090000110",
    city: "Ikorodu",
    nka: true,
    daysAgo: 1000,
  },
  {
    key: "G",
    given: "Ifeanyi",
    family: "Nnamdi",
    dob: "2019-04-05",
    sex: "MALE",
    city: "Ikorodu",
    nok: ["Chioma Nnamdi", "Mother", "08090000111"],
    nka: true,
    daysAgo: 300,
  },
  {
    key: "H",
    given: "Chioma",
    family: "Nnamdi",
    dob: "1991-09-17",
    sex: "FEMALE",
    phone: "08090000111",
    city: "Ikorodu",
    nka: true,
    daysAgo: 300,
  },
  {
    key: "I",
    given: "Abdulrahman",
    family: "Yusuf",
    dob: "1983-02-25",
    sex: "MALE",
    phone: "08090000112",
    city: "Ikorodu",
    daysAgo: 90,
  },
  {
    key: "J",
    given: "Blessing",
    family: "Etim",
    dob: "1998-07-07",
    sex: "FEMALE",
    phone: "08090000113",
    city: "Ikorodu",
    allergies: [["Groundnut", "FOOD", "Swelling of lips", "SEVERE"]],
    daysAgo: 45,
  },
  {
    key: "K",
    given: "Kehinde",
    family: "Alabi",
    dob: "1975-05-19",
    sex: "FEMALE",
    phone: "08090000114",
    city: "Ikorodu",
    nka: true,
    daysAgo: 20,
  },
  {
    key: "L",
    given: "Taiwo",
    family: "Alabi",
    dob: "1975-05-19",
    sex: "MALE",
    phone: "08090000115",
    city: "Ikorodu",
    nka: true,
    daysAgo: 20,
    note: "Twin of K - similar but NOT a duplicate",
  },
  {
    key: "M",
    given: "Emmanuel",
    family: "Udo",
    dob: "2001-10-10",
    sex: "MALE",
    phone: "08090000116",
    city: "Ikorodu",
    daysAgo: 10,
  },
  {
    key: "N",
    given: "Hadiza",
    family: "Suleiman",
    dob: "1988-03-03",
    sex: "FEMALE",
    phone: "08090000117",
    city: "Ikorodu",
    nka: true,
    daysAgo: 150,
  },
  {
    key: "O",
    given: "Victor",
    family: "Ekanem",
    dob: "1969-01-15",
    sex: "MALE",
    phone: "08090000118",
    city: "Ikorodu",
    daysAgo: 700,
  },
  {
    key: "P",
    given: "Yetunde",
    family: "Martins",
    dob: "1993-04-28",
    sex: "FEMALE",
    phone: "08090000119",
    city: "Ikorodu",
    nka: true,
    daysAgo: 3,
  },
  {
    key: "Q",
    given: "Gbenga",
    family: "Ojo",
    dob: "1980-12-01",
    sex: "MALE",
    phone: "08090000120",
    city: "Ikorodu",
    daysAgo: 1,
  },
  {
    key: "R",
    given: "Unknown",
    family: "Male (emergency)",
    dob: null,
    sex: "MALE",
    provisional: true,
    daysAgo: 0,
    note: "Emergency arrival - identity to be completed",
  },
];

async function seedPatients(mainId: string, users: Record<string, string>) {
  const existing = await prisma.patient.count({ where: { isDemo: true } });
  if (existing > 0) return null;
  const today = todayLocal();
  const ids: Record<string, string> = {};
  let n = 0n;
  for (const p of DEMO_PATIENTS) {
    n += 1n;
    const createdAt = new Date(Date.now() - (p.daysAgo ?? 0) * 86_400_000);
    const patient = await prisma.patient.create({
      data: {
        mrn: formatMrn(n),
        registeredBranchId: mainId,
        givenName: p.given,
        middleName: p.middle,
        familyName: p.family,
        nameSearch: buildNameSearch({ givenName: p.given, middleName: p.middle, familyName: p.family }),
        dateOfBirth: p.dob ? new Date(`${p.dob}T00:00:00Z`) : null,
        dobProvenance: p.dob ? "STATED" : "UNKNOWN",
        sexAtBirth: p.sex,
        phoneE164: p.phone ? phone(p.phone) : null,
        city: p.city,
        state: p.city ? "Lagos" : null,
        registrationStatus: p.provisional ? "PROVISIONAL" : "COMPLETE",
        allergyReviewStatus: p.allergies ? "HAS_ALLERGIES" : p.nka ? "NO_KNOWN_ALLERGIES" : "NOT_ASKED",
        createdById: users.reception,
        createdAt,
        isDemo: true,
      },
    });
    ids[p.key] = patient.id;
    if (p.nok) {
      await prisma.patientContact.create({
        data: {
          patientId: patient.id,
          kind: "BOTH",
          name: p.nok[0],
          relationship: p.nok[1],
          phoneE164: phone(p.nok[2]),
          isPrimary: true,
        },
      });
    }
    if (p.nin) {
      await prisma.patientIdentifier.create({
        data: {
          patientId: patient.id,
          type: "NIN",
          valueEnc: encryptField(p.nin),
          valueLast4: p.nin.slice(-4),
          blindIndex: identifierIndex("NIN", p.nin),
          createdById: users.records,
        },
      });
    }
    for (const a of p.allergies ?? []) {
      await prisma.patientAllergy.create({
        data: {
          patientId: patient.id,
          substance: a[0],
          category: a[1],
          reaction: a[2],
          severity: a[3],
          source: "PATIENT_REPORTED",
          recordedById: users.reception!,
          recordedAt: createdAt,
        },
      });
    }
    if (!p.provisional) {
      await prisma.consentRecord.createMany({
        data: [
          {
            patientId: patient.id,
            type: "DATA_PROCESSING_NOTICE",
            status: "GRANTED",
            legalBasis: "CONTRACT",
            noticeVersion: "draft-1 (pending legal review)",
            capturedById: users.reception!,
            capturedAt: createdAt,
          },
          {
            patientId: patient.id,
            type: "SMS_REMINDERS",
            status: p.phone ? "GRANTED" : "DECLINED",
            legalBasis: "CONSENT",
            capturedById: users.reception!,
            capturedAt: createdAt,
          },
        ],
      });
    }
  }
  await prisma.sequence.upsert({
    where: { scope: "MRN" },
    create: { scope: "MRN", value: n },
    update: { value: n },
  });

  // Guardian link: Chioma Nnamdi is mother of Ifeanyi (unverified until records officer verifies)
  await prisma.guardianRelationship.create({
    data: {
      dependentPatientId: ids.G!,
      guardianPatientId: ids.H!,
      guardianName: "Chioma Nnamdi",
      guardianPhoneE164: phone("08090000111"),
      relationship: "Mother",
      createdById: users.reception!,
    },
  });
  // Duplicate review for D / D2
  const [a, b] = ids.D! < ids.D2! ? [ids.D!, ids.D2!] : [ids.D2!, ids.D!];
  await prisma.duplicatePatientReview.create({
    data: {
      patientAId: a,
      patientBId: b,
      score: 75,
      reasons: ["Same phone number", "Same date of birth", "Same surname"],
      raisedById: users.reception,
    },
  });

  // Appointments and visits
  const vt = Object.fromEntries((await prisma.visitType.findMany()).map((v) => [v.code, v]));
  const year = Number(today.slice(0, 4));
  let apt = 0;
  let enc = 0;
  const aptRef = () => `APT-${year}-${String(++apt).padStart(6, "0")}`;
  const encRef = () => `ENC-${year}-${String(++enc).padStart(6, "0")}`;

  async function appointment(
    key: string,
    date: string,
    time: string,
    typeCode: string,
    clinician: string | null,
    status: "BOOKED" | "CHECKED_IN" | "COMPLETED" | "NO_SHOW" | "CANCELLED",
  ) {
    const v = vt[typeCode]!;
    const startAt = localDateTimeToUtc(date, time);
    return prisma.appointment.create({
      data: {
        ref: aptRef(),
        patientId: ids[key]!,
        branchId: mainId,
        departmentId: v.departmentId,
        clinicianId: clinician ? users[clinician] : null,
        visitTypeId: v.id,
        startAt,
        endAt: new Date(startAt.getTime() + v.defaultDurationMin * 60_000),
        status,
        source: "PHONE",
        createdById: users.reception!,
        createdAt: new Date(startAt.getTime() - 3 * 86_400_000),
      },
    });
  }

  async function visit(
    key: string,
    arrivedAt: Date,
    typeCode: string,
    stages: QueueStage[],
    opts: {
      appointmentId?: string;
      clinician?: string;
      priority?: "ROUTINE" | "URGENT" | "EMERGENCY";
      payer?: "CASH" | "HMO" | "UNDETERMINED";
    } = {},
  ) {
    const v = vt[typeCode]!;
    const last = stages[stages.length - 1]!;
    const closed = last === "COMPLETED" || last === "CANCELLED";
    const e = await prisma.encounter.create({
      data: {
        ref: encRef(),
        patientId: ids[key]!,
        branchId: mainId,
        departmentId: v.departmentId,
        appointmentId: opts.appointmentId,
        visitTypeId: v.id,
        attendingClinicianId: opts.clinician ? users[opts.clinician] : null,
        priority: opts.priority ?? "ROUTINE",
        payerClass: opts.payer ?? "CASH",
        queueStage: last,
        status: closed ? (last === "COMPLETED" ? "COMPLETED" : "CANCELLED") : "OPEN",
        arrivedAt,
        completedAt: closed ? new Date(arrivedAt.getTime() + stages.length * 15 * 60_000) : null,
        createdById: users.reception!,
        createdAt: arrivedAt,
      },
    });
    let prev: QueueStage | null = null;
    let t = arrivedAt.getTime();
    for (const s of stages) {
      await prisma.visitQueueEvent.create({
        data: {
          encounterId: e.id,
          fromStage: prev,
          toStage: s,
          changedById:
            s === "IN_CONSULTATION" || s === "READY_TO_DISCHARGE"
              ? users[opts.clinician ?? "doctor"]!
              : users.nurse!,
          changedAt: new Date(t),
        },
      });
      prev = s;
      t += (10 + Math.floor(Math.random() * 25)) * 60_000;
    }
    if (opts.clinician && stages.includes("IN_CONSULTATION")) {
      await prisma.careTeamAssignment.create({
        data: {
          encounterId: e.id,
          patientId: ids[key]!,
          userId: users[opts.clinician]!,
          role: "ATTENDING",
          assignedById: users.reception!,
          assignedAt: arrivedAt,
        },
      });
    }
    return e;
  }

  // Historic completed visits (last 14 days) for dashboard trends
  const history: [string, number, string, string][] = [
    ["E", 13, "GOPD-FU", "doctor"],
    ["F", 12, "GOPD-FU", "doctor2"],
    ["I", 10, "GOPD-NEW", "doctor"],
    ["N", 9, "GOPD-NEW", "doctor2"],
    ["O", 7, "GOPD-FU", "doctor"],
    ["B", 6, "GOPD-FU", "doctor"],
    ["J", 4, "GOPD-NEW", "doctor2"],
    ["K", 3, "GOPD-NEW", "doctor"],
    ["L", 3, "GOPD-NEW", "doctor"],
    ["M", 2, "GOPD-NEW", "doctor2"],
    ["G", 1, "PAED", "doctor"],
  ];
  for (const [key, ago, type, clin] of history) {
    const date = addDays(today, -ago);
    const a = await appointment(key, date, "09:30", type, clin, "COMPLETED");
    await visit(
      key,
      new Date(a.startAt.getTime() - 10 * 60_000),
      type,
      ["AWAITING_VITALS", "READY_FOR_DOCTOR", "IN_CONSULTATION", "READY_TO_DISCHARGE", "COMPLETED"],
      { appointmentId: a.id, clinician: clin },
    );
  }
  await appointment("Q", addDays(today, -2), "11:00", "GOPD-NEW", "doctor2", "NO_SHOW");

  // Today: live queue
  const now = Date.now();
  const a1 = await appointment("A", today, "08:30", "GOPD-NEW", "doctor", "CHECKED_IN");
  await visit(
    "A",
    new Date(now - 95 * 60_000),
    "GOPD-NEW",
    ["AWAITING_VITALS", "READY_FOR_DOCTOR", "IN_CONSULTATION"],
    { appointmentId: a1.id, clinician: "doctor" },
  );
  const a2 = await appointment("B", today, "09:00", "GOPD-FU", "doctor", "CHECKED_IN");
  await visit("B", new Date(now - 70 * 60_000), "GOPD-FU", ["AWAITING_VITALS", "READY_FOR_DOCTOR"], {
    appointmentId: a2.id,
    clinician: "doctor",
    payer: "UNDETERMINED",
  });
  const a3 = await appointment("C", today, "09:30", "ANC-FU", "consultant", "CHECKED_IN");
  await visit("C", new Date(now - 40 * 60_000), "ANC-FU", ["AWAITING_VITALS"], { appointmentId: a3.id });
  await visit("R", new Date(now - 15 * 60_000), "EMERGENCY", ["READY_FOR_DOCTOR"], {
    priority: "EMERGENCY",
    payer: "UNDETERMINED",
  });
  await visit("P", new Date(now - 25 * 60_000), "GOPD-NEW", ["AWAITING_VITALS"], { payer: "CASH" });

  // Upcoming bookings
  for (const [key, time, type, clin] of [
    ["D", "13:00", "GOPD-FU", "doctor"],
    ["H", "14:00", "GOPD-NEW", "doctor2"],
    ["N", "15:30", "GOPD-FU", "doctor"],
  ] as const) {
    await appointment(key, today, time, type, clin, "BOOKED");
  }
  await appointment("K", addDays(today, 1), "10:00", "GOPD-FU", "doctor", "BOOKED");
  await appointment("C", addDays(today, 14), "10:00", "ANC-FU", "consultant", "BOOKED");

  await prisma.sequence.upsert({
    where: { scope: `APT:${year}` },
    create: { scope: `APT:${year}`, value: BigInt(apt) },
    update: { value: BigInt(apt) },
  });
  await prisma.sequence.upsert({
    where: { scope: `ENC:${year}` },
    create: { scope: `ENC:${year}`, value: BigInt(enc) },
    update: { value: BigInt(enc) },
  });
  return ids;
}

async function main() {
  const roles = await seedAccessControl();
  const { main } = await seedOrganisation();
  const users = await seedUsers(roles, main.id);
  const patients = await seedPatients(main.id, users);
  await seedClinicalCatalogue(prisma, users.lab!);
  const clinical = await seedClinicalActivity(prisma, users);
  if (clinical) console.warn("Seeded demo clinical activity (orders, notes, results).");
  if (await seedPharmacy(prisma, users, main.id))
    console.warn(
      "Seeded demo pharmacy and stores (medicines, lots, a pending prescription and requisition).",
    );
  if (await seedBilling(prisma, users))
    console.warn("Seeded DEMO price list, pending directory-listed HMOs and one fictional active payer.");
  if (await seedMaternity(prisma, users))
    console.warn("Seeded DEMO bed-day prices and an antenatal pregnancy.");
  if (await seedHr(prisma, users, main.id, await hashPassword(DEMO_PASSWORD)))
    console.warn(
      "Seeded DEMO employees, pay components (placeholder rates), a payroll run, a roster and a portal login.",
    );
  await recordAudit(prisma, {
    actorType: "SYSTEM",
    action: "seed.loaded",
    resourceType: "System",
    details: {
      demoUsers: Object.keys(users).length,
      demoPatients: patients ? Object.keys(patients).length : 0,
    },
  });
  console.warn(
    `Seed complete. ${Object.keys(users).length} demo staff (<name>@demo.aduraking.test).` +
      (patients ? ` ${Object.keys(patients).length} demo patients.` : " Patients already present - skipped."),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
