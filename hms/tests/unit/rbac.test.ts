import { describe, expect, it } from "vitest";
import { PERMISSIONS, PERMISSION_CODES } from "@/server/authz/permissions";
import { ROLE_TEMPLATES, getRoleTemplate } from "@/server/authz/role-templates";
import { branchesWith, can, type AuthContext, type Grant } from "@/server/authz/context";
import { SYSTEM_META } from "@/server/request-meta";

const sensitivity = (code: string) => PERMISSIONS.find((p) => p.code === code)!.sensitivity;
const perms = (code: string) => new Set(getRoleTemplate(code)!.permissions);

function ctxWith(grants: Partial<Grant>[]): AuthContext {
  return {
    userId: "u",
    sessionId: null,
    kind: "STAFF",
    displayName: "x",
    email: "x@test",
    jobTitle: null,
    activeBranchId: "b1",
    mfaEnabled: false,
    suspendedGrants: [],
    meta: SYSTEM_META,
    grants: grants.map((g, i) => ({
      userRoleId: `ur${i}`,
      roleCode: "R",
      roleName: "R",
      branchId: null,
      departmentId: null,
      isDelegation: false,
      effectiveTo: null,
      permissions: new Set<string>(),
      ...g,
    })),
  };
}

describe("role templates - protective defaults", () => {
  it("only reference permissions that exist", () => {
    for (const t of ROLE_TEMPLATES)
      for (const p of t.permissions) expect(PERMISSION_CODES.has(p), `${t.code}:${p}`).toBe(true);
  });
  it("HR/payroll have no patient or clinical access", () => {
    for (const p of perms("HR_PAYROLL")) expect(["PHI", "CLINICAL"]).not.toContain(sensitivity(p));
  });
  it("clinicians, nurses and reception cannot see payroll by default", () => {
    for (const code of ["PHYSICIAN", "NURSE", "MIDWIFE", "MEDICAL_DIRECTOR", "RECEPTION", "CONSULTANT"]) {
      for (const p of perms(code)) expect(sensitivity(p), `${code}:${p}`).not.toBe("HR");
    }
  });
  it("system support and hospital admin cannot read clinical records", () => {
    for (const code of ["SYSTEM_SUPPORT", "HOSPITAL_ADMIN", "OWNER", "AUDITOR"]) {
      expect(perms(code).has("clinical.read"), code).toBe(false);
    }
    for (const p of perms("SYSTEM_SUPPORT")) expect(["PHI", "CLINICAL"]).not.toContain(sensitivity(p));
  });
  it("reception cannot read clinical notes", () => {
    expect(perms("RECEPTION").has("clinical.read")).toBe(false);
    expect(perms("RECEPTION").has("clinical.read.branch_wide")).toBe(false);
  });
  it("separates request and approval duties", () => {
    expect(perms("HOSPITAL_ADMIN").has("roles.approve_change")).toBe(false);
    expect(perms("RECEPTION").has("patient.merge.approve")).toBe(false);
    expect(perms("CASHIER").has("billing.refund.approve")).toBe(false);
    expect(perms("HR_PAYROLL").has("payroll.approve")).toBe(false);
  });
  it("only clinical roles can break glass", () => {
    for (const t of ROLE_TEMPLATES) {
      if (t.permissions.includes("clinical.breakglass")) expect(t.permissions).toContain("clinical.read");
    }
  });
});

describe("can() branch scoping", () => {
  it("respects branch scope and all-branch grants", () => {
    const ctx = ctxWith([{ branchId: "b1", permissions: new Set(["patient.read"]) }]);
    expect(can(ctx, "patient.read")).toBe(true);
    expect(can(ctx, "patient.read", { branchId: "b1" })).toBe(true);
    expect(can(ctx, "patient.read", { branchId: "b2" })).toBe(false);
    expect(branchesWith(ctx, "patient.read")).toEqual(["b1"]);
    const all = ctxWith([{ branchId: null, permissions: new Set(["patient.read"]) }]);
    expect(can(all, "patient.read", { branchId: "b2" })).toBe(true);
    expect(branchesWith(all, "patient.read")).toBe("ALL");
  });
  it("combines multiple roles (multi-hat staff)", () => {
    const ctx = ctxWith([
      { branchId: "b1", permissions: new Set(["clinical.vitals.record"]) },
      { branchId: "b1", permissions: new Set(["appointment.manage"]) },
    ]);
    expect(can(ctx, "clinical.vitals.record")).toBe(true);
    expect(can(ctx, "appointment.manage")).toBe(true);
    expect(can(ctx, "payroll.read")).toBe(false);
  });
});
