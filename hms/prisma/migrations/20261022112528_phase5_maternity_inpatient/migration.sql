-- CreateEnum
CREATE TYPE "PregnancyStatus" AS ENUM ('ACTIVE', 'DELIVERED', 'ENDED');

-- CreateEnum
CREATE TYPE "DatingMethod" AS ENUM ('LMP', 'ULTRASOUND', 'ASSISTED_CONCEPTION', 'OTHER');

-- CreateEnum
CREATE TYPE "DeliveryMode" AS ENUM ('SVD', 'ASSISTED_VACUUM', 'ASSISTED_FORCEPS', 'BREECH', 'CAESAREAN_EMERGENCY', 'CAESAREAN_ELECTIVE');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('DRAFT', 'SIGNED');

-- CreateEnum
CREATE TYPE "BirthOutcome" AS ENUM ('LIVE_BIRTH', 'FRESH_STILLBIRTH', 'MACERATED_STILLBIRTH');

-- CreateEnum
CREATE TYPE "PostnatalSubject" AS ENUM ('MOTHER', 'BABY');

-- CreateEnum
CREATE TYPE "AdmissionStatus" AS ENUM ('ADMITTED', 'DISCHARGE_AUTHORISED', 'DISCHARGED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdministrationStatus" AS ENUM ('GIVEN', 'HELD', 'REFUSED', 'NOT_AVAILABLE');

-- AlterEnum
ALTER TYPE "ChargeSource" ADD VALUE 'BED';

-- AlterEnum
ALTER TYPE "QueueStage" ADD VALUE 'ADMITTED';

-- AlterTable
ALTER TABLE "ServiceItem" ADD COLUMN     "wardId" UUID;

-- CreateTable
CREATE TABLE "PregnancyEpisode" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "patientId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "status" "PregnancyStatus" NOT NULL DEFAULT 'ACTIVE',
    "gravida" INTEGER NOT NULL,
    "para" INTEGER NOT NULL,
    "bookingDate" DATE NOT NULL,
    "edd" DATE,
    "bloodGroup" TEXT,
    "riskNotes" TEXT,
    "openedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),
    "endReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PregnancyEpisode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PregnancyDatingEvent" (
    "id" UUID NOT NULL,
    "episodeId" UUID NOT NULL,
    "method" "DatingMethod" NOT NULL,
    "lmp" DATE,
    "scanDate" DATE,
    "gaAtScanDays" INTEGER,
    "edd" DATE NOT NULL,
    "note" TEXT,
    "adopted" BOOLEAN NOT NULL DEFAULT false,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PregnancyDatingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AntenatalVisit" (
    "id" UUID NOT NULL,
    "episodeId" UUID NOT NULL,
    "encounterId" UUID,
    "visitDate" DATE NOT NULL,
    "gestationDays" INTEGER,
    "weightKg" DECIMAL(5,1),
    "systolicMmHg" INTEGER,
    "diastolicMmHg" INTEGER,
    "fundalHeightCm" DECIMAL(4,1),
    "fetalHeartRate" INTEGER,
    "presentation" TEXT,
    "urineProtein" TEXT,
    "oedema" TEXT,
    "notes" TEXT,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enteredInErrorAt" TIMESTAMPTZ(3),
    "errorReason" TEXT,

    CONSTRAINT "AntenatalVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRecord" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "episodeId" UUID NOT NULL,
    "motherPatientId" UUID NOT NULL,
    "encounterId" UUID,
    "deliveredAt" TIMESTAMPTZ(3) NOT NULL,
    "mode" "DeliveryMode" NOT NULL,
    "gestationDays" INTEGER,
    "bloodLossMl" INTEGER,
    "placentaComplete" BOOLEAN,
    "perineum" TEXT,
    "complications" TEXT,
    "attendants" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'DRAFT',
    "recordedById" UUID NOT NULL,
    "signedById" UUID,
    "signedAt" TIMESTAMPTZ(3),
    "contentHash" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DeliveryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewbornRecord" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "birthOrder" INTEGER NOT NULL,
    "outcome" "BirthOutcome" NOT NULL,
    "sex" "SexAtBirth" NOT NULL,
    "birthAt" TIMESTAMPTZ(3) NOT NULL,
    "birthWeightG" INTEGER,
    "apgar1" INTEGER,
    "apgar5" INTEGER,
    "resuscitation" TEXT,
    "notes" TEXT,
    "babyPatientId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewbornRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostnatalVisit" (
    "id" UUID NOT NULL,
    "episodeId" UUID NOT NULL,
    "subject" "PostnatalSubject" NOT NULL,
    "babyPatientId" UUID,
    "visitDate" DATE NOT NULL,
    "temperatureC" DECIMAL(4,1),
    "systolicMmHg" INTEGER,
    "diastolicMmHg" INTEGER,
    "weightG" INTEGER,
    "feeding" TEXT,
    "findings" TEXT NOT NULL,
    "plan" TEXT,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostnatalVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admission" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "patientId" UUID NOT NULL,
    "encounterId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "status" "AdmissionStatus" NOT NULL DEFAULT 'ADMITTED',
    "reason" TEXT NOT NULL,
    "admittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "admittedById" UUID NOT NULL,
    "attendingClinicianId" UUID,
    "dischargeAuthorisedAt" TIMESTAMPTZ(3),
    "dischargeAuthorisedById" UUID,
    "dischargeSummary" TEXT,
    "dischargeDestination" TEXT,
    "financialClearanceAt" TIMESTAMPTZ(3),
    "financialClearanceById" UUID,
    "financialClearanceNote" TEXT,
    "dischargedAt" TIMESTAMPTZ(3),
    "dischargedById" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Admission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BedAssignment" (
    "id" UUID NOT NULL,
    "admissionId" UUID NOT NULL,
    "bedId" UUID NOT NULL,
    "startAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endAt" TIMESTAMPTZ(3),
    "reason" TEXT,
    "assignedById" UUID NOT NULL,
    "endedById" UUID,

    CONSTRAINT "BedAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationAdministration" (
    "id" UUID NOT NULL,
    "admissionId" UUID,
    "encounterId" UUID NOT NULL,
    "prescriptionItemId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "scheduledFor" TIMESTAMPTZ(3),
    "administeredAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "AdministrationStatus" NOT NULL,
    "doseGiven" TEXT,
    "route" TEXT,
    "reason" TEXT,
    "recordedById" UUID NOT NULL,
    "witnessedById" UUID,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enteredInErrorAt" TIMESTAMPTZ(3),
    "errorReason" TEXT,

    CONSTRAINT "MedicationAdministration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PregnancyEpisode_ref_key" ON "PregnancyEpisode"("ref");

-- CreateIndex
CREATE INDEX "PregnancyEpisode_patientId_status_idx" ON "PregnancyEpisode"("patientId", "status");

-- CreateIndex
CREATE INDEX "AntenatalVisit_episodeId_visitDate_idx" ON "AntenatalVisit"("episodeId", "visitDate");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryRecord_ref_key" ON "DeliveryRecord"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "NewbornRecord_babyPatientId_key" ON "NewbornRecord"("babyPatientId");

-- CreateIndex
CREATE UNIQUE INDEX "NewbornRecord_deliveryId_birthOrder_key" ON "NewbornRecord"("deliveryId", "birthOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Admission_ref_key" ON "Admission"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "Admission_encounterId_key" ON "Admission"("encounterId");

-- CreateIndex
CREATE INDEX "Admission_branchId_status_idx" ON "Admission"("branchId", "status");

-- CreateIndex
CREATE INDEX "BedAssignment_bedId_idx" ON "BedAssignment"("bedId");

-- CreateIndex
CREATE INDEX "MedicationAdministration_encounterId_administeredAt_idx" ON "MedicationAdministration"("encounterId", "administeredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceItem_wardId_key" ON "ServiceItem"("wardId");

-- AddForeignKey
ALTER TABLE "PregnancyEpisode" ADD CONSTRAINT "PregnancyEpisode_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PregnancyDatingEvent" ADD CONSTRAINT "PregnancyDatingEvent_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "PregnancyEpisode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AntenatalVisit" ADD CONSTRAINT "AntenatalVisit_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "PregnancyEpisode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRecord" ADD CONSTRAINT "DeliveryRecord_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "PregnancyEpisode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewbornRecord" ADD CONSTRAINT "NewbornRecord_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "DeliveryRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewbornRecord" ADD CONSTRAINT "NewbornRecord_babyPatientId_fkey" FOREIGN KEY ("babyPatientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostnatalVisit" ADD CONSTRAINT "PostnatalVisit_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "PregnancyEpisode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BedAssignment" ADD CONSTRAINT "BedAssignment_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BedAssignment" ADD CONSTRAINT "BedAssignment_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "Bed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationAdministration" ADD CONSTRAINT "MedicationAdministration_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationAdministration" ADD CONSTRAINT "MedicationAdministration_prescriptionItemId_fkey" FOREIGN KEY ("prescriptionItemId") REFERENCES "PrescriptionItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────────── Hand-written integrity rules (Phase 5) ─────────────

-- One active pregnancy per mother; plausible obstetric counts.
CREATE UNIQUE INDEX "PregnancyEpisode_one_active" ON "PregnancyEpisode" ("patientId") WHERE "status" = 'ACTIVE';
ALTER TABLE "PregnancyEpisode" ADD CONSTRAINT "PregnancyEpisode_counts_chk"
  CHECK ("gravida" BETWEEN 1 AND 30 AND "para" >= 0 AND "para" < "gravida");
CREATE TRIGGER "PregnancyEpisode_no_delete" BEFORE DELETE ON "PregnancyEpisode" FOR EACH ROW EXECUTE FUNCTION hms_append_only();

-- Dating events: permanent; only the "adopted" choice can change; one adopted per pregnancy.
CREATE UNIQUE INDEX "PregnancyDating_one_adopted" ON "PregnancyDatingEvent" ("episodeId") WHERE "adopted";
CREATE OR REPLACE FUNCTION hms_dating_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Dating events cannot be deleted'; END IF;
  IF NOT hms_only_columns_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY['adopted']) THEN
    RAISE EXCEPTION 'Dating events are permanent; record a new one';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PregnancyDating_guard" BEFORE UPDATE OR DELETE ON "PregnancyDatingEvent" FOR EACH ROW EXECUTE FUNCTION hms_dating_guard();
ALTER TABLE "PregnancyDatingEvent" ADD CONSTRAINT "PregnancyDating_ga_chk" CHECK ("gaAtScanDays" IS NULL OR "gaAtScanDays" BETWEEN 0 AND 300);

-- Observations: plausibility; corrections only by an entered-in-error marker.
ALTER TABLE "AntenatalVisit" ADD CONSTRAINT "AntenatalVisit_range_chk" CHECK (
  ("weightKg" IS NULL OR "weightKg" BETWEEN 20 AND 300)
  AND ("systolicMmHg" IS NULL OR "systolicMmHg" BETWEEN 50 AND 300)
  AND ("diastolicMmHg" IS NULL OR "diastolicMmHg" BETWEEN 20 AND 200)
  AND ("fundalHeightCm" IS NULL OR "fundalHeightCm" BETWEEN 5 AND 60)
  AND ("fetalHeartRate" IS NULL OR "fetalHeartRate" BETWEEN 50 AND 250)
  AND ("gestationDays" IS NULL OR "gestationDays" BETWEEN 0 AND 320));
CREATE OR REPLACE FUNCTION hms_error_marker_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME; END IF;
  IF OLD."enteredInErrorAt" IS NOT NULL
     OR NOT hms_only_columns_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY['enteredInErrorAt', 'errorReason']) THEN
    RAISE EXCEPTION '% records are permanent; mark the entry as entered in error', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AntenatalVisit_guard" BEFORE UPDATE OR DELETE ON "AntenatalVisit" FOR EACH ROW EXECUTE FUNCTION hms_error_marker_only();
CREATE TRIGGER "MedicationAdministration_guard" BEFORE UPDATE OR DELETE ON "MedicationAdministration" FOR EACH ROW EXECUTE FUNCTION hms_error_marker_only();
CREATE TRIGGER "PostnatalVisit_append_only" BEFORE UPDATE OR DELETE ON "PostnatalVisit" FOR EACH ROW EXECUTE FUNCTION hms_append_only();
ALTER TABLE "PostnatalVisit" ADD CONSTRAINT "PostnatalVisit_subject_chk"
  CHECK (("subject" = 'BABY') = ("babyPatientId" IS NOT NULL));

-- Deliveries: immutable once signed; never deleted.
CREATE OR REPLACE FUNCTION hms_delivery_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Delivery records cannot be deleted'; END IF;
  IF OLD."status" = 'SIGNED' THEN RAISE EXCEPTION 'Signed delivery records are immutable; add a clinical note'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "DeliveryRecord_guard" BEFORE UPDATE OR DELETE ON "DeliveryRecord" FOR EACH ROW EXECUTE FUNCTION hms_delivery_guard();
ALTER TABLE "DeliveryRecord" ADD CONSTRAINT "DeliveryRecord_values_chk"
  CHECK (("bloodLossMl" IS NULL OR "bloodLossMl" BETWEEN 0 AND 10000) AND ("gestationDays" IS NULL OR "gestationDays" BETWEEN 140 AND 320));

CREATE OR REPLACE FUNCTION hms_newborn_guard() RETURNS trigger AS $$
DECLARE parent_status text;
BEGIN
  SELECT "status" INTO parent_status FROM "DeliveryRecord" WHERE "id" = COALESCE(NEW."deliveryId", OLD."deliveryId");
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Newborn records cannot be deleted'; END IF;
  IF parent_status = 'SIGNED' THEN RAISE EXCEPTION 'Newborn records of a signed delivery are immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "NewbornRecord_guard" BEFORE UPDATE OR DELETE ON "NewbornRecord" FOR EACH ROW EXECUTE FUNCTION hms_newborn_guard();
ALTER TABLE "NewbornRecord" ADD CONSTRAINT "NewbornRecord_values_chk" CHECK (
  "birthOrder" BETWEEN 1 AND 8
  AND ("birthWeightG" IS NULL OR "birthWeightG" BETWEEN 200 AND 7000)
  AND ("apgar1" IS NULL OR "apgar1" BETWEEN 0 AND 10)
  AND ("apgar5" IS NULL OR "apgar5" BETWEEN 0 AND 10)
  AND ("outcome" = 'LIVE_BIRTH' OR "babyPatientId" IS NULL));

-- Admissions: one current stay per patient; never deleted.
CREATE UNIQUE INDEX "Admission_one_current" ON "Admission" ("patientId") WHERE "status" IN ('ADMITTED', 'DISCHARGE_AUTHORISED');
CREATE TRIGGER "Admission_no_delete" BEFORE DELETE ON "Admission" FOR EACH ROW EXECUTE FUNCTION hms_append_only();

-- Beds: no overlapping occupancy of one bed; one open assignment per stay; assignments only close.
ALTER TABLE "BedAssignment" ADD CONSTRAINT "BedAssignment_no_overlap" EXCLUDE USING gist (
  "bedId" WITH =, tstzrange("startAt", "endAt", '[)') WITH &&
);
CREATE UNIQUE INDEX "BedAssignment_one_open" ON "BedAssignment" ("admissionId") WHERE "endAt" IS NULL;
ALTER TABLE "BedAssignment" ADD CONSTRAINT "BedAssignment_range_chk" CHECK ("endAt" IS NULL OR "endAt" > "startAt");
CREATE OR REPLACE FUNCTION hms_bed_assignment_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Bed assignments cannot be deleted'; END IF;
  IF OLD."endAt" IS NOT NULL OR NOT hms_only_columns_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY['endAt', 'endedById']) THEN
    RAISE EXCEPTION 'Bed assignments can only be ended once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "BedAssignment_guard" BEFORE UPDATE OR DELETE ON "BedAssignment" FOR EACH ROW EXECUTE FUNCTION hms_bed_assignment_guard();
