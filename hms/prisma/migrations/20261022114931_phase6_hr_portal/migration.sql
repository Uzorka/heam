-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('PERMANENT', 'CONTRACT', 'LOCUM', 'INTERN', 'NYSC', 'VOLUNTEER');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'EXITED');

-- CreateEnum
CREATE TYPE "ShiftKind" AS ENUM ('MORNING', 'AFTERNOON', 'NIGHT', 'ON_CALL', 'OTHER');

-- CreateEnum
CREATE TYPE "AttendanceKind" AS ENUM ('CLOCK_IN', 'CLOCK_OUT');

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('ANNUAL', 'SICK', 'MATERNITY', 'PATERNITY', 'STUDY', 'COMPASSIONATE', 'UNPAID', 'OTHER');

-- CreateEnum
CREATE TYPE "PayComponentKind" AS ENUM ('EARNING', 'DEDUCTION');

-- CreateEnum
CREATE TYPE "PayCalc" AS ENUM ('FIXED', 'PERCENT_OF_BASIC');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'APPROVED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "releasedToPortalAt" TIMESTAMPTZ(3),
ADD COLUMN     "releasedToPortalById" UUID;

-- AlterTable
ALTER TABLE "ServiceOrder" ADD COLUMN     "releasedToPortalAt" TIMESTAMPTZ(3),
ADD COLUMN     "releasedToPortalById" UUID;

