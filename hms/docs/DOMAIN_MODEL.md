# Domain model

Source of truth: [`prisma/schema.prisma`](../prisma/schema.prisma) plus hand-written constraints in
`prisma/migrations/*/migration.sql`. Conventions: UUIDv4 ids, `timestamptz` UTC, money in integer
kobo, `version` columns for optimistic locking, `Restrict` on relations to health/financial records,
no hard deletes.

## Implemented (Phase 1)

| Area              | Entities                                                                                                                | Notes                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Organisation      | Organization, Branch, Department, Ward, Bed, VisitType                                                                  | Branch `status` + `verificationStatus`; DEMO flags on seeded wards/beds                             |
| Configuration     | SetupFact, SystemSetting, Sequence                                                                                      | Facts are UNKNOWN / AWAITING_APPROVAL / VERIFIED / REJECTED                                         |
| Identity & access | User, Role, Permission, RolePermission, UserRole, RoleChangeRequest, Session, PasswordResetToken, LoginAttempt          | UserRole: branch or all-branches scope, department, effective dates, delegation, revocation history |
| Security          | BreakGlassGrant, AuditEvent, Notification                                                                               | AuditEvent append-only + hash chain                                                                 |
| Patients          | Patient, PatientIdentifier, PatientContact, PatientAllergy, ConsentRecord, GuardianRelationship, DuplicatePatientReview | Identifiers encrypted; merges keep the losing record (`MERGED`, `mergedIntoId`)                     |
| Scheduling        | Appointment, Encounter, VisitQueueEvent, CareTeamAssignment                                                             | Exclusion constraint on clinician time ranges; one OPEN encounter per patient/branch                |

### Key state machines

- **Visit queue** (`domains/queue/state-machine.ts`): REGISTERED → AWAITING_VITALS → READY_FOR_DOCTOR →
  IN_CONSULTATION → AWAITING_SERVICES / AWAITING_REVIEW → READY_TO_DISCHARGE → COMPLETED; CANCELLED needs a reason.
  Entering or leaving clinical stages needs `clinical.note.write`.
- **Duplicate review**: OPEN → MERGE_REQUESTED → MERGED (approver ≠ requester), or NOT_DUPLICATE.
- **Role change**: PENDING → APPROVED / REJECTED / CANCELLED (approver ≠ requester; stale role version rejected).
- **Appointment**: BOOKED → CHECKED_IN → COMPLETED; BOOKED → CANCELLED / NO_SHOW (only after start) / RESCHEDULED (links to new booking).

## Implemented (Phase 2)

| Area          | Entities                                                                                            | Notes                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documentation | ClinicalNote, ClinicalNoteVersion                                                                   | Drafts versioned on save; SIGNED rows immutable (trigger); corrections are ADDENDUM notes; DISCARDED drafts kept                                    |
| Observations  | VitalSign, TriageRecord, VitalThreshold                                                             | Units in column names; plausibility CHECKs; corrections only by entered-in-error marker (trigger); thresholds DRAFT → APPROVED by another clinician |
| Diagnoses     | Diagnosis                                                                                           | Provisional / confirmed / refuted; active / resolved / entered-in-error; optional ICD-10; problem-list flag                                         |
| Orders        | ServiceOrder, OrderStatusEvent                                                                      | One orderable item per row; `(requestGroupId, itemIndex)` unique = idempotency; per-kind state machine; no cancellation after work starts           |
| Laboratory    | LabTestDefinition, LabTestComponent, LabReferenceRange, LabSpecimen, LabResult, CriticalResultAlert | Accession numbers; FINAL results immutable except supersession; one current FINAL per component; amendments link to the original                    |
| Imaging       | ImagingStudyDefinition, ImagingReport                                                               | Signed reports immutable; amended reports reference the original                                                                                    |
| Documents     | Document                                                                                            | Bytes in object storage under random keys; type by signature; voided, never deleted                                                                 |

