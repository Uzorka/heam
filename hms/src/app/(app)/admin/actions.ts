"use server";
import { z } from "zod";
import { defineAction } from "@/server/action";
import {
  decideSetupFact,
  saveBed,
  saveBranch,
  saveDepartment,
  saveVisitType,
  saveWard,
  updateOrganization,
  updateSystemSetting,
} from "@/server/domains/settings/service";
import {
  adminIssuePasswordReset,
  adminResetMfa,
  adminRevokeSessions,
  assignRole,
  createUser,
  revokeRole,
  setUserStatus,
} from "@/server/domains/staff/users";
import { cancelRoleChange, decideRoleChange, requestRoleChange } from "@/server/domains/staff/roles";
import { env } from "@/server/env";
import {
  bedSchema,
  branchSchema,
  departmentSchema,
  organizationSchema,
  setupFactDecisionSchema,
  settingUpdateSchema,
  visitTypeSchema,
  wardSchema,
} from "@/lib/schemas/settings";
import {
  assignRoleSchema,
  createUserSchema,
  revokeRoleSchema,
  roleChangeDecisionSchema,
  roleChangeRequestSchema,
  userStatusSchema,
} from "@/lib/schemas/staff";
import { requiredText, uuid } from "@/lib/schemas/common";

const link = (token: string) => `${env().APP_URL}/reset-password?t=${token}`;

export const updateOrganizationAction = defineAction("settings.organization", organizationSchema, updateOrganization);
export const saveBranchAction = defineAction("settings.branch", branchSchema, async (ctx, i) => (await saveBranch(ctx, i)).id);
export const saveDepartmentAction = defineAction("settings.department", departmentSchema, async (ctx, i) => (await saveDepartment(ctx, i)).id);
export const saveWardAction = defineAction("settings.ward", wardSchema, async (ctx, i) => (await saveWard(ctx, i)).id);
export const saveBedAction = defineAction("settings.bed", bedSchema, async (ctx, i) => (await saveBed(ctx, i)).id);
export const saveVisitTypeAction = defineAction("settings.visit_type", visitTypeSchema, async (ctx, i) => (await saveVisitType(ctx, i)).id);
export const decideSetupFactAction = defineAction("setup.fact", setupFactDecisionSchema, decideSetupFact);
export const updateSettingAction = defineAction("settings.system", settingUpdateSchema, async (ctx, i) => updateSystemSetting(ctx, i.key, i.value));

export const createUserAction = defineAction("users.create", createUserSchema, async (ctx, i) => {
  const r = await createUser(ctx, i);
  return { userId: r.userId, setupLink: link(r.setupToken), expiresAt: r.expiresAt.toISOString() };
});
export const assignRoleAction = defineAction("users.role.assign", assignRoleSchema, async (ctx, i) => (await assignRole(ctx, i)).id);
export const revokeRoleAction = defineAction("users.role.revoke", revokeRoleSchema, revokeRole);
export const setUserStatusAction = defineAction("users.status", userStatusSchema, setUserStatus);
export const issueResetAction = defineAction("users.reset", z.object({ userId: uuid }), async (ctx, i) => {
  const r = await adminIssuePasswordReset(ctx, i.userId);
  return { setupLink: link(r.token), expiresAt: r.expiresAt.toISOString() };
});
export const resetMfaAction = defineAction("users.mfa_reset", z.object({ userId: uuid, reason: requiredText("Reason", 300) }), async (ctx, i) =>
  adminResetMfa(ctx, i.userId, i.reason),
);
export const revokeSessionsAction = defineAction("users.sessions_revoke", z.object({ userId: uuid }), async (ctx, i) => adminRevokeSessions(ctx, i.userId));
export const requestRoleChangeAction = defineAction("roles.request", roleChangeRequestSchema, async (ctx, i) => (await requestRoleChange(ctx, i)).id);
export const decideRoleChangeAction = defineAction("roles.decide", roleChangeDecisionSchema, decideRoleChange);
export const cancelRoleChangeAction = defineAction("roles.cancel", z.object({ requestId: uuid }), async (ctx, i) => cancelRoleChange(ctx, i.requestId));
