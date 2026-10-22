# Aduraking HMS - task tracker

Last updated: 22 Oct 2026 (end of Phase 6).

## Phase 1 - Foundation ✅

- [x] Next.js 15 / React 19 / TypeScript strict / Tailwind / Prisma 6 / PostgreSQL 16 project in `hms/`
- [x] Migration with DB-level integrity: clinician double-booking exclusion constraint, one open visit per patient/branch, append-only audit & queue triggers, check constraints
- [x] Auth: Argon2id, DB sessions (idle + absolute expiry, revocation), lockout + IP rate limit, TOTP MFA enrolment/verification, password reset tokens (single use), admin-issued setup links
- [x] RBAC: 110 permissions, 21 role templates, branch/all-branch scope, effective dates, temporary cover (≤31 days), MFA-gated privileged roles, no self-grants, two-person role-change approval with risk notes
- [x] Hash-chained, append-only audit trail + viewer + integrity verification; denials audited; patient views audited
- [x] Hospital configuration: organisation, branches (verification-gated activation), departments, wards, beds, visit types, typed system settings, setup checklist of unverified public facts
- [x] Patient registry: registration (full + emergency/provisional), explainable duplicate detection, two-person merge, encrypted identifiers with audited reveal, allergies (reported vs clinician-verified, entered-in-error), consents (superseding history), contacts, guardian links with independent verification, status (inactive/deceased), optimistic locking, timeline
- [x] Scheduling: booking, reschedule (linked), cancel, no-show, authorised overlap override, day view by clinician
- [x] Check-in (appointment or walk-in), visit queue state machine with role-gated transitions, care-team assignment, printable slip, 30 s safe polling
- [x] Dashboards: executive (aggregated, defined metrics, chart + table alternative), front desk, clinician, pending approvals; no placeholder numbers
- [x] Break-glass emergency access with review queue; clinical access rule (care team / branch-wide / break-glass) ready for Phase 2
- [x] UI shell: permission-built navigation, branch selector, global patient search (`/`), light/dark, mobile drawer, accessible forms with error summaries, toasts only after server confirmation
- [x] Fictional seed (22 staff, 19 patients incl. duplicate pair, twins, emergency, guardian link, live queue, history)
- [x] Docs: README, architecture, domain model, plan, permissions matrix (generated), setup & go-live checklists, security/privacy, deployment, backup/restore, incident response, operations
- [x] CI workflow (`.github/workflows/hms-ci.yml`)

### Test status

- Unit: 46 tests (money, time/Lagos, phone, MRN check digit, duplicate scoring, queue state machine, RBAC template invariants, env fail-safe, encryption, redaction, audit hash, password policy)
- Integration (real PostgreSQL): 36 tests (access control, registry, merges, identifiers, scheduling concurrency, check-in concurrency, full journey, auth/lockout/sessions/reset, audit chain & immutability, break-glass)
- E2E (Playwright, production build): 9 tests incl. register → duplicate warning → book → check in → nurse → doctor; access denials; security headers; phone + tablet layouts

### Known issues / notes

- `npm audit` advisories are in build tooling (PostCSS bundled by Next 15.5, Prisma CLI config dependency); none in runtime request paths identified. Re-check when upgrading to Next 16 / Prisma 7.
- No group-level `loading.tsx` (Next 15.5 navigation stall, see `app/(app)/layout.tsx`).
- `/patients/new` client bundle is large (~195 kB) because of full phone metadata; consider server-side normalisation only.
- Dev/test databases: integration tests are non-destructive; drop/recreate `hms_test` manually if it grows.
- Logo upload waits for the Phase 2 document storage adapter.

## Acceptance criteria (prompt §29)