| Stock | InventoryProduct, StockLocation, InventoryLot, StockBalance, StockMovement | Balance per lot/location (CHECK ≥ 0) changed only with a ledger row in the same transaction; ledger append-only; lots unusable from expiry date, or when QUARANTINED/RECALLED |
| Stock control | StockAdjustmentRequest, StockCount, StockCountLine | Two-person approval; count variances posted against the snapshot |
| Procurement | Supplier, PurchaseRequisition, RequisitionItem, PurchaseOrder, PurchaseOrderItem, GoodsReceipt(+Line) | Requisition approver ≠ requester; received ≤ ordered (CHECK); receipts append-only and idempotent |
| Medicines | MedicationProduct, MedicationFrequency | Each medicine is one stock item; frequencies are clinician-approved content |
| Prescribing | Prescription, PrescriptionItem, DispenseEvent | Signed prescriptions immutable (trigger) apart from status; dispensed ≤ prescribed (CHECK); dispense events immutable except one reversal marker |

| Prices | ServiceItem, ServicePrice | Approved prices effective-dated, non-overlapping (exclusion constraint), immutable except closing |
| Payers | Payer, PayerPlan, PayerTariff, PatientCoverage, EligibilityCheck | Payers pending until activated with evidence; tariffs per payer/plan/service, effective-dated; eligibility evidence append-only |
| Billing | Charge, Invoice, InvoiceAdjustment | One charge per source event (unique); decision code + note; unpriced charges carry no amounts; finalised invoices lock charges |
| Payments | Payment, PaymentAllocation, PaymentProviderEvent, Refund, CashierShift | Payment facts immutable; allocations append-only and never exceed the balance; provider events stored once |
| HMO workflow | Preauthorization(+Item, Event), Claim, ClaimLine, ClaimEvent, ClaimBatch, Remittance(+Line) | One live claim line per charge; PAID only via remittance; paid ≤ claimed (CHECK) |
| Ledger | LedgerAccount, JournalEntry, JournalLine | Balanced at commit; append-only; unique per (source, kind) for exactly-once posting |

| Maternity | PregnancyEpisode, PregnancyDatingEvent, AntenatalVisit, DeliveryRecord, NewbornRecord, PostnatalVisit | Mother, pregnancy, delivery and each baby are distinct records; babies are Patients linked by NewbornRecord and a verified GuardianRelationship |
| Inpatient | Admission, BedAssignment, MedicationAdministration | Admission continues the visit; bed assignments cannot overlap (exclusion constraint); discharge = authorisation → clearance → completion |

Prescription item states: `PENDING → (QUERIED) → VERIFIED → PARTIALLY_DISPENSED → DISPENSED`; `CANCELLED` before dispensing (prescriber) or for the
undispensed balance (pharmacy). A same-day reversal returns stock to the original lot and reopens the item.

Order states: LAB `ORDERED → SPECIMEN_COLLECTED → IN_PROGRESS → RESULTED → VERIFIED` (rejection returns to ORDERED; a verifier
can return RESULTED → IN_PROGRESS); IMAGING `ORDERED → (SCHEDULED) → IN_PROGRESS → RESULTED → VERIFIED`; PROCEDURE/REFERRAL
`ORDERED → COMPLETED`; any kind → CANCELLED only before work starts.

## Implemented (Phase 6)

| Area    | Entities                                                                                                                                                                    |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HR      | Employee (encrypted bank account, optional link to a staff User), ProfessionalCredential, RosterShift (no overlap per person), AttendanceRecord (append-only), LeaveRequest |
| Payroll | PayComponent (DRAFT → APPROVED, one basic), EmployeePayItem (effective-dated), PayrollRun (DRAFT → APPROVED, one per branch-month), Payslip (locked with its run)           |
| Portal  | PortalAccount (one PORTAL user ↔ one patient, revoked not deleted); `releasedToPortalAt` on ServiceOrder and Document                                                      |
| Export  | Reports are computed aggregates; FHIR R4 mappers (Patient, Encounter, vital-sign Observation, MedicationRequest) build export bundles; exports are audit events             |

Payroll run states: `DRAFT → APPROVED` (locked); a draft can be re-prepared. Leave: `PENDING → APPROVED | REJECTED`.

`docs/DATA_DICTIONARY.md` and an ERD will be generated from the schema once Phase 2 entities land.
