type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "outline";

export const DECISION_LABEL: Record<string, { label: string; tone: Tone }> = {
  CASH_PRICE: { label: "Cash price", tone: "neutral" },
  PAYER_TARIFF: { label: "Payer tariff", tone: "accent" },
  EXCLUDED_BY_PLAN: { label: "Not covered - patient pays", tone: "warning" },
  PAYER_NOT_ACTIVE: { label: "Payer not active - patient pays", tone: "warning" },
  COVERAGE_NOT_VALID: { label: "Cover not valid - patient pays", tone: "warning" },
  TARIFF_NOT_MAPPED: { label: "Tariff not mapped - needs HMO", tone: "danger" },
  NO_CASH_PRICE: { label: "No price - needs billing", tone: "danger" },
  RESOLVED_PATIENT_PAY: { label: "Patient pay (confirmed)", tone: "neutral" },
};

export const METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  POS: "POS / card",
  BANK_TRANSFER: "Bank transfer",
  ONLINE: "Online",
};

export const PAYER_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING_VERIFICATION: { label: "Pending verification", tone: "warning" },
  ACTIVE: { label: "Active contract", tone: "success" },
  SUSPENDED: { label: "Suspended", tone: "danger" },
  TERMINATED: { label: "Terminated", tone: "outline" },
};

export const ELIGIBILITY_LABEL: Record<string, { label: string; tone: Tone }> = {
  NOT_CHECKED: { label: "Not checked", tone: "outline" },
  VERIFIED_MANUAL: { label: "Verified (manual)", tone: "success" },
  VERIFIED_ONLINE: { label: "Verified (online)", tone: "success" },
  NOT_ELIGIBLE: { label: "Not eligible", tone: "danger" },
  CHECK_FAILED: { label: "Check failed - not verified", tone: "warning" },
};

export const PREAUTH_TONE: Record<string, Tone> = {
  DRAFT: "neutral",
  SUBMITTED: "accent",
  QUERIED: "warning",
  APPROVED: "success",
  PARTIALLY_APPROVED: "success",
  REJECTED: "danger",
  EXPIRED: "outline",
  CANCELLED: "outline",
};

export const CLAIM_TONE: Record<string, Tone> = {
  DRAFT: "neutral",
  VALIDATED: "accent",
  SUBMITTED: "accent",
  ACKNOWLEDGED: "accent",
  QUERIED: "warning",
  RESUBMITTED: "accent",
  APPROVED: "success",
  PARTLY_APPROVED: "warning",
  DENIED: "danger",
  PARTLY_PAID: "warning",
  PAID: "success",
  CLOSED: "outline",
};

export const statusText = (s: string) => s.toLowerCase().replace(/_/g, " ");

export const PAYER_CLASS_LABEL: Record<string, string> = {
  UNDETERMINED: "Not yet determined",
  CASH: "Self-pay",
  HMO: "HMO / insurance",
  CORPORATE: "Corporate",
  PART_INSURED: "Part insured",
};