| #     | Criterion                                                       | Status                                                                        |
| ----- | --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1     | Reception cannot read clinical notes                            | ✅ integration + E2E (reception denied notes and charts)                      |
| 2     | HR no PHI; clinicians no payroll                                | ✅ integration + E2E                                                          |
| 3     | Multiple scoped roles; revocation immediate                     | ✅                                                                            |
| 4     | Branch / direct URL restriction                                 | ✅                                                                            |
| 5     | Duplicates never silently merged                                | ✅                                                                            |
| 6     | Idempotent payment callback                                     | ✅ integration (concurrent duplicate delivery posts once)                     |
| 7     | Concurrent bed assignment                                       | ✅ integration (concurrent moves: one wins; DB exclusion constraint)          |
| 8–9   | Dispensing lot accuracy; expired lots blocked                   | ✅ integration (idempotent + concurrent) + E2E                                |
| 10–11 | Verified results / signed notes immutable with amendments       | ✅ integration (DB triggers; signed amendments supersede)                     |
| 12–15 | HMO patient-pay, claim vs preauth, remittance, effective tariff | ✅ integration + E2E (HMO flow to reconciled remittance)                      |
| 16    | Pregnancy & newborn (twins) linked records                      | ✅ integration + E2E (twins: two baby records linked to mother)               |
| 17    | Cancelled orders not chargeable                                 | ✅ integration (charge voided in same transaction; finalised bills protected) |
| 18    | Critical result acknowledgement                                 | ✅ integration (attributed acknowledgement)                                   |
| 19    | Lagos time & kobo money                                         | ✅ unit                                                                       |
| 20    | Guardian sees only approved dependant documents                 | ✅ integration + E2E (released items of verified dependants only)             |
| 21    | Sensitive downloads/exports permissioned & logged               | ✅ integration + E2E (export.data, watermark, audited denials; FHIR export)   |
| 22    | URL manipulation cannot bypass record rules                     | ✅                                                                            |
| 23    | Broken connector never marks eligibility verified               | ✅ integration (missing, failing and malformed connectors)                    |
| 24    | Core screens on phone/tablet                                    | ✅ E2E @mobile (front desk, ward board, self-service, portal)                 |
| 25    | Production fails safely without secrets                         | ✅ unit + observed                                                            |

## Phase 2 - Clinical, laboratory, imaging, documents ✅

- [x] Migration `phase2_clinical` with DB immutability triggers (signed notes, verified results, signed reports, vitals, triage), append-only history tables, plausibility CHECKs, one approved threshold per vital, one current verified result per component, order/catalogue consistency checks
- [x] Clinical access model: current-visit access for staff on duty in the branch; full history with care relationship / branch-wide / break-glass; documenting care joins the care team; chart and visit views audited
- [x] Encounter workspace (`/encounters/[id]`): summary, vitals & triage, notes, diagnoses, orders & results; queue stage moves from the workspace
- [x] Clinical notes: SOAP / progress / nursing / procedure templates, versioned drafts with conflict detection, unsaved-change warning, password-confirmed signing with content hash, addenda, discard (kept), others' drafts hidden
- [x] Vitals with units, BMI only from valid inputs, entered-in-error corrections; triage with staff-assigned acuity
- [x] Diagnoses: provisional / confirmed / refuted, resolved / entered-in-error, optional ICD-10, problem list
- [x] Orders: lab, imaging, procedure, referral; idempotent placement; duplicate-open-order guard; cancellation only before work starts; clinician result review
- [x] Laboratory: worklists, accession numbers, QR specimen labels, receive/reject (orderer notified), typed result entry, flags only from approved ranges (sex/age aware), independent password-confirmed verification (setting), return for correction, critical-result alerts with attributed acknowledgement, signed amendments that supersede (clinician must re-review), turnaround metric
- [x] Imaging: worklist, scheduling, report drafts, signed reports, amended reports
- [x] Documents: local/S3 storage adapter, signature-based type check, 10 MB limit, scan hook, authorised + audited downloads, void instead of delete
- [x] Clinical catalogue admin: lab tests & components, imaging studies, reference ranges and vital thresholds with draft → approval by a different clinician
- [x] Results inbox, critical alerts, dashboard tiles (results to review, lab queues, lab TAT), notification texts without clinical content
- [x] Patient record "Clinical" tab (history) with restricted state and break-glass entry point
- [x] Release-time permission sync (`npm run db:sync-permissions`) - new permissions `clinical.rules.approve`, `clinical.results.review`
- [x] Seed: 8 lab tests, 6 imaging studies, DRAFT placeholder ranges/thresholds, demo clinical activity, second lab scientist

### Phase 2 test status

