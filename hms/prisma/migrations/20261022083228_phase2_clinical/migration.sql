-- CreateEnum
CREATE TYPE "ClinicalNoteType" AS ENUM ('CONSULTATION', 'PROGRESS', 'NURSING', 'PROCEDURE', 'ADDENDUM');

-- CreateEnum
CREATE TYPE "NoteStatus" AS ENUM ('DRAFT', 'SIGNED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "VitalContext" AS ENUM ('OUTPATIENT', 'INPATIENT', 'ANTENATAL');

-- CreateEnum
CREATE TYPE "VitalParameter" AS ENUM ('TEMPERATURE_C', 'PULSE_BPM', 'RESP_RATE', 'SYSTOLIC', 'DIASTOLIC', 'SPO2');

-- CreateEnum
CREATE TYPE "ClinicalRuleStatus" AS ENUM ('DRAFT', 'APPROVED', 'RETIRED');

-- CreateEnum
CREATE TYPE "DiagnosisCertainty" AS ENUM ('PROVISIONAL', 'CONFIRMED', 'REFUTED');

-- CreateEnum
CREATE TYPE "DiagnosisStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'ENTERED_IN_ERROR');

-- CreateEnum
CREATE TYPE "LabResultType" AS ENUM ('NUMERIC', 'TEXT', 'CODED');

-- CreateEnum
CREATE TYPE "RangeSex" AS ENUM ('ANY', 'FEMALE', 'MALE');

-- CreateEnum
CREATE TYPE "ImagingModality" AS ENUM ('XRAY', 'ULTRASOUND', 'CT', 'MRI', 'ECG', 'OTHER');

-- CreateEnum
CREATE TYPE "OrderKind" AS ENUM ('LAB', 'IMAGING', 'PROCEDURE', 'REFERRAL');

-- CreateEnum
CREATE TYPE "OrderPriority" AS ENUM ('ROUTINE', 'URGENT', 'STAT');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('ORDERED', 'SCHEDULED', 'SPECIMEN_COLLECTED', 'IN_PROGRESS', 'RESULTED', 'VERIFIED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SpecimenStatus" AS ENUM ('COLLECTED', 'RECEIVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ResultFlag" AS ENUM ('NONE', 'NORMAL', 'LOW', 'HIGH', 'CRITICAL_LOW', 'CRITICAL_HIGH', 'ABNORMAL');

-- CreateEnum
CREATE TYPE "ResultStatus" AS ENUM ('DRAFT', 'FINAL');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'SIGNED');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('LAB_REPORT', 'IMAGING', 'REFERRAL', 'CONSENT', 'CLINICAL_OTHER', 'ADMINISTRATIVE');

-- CreateEnum
CREATE TYPE "DocumentSource" AS ENUM ('INTERNAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('NOT_SCANNED', 'CLEAN', 'INFECTED');

-- CreateTable
CREATE TABLE "ClinicalNote" (
    "id" UUID NOT NULL,
    "encounterId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "type" "ClinicalNoteType" NOT NULL,
    "status" "NoteStatus" NOT NULL DEFAULT 'DRAFT',
    "templateKey" TEXT,
    "content" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "authorId" UUID NOT NULL,
    "parentNoteId" UUID,
    "signedById" UUID,
    "signedAt" TIMESTAMPTZ(3),
    "contentHash" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClinicalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalNoteVersion" (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "savedById" UUID NOT NULL,
    "savedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalNoteVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriageRecord" (
    "id" UUID NOT NULL,
    "encounterId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "chiefComplaint" TEXT NOT NULL,
    "acuity" TEXT NOT NULL,
    "notes" TEXT,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enteredInErrorAt" TIMESTAMPTZ(3),
    "enteredInErrorById" UUID,
    "errorReason" TEXT,

    CONSTRAINT "TriageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VitalSign" (
    "id" UUID NOT NULL,
    "encounterId" UUID,
    "patientId" UUID NOT NULL,
    "context" "VitalContext" NOT NULL DEFAULT 'OUTPATIENT',
    "measuredAt" TIMESTAMPTZ(3) NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" UUID NOT NULL,
    "temperatureC" DECIMAL(4,1),
    "pulseBpm" INTEGER,
    "respRatePerMin" INTEGER,
    "systolicMmHg" INTEGER,
    "diastolicMmHg" INTEGER,
    "spo2Pct" INTEGER,
    "weightKg" DECIMAL(5,2),
    "heightCm" DECIMAL(5,1),
    "painScore" INTEGER,
    "notes" TEXT,
    "enteredInErrorAt" TIMESTAMPTZ(3),
    "enteredInErrorById" UUID,
    "errorReason" TEXT,

    CONSTRAINT "VitalSign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VitalThreshold" (
    "id" UUID NOT NULL,
    "parameter" "VitalParameter" NOT NULL,
    "low" DECIMAL(6,1),
    "high" DECIMAL(6,1),
    "criticalLow" DECIMAL(6,1),
    "criticalHigh" DECIMAL(6,1),
    "status" "ClinicalRuleStatus" NOT NULL DEFAULT 'DRAFT',
    "source" TEXT,
    "createdById" UUID,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VitalThreshold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Diagnosis" (
    "id" UUID NOT NULL,
    "encounterId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "code" TEXT,
    "codeSystem" TEXT,
    "certainty" "DiagnosisCertainty" NOT NULL,
    "status" "DiagnosisStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "onProblemList" BOOLEAN NOT NULL DEFAULT false,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Diagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabTestDefinition" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specimenType" TEXT NOT NULL,
    "turnaroundHours" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LabTestDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabTestComponent" (
    "id" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "resultType" "LabResultType" NOT NULL,
    "decimals" INTEGER,
    "allowedValues" TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LabTestComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabReferenceRange" (
    "id" UUID NOT NULL,
    "componentId" UUID NOT NULL,
    "sex" "RangeSex" NOT NULL DEFAULT 'ANY',
    "ageMinDays" INTEGER NOT NULL DEFAULT 0,
    "ageMaxDays" INTEGER,
    "low" DECIMAL(12,4),
    "high" DECIMAL(12,4),
    "criticalLow" DECIMAL(12,4),
    "criticalHigh" DECIMAL(12,4),
    "normalText" TEXT,
    "status" "ClinicalRuleStatus" NOT NULL DEFAULT 'DRAFT',
    "source" TEXT,
    "createdById" UUID,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabReferenceRange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImagingStudyDefinition" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "modality" "ImagingModality" NOT NULL,
    "bodyPart" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImagingStudyDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceOrder" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "requestGroupId" UUID NOT NULL,
    "itemIndex" INTEGER NOT NULL,
    "kind" "OrderKind" NOT NULL,
    "encounterId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "labTestId" UUID,
    "imagingStudyId" UUID,
    "description" TEXT NOT NULL,
    "priority" "OrderPriority" NOT NULL DEFAULT 'ROUTINE',
    "clinicalIndication" TEXT,
    "notes" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'ORDERED',
    "orderedById" UUID NOT NULL,
    "orderedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledAt" TIMESTAMPTZ(3),
    "resultedAt" TIMESTAMPTZ(3),
    "verifiedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledById" UUID,
    "cancelReason" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewedById" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ServiceOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusEvent" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "note" TEXT,
    "changedById" UUID NOT NULL,
    "changedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabSpecimen" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "accession" TEXT NOT NULL,
    "specimenType" TEXT NOT NULL,
    "status" "SpecimenStatus" NOT NULL DEFAULT 'COLLECTED',
    "collectedAt" TIMESTAMPTZ(3) NOT NULL,
    "collectedById" UUID NOT NULL,
    "receivedAt" TIMESTAMPTZ(3),
    "receivedById" UUID,
    "rejectedAt" TIMESTAMPTZ(3),
    "rejectedById" UUID,
    "rejectionReason" TEXT,

    CONSTRAINT "LabSpecimen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabResult" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "componentId" UUID NOT NULL,
    "valueText" TEXT NOT NULL,
    "valueNumeric" DECIMAL(14,4),
    "unit" TEXT,
    "referenceText" TEXT,
    "flag" "ResultFlag" NOT NULL DEFAULT 'NONE',
    "status" "ResultStatus" NOT NULL DEFAULT 'DRAFT',
    "enteredById" UUID NOT NULL,
    "enteredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMPTZ(3),
    "amendsResultId" UUID,
    "amendmentReason" TEXT,
    "supersededAt" TIMESTAMPTZ(3),
    "supersededById" UUID,

    CONSTRAINT "LabResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CriticalResultAlert" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "raisedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" TEXT NOT NULL,
    "acknowledgedById" UUID,
    "acknowledgedAt" TIMESTAMPTZ(3),
    "communicatedTo" TEXT,
    "communicationMethod" TEXT,
    "notes" TEXT,

    CONSTRAINT "CriticalResultAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImagingReport" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "findings" TEXT NOT NULL,
    "impression" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "authorId" UUID NOT NULL,
    "signedById" UUID,
    "signedAt" TIMESTAMPTZ(3),
    "contentHash" TEXT,
    "amendsReportId" UUID,
    "amendmentReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ImagingReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" UUID NOT NULL,
    "patientId" UUID,
    "encounterId" UUID,
    "orderId" UUID,
    "kind" "DocumentKind" NOT NULL,
    "title" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "source" "DocumentSource" NOT NULL DEFAULT 'INTERNAL',
    "sourceDescription" TEXT,
    "scanStatus" "ScanStatus" NOT NULL DEFAULT 'NOT_SCANNED',
    "uploadedById" UUID NOT NULL,
    "uploadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMPTZ(3),
    "voidedById" UUID,
    "voidReason" TEXT,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClinicalNote_patientId_createdAt_idx" ON "ClinicalNote"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "ClinicalNote_encounterId_idx" ON "ClinicalNote"("encounterId");

-- CreateIndex
CREATE INDEX "ClinicalNote_authorId_status_idx" ON "ClinicalNote"("authorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalNoteVersion_noteId_version_key" ON "ClinicalNoteVersion"("noteId", "version");

-- CreateIndex
CREATE INDEX "TriageRecord_encounterId_idx" ON "TriageRecord"("encounterId");

-- CreateIndex
CREATE INDEX "VitalSign_patientId_measuredAt_idx" ON "VitalSign"("patientId", "measuredAt");

-- CreateIndex
CREATE INDEX "VitalSign_encounterId_idx" ON "VitalSign"("encounterId");

-- CreateIndex
CREATE INDEX "VitalThreshold_parameter_status_idx" ON "VitalThreshold"("parameter", "status");

-- CreateIndex
CREATE INDEX "Diagnosis_patientId_status_idx" ON "Diagnosis"("patientId", "status");

-- CreateIndex
CREATE INDEX "Diagnosis_encounterId_idx" ON "Diagnosis"("encounterId");

-- CreateIndex
CREATE UNIQUE INDEX "LabTestDefinition_code_key" ON "LabTestDefinition"("code");

-- CreateIndex
CREATE UNIQUE INDEX "LabTestComponent_testId_code_key" ON "LabTestComponent"("testId", "code");

-- CreateIndex
CREATE INDEX "LabReferenceRange_componentId_status_idx" ON "LabReferenceRange"("componentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ImagingStudyDefinition_code_key" ON "ImagingStudyDefinition"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceOrder_ref_key" ON "ServiceOrder"("ref");

-- CreateIndex
CREATE INDEX "ServiceOrder_branchId_kind_status_idx" ON "ServiceOrder"("branchId", "kind", "status");

-- CreateIndex
CREATE INDEX "ServiceOrder_patientId_orderedAt_idx" ON "ServiceOrder"("patientId", "orderedAt");

-- CreateIndex
CREATE INDEX "ServiceOrder_encounterId_idx" ON "ServiceOrder"("encounterId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceOrder_requestGroupId_itemIndex_key" ON "ServiceOrder"("requestGroupId", "itemIndex");

-- CreateIndex
CREATE INDEX "OrderStatusEvent_orderId_changedAt_idx" ON "OrderStatusEvent"("orderId", "changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LabSpecimen_accession_key" ON "LabSpecimen"("accession");

-- CreateIndex
CREATE INDEX "LabSpecimen_orderId_idx" ON "LabSpecimen"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "LabResult_amendsResultId_key" ON "LabResult"("amendsResultId");

-- CreateIndex
CREATE INDEX "LabResult_orderId_idx" ON "LabResult"("orderId");

-- CreateIndex
CREATE INDEX "CriticalResultAlert_acknowledgedAt_idx" ON "CriticalResultAlert"("acknowledgedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImagingReport_amendsReportId_key" ON "ImagingReport"("amendsReportId");

-- CreateIndex
CREATE INDEX "ImagingReport_orderId_idx" ON "ImagingReport"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");

-- CreateIndex
CREATE INDEX "Document_patientId_uploadedAt_idx" ON "Document"("patientId", "uploadedAt");

-- CreateIndex
CREATE INDEX "Document_orderId_idx" ON "Document"("orderId");

-- AddForeignKey
ALTER TABLE "ClinicalNote" ADD CONSTRAINT "ClinicalNote_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalNote" ADD CONSTRAINT "ClinicalNote_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalNote" ADD CONSTRAINT "ClinicalNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalNote" ADD CONSTRAINT "ClinicalNote_signedById_fkey" FOREIGN KEY ("signedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalNote" ADD CONSTRAINT "ClinicalNote_parentNoteId_fkey" FOREIGN KEY ("parentNoteId") REFERENCES "ClinicalNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalNoteVersion" ADD CONSTRAINT "ClinicalNoteVersion_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "ClinicalNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageRecord" ADD CONSTRAINT "TriageRecord_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageRecord" ADD CONSTRAINT "TriageRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageRecord" ADD CONSTRAINT "TriageRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VitalSign" ADD CONSTRAINT "VitalSign_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VitalSign" ADD CONSTRAINT "VitalSign_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VitalSign" ADD CONSTRAINT "VitalSign_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Diagnosis" ADD CONSTRAINT "Diagnosis_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Diagnosis" ADD CONSTRAINT "Diagnosis_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Diagnosis" ADD CONSTRAINT "Diagnosis_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabTestComponent" ADD CONSTRAINT "LabTestComponent_testId_fkey" FOREIGN KEY ("testId") REFERENCES "LabTestDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabReferenceRange" ADD CONSTRAINT "LabReferenceRange_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "LabTestComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_labTestId_fkey" FOREIGN KEY ("labTestId") REFERENCES "LabTestDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_imagingStudyId_fkey" FOREIGN KEY ("imagingStudyId") REFERENCES "ImagingStudyDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_orderedById_fkey" FOREIGN KEY ("orderedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusEvent" ADD CONSTRAINT "OrderStatusEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabSpecimen" ADD CONSTRAINT "LabSpecimen_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "LabTestComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_amendsResultId_fkey" FOREIGN KEY ("amendsResultId") REFERENCES "LabResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriticalResultAlert" ADD CONSTRAINT "CriticalResultAlert_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriticalResultAlert" ADD CONSTRAINT "CriticalResultAlert_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingReport" ADD CONSTRAINT "ImagingReport_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingReport" ADD CONSTRAINT "ImagingReport_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingReport" ADD CONSTRAINT "ImagingReport_signedById_fkey" FOREIGN KEY ("signedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingReport" ADD CONSTRAINT "ImagingReport_amendsReportId_fkey" FOREIGN KEY ("amendsReportId") REFERENCES "ImagingReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── Hand-written integrity rules (Phase 2) ─────────────

-- Generic: allow an UPDATE only if nothing changed apart from the listed columns.
CREATE OR REPLACE FUNCTION hms_only_columns_changed(old_row jsonb, new_row jsonb, allowed text[])
RETURNS boolean AS $$
  SELECT (old_row - allowed) = (new_row - allowed);
$$ LANGUAGE sql IMMUTABLE;

-- Clinical notes: never deleted; immutable once signed (corrections are addenda).
CREATE OR REPLACE FUNCTION hms_clinical_note_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ClinicalNote rows cannot be deleted';
  END IF;
  IF OLD."status" = 'SIGNED' THEN
    RAISE EXCEPTION 'Signed clinical notes are immutable; write an addendum';
  END IF;
  IF OLD."status" = 'DISCARDED' THEN
    RAISE EXCEPTION 'Discarded drafts cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ClinicalNote_guard" BEFORE UPDATE OR DELETE ON "ClinicalNote"
  FOR EACH ROW EXECUTE FUNCTION hms_clinical_note_guard();

CREATE TRIGGER "ClinicalNoteVersion_append_only" BEFORE UPDATE OR DELETE ON "ClinicalNoteVersion"
  FOR EACH ROW EXECUTE FUNCTION hms_append_only();
CREATE TRIGGER "OrderStatusEvent_append_only" BEFORE UPDATE OR DELETE ON "OrderStatusEvent"
  FOR EACH ROW EXECUTE FUNCTION hms_append_only();

-- Lab results: FINAL rows may only gain supersededAt/supersededById (once). Never deleted when FINAL.
CREATE OR REPLACE FUNCTION hms_lab_result_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'FINAL' THEN RAISE EXCEPTION 'Verified lab results cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'FINAL' THEN
    IF OLD."supersededAt" IS NOT NULL
       OR NOT hms_only_columns_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY['supersededAt','supersededById']) THEN
      RAISE EXCEPTION 'Verified lab results are immutable; record an amendment';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "LabResult_guard" BEFORE UPDATE OR DELETE ON "LabResult"
  FOR EACH ROW EXECUTE FUNCTION hms_lab_result_guard();

-- Imaging reports: immutable once signed; never deleted.
CREATE OR REPLACE FUNCTION hms_imaging_report_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Imaging reports cannot be deleted'; END IF;
  IF OLD."status" = 'SIGNED' THEN RAISE EXCEPTION 'Signed imaging reports are immutable; issue an amended report'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ImagingReport_guard" BEFORE UPDATE OR DELETE ON "ImagingReport"
  FOR EACH ROW EXECUTE FUNCTION hms_imaging_report_guard();

-- Vitals and triage: measurements are never edited; only the entered-in-error marker may be set (once).
CREATE OR REPLACE FUNCTION hms_observation_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME; END IF;
  IF OLD."enteredInErrorAt" IS NOT NULL
     OR NOT hms_only_columns_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY['enteredInErrorAt','enteredInErrorById','errorReason']) THEN
    RAISE EXCEPTION '% measurements cannot be edited; mark entered-in-error and re-record', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "VitalSign_guard" BEFORE UPDATE OR DELETE ON "VitalSign"
  FOR EACH ROW EXECUTE FUNCTION hms_observation_guard();
CREATE TRIGGER "TriageRecord_guard" BEFORE UPDATE OR DELETE ON "TriageRecord"
  FOR EACH ROW EXECUTE FUNCTION hms_observation_guard();

-- Documents are voided, never deleted.
CREATE TRIGGER "Document_no_delete" BEFORE DELETE ON "Document"
  FOR EACH ROW EXECUTE FUNCTION hms_append_only();

-- Plausibility (data-entry guards, NOT clinical thresholds).
ALTER TABLE "VitalSign" ADD CONSTRAINT "VitalSign_plausible_chk" CHECK (
  ("temperatureC" IS NULL OR "temperatureC" BETWEEN 25 AND 45) AND
  ("pulseBpm" IS NULL OR "pulseBpm" BETWEEN 20 AND 300) AND
  ("respRatePerMin" IS NULL OR "respRatePerMin" BETWEEN 4 AND 100) AND
  ("systolicMmHg" IS NULL OR "systolicMmHg" BETWEEN 40 AND 300) AND
  ("diastolicMmHg" IS NULL OR "diastolicMmHg" BETWEEN 20 AND 200) AND
  ("spo2Pct" IS NULL OR "spo2Pct" BETWEEN 30 AND 100) AND
  ("weightKg" IS NULL OR "weightKg" BETWEEN 0.3 AND 400) AND
  ("heightCm" IS NULL OR "heightCm" BETWEEN 20 AND 250) AND
  ("painScore" IS NULL OR "painScore" BETWEEN 0 AND 10)
);
ALTER TABLE "VitalSign" ADD CONSTRAINT "VitalSign_has_value_chk" CHECK (
  num_nonnulls("temperatureC","pulseBpm","respRatePerMin","systolicMmHg","diastolicMmHg","spo2Pct","weightKg","heightCm","painScore") > 0
);

-- Exactly one approved threshold per vital parameter.
CREATE UNIQUE INDEX "VitalThreshold_one_approved" ON "VitalThreshold" ("parameter") WHERE "status" = 'APPROVED';

-- An order references the right catalogue for its kind.
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_kind_ref_chk" CHECK (
  ("kind" = 'LAB' AND "labTestId" IS NOT NULL AND "imagingStudyId" IS NULL) OR
  ("kind" = 'IMAGING' AND "imagingStudyId" IS NOT NULL AND "labTestId" IS NULL) OR
  ("kind" IN ('PROCEDURE','REFERRAL') AND "labTestId" IS NULL AND "imagingStudyId" IS NULL)
);
-- At most one current (non-superseded) FINAL result per order component.
CREATE UNIQUE INDEX "LabResult_one_current_final" ON "LabResult" ("orderId", "componentId")
  WHERE "status" = 'FINAL' AND "supersededAt" IS NULL;
-- At most one current DRAFT result per order component.
CREATE UNIQUE INDEX "LabResult_one_draft" ON "LabResult" ("orderId", "componentId") WHERE "status" = 'DRAFT';
