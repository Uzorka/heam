-- CreateEnum
CREATE TYPE "InventoryCategory" AS ENUM ('PHARMACY', 'LAB_CONSUMABLE', 'MEDICAL_SUPPLY', 'MATERNITY_THEATRE', 'OFFICE_MAINTENANCE', 'ASSET');

-- CreateEnum
CREATE TYPE "StockLocationKind" AS ENUM ('MAIN_STORE', 'PHARMACY', 'WARD', 'LABORATORY', 'THEATRE', 'QUARANTINE');

-- CreateEnum
CREATE TYPE "LotStatus" AS ENUM ('AVAILABLE', 'QUARANTINED', 'RECALLED');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIPT', 'DISPENSE', 'DISPENSE_REVERSAL', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT', 'COUNT_ADJUSTMENT', 'CONSUMPTION');

-- CreateEnum
CREATE TYPE "AdjustmentReason" AS ENUM ('DAMAGED', 'EXPIRED', 'LOST', 'RECALLED', 'FOUND', 'OTHER');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('OPEN', 'SUBMITTED', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RequisitionStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'ORDERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DosageForm" AS ENUM ('TABLET', 'CAPSULE', 'SYRUP', 'SUSPENSION', 'INJECTION', 'INFUSION', 'CREAM', 'OINTMENT', 'DROPS', 'INHALER', 'SUPPOSITORY', 'PESSARY', 'OTHER');

-- CreateEnum
CREATE TYPE "FormularyStatus" AS ENUM ('FORMULARY', 'RESTRICTED', 'NON_FORMULARY');

-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('DRAFT', 'SIGNED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PrescriptionItemStatus" AS ENUM ('PENDING', 'QUERIED', 'VERIFIED', 'PARTIALLY_DISPENSED', 'DISPENSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "InventoryProduct" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "InventoryCategory" NOT NULL,
    "baseUnit" TEXT NOT NULL,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "reorderQuantity" INTEGER NOT NULL DEFAULT 0,
    "trackExpiry" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "InventoryProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLocation" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "StockLocationKind" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLot" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "expiryDate" DATE,
    "manufacturer" TEXT,
    "supplierId" UUID,
    "unitCostKobo" BIGINT,
    "status" "LotStatus" NOT NULL DEFAULT 'AVAILABLE',
    "statusReason" TEXT,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBalance" (
    "lotId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("lotId","locationId")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "idempotencyKey" TEXT,
    "performedById" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustmentRequest" (
    "id" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "quantityDelta" INTEGER NOT NULL,
    "reason" "AdjustmentReason" NOT NULL,
    "notes" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" UUID NOT NULL,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNotes" TEXT,
    "movementId" UUID,

    CONSTRAINT "StockAdjustmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCount" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "locationId" UUID NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'OPEN',
    "startedById" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedById" UUID,
    "submittedAt" TIMESTAMPTZ(3),
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "notes" TEXT,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "id" UUID NOT NULL,
    "countId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "systemQty" INTEGER NOT NULL,
    "countedQty" INTEGER,
    "varianceNote" TEXT,

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phoneE164" TEXT,
    "email" TEXT,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequisition" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "branchId" UUID NOT NULL,
    "status" "RequisitionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "justification" TEXT NOT NULL,
    "requestedById" UUID NOT NULL,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNotes" TEXT,

    CONSTRAINT "PurchaseRequisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequisitionItem" (
    "id" UUID NOT NULL,
    "requisitionId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,

    CONSTRAINT "RequisitionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "supplierId" UUID NOT NULL,
    "requisitionId" UUID,
    "branchId" UUID NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" UUID,
    "issuedAt" TIMESTAMPTZ(3),
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "quantityOrdered" INTEGER NOT NULL,
    "quantityReceived" INTEGER NOT NULL DEFAULT 0,
    "unitCostKobo" BIGINT NOT NULL,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "receivedById" UUID NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryNote" TEXT,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" UUID NOT NULL,
    "receiptId" UUID NOT NULL,
    "poItemId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCostKobo" BIGINT NOT NULL,
    "quarantined" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationProduct" (
    "id" UUID NOT NULL,
    "inventoryProductId" UUID NOT NULL,
    "genericName" TEXT NOT NULL,
    "brandName" TEXT,
    "strength" TEXT NOT NULL,
    "form" "DosageForm" NOT NULL,
    "defaultRoute" TEXT NOT NULL,
    "dispensingUnit" TEXT NOT NULL,
    "nafdacNumber" TEXT,
    "nafdacVerified" BOOLEAN NOT NULL DEFAULT false,
    "controlled" BOOLEAN NOT NULL DEFAULT false,
    "formularyStatus" "FormularyStatus" NOT NULL DEFAULT 'FORMULARY',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MedicationProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationFrequency" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "timesPerDay" DECIMAL(5,2),
    "status" "ClinicalRuleStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicationFrequency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "encounterId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "prescriberId" UUID NOT NULL,
    "status" "PrescriptionStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "signedAt" TIMESTAMPTZ(3),
    "contentHash" TEXT,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionItem" (
    "id" UUID NOT NULL,
    "prescriptionId" UUID NOT NULL,
    "medicationId" UUID NOT NULL,
    "dose" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "frequencyId" UUID NOT NULL,
    "durationDays" INTEGER,
    "prn" BOOLEAN NOT NULL DEFAULT false,
    "quantity" INTEGER NOT NULL,
    "instructions" TEXT,
    "status" "PrescriptionItemStatus" NOT NULL DEFAULT 'PENDING',
    "quantityDispensed" INTEGER NOT NULL DEFAULT 0,
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMPTZ(3),
    "pharmacistNote" TEXT,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PrescriptionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispenseEvent" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "dispensedById" UUID NOT NULL,
    "dispensedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "counsellingGiven" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" TEXT NOT NULL,
    "movementId" UUID NOT NULL,
    "reversedAt" TIMESTAMPTZ(3),
    "reversedById" UUID,
    "reversalReason" TEXT,

    CONSTRAINT "DispenseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryProduct_sku_key" ON "InventoryProduct"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "StockLocation_branchId_code_key" ON "StockLocation"("branchId", "code");

-- CreateIndex
CREATE INDEX "InventoryLot_expiryDate_idx" ON "InventoryLot"("expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLot_productId_lotNumber_key" ON "InventoryLot"("productId", "lotNumber");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_idempotencyKey_key" ON "StockMovement"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StockMovement_lotId_locationId_occurredAt_idx" ON "StockMovement"("lotId", "locationId", "occurredAt");

-- CreateIndex
CREATE INDEX "StockMovement_productId_occurredAt_idx" ON "StockMovement"("productId", "occurredAt");

-- CreateIndex
CREATE INDEX "StockMovement_referenceType_referenceId_idx" ON "StockMovement"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "StockAdjustmentRequest_status_idx" ON "StockAdjustmentRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_ref_key" ON "StockCount"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountLine_countId_lotId_key" ON "StockCountLine"("countId", "lotId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequisition_ref_key" ON "PurchaseRequisition"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_ref_key" ON "PurchaseOrder"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_ref_key" ON "GoodsReceipt"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_idempotencyKey_key" ON "GoodsReceipt"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "MedicationProduct_inventoryProductId_key" ON "MedicationProduct"("inventoryProductId");

-- CreateIndex
CREATE INDEX "MedicationProduct_genericName_idx" ON "MedicationProduct"("genericName");

-- CreateIndex
CREATE UNIQUE INDEX "MedicationFrequency_code_key" ON "MedicationFrequency"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Prescription_ref_key" ON "Prescription"("ref");

-- CreateIndex
CREATE INDEX "Prescription_branchId_status_idx" ON "Prescription"("branchId", "status");

-- CreateIndex
CREATE INDEX "Prescription_patientId_createdAt_idx" ON "Prescription"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "PrescriptionItem_prescriptionId_idx" ON "PrescriptionItem"("prescriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "DispenseEvent_movementId_key" ON "DispenseEvent"("movementId");

-- CreateIndex
CREATE INDEX "DispenseEvent_itemId_idx" ON "DispenseEvent"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "DispenseEvent_idempotencyKey_lotId_key" ON "DispenseEvent"("idempotencyKey", "lotId");

-- AddForeignKey
ALTER TABLE "StockLocation" ADD CONSTRAINT "StockLocation_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InventoryProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InventoryProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequisition" ADD CONSTRAINT "PurchaseRequisition_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequisitionItem" ADD CONSTRAINT "RequisitionItem_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "PurchaseRequisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequisitionItem" ADD CONSTRAINT "RequisitionItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InventoryProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "PurchaseRequisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InventoryProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_poItemId_fkey" FOREIGN KEY ("poItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationProduct" ADD CONSTRAINT "MedicationProduct_inventoryProductId_fkey" FOREIGN KEY ("inventoryProductId") REFERENCES "InventoryProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_prescriberId_fkey" FOREIGN KEY ("prescriberId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "MedicationProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_frequencyId_fkey" FOREIGN KEY ("frequencyId") REFERENCES "MedicationFrequency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispenseEvent" ADD CONSTRAINT "DispenseEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PrescriptionItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispenseEvent" ADD CONSTRAINT "DispenseEvent_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispenseEvent" ADD CONSTRAINT "DispenseEvent_dispensedById_fkey" FOREIGN KEY ("dispensedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── Hand-written integrity rules (Phase 3) ─────────────

-- Stock can never go negative and movements are never zero.
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_nonnegative_chk" CHECK ("quantity" >= 0);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_nonzero_chk" CHECK ("quantity" <> 0 AND "balanceAfter" >= 0);
CREATE TRIGGER "StockMovement_append_only" BEFORE UPDATE OR DELETE ON "StockMovement"
  FOR EACH ROW EXECUTE FUNCTION hms_append_only();

-- Lots are never deleted.
CREATE TRIGGER "InventoryLot_no_delete" BEFORE DELETE ON "InventoryLot"
  FOR EACH ROW EXECUTE FUNCTION hms_append_only();

-- Dispense events: immutable except a one-time reversal marker.
CREATE OR REPLACE FUNCTION hms_dispense_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'DispenseEvent rows cannot be deleted'; END IF;
  IF OLD."reversedAt" IS NOT NULL
     OR NOT hms_only_columns_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY['reversedAt','reversedById','reversalReason']) THEN
    RAISE EXCEPTION 'Dispense events are immutable; record a reversal';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "DispenseEvent_guard" BEFORE UPDATE OR DELETE ON "DispenseEvent"
  FOR EACH ROW EXECUTE FUNCTION hms_dispense_guard();
ALTER TABLE "DispenseEvent" ADD CONSTRAINT "DispenseEvent_qty_chk" CHECK ("quantity" > 0);

-- Prescriptions: never deleted; once signed, the clinical content cannot change.
CREATE OR REPLACE FUNCTION hms_prescription_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Prescriptions cannot be deleted'; END IF;
  IF OLD."status" <> 'DRAFT'
     AND NOT hms_only_columns_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY['status','cancelledAt','cancelReason','updatedAt','version']) THEN
    RAISE EXCEPTION 'Signed prescriptions are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Prescription_guard" BEFORE UPDATE OR DELETE ON "Prescription"
  FOR EACH ROW EXECUTE FUNCTION hms_prescription_guard();

CREATE OR REPLACE FUNCTION hms_prescription_item_guard() RETURNS trigger AS $$
DECLARE parent_status text;
BEGIN
  SELECT "status" INTO parent_status FROM "Prescription" WHERE "id" = COALESCE(NEW."prescriptionId", OLD."prescriptionId");
  IF TG_OP = 'DELETE' THEN
    IF parent_status <> 'DRAFT' THEN RAISE EXCEPTION 'Items of a signed prescription cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF parent_status <> 'DRAFT' AND NOT hms_only_columns_changed(to_jsonb(OLD), to_jsonb(NEW),
       ARRAY['status','quantityDispensed','verifiedById','verifiedAt','pharmacistNote','cancelledAt','cancelReason','version']) THEN
    RAISE EXCEPTION 'The clinical content of a signed prescription cannot change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PrescriptionItem_guard" BEFORE UPDATE OR DELETE ON "PrescriptionItem"
  FOR EACH ROW EXECUTE FUNCTION hms_prescription_item_guard();
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_qty_chk"
  CHECK ("quantity" > 0 AND "quantityDispensed" >= 0 AND "quantityDispensed" <= "quantity" AND ("durationDays" IS NULL OR "durationDays" > 0));

-- Procurement quantities.
ALTER TABLE "RequisitionItem" ADD CONSTRAINT "RequisitionItem_qty_chk" CHECK ("quantity" > 0);
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_qty_chk"
  CHECK ("quantityOrdered" > 0 AND "quantityReceived" >= 0 AND "quantityReceived" <= "quantityOrdered" AND "unitCostKobo" >= 0);
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_qty_chk" CHECK ("quantity" > 0 AND "unitCostKobo" >= 0);
CREATE TRIGGER "GoodsReceipt_append_only" BEFORE UPDATE OR DELETE ON "GoodsReceipt"
  FOR EACH ROW EXECUTE FUNCTION hms_append_only();
CREATE TRIGGER "GoodsReceiptLine_append_only" BEFORE UPDATE OR DELETE ON "GoodsReceiptLine"
  FOR EACH ROW EXECUTE FUNCTION hms_append_only();
ALTER TABLE "StockAdjustmentRequest" ADD CONSTRAINT "StockAdjustment_nonzero_chk" CHECK ("quantityDelta" <> 0);
ALTER TABLE "InventoryProduct" ADD CONSTRAINT "InventoryProduct_reorder_chk" CHECK ("reorderLevel" >= 0 AND "reorderQuantity" >= 0);
