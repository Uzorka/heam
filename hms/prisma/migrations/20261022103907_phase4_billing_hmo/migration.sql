-- CreateEnum
CREATE TYPE "ServiceCategory" AS ENUM ('CONSULTATION', 'ADMISSION', 'LABORATORY', 'IMAGING', 'PROCEDURE', 'MATERNITY', 'CONSUMABLE', 'PHARMACY', 'MISCELLANEOUS');

-- CreateEnum
CREATE TYPE "TariffStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED', 'RETIRED');

-- CreateEnum
CREATE TYPE "PayerScheme" AS ENUM ('PRIVATE_HMO', 'NHIA', 'STATE_SCHEME', 'CORPORATE');

-- CreateEnum
CREATE TYPE "PayerStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "BillingModel" AS ENUM ('FEE_FOR_SERVICE', 'CAPITATION');

-- CreateEnum
CREATE TYPE "TariffCoverage" AS ENUM ('COVERED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "CoverageStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "EligibilityStatus" AS ENUM ('NOT_CHECKED', 'VERIFIED_MANUAL', 'VERIFIED_ONLINE', 'NOT_ELIGIBLE', 'CHECK_FAILED');

-- CreateEnum
CREATE TYPE "MemberRelationship" AS ENUM ('PRINCIPAL', 'SPOUSE', 'CHILD', 'OTHER_DEPENDANT');

-- CreateEnum
CREATE TYPE "EligibilityMethod" AS ENUM ('MANUAL_PHONE', 'MANUAL_PORTAL', 'MANUAL_EMAIL', 'CONNECTOR');

-- CreateEnum
CREATE TYPE "EligibilityOutcome" AS ENUM ('ELIGIBLE', 'NOT_ELIGIBLE', 'UNREACHABLE', 'ERROR');

-- CreateEnum
CREATE TYPE "PreauthStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'QUERIED', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChargeSource" AS ENUM ('VISIT', 'ORDER', 'DISPENSE', 'MANUAL');

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('ACTIVE', 'VOID');

-- CreateEnum
CREATE TYPE "CoverageDecision" AS ENUM ('CASH_PRICE', 'PAYER_TARIFF', 'EXCLUDED_BY_PLAN', 'PAYER_NOT_ACTIVE', 'COVERAGE_NOT_VALID', 'TARIFF_NOT_MAPPED', 'NO_CASH_PRICE', 'RESOLVED_PATIENT_PAY');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'FINALISED', 'VOID');

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('DISCOUNT', 'CREDIT_NOTE', 'WRITE_OFF');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'POS', 'BANK_TRANSFER', 'ONLINE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'PAID');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED', 'APPROVED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('DRAFT', 'VALIDATED', 'SUBMITTED', 'ACKNOWLEDGED', 'QUERIED', 'RESUBMITTED', 'APPROVED', 'PARTLY_APPROVED', 'DENIED', 'PARTLY_PAID', 'PAID', 'CLOSED');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'INCOME', 'EXPENSE', 'EQUITY');

-- AlterTable
ALTER TABLE "Encounter" ADD COLUMN     "coverageId" UUID;

