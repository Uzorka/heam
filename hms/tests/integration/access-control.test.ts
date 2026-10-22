import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { loadAuthContext, can } from "@/server/authz/context";
import { getClinicalAccess } from "@/server/authz/clinical-access";
import { getPatientDetail, searchPatients } from "@/server/domains/patients/service";
import { assignRole, revokeRole } from "@/server/domains/staff/users";
import { decideRoleChange, requestRoleChange } from "@/server/domains/staff/roles";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { branch, createUser, ctxFor, newPatient, userCtx } from "./helpers";

describe("RBAC and record-level access", () => {
  it("(1) reception has demographics but no clinical record access", async () => {
    const { ctx: reception } = await userCtx(["RECEPTION"]);
    const p = await newPatient(reception);
    const detail = await getPatientDetail(reception, p.patientId);
    expect(detail.patient.mrn).toBe(p.mrn);
    expect((await getClinicalAccess(reception, p.patientId)).allowed).toBe(false);
  });

  it("(2) HR cannot search or read patients; clinicians cannot see payroll", async () => {
    const { ctx: reception } = await userCtx(["RECEPTION"]);
    const p = await newPatient(reception);
    const { ctx: hr } = await userCtx(["HR_PAYROLL"]);
    await expect(searchPatients(hr, { q: "", page: 1, pageSize: 20, includeInactive: false })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getPatientDetail(hr, p.patientId)).rejects.toBeInstanceOf(ForbiddenError);
    const { ctx: doctor } = await userCtx(["PHYSICIAN"]);
    expect(can(doctor, "payroll.read")).toBe(false);
    expect(can(doctor, "hr.read")).toBe(false);
  });

  it("(3) multiple scoped roles combine, and revoking a role removes access immediately", async () => {
    const { ctx: admin } = await userCtx(["HOSPITAL_ADMIN"], { allBranches: true });
    const staff = await createUser(["NURSE"]);
    const main = await branch("T-MAIN");
    const reception = await prisma.role.findUniqueOrThrow({ where: { code: "RECEPTION" } });
    expect(can(await ctxFor(staff.id), "appointment.manage")).toBe(false);
    const ur = await assignRole(admin, {
      userId: staff.id,
      roleId: reception.id,
      branchId: main.id,
      allBranches: false,
      reason: "Weekend desk cover",
      isDelegation: false,
    });
    const both = await ctxFor(staff.id);
    expect(can(both, "appointment.manage")).toBe(true);
    expect(can(both, "clinical.vitals.record")).toBe(true);
    await revokeRole(admin, { userRoleId: ur.id, reason: "Cover ended" });
    const after = await ctxFor(staff.id);
    expect(can(after, "appointment.manage")).toBe(false);
    expect(can(after, "clinical.vitals.record")).toBe(true);
  });

  it("expired delegations stop applying without any job running", async () => {
    const staff = await createUser([]);
    const main = await branch();
    const role = await prisma.role.findUniqueOrThrow({ where: { code: "RECEPTION" } });
    await prisma.userRole.create({
      data: { userId: staff.id, roleId: role.id, branchId: main.id, effectiveTo: new Date(Date.now() - 1000), isDelegation: true },
    });
    expect(can(await ctxFor(staff.id), "appointment.manage")).toBe(false);
  });

  it("admins cannot grant roles to themselves", async () => {
    const { user, ctx: admin } = await userCtx(["HOSPITAL_ADMIN"], { allBranches: true });
    const md = await prisma.role.findUniqueOrThrow({ where: { code: "MEDICAL_DIRECTOR" } });
    await expect(
      assignRole(admin, { userId: user.id, roleId: md.id, allBranches: true, reason: "self", isDelegation: false }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("(4/22) branch scoping: other-branch patients are not found, even by direct id", async () => {
    const { ctx: otherReception } = await userCtx(["RECEPTION"], { branch: "T-OTHER" });
    const other = await newPatient(otherReception);
    const { ctx: mainReception } = await userCtx(["RECEPTION"], { branch: "T-MAIN" });
    await expect(getPatientDetail(mainReception, other.patientId)).rejects.toBeInstanceOf(NotFoundError);
    const res = await searchPatients(mainReception, { q: other.mrn, page: 1, pageSize: 20, includeInactive: false });
    expect(res.total).toBe(0);
    const { ctx: allBranch } = await userCtx(["MEDICAL_RECORDS"], { allBranches: true });
    expect((await getPatientDetail(allBranch, other.patientId)).patient.id).toBe(other.patientId);
  });

  it("suspended accounts cannot build an auth context", async () => {
    const u = await createUser(["NURSE"]);
    await prisma.user.update({ where: { id: u.id }, data: { status: "SUSPENDED" } });
    await expect(loadAuthContext(prisma, u.id)).rejects.toThrow(/not active/);
  });

  it("MFA-required roles are suspended until the user enrols (when enforced)", async () => {
    const u = await createUser(["FINANCE", "CASHIER"]);
    const ctx = await loadAuthContext(prisma, u.id, { enforceMfa: true });
    expect(ctx.suspendedGrants.map((g) => g.roleCode)).toEqual(["FINANCE"]);
    expect(can(ctx, "finance.read")).toBe(false);
    expect(can(ctx, "billing.payment.collect")).toBe(true);
  });

  it("role permission changes need a second approver", async () => {
    const { ctx: requester } = await userCtx(["HOSPITAL_ADMIN"], { allBranches: true });
    const { ctx: approver } = await userCtx(["OWNER"], { allBranches: true });
    const role = await prisma.role.create({ data: { code: `TMP${Date.now()}`, name: "Temp role" } });
    const req = await requestRoleChange(requester, { roleId: role.id, add: ["queue.read"], remove: [], reason: "Needed for triage cover" });
    // requester lacks approve permission; an approver who is also the requester is refused
    await expect(decideRoleChange(requester, { requestId: req.id, approve: true })).rejects.toBeInstanceOf(ForbiddenError);
    await decideRoleChange(approver, { requestId: req.id, approve: true });
    const perms = await prisma.rolePermission.findMany({ where: { roleId: role.id } });
    expect(perms.map((p) => p.permissionCode)).toEqual(["queue.read"]);
  });
});