- Unit: +8 (range selection, numeric/coded flags, strict parsing, vital flags, BMI)
- Integration: +16 (clinical access, note immutability/addenda, drafts privacy, vitals correction & DB guards, approval of thresholds, diagnoses, order idempotency, cancellation rules, full lab journey, unflagged without ranges, result immutability & amendment, critical acknowledgement, specimen rejection, imaging report immutability & amendment, document permissions/audit/type checks)
- E2E: +1 (nurse vitals → doctor signed note → lab order → collection/receipt/result → same-person verification refused → second scientist verifies → doctor reviews → reception blocked)
- Totals at end of Phase 2: 105 unit + integration, 10 E2E - all passing

### Known limitations after Phase 2

- No PACS/DICOM, no analyser interfaces (manual entry / file attachment).
- Malware scanner not bundled (`scanUpload` hook); files are labelled "not virus-scanned".
- Note templates and the triage acuity scale are code-defined placeholders pending medical director approval; no template editor yet.
- No medication orders yet (Phase 3 prescribing); allergies are displayed but no interaction engine exists (by design until a validated knowledge base is configured).
- Results are not yet released to the patient portal (Phase 6).
- Specimen collection is a lab permission; nurse collection requires a role change if the hospital wants it.

## Phase 3 - Pharmacy, inventory, procurement ✅

- [x] Migration `phase3_pharmacy_inventory`: stock balances with a non-negative CHECK, append-only stock ledger and goods receipts, lots never deleted, dispense events immutable except a one-time reversal marker, signed prescriptions immutable (trigger), quantity CHECKs
- [x] Stock ledger service: every change goes through `postMovement` (row lock, no negative stock, balance-after recorded); FEFO allocation over usable lots only
- [x] Medication catalogue linked 1:1 to stock items (generic/brand, strength, form, route, dispensing unit, NAFDAC number recorded as unverified, controlled flag, formulary status)
- [x] Dose frequencies as clinical content: DRAFT → APPROVED by a different clinician; only approved frequencies can be prescribed
- [x] Prescribing from the visit workspace (_Medications_ tab): multiple medicines, suggested quantity the prescriber must confirm, allergy acknowledgement when allergies are recorded, password signature with content hash; cancel undispensed items; no fabricated interaction checks
- [x] Pharmacy worklist and prescription page: verify or query (prescriber notified), independent verification setting, dispensing with FEFO or a chosen lot, partial fills, controlled-drug grant, counselling flag, idempotency key per dispense, same-day reversal, stop supplying the balance
- [x] Stock pages: usable stock, reorder alerts, near-expiry (setting) and unusable stock, product lots and ledger, quarantine/recall/release, transfers (unusable lots only into quarantine)
- [x] Procurement: suppliers, requisitions approved by someone else, purchase orders (draft → issued → received), goods receipts creating lots (expiry required when tracked; expired goods refused; quarantine on receipt), idempotent receipts
- [x] Two-person stock adjustments and cycle counts (snapshot, count entry, approval posts variances)
- [x] Dashboard approvals for frequencies, requisitions, adjustments and counts (and fixed: the card no longer hides when only clinical rules are pending); notification texts for lab, imaging and pharmacy events
- [x] Patient chart shows medication history with dispensed lots
- [x] New permission `inventory.transfer` (synced to template roles at release); settings `pharmacy.requireIndependentVerification`, `inventory.nearExpiryDays`
- [x] Seed: 10 generic medicines, 4 supplies, demo store/pharmacy/quarantine locations, fictional supplier, lots including near-expiry, expired and quarantined, a pending prescription and requisition; frequencies carry a clearly labelled DEMO approval

### Phase 3 test status

- Unit: +2 (quantity suggestion)
- Integration: +19 (signed-prescription immutability, draft frequencies refused, allergy acknowledgement and password, non-prescribers refused, approval separation, verification rules and queries, AC8 single update of the FEFO lot under retries and concurrent retries, AC9 expired / expiring-today / quarantined / recalled lots refused, partial fills and multi-lot FEFO, concurrent last-stock dispenses, controlled drugs, reversal, cancellation/closing, requisition → PO → receipt idempotency and over-receipt, quarantine release, transfers, adjustments and counts)
- E2E: +2 (prescribe → verify → dispense skipping the expired lot; stock alerts and pharmacy access denied to a prescriber)
- Totals at end of Phase 3: 55 unit + 71 integration, 12 E2E - all passing (E2E suite run twice back to back)

