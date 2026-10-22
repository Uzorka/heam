import type { InventoryCategory } from "@prisma/client";

export const CATEGORY_LABEL: Record<InventoryCategory, string> = {
  PHARMACY: "Pharmacy",
  LAB_CONSUMABLE: "Lab consumable",
  MEDICAL_SUPPLY: "Medical supply",
  MATERNITY_THEATRE: "Maternity & theatre",
  OFFICE_MAINTENANCE: "Office & maintenance",
  ASSET: "Asset",
};

export const MOVEMENT_LABEL: Record<string, string> = {
  RECEIPT: "Received",
  DISPENSE: "Dispensed",
  DISPENSE_REVERSAL: "Dispense reversed",
  TRANSFER_OUT: "Transfer out",
  TRANSFER_IN: "Transfer in",
  ADJUSTMENT: "Adjustment",
  COUNT_ADJUSTMENT: "Count adjustment",
  CONSUMPTION: "Consumed",
};

export const LOCATION_KIND_LABEL: Record<string, string> = {
  MAIN_STORE: "Main store",
  PHARMACY: "Pharmacy",
  WARD: "Ward",
  LABORATORY: "Laboratory",
  THEATRE: "Theatre",
  QUARANTINE: "Quarantine",
};

export const PO_TONE = {
  DRAFT: "neutral",
  ISSUED: "accent",
  PARTIALLY_RECEIVED: "warning",
  RECEIVED: "success",
  CANCELLED: "outline",
} as const;
