"use server";
import { defineAction } from "@/server/action";
import {
  addCredential,
  addShift,
  cancelShift,
  clock,
  decideLeave,
  requestLeave,
  saveEmployee,
  setEmployeeStatus,
  verifyCredential,
} from "@/server/domains/hr/service";
import {
  addPayItem,
  approvePayroll,
  decidePayComponent,
  preparePayroll,
  proposePayComponent,
} from "@/server/domains/hr/payroll";
import {
  approvePayrollSchema,
  cancelShiftSchema,
  clockSchema,
  credentialSchema,
  decisionSchema,
  employeeSchema,
  employeeStatusSchema,
  leaveSchema,
  payComponentSchema,
  payItemSchema,
  payrollRunSchema,
  shiftSchema,
  verifyCredentialSchema,
} from "@/lib/schemas/hr";

export const saveEmployeeAction = defineAction(
  "hr.employee.save",
  employeeSchema,
  async (ctx, i) => (await saveEmployee(ctx, i)).id,
);
export const employeeStatusAction = defineAction(
  "hr.employee.status",
  employeeStatusSchema,
  setEmployeeStatus,
);
export const addCredentialAction = defineAction(
  "hr.credential.add",
  credentialSchema,
  async (ctx, i) => (await addCredential(ctx, i)).id,
);
export const verifyCredentialAction = defineAction(
  "hr.credential.verify",
  verifyCredentialSchema,
  async (ctx, i) => {
    await verifyCredential(ctx, i);
  },
);
export const addShiftAction = defineAction(
  "hr.shift.add",
  shiftSchema,
  async (ctx, i) => (await addShift(ctx, i)).id,
);
export const cancelShiftAction = defineAction("hr.shift.cancel", cancelShiftSchema, async (ctx, i) => {
  await cancelShift(ctx, i);
});
export const clockAction = defineAction("hr.clock", clockSchema, async (ctx, i) => {
  await clock(ctx, i);
});
export const requestLeaveAction = defineAction(
  "hr.leave.request",
  leaveSchema,
  async (ctx, i) => (await requestLeave(ctx, i)).id,
);
export const decideLeaveAction = defineAction("hr.leave.decide", decisionSchema, async (ctx, i) => {
  await decideLeave(ctx, i);
});

export const proposePayComponentAction = defineAction(
  "payroll.component.propose",
  payComponentSchema,
  async (ctx, i) => (await proposePayComponent(ctx, i)).id,
);
export const decidePayComponentAction = defineAction(
  "payroll.component.decide",
  decisionSchema,
  async (ctx, i) => {
    await decidePayComponent(ctx, i);
  },
);
export const addPayItemAction = defineAction("payroll.item.add", payItemSchema, async (ctx, i) => {
  await addPayItem(ctx, i);
});
export const preparePayrollAction = defineAction(
  "payroll.run.prepare",
  payrollRunSchema,
  async (ctx, i) => (await preparePayroll(ctx, i)).id,
);
export const approvePayrollAction = defineAction(
  "payroll.run.approve",
  approvePayrollSchema,
  async (ctx, i) => {
    await approvePayroll(ctx, i);
  },
);