### Known limitations after Phase 3

- Substitution is not a pharmacy action: a different product needs the prescriber to cancel and re-prescribe (keeps the signed record truthful). Pack-size conversions are not modelled; each medicine has one dispensing unit.
- No drug-interaction or dose-range checking (no validated knowledge base configured).
- Medication administration records (MAR) are deferred to Phase 5 with admissions.
- Dispensing is not yet charged; billing arrives in Phase 4.
- Count approval posts the variance against the snapshot quantity; counts should be done when the location is quiet.

## Phase 4 - Billing, payments, HMO and claims ✅

- [x] Migration `phase4_billing_hmo`: effective-dated cash prices and payer tariffs (exclusion constraints, approved rows immutable), charge split CHECKs, charges/invoices never deleted, finalised invoices lock their charges, payments immutable except status/reversal, append-only allocations, provider events, eligibility checks, pre-auth/claim histories and remittances, one open shift per cashier, one live claim line per charge, balanced append-only journal (deferred constraint trigger)
- [x] Service catalogue linked to lab tests, imaging studies, visit types and stock items; prices proposed by finance and approved by the owner (two people); bills use the price in force on the service date
- [x] Coverage decision per charge with visible source: payer tariff + co-pay, excluded / lapsed cover / inactive payer = explicit patient pay, unmapped tariff or missing price held for resolution (invoice cannot be finalised until resolved)
- [x] Automatic, idempotent charges at check-in (consultation), order placement and dispensing; order cancellation and dispense reversal void them in the same transaction; a charge on a finalised invoice blocks silent cancellation
- [x] Invoices (open → finalised), manual charges, discounts / credit notes / write-offs with second-person approval, printable invoice and receipt
- [x] Cashier shifts (float, expected vs counted cash, approval), cash/POS/transfer payments with idempotency keys, deposits and credit, apply credit, refunds (request → approve → pay out), reversal of payments recorded in error
- [x] Online payment adapter (Paystack-style signed webhook) disabled until configured; verified callbacks confirm exactly once
- [x] Payers (three directory-listed HMOs seeded as pending verification), plans, tariffs, activation only with contract evidence; patient cover; manual eligibility with evidence; connector eligibility that records failures as not verified
- [x] Pre-authorisation workflow (draft → submitted → queried / approved / partly approved / rejected / expired / cancelled) with auth codes; approval re-links charges
- [x] Claims from visits (deduplicated), validation (diagnosis, pre-auth, active payer), batches, Excel-friendly CSV export (audited, formula-safe), payer decisions, remittance import with line reconciliation, write-off on close (finance)
- [x] Simplified double-entry ledger: revenue at charge, receivables (patient / payer), deposits, payments, allocations, refunds, adjustments, remittances, write-offs
- [x] UI: cashier desk, patient account, invoice, receipts, billing approvals, price list, HMO desk (ageing, by-payer balances, visits to claim, contract expiry), payers/plans/tariffs, pre-authorisations, claims, remittances, finance overview; payer panel on the visit workspace and a non-clinical visit billing page for HMO/billing staff; Coverage tab on the patient record; cover selection at check-in
- [x] Seed: DEMO price list (labelled fictional), pending Hygeia / Reliance / Fountain listings, one fictional active payer with tariffs (one excluded, one pre-auth), demo patient cover

### Phase 4 test status

- Integration: +17 (effective-dated pricing, overlaps, unpriced services, payer split, AC12 patient pay, unmapped tariffs, payer activation, AC23 connectors, AC17 order charges, finalised-invoice protection, shifts/overpayment/refunds, credit and discounts, AC6 callbacks, ledger guards, AC13 pre-auth vs payment, AC14 duplicates and multiple remittances, write-off approval)
- E2E: +2 (HMO cover → check-in on cover → orders → pre-authorisation → co-pay collection → claim → batch → approval → remittance → paid; role checks on finance pages)
- Totals at end of Phase 4: 55 unit + 88 integration, 14 E2E - all passing (E2E suite run twice back to back)

### Known limitations after Phase 4

