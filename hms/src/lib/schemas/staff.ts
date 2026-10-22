import { z } from "zod";
import { localDate, optionalPhone, optionalText, requiredText, uuid } from "./common";

const roleGrant = z
  .object({
    roleId: uuid,
    branchId: uuid.optional().or(z.literal("").transform(() => undefined)),
    allBranches: z.boolean().default(false),
    departmentId: uuid.optional().or(z.literal("").transform(() => undefined)),
  })
  .refine((g) => g.allBranches || !!g.branchId, {
    message: "Choose a branch or all branches",
    path: ["branchId"],
  });

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  givenName: requiredText("First name", 80),
  familyName: requiredText("Surname", 80),
  displayName: optionalText(120),
  phone: optionalPhone,
  jobTitle: optionalText(120),
  staffNumber: optionalText(40),
  defaultBranchId: uuid,
  roles: z.array(roleGrant).min(1, "Assign at least one role"),
});

export const assignRoleSchema = z
  .object({
    userId: uuid,
    roleId: uuid,
    branchId: uuid.optional().or(z.literal("").transform(() => undefined)),
    allBranches: z.boolean().default(false),
    departmentId: uuid.optional().or(z.literal("").transform(() => undefined)),
    effectiveFrom: localDate.optional().or(z.literal("").transform(() => undefined)),
    effectiveTo: localDate.optional().or(z.literal("").transform(() => undefined)),
    reason: requiredText("Reason", 300),
    isDelegation: z.boolean().default(false),
    delegatedFromUserId: uuid.optional().or(z.literal("").transform(() => undefined)),
  })
  .refine((g) => g.allBranches || !!g.branchId, {
    message: "Choose a branch or all branches",
    path: ["branchId"],
  })
  .refine((g) => !g.isDelegation || (!!g.effectiveTo && !!g.delegatedFromUserId), {
    message: "Temporary cover needs an end date and the person being covered",
    path: ["effectiveTo"],
  });

export const revokeRoleSchema = z.object({ userRoleId: uuid, reason: requiredText("Reason", 300) });

export const userStatusSchema = z.object({
  userId: uuid,
  status: z.enum(["ACTIVE", "SUSPENDED", "INACTIVE"]),
  reason: requiredText("Reason", 300),
});

export const roleChangeRequestSchema = z.object({
  roleId: uuid,
  add: z.array(z.string()).default([]),
  remove: z.array(z.string()).default([]),
  reason: requiredText("Reason", 500),
});

export const roleChangeDecisionSchema = z.object({
  requestId: uuid,
  approve: z.boolean(),
  notes: optionalText(500),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(1, "Enter a new password"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const totpCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export const breakGlassSchema = z.object({
  patientId: uuid,
  reason: z.enum(["EMERGENCY_TREATMENT", "URGENT_CONSULT_COVER", "UNCONSCIOUS_PATIENT", "OTHER_URGENT"]),
  justification: requiredText("Justification", 1000).refine(
    (v) => v.length >= 20,
    "Explain the clinical need (20+ characters)",
  ),
});

export const breakGlassReviewSchema = z.object({
  grantId: uuid,
  status: z.enum(["APPROPRIATE", "CONCERN"]),
  notes: requiredText("Review notes", 1000),
});
