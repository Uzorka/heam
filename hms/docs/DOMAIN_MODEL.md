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

## Planned (Phases 2–6)

| Phase | Entities                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2     | TriageRecord, VitalSign (with units), ClinicalNote, ClinicalNoteVersion (append-only, signed addenda), Diagnosis, CarePlan, ServiceOrder, LabTestDefinition, LabOrder, LabSpecimen, LabResult, LabResultVerification, ImagingOrder, ImagingReport, Document (S3 adapter)                                                                                                                                                                     |
| 3     | MedicationCatalogueItem, Prescription, MedicationOrder, DispenseEvent, MedicationAdministration, InventoryProduct, InventoryLot, StockLocation, StockMovement (ledger), StockTransfer, StockCount, Supplier, PurchaseRequisition, PurchaseOrder, GoodsReceipt                                                                                                                                                                                |
| 4     | ServiceCatalogueItem (effective-dated prices), InsurancePartner, InsurancePlan, InsuranceTariff, PatientCoverage, EligibilityCheck, CoverageDecision, Preauthorization(+Event), Claim, ClaimItem, ClaimStatusEvent, ClaimAttachment, Remittance, ClaimReconciliation, Invoice, InvoiceItem, Payment, PaymentAllocation, Refund, CreditNote, CashierShift, FinancialPosting, LedgerAccount, JournalEntry, JournalLine, IdempotencyKey, Outbox |
| 5     | PregnancyEpisode, AntenatalVisit, PregnancyDatingEvent, LabourEpisode, DeliveryRecord, NewbornRelationship, PostnatalVisit, Admission, BedAssignment (exclusion constraint), BedStatusEvent, WardObservation, DischargeRecord                                                                                                                                                                                                                |
| 6     | Employment, ProfessionalCredential, Shift, Attendance, LeaveRequest, PayrollRun, Payslip, PortalAccount links, IntegrationCredentialReference, export logs                                                                                                                                                                                                                                                                                   |

`docs/DATA_DICTIONARY.md` and an ERD will be generated from the schema once Phase 2 entities land.