- Encounter and annual benefit limits are stored on plans but not yet enforced automatically; capitation is recorded but not reconciled.
- Corporate accounts use the payer model (scheme CORPORATE); there is no separate corporate statement run yet.
- Expenses, purchase payables and branch comparison reports are not built (finance overview covers revenue, collections, receivables and postings).
- Claim attachments and appeal letters are not generated; denial reasons and resubmissions are recorded.
- No live payer or payment integration exists (by design until agreements and credentials).

## Phase 5 - Maternity and inpatient wards ✅

- [x] Migration `phase5_maternity_inpatient`: one active pregnancy per mother (G/P plausibility), permanent dating events with one adopted EDD, ANC visits and MAR entries correctable only by entered-in-error markers, signed delivery and newborn records immutable, stillbirths carry no patient record, one current admission per patient, bed assignments with an exclusion constraint (no overlap) that can only be closed once, `ADMITTED` queue stage, `BED` charge source and ward-linked bed-day services
- [x] Pregnancy record: booking (gravida/para), dating by LMP / ultrasound / other with the calculated EDD shown as a proposal and adopted explicitly by a clinician, ANC visits with gestation from the adopted EDD and BP flags only from approved thresholds, close record without delivery
- [x] Delivery: password-signed record with mode, blood loss, placenta, perineum, complications; one newborn record per baby (birth order, outcome, sex, time, weight, Apgar); each live-born baby gets its own hospital number linked to the mother as verified guardian (twins: "Twin 1", "Twin 2"); optional rooming-in admission for babies when the mother is an inpatient
- [x] Postnatal checks for mother or a named baby
- [x] Admissions from an open visit (documentation continues on the same visit), bed assignment and ward moves with row locks and the exclusion constraint, beds to cleaning then ready, ward board, admission page
- [x] Discharge in three steps: clinician authorisation with signed summary → finance clearance (bed-day charges posted first; balance must be settled or an override recorded with reason) → completion (bed released, visit closed)
- [x] Medication administration record on the visit's Medications tab (given / held / refused / not available, reason required when not given), controlled drugs need a second nurse's credentials as witness
- [x] Patient record: Maternity tab with pregnancies and mother/baby links; visit workspace shows admission status or an Admit button
- [x] Seed: DEMO bed-day prices for the DEMO wards; demo patient Aisha Bello has a dated pregnancy at 28 weeks with three ANC visits
- [x] Role template changes (review before go-live): midwives may sign deliveries; finance can view admissions to clear them. Existing deployments apply these through the role-change approval workflow.

### Phase 5 test status

- Unit: +4 (EDD from LMP and ultrasound, gestation, bed nights)
- Integration: +8 (dating proposal vs adoption and immutability, implausible counts, AC16 twins with distinct linked records and rooming-in, stillbirth, signing rights, AC7 concurrent bed assignment, ward move and three-step discharge with bed-day charges, controlled-drug MAR witness)
- E2E: +1 (antenatal booking and dating → ANC visit → admission → bed assignment and ward move → twin delivery → mother and both babies discharged → beds cleaned)
- Totals at end of Phase 5: 59 unit + 96 integration, 15 E2E - all passing (E2E suite run twice back to back)

### Known limitations after Phase 5

- Partograph, labour observations chart and neonatal unit (NICU) workflows are not built; labour is documented in notes and the delivery record.
- No scheduled MAR (dose times are not generated from frequencies); administrations are recorded as given.
- Bed-day charges are posted at financial clearance per bed segment (nights to that day); a stay extended after clearance needs a manual charge.
- Babies' visits start as "payer not determined"; HMO enrolment of newborns is done by the HMO desk.

## Phase 6 - HR, payroll, portal, reporting, interoperability, hardening ✅

