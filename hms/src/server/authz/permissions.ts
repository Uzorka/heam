/**
 * Permission catalogue. Codes are "<resource>.<action>". Sensitivity classifies what a permission
 * exposes so reviewers can spot, for example, a non-clinical role being given CLINICAL access.
 *
 * This file is imported by the seed script and by tests, so it must stay free of server-only imports.
 */
export type Sensitivity = "LOW" | "ADMIN" | "PHI" | "CLINICAL" | "FINANCIAL" | "HR";

export interface PermissionDef {
  code: string;
  description: string;
  sensitivity: Sensitivity;
}

const p = (code: string, sensitivity: Sensitivity, description: string): PermissionDef => ({
  code,
  sensitivity,
  description,
});

export const PERMISSIONS = [
  // Administration & configuration
  p("settings.read", "ADMIN", "View hospital configuration"),
  p("settings.manage", "ADMIN", "Change hospital, branch, department, ward, bed and visit-type configuration"),
  p("setup.verify", "ADMIN", "Verify or reject imported public facts in the setup checklist"),
  p("users.read", "ADMIN", "View staff accounts and their role assignments"),
  p("users.manage", "ADMIN", "Create staff accounts, assign/revoke roles, suspend accounts"),
  p("users.credentials.reset", "ADMIN", "Issue password resets and clear MFA for staff accounts"),
  p("roles.read", "ADMIN", "View role definitions"),
  p("roles.request_change", "ADMIN", "Propose changes to role permissions"),
  p("roles.approve_change", "ADMIN", "Approve or reject proposed role permission changes"),
  p("sessions.manage", "ADMIN", "View and revoke other users' sessions"),
  p("audit.read", "ADMIN", "View the audit trail (identifiers only, no clinical content)"),
  p("audit.breakglass.review", "ADMIN", "Review emergency (break-glass) access events"),

  // Patient registry
  p("patient.search", "PHI", "Search the patient registry (masked summaries)"),
  p("patient.read", "PHI", "View patient demographics and contact details"),
  p("patient.create", "PHI", "Register new patients"),
  p("patient.update", "PHI", "Edit patient demographics and contacts"),
  p("patient.identifiers.read", "PHI", "View unmasked identity document numbers"),
  p("patient.status.manage", "PHI", "Mark patients inactive or deceased"),
  p("patient.merge.request", "PHI", "Raise or request merge of suspected duplicate records"),
  p("patient.merge.approve", "PHI", "Approve a requested merge (must differ from requester)"),
  p("patient.allergy.record", "CLINICAL", "Record patient-reported allergies"),
  p("patient.allergy.verify", "CLINICAL", "Verify or mark allergy entries as entered-in-error"),
  p("patient.consent.manage", "PHI", "Record and withdraw patient consents"),
  p("patient.guardian.manage", "PHI", "Record guardian/dependent relationships"),
  p("patient.guardian.verify", "PHI", "Verify guardian relationships for portal access"),

  // Scheduling & front desk
  p("appointment.read", "PHI", "View appointments"),
  p("appointment.manage", "PHI", "Book, reschedule, cancel and mark no-show"),
  p("appointment.override", "PHI", "Book an overlapping slot with a recorded reason"),
  p("queue.read", "PHI", "View visit queues"),
  p("queue.manage", "PHI", "Check patients in and move them between queue stages"),

  // Clinical (Phase 2+)
  p("encounter.read", "CLINICAL", "View encounter workflow details"),
  p("clinical.read", "CLINICAL", "Read clinical records for patients under your care"),
  p("clinical.read.branch_wide", "CLINICAL", "Read clinical records for any patient in your branch"),
  p("clinical.note.write", "CLINICAL", "Draft clinical notes"),
  p("clinical.note.sign", "CLINICAL", "Sign clinical notes and addenda"),
  p("clinical.vitals.record", "CLINICAL", "Record vital signs"),
  p("clinical.triage.record", "CLINICAL", "Record triage assessments"),
  p("clinical.diagnosis.write", "CLINICAL", "Record diagnoses"),
  p("clinical.order.create", "CLINICAL", "Place lab, imaging and procedure orders"),
  p("clinical.order.cancel", "CLINICAL", "Cancel clinical orders"),
  p("clinical.prescribe", "CLINICAL", "Sign prescriptions"),
  p("clinical.care_team.manage", "CLINICAL", "Assign clinicians and nurses to a patient's care team"),
  p("clinical.breakglass", "CLINICAL", "Invoke logged emergency access to a patient record"),
  p("nursing.mar.record", "CLINICAL", "Record medication administration"),
  p("nursing.notes.write", "CLINICAL", "Write nursing notes and handovers"),
  p("maternity.read", "CLINICAL", "View maternity episodes"),
  p("maternity.write", "CLINICAL", "Record antenatal, labour and postnatal data"),
  p("maternity.delivery.sign", "CLINICAL", "Sign delivery and birth records"),

  // Diagnostics
  p("lab.worklist", "CLINICAL", "View laboratory worklists"),
  p("lab.specimen.collect", "CLINICAL", "Collect, receive and reject specimens"),
  p("lab.result.enter", "CLINICAL", "Enter laboratory results"),
  p("lab.result.verify", "CLINICAL", "Verify and release laboratory results"),
  p("lab.catalogue.manage", "ADMIN", "Manage lab tests and reference ranges"),
  p("lab.critical.acknowledge", "CLINICAL", "Acknowledge critical laboratory results"),
  p("imaging.worklist", "CLINICAL", "View imaging worklists"),
  p("imaging.report.write", "CLINICAL", "Write imaging reports"),
  p("imaging.report.sign", "CLINICAL", "Sign imaging reports"),

  // Pharmacy & inventory
  p("pharmacy.queue", "CLINICAL", "View prescriptions awaiting pharmacy"),
  p("pharmacy.verify", "CLINICAL", "Pharmacist verification of prescriptions"),
  p("pharmacy.dispense", "CLINICAL", "Dispense medication"),
  p("pharmacy.controlled.dispense", "CLINICAL", "Dispense controlled drugs"),
  p("pharmacy.catalogue.manage", "ADMIN", "Manage the medication catalogue"),
  p("inventory.read", "LOW", "View stock levels"),
  p("inventory.requisition.create", "LOW", "Raise purchase requisitions"),
  p("inventory.requisition.approve", "FINANCIAL", "Approve requisitions"),
  p("inventory.po.manage", "FINANCIAL", "Create purchase orders"),
  p("inventory.receive", "LOW", "Receive goods"),
  p("inventory.adjust", "LOW", "Propose stock adjustments"),
  p("inventory.adjust.approve", "FINANCIAL", "Approve stock adjustments"),
  p("inventory.count", "LOW", "Perform stock counts"),

  // HMO & insurance
  p("hmo.read", "FINANCIAL", "View HMO partners, plans and coverage"),
  p("hmo.partner.manage", "FINANCIAL", "Configure HMO partners, plans and tariffs"),
  p("hmo.partner.activate", "FINANCIAL", "Activate a verified HMO contract"),
  p("hmo.coverage.manage", "PHI", "Record patient HMO enrolment"),
  p("hmo.eligibility.record", "PHI", "Record eligibility verification"),
  p("hmo.preauth.manage", "CLINICAL", "Manage pre-authorisation requests"),
  p("hmo.claim.manage", "FINANCIAL", "Prepare and edit claims"),
  p("hmo.claim.submit", "FINANCIAL", "Submit claims and record payer decisions"),
  p("hmo.remittance.reconcile", "FINANCIAL", "Import and reconcile remittances"),

  // Billing & finance
  p("billing.read", "FINANCIAL", "View patient accounts and invoices"),
  p("billing.catalogue.manage", "FINANCIAL", "Edit the service catalogue and prices"),
  p("billing.tariff.approve", "FINANCIAL", "Approve price/tariff changes"),
  p("billing.invoice.manage", "FINANCIAL", "Create and adjust invoices"),
  p("billing.discount.approve", "FINANCIAL", "Approve discounts"),
  p("billing.payment.collect", "FINANCIAL", "Collect payments and issue receipts"),
  p("billing.refund.request", "FINANCIAL", "Request refunds"),
  p("billing.refund.approve", "FINANCIAL", "Approve refunds and voids"),
  p("cashier.shift.manage", "FINANCIAL", "Open and close cashier shifts"),
  p("finance.read", "FINANCIAL", "View finance reports and ledgers"),
  p("finance.expense.manage", "FINANCIAL", "Record expenses"),
  p("finance.close.approve", "FINANCIAL", "Approve daily close and shift reconciliation"),

  // Admissions
  p("admission.read", "CLINICAL", "View admissions and ward lists"),
  p("admission.manage", "CLINICAL", "Admit, transfer and assign beds"),
  p("discharge.authorize", "CLINICAL", "Authorise clinical discharge"),
  p("discharge.clear_finance", "FINANCIAL", "Give financial clearance for discharge"),

  // HR & payroll
  p("hr.read", "HR", "View employee records"),
  p("hr.manage", "HR", "Manage employee records"),
  p("hr.roster.manage", "HR", "Manage shifts and rosters"),
  p("hr.leave.approve", "HR", "Approve leave"),
  p("payroll.read", "HR", "View payroll"),
  p("payroll.run", "HR", "Prepare payroll runs"),
  p("payroll.approve", "HR", "Approve and lock payroll runs"),

  // Reporting
  p("report.operational", "LOW", "Operational (non-PHI, aggregated) reports"),
  p("report.clinical", "CLINICAL", "Clinical activity reports"),
  p("report.financial", "FINANCIAL", "Financial reports"),
  p("report.hmo", "FINANCIAL", "HMO and claims reports"),
  p("report.executive", "LOW", "Executive aggregated dashboard"),
  p("export.data", "PHI", "Export report data (audited, watermarked)"),

  // Portal
  p("portal.self.read", "PHI", "Patient portal: own released records"),
  p("portal.dependent.read", "PHI", "Patient portal: verified dependants' released records"),
] as const satisfies readonly PermissionDef[];

export type PermissionCode = (typeof PERMISSIONS)[number]["code"];

export const PERMISSION_CODES = new Set<string>(PERMISSIONS.map((x) => x.code));

export function isPermissionCode(code: string): code is PermissionCode {
  return PERMISSION_CODES.has(code);
}

export function permissionResource(code: string): string {
  return code.split(".")[0]!;
}

export function permissionAction(code: string): string {
  return code.split(".").slice(1).join(".");
}