-- CreateTable
CREATE TABLE "Employee" (
    "id" UUID NOT NULL,
    "staffNumber" TEXT NOT NULL,
    "userId" UUID,
    "branchId" UUID NOT NULL,
    "givenName" TEXT NOT NULL,
    "familyName" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "department" TEXT,
    "employmentType" "EmploymentType" NOT NULL,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "phoneE164" TEXT,
    "email" TEXT,
    "bankName" TEXT,
    "bankAccountEnc" TEXT,
    "bankAccountLast4" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalCredential" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "expiresAt" DATE,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMPTZ(3),
    "evidence" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterShift" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "location" TEXT,
    "kind" "ShiftKind" NOT NULL,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMPTZ(3),

    CONSTRAINT "RosterShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "kind" "AttendanceKind" NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" UUID NOT NULL,
    "note" TEXT,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "type" "LeaveType" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" UUID NOT NULL,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNote" TEXT,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayComponent" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PayComponentKind" NOT NULL,
    "calc" "PayCalc" NOT NULL,
    "rateBasisPoints" INTEGER,
    "isBasic" BOOLEAN NOT NULL DEFAULT false,
    "status" "TariffStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PayComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeePayItem" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "componentId" UUID NOT NULL,
    "amountKobo" BIGINT,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeePayItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "branchId" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "grossKobo" BIGINT NOT NULL DEFAULT 0,
    "deductionsKobo" BIGINT NOT NULL DEFAULT 0,
    "netKobo" BIGINT NOT NULL DEFAULT 0,
    "preparedById" UUID NOT NULL,
    "preparedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payslip" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "grossKobo" BIGINT NOT NULL,
    "deductionsKobo" BIGINT NOT NULL,
    "netKobo" BIGINT NOT NULL,
    "lines" JSONB NOT NULL,

    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalAccount" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedById" UUID,

    CONSTRAINT "PortalAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_staffNumber_key" ON "Employee"("staffNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE INDEX "Employee_branchId_status_idx" ON "Employee"("branchId", "status");

-- CreateIndex
CREATE INDEX "RosterShift_branchId_startAt_idx" ON "RosterShift"("branchId", "startAt");

-- CreateIndex
CREATE INDEX "AttendanceRecord_employeeId_at_idx" ON "AttendanceRecord"("employeeId", "at");

-- CreateIndex
CREATE INDEX "LeaveRequest_status_idx" ON "LeaveRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PayComponent_code_key" ON "PayComponent"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_ref_key" ON "PayrollRun"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_runId_employeeId_key" ON "Payslip"("runId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "PortalAccount_userId_key" ON "PortalAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PortalAccount_patientId_key" ON "PortalAccount"("patientId");

-- AddForeignKey
ALTER TABLE "ProfessionalCredential" ADD CONSTRAINT "ProfessionalCredential_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterShift" ADD CONSTRAINT "RosterShift_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePayItem" ADD CONSTRAINT "EmployeePayItem_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePayItem" ADD CONSTRAINT "EmployeePayItem_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "PayComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────────── Hand-written integrity rules (Phase 6) ─────────────

-- Rosters: no overlapping live shifts for one person; shifts end after they start.
ALTER TABLE "RosterShift" ADD CONSTRAINT "RosterShift_range_chk" CHECK ("endAt" > "startAt" AND "endAt" - "startAt" <= interval '36 hours');
ALTER TABLE "RosterShift" ADD CONSTRAINT "RosterShift_no_overlap" EXCLUDE USING gist (
  "employeeId" WITH =, tstzrange("startAt", "endAt", '[)') WITH &&
) WHERE ("cancelledAt" IS NULL);

-- Attendance is an append-only log.
CREATE TRIGGER "AttendanceRecord_append_only" BEFORE UPDATE OR DELETE ON "AttendanceRecord" FOR EACH ROW EXECUTE FUNCTION hms_append_only();

ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_range_chk" CHECK ("endDate" >= "startDate" AND "days" > 0);
CREATE TRIGGER "Employee_no_delete" BEFORE DELETE ON "Employee" FOR EACH ROW EXECUTE FUNCTION hms_append_only();

-- Pay rules: rates are percentages in basis points; fixed items carry amounts.
ALTER TABLE "PayComponent" ADD CONSTRAINT "PayComponent_rate_chk" CHECK (
  ("calc" = 'FIXED' AND "rateBasisPoints" IS NULL) OR ("calc" = 'PERCENT_OF_BASIC' AND "rateBasisPoints" BETWEEN 0 AND 10000 AND NOT "isBasic"));
CREATE UNIQUE INDEX "PayComponent_one_basic" ON "PayComponent" ("isBasic") WHERE "isBasic" AND "status" = 'APPROVED';
ALTER TABLE "EmployeePayItem" ADD CONSTRAINT "EmployeePayItem_amount_chk" CHECK (("amountKobo" IS NULL OR "amountKobo" >= 0) AND ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"));

-- Payroll: one live run per branch and month; approved runs and their payslips are locked.
CREATE UNIQUE INDEX "PayrollRun_one_per_period" ON "PayrollRun" ("branchId", "period") WHERE "status" <> 'CANCELLED';
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_period_chk" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
CREATE OR REPLACE FUNCTION hms_payroll_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Payroll runs cannot be deleted'; END IF;
  IF OLD."status" <> 'DRAFT' THEN RAISE EXCEPTION 'Approved or cancelled payroll runs are locked'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PayrollRun_guard" BEFORE UPDATE OR DELETE ON "PayrollRun" FOR EACH ROW EXECUTE FUNCTION hms_payroll_guard();
CREATE OR REPLACE FUNCTION hms_payslip_guard() RETURNS trigger AS $$
DECLARE run_status text;
BEGIN
  SELECT "status" INTO run_status FROM "PayrollRun" WHERE "id" = COALESCE(NEW."runId", OLD."runId");
  IF run_status <> 'DRAFT' THEN RAISE EXCEPTION 'Payslips of an approved payroll run are locked'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Payslip_guard" BEFORE UPDATE OR DELETE ON "Payslip" FOR EACH ROW EXECUTE FUNCTION hms_payslip_guard();
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_amount_chk" CHECK ("grossKobo" >= 0 AND "deductionsKobo" >= 0 AND "netKobo" = "grossKobo" - "deductionsKobo");

-- Portal accounts are revoked, never deleted.
CREATE TRIGGER "PortalAccount_no_delete" BEFORE DELETE ON "PortalAccount" FOR EACH ROW EXECUTE FUNCTION hms_append_only();