- [x] Migration `phase6_hr_portal`: rosters with a per-person no-overlap exclusion constraint, append-only attendance, leave date checks, employees and portal accounts never deleted, one approved basic pay component, one payroll run per branch-month, approved runs locked (trigger), payslip amount check; migration `payslip_insert_guard` also blocks adding or moving payslips in an approved run
- [x] HR: staff records (bank account encrypted, last 4 shown), credentials verified by someone other than the person who added them, employment status, duty roster by week, attendance (self or supervisor, double clock-in refused), leave with an approver who is neither the employee nor the requester
- [x] Payroll: pay components with source references, proposed and approved by different people; effective-dated pay items; payroll prepared and approved by different people; approved runs locked; no statutory rules invented
- [x] Self-service (_My work & pay_): clock in/out, shifts, leave requests, own approved payslips
- [x] Patient portal (separate layout, `PORTAL` logins redirected away from staff screens): own record and verified, current dependants only; clinician-released results and documents; appointments; audited views, downloads and denials. Staff create portal accounts from the patient record with a one-time setup link and revoke them; clinicians release/withdraw results and documents from the visit
- [x] Reports: visits, lab turnaround, admissions/discharges, diagnoses, deliveries, charges, collections, HMO claims - aggregated, branch-scoped, each with its own permission; CSV export needs `export.data`, is watermarked, formula-escaped and audited (denials too)
- [x] FHIR R4 export foundation: Patient, Encounter, vital-sign Observations (LOINC/UCUM), MedicationRequest; `/api/fhir/patients/[id]` needs `export.data` and a care relationship, audited
- [x] Hardening: axe-core accessibility scan of core screens in E2E (2 label-in-name fixes), mobile/tablet checks for self-service and portal, threat model, DPIA preparation notes, backup/restore dry run (recorded in `BACKUP_RESTORE.md`), dependency audit with non-breaking fixes applied
- [x] Role template changes (review before go-live): medical records manage portal accounts; owner, medical director and finance may export. Existing deployments apply these through the role-change approval workflow
- [x] Seed: five DEMO employees linked to demo staff, DEMO pay components (placeholder rates, labelled), an approved DEMO payroll run for last month, today's roster, portal login `patient@demo.aduraking.test` for Ngozi Okafor with one released result
- [x] Test fix: integration test phone numbers no longer collide across runs (caused an intermittent duplicate-patient failure)

### Phase 6 test status

- Unit: +4 (FHIR mappers)
- Integration: +7 (AC2 HR/clinician separation, encrypted bank details, roster overlap, leave approval, payroll approval separation and locking incl. payslip insert guard; AC20 portal release, unverified/revoked guardianship, portal users denied staff functions; AC21 export permission, watermark and audit; FHIR export permission and care relationship)
- E2E: +7 (HR separation, self-service clock-in and leave approved by HR, report export watermark and denial, portal released record and URL guessing, phone and tablet layouts, axe scans of staff screens and portal)
- Totals at end of Phase 6: 63 unit + 103 integration, 23 E2E - all passing (E2E suite run twice back to back)

### Known limitations after Phase 6

- Payroll has no built-in PAYE, pension or NHF calculations by design; percentage components are of basic pay only; no bank payment file export yet.
- Portal: no appointment requests, messaging or MFA for portal logins yet; results are shown as released, without patient-friendly explanations.
- No SMS/email delivery (adapters remain disabled until a provider is contracted).
- FHIR is export-only (no import, no national exchange connection); Observations cover vital signs only, not lab results.
- Remaining `npm audit` advisories need major upgrades (Next 16, Prisma 7).

## Continuation prompt for the next session

> Continue the Aduraking HMS in `hms/` on branch `claude/aduraking-hms`. Read `TASKS.md`, `docs/ARCHITECTURE.md`
> and `docs/DOMAIN_MODEL.md` first. Phases 1-6 are complete and green (unit, integration, E2E). Next work is go-live preparation
> (see `docs/HOSPITAL_GO_LIVE_CHECKLIST.md`) and the known limitations above. For any change: add a new Prisma migration (never edit applied ones), put all rules in `src/server/domains/*`
> services with `requirePermission`/`getClinicalAccess` checks and same-transaction `recordAudit`, expose them via
> `defineAction`, and build pages using the existing UI kit (`components/ui`, `components/forms/action-form`).
> Clinical notes and verified results must be append-only with signed amendments (DB triggers + tests). Keep
> clinical rules configurable and clinician-approved; never add autonomous diagnosis. Run `npm run typecheck`,
> `npm run lint`, `npm test`, `npm run test:integration`, `npm run build`, `npm run test:e2e` before each commit,
> update TASKS.md, and never run destructive database resets without explicit user consent.