-- CreateTable
CREATE TABLE "ServiceItem" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ServiceCategory" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "labTestId" UUID,
    "imagingStudyId" UUID,
    "visitTypeId" UUID,
    "inventoryProductId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ServiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicePrice" (
    "id" UUID NOT NULL,
    "serviceItemId" UUID NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "status" "TariffStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNote" TEXT,

    CONSTRAINT "ServicePrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payer" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scheme" "PayerScheme" NOT NULL,
    "status" "PayerStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "providerCode" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "claimsEmail" TEXT,
    "contractStart" DATE,
    "contractEnd" DATE,
    "contractEvidence" TEXT,
    "sourceNote" TEXT,
    "activatedById" UUID,
    "activatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Payer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayerPlan" (
    "id" UUID NOT NULL,
    "payerId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "billingModel" "BillingModel" NOT NULL DEFAULT 'FEE_FOR_SERVICE',
    "copayBasisPoints" INTEGER NOT NULL DEFAULT 0,
    "encounterLimitKobo" BIGINT,
    "annualLimitKobo" BIGINT,
    "status" "PayerStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "notes" TEXT,
    "activatedById" UUID,
    "activatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayerPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayerTariff" (
    "id" UUID NOT NULL,
    "payerId" UUID NOT NULL,
    "planId" UUID,
    "serviceItemId" UUID NOT NULL,
    "coverage" "TariffCoverage" NOT NULL,
    "amountKobo" BIGINT,
    "copayBasisPoints" INTEGER,
    "requiresPreauth" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "status" "TariffStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PayerTariff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientCoverage" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "payerId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "memberNumber" TEXT NOT NULL,
    "relationship" "MemberRelationship" NOT NULL DEFAULT 'PRINCIPAL',
    "principalName" TEXT,
    "sponsor" TEXT,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "status" "CoverageStatus" NOT NULL DEFAULT 'ACTIVE',
    "eligibilityStatus" "EligibilityStatus" NOT NULL DEFAULT 'NOT_CHECKED',
    "lastCheckedAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),
    "endReason" TEXT,

    CONSTRAINT "PatientCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibilityCheck" (
    "id" UUID NOT NULL,
    "coverageId" UUID NOT NULL,
    "method" "EligibilityMethod" NOT NULL,
    "outcome" "EligibilityOutcome" NOT NULL,
    "reference" TEXT,
    "evidence" TEXT,
    "errorCode" TEXT,
    "checkedById" UUID NOT NULL,
    "checkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EligibilityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Preauthorization" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "encounterId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "coverageId" UUID NOT NULL,
    "payerId" UUID NOT NULL,
    "status" "PreauthStatus" NOT NULL DEFAULT 'DRAFT',
    "medicalNecessity" TEXT NOT NULL,
    "requestedKobo" BIGINT NOT NULL,
    "approvedKobo" BIGINT,
    "authCode" TEXT,
    "validUntil" DATE,
    "decisionNote" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMPTZ(3),
    "decidedAt" TIMESTAMPTZ(3),
    "decisionRecordedById" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Preauthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreauthItem" (
    "id" UUID NOT NULL,
    "preauthId" UUID NOT NULL,
    "serviceItemId" UUID NOT NULL,
    "orderId" UUID,
    "quantity" INTEGER NOT NULL,
    "requestedKobo" BIGINT NOT NULL,
    "approvedQty" INTEGER,

    CONSTRAINT "PreauthItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreauthEvent" (
    "id" UUID NOT NULL,
    "preauthId" UUID NOT NULL,
    "fromStatus" "PreauthStatus",
    "toStatus" "PreauthStatus" NOT NULL,
    "note" TEXT,
    "byId" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreauthEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Charge" (
    "id" UUID NOT NULL,
    "encounterId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "invoiceId" UUID,
    "serviceItemId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "serviceDate" DATE NOT NULL,
    "sourceType" "ChargeSource" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "unitPriceKobo" BIGINT,
    "totalKobo" BIGINT,
    "payerPortionKobo" BIGINT NOT NULL DEFAULT 0,
    "patientPortionKobo" BIGINT,
    "decision" "CoverageDecision" NOT NULL,
    "decisionNote" TEXT,
    "needsResolution" BOOLEAN NOT NULL DEFAULT false,
    "coverageId" UUID,
    "payerId" UUID,
    "preauthRequired" BOOLEAN NOT NULL DEFAULT false,
    "preauthId" UUID,
    "status" "ChargeStatus" NOT NULL DEFAULT 'ACTIVE',
    "voidReason" TEXT,
    "voidedAt" TIMESTAMPTZ(3),
    "voidedById" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "encounterId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "finalisedAt" TIMESTAMPTZ(3),
    "finalisedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceAdjustment" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "type" "AdjustmentType" NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" UUID NOT NULL,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNote" TEXT,

    CONSTRAINT "InvoiceAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "receiptNo" TEXT,
    "patientId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT,
    "provider" TEXT,
    "providerRef" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "cashierShiftId" UUID,
    "receivedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMPTZ(3),
    "reversedAt" TIMESTAMPTZ(3),
    "reversedById" UUID,
    "reversalReason" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentProviderEvent" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "paymentId" UUID,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" UUID NOT NULL,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNote" TEXT,
    "paidById" UUID,
    "paidAt" TIMESTAMPTZ(3),
    "reference" TEXT,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashierShift" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "cashierId" UUID NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingFloatKobo" BIGINT NOT NULL,
    "closedAt" TIMESTAMPTZ(3),
    "expectedCashKobo" BIGINT,
    "countedCashKobo" BIGINT,
    "varianceKobo" BIGINT,
    "closeNote" TEXT,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "approvalNote" TEXT,

    CONSTRAINT "CashierShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "payerId" UUID NOT NULL,
    "coverageId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "encounterId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "batchId" UUID,
    "status" "ClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "claimedKobo" BIGINT NOT NULL DEFAULT 0,
    "approvedKobo" BIGINT,
    "paidKobo" BIGINT NOT NULL DEFAULT 0,
    "writtenOffKobo" BIGINT NOT NULL DEFAULT 0,
    "denialReason" TEXT,
    "submittedAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimLine" (
    "id" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "chargeId" UUID NOT NULL,
    "serviceItemId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "serviceDate" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,
    "claimedKobo" BIGINT NOT NULL,
    "approvedKobo" BIGINT,
    "paidKobo" BIGINT NOT NULL DEFAULT 0,
    "authCode" TEXT,
    "removedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ClaimLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimEvent" (
    "id" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "fromStatus" "ClaimStatus",
    "toStatus" "ClaimStatus" NOT NULL,
    "note" TEXT,
    "byId" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimBatch" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "payerId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ClaimBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Remittance" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "payerId" UUID NOT NULL,
    "payerReference" TEXT NOT NULL,
    "receivedDate" DATE NOT NULL,
    "totalKobo" BIGINT NOT NULL,
    "note" TEXT,
    "importedById" UUID NOT NULL,
    "importedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Remittance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemittanceLine" (
    "id" UUID NOT NULL,
    "remittanceId" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "claimLineId" UUID,
    "paidKobo" BIGINT NOT NULL,
    "deniedKobo" BIGINT NOT NULL DEFAULT 0,
    "reason" TEXT,

    CONSTRAINT "RemittanceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "accountCode" TEXT NOT NULL,
    "debitKobo" BIGINT NOT NULL DEFAULT 0,
    "creditKobo" BIGINT NOT NULL DEFAULT 0,
    "payerId" UUID,
    "patientId" UUID,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceItem_code_key" ON "ServiceItem"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceItem_labTestId_key" ON "ServiceItem"("labTestId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceItem_imagingStudyId_key" ON "ServiceItem"("imagingStudyId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceItem_visitTypeId_key" ON "ServiceItem"("visitTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceItem_inventoryProductId_key" ON "ServiceItem"("inventoryProductId");

-- CreateIndex
CREATE INDEX "ServicePrice_serviceItemId_status_idx" ON "ServicePrice"("serviceItemId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Payer_code_key" ON "Payer"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PayerPlan_payerId_code_key" ON "PayerPlan"("payerId", "code");

-- CreateIndex
CREATE INDEX "PayerTariff_payerId_serviceItemId_status_idx" ON "PayerTariff"("payerId", "serviceItemId", "status");

-- CreateIndex
CREATE INDEX "PatientCoverage_patientId_status_idx" ON "PatientCoverage"("patientId", "status");

-- CreateIndex
CREATE INDEX "EligibilityCheck_coverageId_checkedAt_idx" ON "EligibilityCheck"("coverageId", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Preauthorization_ref_key" ON "Preauthorization"("ref");

-- CreateIndex
CREATE INDEX "Preauthorization_payerId_status_idx" ON "Preauthorization"("payerId", "status");

-- CreateIndex
CREATE INDEX "Charge_invoiceId_idx" ON "Charge"("invoiceId");

-- CreateIndex
CREATE INDEX "Charge_encounterId_idx" ON "Charge"("encounterId");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_sourceType_sourceId_key" ON "Charge"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_ref_key" ON "Invoice"("ref");

-- CreateIndex
CREATE INDEX "Invoice_patientId_status_idx" ON "Invoice"("patientId", "status");

-- CreateIndex
CREATE INDEX "InvoiceAdjustment_status_idx" ON "InvoiceAdjustment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_receiptNo_key" ON "Payment"("receiptNo");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_patientId_status_idx" ON "Payment"("patientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_provider_providerRef_key" ON "Payment"("provider", "providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProviderEvent_provider_eventId_key" ON "PaymentProviderEvent"("provider", "eventId");

-- CreateIndex
CREATE INDEX "Refund_status_idx" ON "Refund"("status");

-- CreateIndex
CREATE INDEX "CashierShift_branchId_status_idx" ON "CashierShift"("branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_ref_key" ON "Claim"("ref");

-- CreateIndex
CREATE INDEX "Claim_payerId_status_idx" ON "Claim"("payerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimBatch_ref_key" ON "ClaimBatch"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "Remittance_ref_key" ON "Remittance"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "Remittance_payerId_payerReference_key" ON "Remittance"("payerId", "payerReference");

-- CreateIndex
CREATE INDEX "JournalEntry_occurredAt_idx" ON "JournalEntry"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_sourceType_sourceId_kind_key" ON "JournalEntry"("sourceType", "sourceId", "kind");

-- CreateIndex
CREATE INDEX "JournalLine_accountCode_idx" ON "JournalLine"("accountCode");

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_coverageId_fkey" FOREIGN KEY ("coverageId") REFERENCES "PatientCoverage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePrice" ADD CONSTRAINT "ServicePrice_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "ServiceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayerPlan" ADD CONSTRAINT "PayerPlan_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayerTariff" ADD CONSTRAINT "PayerTariff_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayerTariff" ADD CONSTRAINT "PayerTariff_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PayerPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayerTariff" ADD CONSTRAINT "PayerTariff_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "ServiceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientCoverage" ADD CONSTRAINT "PatientCoverage_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientCoverage" ADD CONSTRAINT "PatientCoverage_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientCoverage" ADD CONSTRAINT "PatientCoverage_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PayerPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityCheck" ADD CONSTRAINT "EligibilityCheck_coverageId_fkey" FOREIGN KEY ("coverageId") REFERENCES "PatientCoverage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preauthorization" ADD CONSTRAINT "Preauthorization_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preauthorization" ADD CONSTRAINT "Preauthorization_coverageId_fkey" FOREIGN KEY ("coverageId") REFERENCES "PatientCoverage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preauthorization" ADD CONSTRAINT "Preauthorization_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreauthItem" ADD CONSTRAINT "PreauthItem_preauthId_fkey" FOREIGN KEY ("preauthId") REFERENCES "Preauthorization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreauthEvent" ADD CONSTRAINT "PreauthEvent_preauthId_fkey" FOREIGN KEY ("preauthId") REFERENCES "Preauthorization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "ServiceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_preauthId_fkey" FOREIGN KEY ("preauthId") REFERENCES "Preauthorization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceAdjustment" ADD CONSTRAINT "InvoiceAdjustment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cashierShiftId_fkey" FOREIGN KEY ("cashierShiftId") REFERENCES "CashierShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_coverageId_fkey" FOREIGN KEY ("coverageId") REFERENCES "PatientCoverage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ClaimBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimLine" ADD CONSTRAINT "ClaimLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimLine" ADD CONSTRAINT "ClaimLine_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvent" ADD CONSTRAINT "ClaimEvent_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Remittance" ADD CONSTRAINT "Remittance_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemittanceLine" ADD CONSTRAINT "RemittanceLine_remittanceId_fkey" FOREIGN KEY ("remittanceId") REFERENCES "Remittance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemittanceLine" ADD CONSTRAINT "RemittanceLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemittanceLine" ADD CONSTRAINT "RemittanceLine_claimLineId_fkey" FOREIGN KEY ("claimLineId") REFERENCES "ClaimLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountCode_fkey" FOREIGN KEY ("accountCode") REFERENCES "LedgerAccount"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── Hand-written integrity rules (Phase 4) ─────────────

-- Prices: non-negative, valid date ranges, approved prices never overlap, approved rows only close or retire.
ALTER TABLE "ServicePrice" ADD CONSTRAINT "ServicePrice_amount_chk"
  CHECK ("amountKobo" >= 0 AND ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"));
ALTER TABLE "ServicePrice" ADD CONSTRAINT "ServicePrice_no_overlap" EXCLUDE USING gist (
  "serviceItemId" WITH =, daterange("effectiveFrom", "effectiveTo", '[)') WITH &&
) WHERE ("status" = 'APPROVED');

ALTER TABLE "PayerPlan" ADD CONSTRAINT "PayerPlan_copay_chk"
  CHECK ("copayBasisPoints" BETWEEN 0 AND 10000 AND ("encounterLimitKobo" IS NULL OR "encounterLimitKobo" >= 0) AND ("annualLimitKobo" IS NULL OR "annualLimitKobo" >= 0));
ALTER TABLE "PayerTariff" ADD CONSTRAINT "PayerTariff_amount_chk" CHECK (
  (("coverage" = 'EXCLUDED' AND "amountKobo" IS NULL) OR ("coverage" = 'COVERED' AND "amountKobo" >= 0))
  AND ("copayBasisPoints" IS NULL OR "copayBasisPoints" BETWEEN 0 AND 10000)
  AND ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"));
ALTER TABLE "PayerTariff" ADD CONSTRAINT "PayerTariff_no_overlap" EXCLUDE USING gist (
  "payerId" WITH =,
  (COALESCE("planId", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
  "serviceItemId" WITH =,
  daterange("effectiveFrom", "effectiveTo", '[)') WITH &&
) WHERE ("status" = 'APPROVED');

CREATE OR REPLACE FUNCTION hms_tariff_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME; END IF;
  IF OLD."status" IN ('APPROVED', 'RETIRED', 'REJECTED')
     AND NOT hms_only_columns_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY['effectiveTo', 'status']) THEN
    RAISE EXCEPTION 'Approved prices are immutable; propose a new effective-dated price';
  END IF;
  IF OLD."status" IN ('RETIRED', 'REJECTED') AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'Retired or rejected prices cannot be reinstated';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ServicePrice_guard" BEFORE UPDATE OR DELETE ON "ServicePrice" FOR EACH ROW EXECUTE FUNCTION hms_tariff_guard();
CREATE TRIGGER "PayerTariff_guard" BEFORE UPDATE OR DELETE ON "PayerTariff" FOR EACH ROW EXECUTE FUNCTION hms_tariff_guard();

-- Eligibility evidence and workflow histories are append-only.
CREATE TRIGGER "EligibilityCheck_append_only" BEFORE UPDATE OR DELETE ON "EligibilityCheck" FOR EACH ROW EXECUTE FUNCTION hms_append_only();
CREATE TRIGGER "PreauthEvent_append_only" BEFORE UPDATE OR DELETE ON "PreauthEvent" FOR EACH ROW EXECUTE FUNCTION hms_append_only();
CREATE TRIGGER "ClaimEvent_append_only" BEFORE UPDATE OR DELETE ON "ClaimEvent" FOR EACH ROW EXECUTE FUNCTION hms_append_only();

ALTER TABLE "Preauthorization" ADD CONSTRAINT "Preauth_amount_chk"
  CHECK ("requestedKobo" >= 0 AND ("approvedKobo" IS NULL OR "approvedKobo" >= 0));
ALTER TABLE "PreauthItem" ADD CONSTRAINT "PreauthItem_qty_chk"
  CHECK ("quantity" > 0 AND "requestedKobo" >= 0 AND ("approvedQty" IS NULL OR "approvedQty" BETWEEN 0 AND "quantity"));

-- Charges: consistent payer split; unpriced charges carry no amounts; never deleted.
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_amounts_chk" CHECK (
  "quantity" > 0 AND "payerPortionKobo" >= 0 AND (
    ("unitPriceKobo" IS NULL AND "totalKobo" IS NULL AND "patientPortionKobo" IS NULL AND "payerPortionKobo" = 0)
    OR ("unitPriceKobo" >= 0 AND "totalKobo" = "unitPriceKobo" * "quantity"
        AND "patientPortionKobo" >= 0 AND "payerPortionKobo" + "patientPortionKobo" = "totalKobo")));
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_void_chk"
  CHECK (("status" = 'VOID') = ("voidedAt" IS NOT NULL));
CREATE TRIGGER "Charge_no_delete" BEFORE DELETE ON "Charge" FOR EACH ROW EXECUTE FUNCTION hms_append_only();
CREATE TRIGGER "Invoice_no_delete" BEFORE DELETE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION hms_append_only();
-- A finalised invoice's charges cannot change (corrections are approved adjustments).
CREATE OR REPLACE FUNCTION hms_charge_guard() RETURNS trigger AS $$
DECLARE inv_status text;
BEGIN
  IF OLD."invoiceId" IS NOT NULL THEN
    SELECT "status" INTO inv_status FROM "Invoice" WHERE "id" = OLD."invoiceId";
    IF inv_status = 'FINALISED' THEN
      RAISE EXCEPTION 'Charges on a finalised invoice cannot change; record an approved adjustment';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Charge_guard" BEFORE UPDATE ON "Charge" FOR EACH ROW EXECUTE FUNCTION hms_charge_guard();

ALTER TABLE "InvoiceAdjustment" ADD CONSTRAINT "InvoiceAdjustment_amount_chk" CHECK ("amountKobo" > 0);

-- Payments: positive, never deleted; the money facts are fixed once recorded.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_chk" CHECK ("amountKobo" > 0);
CREATE OR REPLACE FUNCTION hms_payment_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Payments cannot be deleted'; END IF;
  IF NOT hms_only_columns_changed(to_jsonb(OLD), to_jsonb(NEW),
       ARRAY['status', 'receiptNo', 'confirmedAt', 'reversedAt', 'reversedById', 'reversalReason']) THEN
    RAISE EXCEPTION 'Payment amounts, methods and references cannot be edited; reverse and re-record';
  END IF;
  IF OLD."status" IN ('REVERSED', 'FAILED') AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'Reversed or failed payments are final';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Payment_guard" BEFORE UPDATE OR DELETE ON "Payment" FOR EACH ROW EXECUTE FUNCTION hms_payment_guard();
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_amount_chk" CHECK ("amountKobo" > 0);
CREATE TRIGGER "PaymentAllocation_append_only" BEFORE UPDATE OR DELETE ON "PaymentAllocation" FOR EACH ROW EXECUTE FUNCTION hms_append_only();
CREATE TRIGGER "PaymentProviderEvent_append_only" BEFORE UPDATE OR DELETE ON "PaymentProviderEvent" FOR EACH ROW EXECUTE FUNCTION hms_append_only();
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_amount_chk" CHECK ("amountKobo" > 0);

-- One open shift per cashier.
CREATE UNIQUE INDEX "CashierShift_one_open" ON "CashierShift" ("cashierId") WHERE "status" = 'OPEN';
ALTER TABLE "CashierShift" ADD CONSTRAINT "CashierShift_amounts_chk"
  CHECK ("openingFloatKobo" >= 0 AND ("countedCashKobo" IS NULL OR "countedCashKobo" >= 0));

-- Claims: a charge appears on at most one live claim line; paid never exceeds claimed.
CREATE UNIQUE INDEX "ClaimLine_charge_once" ON "ClaimLine" ("chargeId") WHERE "removedAt" IS NULL;
ALTER TABLE "ClaimLine" ADD CONSTRAINT "ClaimLine_amount_chk" CHECK (
  "quantity" > 0 AND "claimedKobo" >= 0 AND "paidKobo" >= 0 AND "paidKobo" <= "claimedKobo"
  AND ("approvedKobo" IS NULL OR "approvedKobo" BETWEEN 0 AND "claimedKobo"));
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_amount_chk" CHECK (
  "claimedKobo" >= 0 AND "paidKobo" >= 0 AND "writtenOffKobo" >= 0 AND "paidKobo" + "writtenOffKobo" <= "claimedKobo"
  AND ("approvedKobo" IS NULL OR "approvedKobo" BETWEEN 0 AND "claimedKobo"));
ALTER TABLE "Remittance" ADD CONSTRAINT "Remittance_amount_chk" CHECK ("totalKobo" >= 0);
ALTER TABLE "RemittanceLine" ADD CONSTRAINT "RemittanceLine_amount_chk" CHECK ("paidKobo" >= 0 AND "deniedKobo" >= 0);
CREATE TRIGGER "Remittance_append_only" BEFORE UPDATE OR DELETE ON "Remittance" FOR EACH ROW EXECUTE FUNCTION hms_append_only();
CREATE TRIGGER "RemittanceLine_append_only" BEFORE UPDATE OR DELETE ON "RemittanceLine" FOR EACH ROW EXECUTE FUNCTION hms_append_only();

-- Ledger: lines are one-sided and positive; every entry balances at commit; append-only.
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_side_chk" CHECK (
  "debitKobo" >= 0 AND "creditKobo" >= 0 AND (("debitKobo" = 0) <> ("creditKobo" = 0)));
CREATE TRIGGER "JournalEntry_append_only" BEFORE UPDATE OR DELETE ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION hms_append_only();
CREATE TRIGGER "JournalLine_append_only" BEFORE UPDATE OR DELETE ON "JournalLine" FOR EACH ROW EXECUTE FUNCTION hms_append_only();
CREATE OR REPLACE FUNCTION hms_journal_balanced() RETURNS trigger AS $$
DECLARE d numeric; c numeric;
BEGIN
  SELECT COALESCE(SUM("debitKobo"), 0), COALESCE(SUM("creditKobo"), 0) INTO d, c
  FROM "JournalLine" WHERE "entryId" = NEW."entryId";
  IF d <> c THEN RAISE EXCEPTION 'Journal entry % is not balanced (debits %, credits %)', NEW."entryId", d, c; END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER "JournalLine_balanced" AFTER INSERT ON "JournalLine"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hms_journal_balanced();

-- Chart of accounts used by automatic postings.
INSERT INTO "LedgerAccount" ("code", "name", "type") VALUES
  ('1000', 'Cash on hand', 'ASSET'),
  ('1010', 'POS / card clearing', 'ASSET'),
  ('1020', 'Bank', 'ASSET'),
  ('1030', 'Online payments clearing', 'ASSET'),
  ('1100', 'Patient receivables', 'ASSET'),
  ('1200', 'Payer (HMO) receivables', 'ASSET'),
  ('2100', 'Patient deposits and credits', 'LIABILITY'),
  ('4000', 'Service revenue', 'INCOME'),
  ('4900', 'Discounts and credit notes', 'EXPENSE'),
  ('5900', 'Payer denials and write-offs', 'EXPENSE')
ON CONFLICT DO NOTHING;
