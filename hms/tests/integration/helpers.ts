import { prisma } from "@/server/db";
import { loadAuthContext, type AuthContext } from "@/server/authz/context";
import { hashPassword } from "@/server/auth/password";
import { registerPatient } from "@/server/domains/patients/service";
import { registerPatientSchema } from "@/lib/schemas/patient";

let counter = 0;
export function uniq(prefix = "t") {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export async function branch(code: "T-MAIN" | "T-OTHER" = "T-MAIN") {
  return prisma.branch.findUniqueOrThrow({ where: { code } });
}

export async function visitType(code: "T-MAIN" | "T-OTHER" = "T-MAIN") {
  return prisma.visitType.findUniqueOrThrow({ where: { code: `GOPD-${code}` } });
}

let cachedHash: string | undefined;
export const TEST_PASSWORD = "Correct-Horse-Battery-9";

export async function createUser(
  roleCodes: string[],
  opts: { branch?: "T-MAIN" | "T-OTHER"; allBranches?: boolean; email?: string } = {},
) {
  cachedHash ??= await hashPassword(TEST_PASSWORD);
  const b = await branch(opts.branch ?? "T-MAIN");
  const name = uniq("u");
  const user = await prisma.user.create({
    data: {
      email: opts.email ?? `${name}@test.local`,
      givenName: "Test",
      familyName: name,
      displayName: `Test ${name}`,
      passwordHash: cachedHash,
      mustChangePassword: false,
      defaultBranchId: b.id,
    },
  });
  for (const code of roleCodes) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code } });
    await prisma.userRole.create({
      data: {
        userId: user.id,
        roleId: role.id,
        branchId: opts.allBranches ? null : b.id,
        allBranches: !!opts.allBranches,
      },
    });
  }
  return user;
}

export async function ctxFor(userId: string, opts: { activeBranchId?: string } = {}): Promise<AuthContext> {
  return loadAuthContext(prisma, userId, { activeBranchId: opts.activeBranchId, enforceMfa: false });
}

export async function userCtx(
  roleCodes: string[],
  opts: { branch?: "T-MAIN" | "T-OTHER"; allBranches?: boolean } = {},
) {
  const user = await createUser(roleCodes, opts);
  return { user, ctx: await ctxFor(user.id) };
}

/** Unique 11-digit Nigerian mobile number. */
export function uniquePhone() {
  return `0809${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
}

export async function newPatient(
  ctx: AuthContext,
  overrides: Partial<Parameters<typeof registerPatientSchema.parse>[0]> = {},
) {
  const input = registerPatientSchema.parse({
    givenName: uniq("Given"),
    familyName: uniq("Family"),
    dateOfBirth: "1990-05-05",
    dobProvenance: "STATED",
    sexAtBirth: "FEMALE",
    phone: uniquePhone(),
    privacyNoticeGiven: true,
    ...overrides,
  });
  const r = await registerPatient(ctx, input);
  if (r.status !== "CREATED")
    throw new Error(`Unexpected duplicate warning: ${JSON.stringify(r.candidates)}`);
  return r;
}

import { checkIn, transitionStage } from "@/server/domains/queue/service";

/** Walk-in visit taken into consultation by `doctor` (establishing the care relationship). */
export async function visitInConsultation(reception: AuthContext, doctor: AuthContext, patientId: string) {
  const vt = await visitType();
  const enc = await checkIn(reception, { patientId, visitTypeId: vt.id, priority: "ROUTINE", payerClass: "CASH", financialTermsAcknowledged: true });
  let v = await transitionStage(reception, { encounterId: enc.id, version: enc.version, toStage: "READY_FOR_DOCTOR" });
  v = await transitionStage(doctor, { encounterId: enc.id, version: v.version, toStage: "IN_CONSULTATION" });
  return { ...enc, version: v.version };
}

export async function labTest(code: "T-HB" | "T-MP") {
  return prisma.labTestDefinition.findUniqueOrThrow({ where: { code }, include: { components: true } });
}
