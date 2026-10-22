# Operations workflows (Phase 1)

## Front desk: returning patient with appointment

1. _Front desk → Today_ or _Appointments_: find the booking → **Check in**.
2. Confirm payer (self-pay / HMO to verify / corporate), priority and that fees/deposit policy were explained → **Check in**.
3. Print the visit slip. The patient appears in _Visit queue_ as _Awaiting vitals_ (configurable).

## Front desk: new or walk-in patient

1. Search by MRN, phone or name first (press `/` anywhere).
2. **Register patient**: names, sex at birth, date of birth (or estimated age with source), contact, next of kin, privacy notice confirmation, SMS consent.
3. If the system shows _Possible existing record_, open the matches. Use the existing record if it is the same person; otherwise tick the confirmation - the pair is queued for medical records review.
4. **Check in** from the patient record.

## Emergency arrival

**Emergency** button → minimum details (e.g. "Unknown / Unidentified male ~40") → check in as _Emergency_. Treatment is never delayed for registration. Complete the registration later (_Patients → Provisional only_).

## Nurse

_Visit queue_ → **Open visit** → _Vitals & triage_: record vitals (units shown; leave blank anything not measured) and the presenting complaint with your acuity judgement → **Ready for doctor**. A wrong entry is marked _entered in error_ and re-recorded - values are never edited. Nursing notes are signed with your password. Nurses cannot take patients into consultation.

## Doctor

_Visit queue_ → _Ready for doctor_ → **In consultation** (adds you to the care team) → **Open visit**:

- _Notes_: start a Consultation (SOAP) draft, **Save draft** as you go, **Sign note** with your password. Corrections after signing: **Add addendum**.
- _Diagnoses_: provisional or confirmed, optional ICD-10 code, optionally on the long-term problem list.
- _Orders & results_: tick tests/studies, give the clinical indication, **Place orders** (a double click cannot duplicate them). Cancel only before the lab/imaging starts work.
- Results arrive in **Results to review**: open the visit and **Mark reviewed**. Critical results show a red banner that must be **acknowledged** (who was informed, how).

Then move to **Awaiting services / review** or **Ready to discharge**; the front desk closes the visit.

## Laboratory

_Laboratory_ worklist (STAT/urgent first) → open the request → **Record collection** (check two identifiers; print the label) → **Receive in lab** (or **Reject specimen** with a reason - the doctor is notified) → enter results → **Submit for verification**. A **different** scientist opens _To verify_ → **Verify & release** (password). After release, values change only through **Amend** (reason + password); the original stays on record and the doctor must review again. Attach analyser printouts or referral-lab reports and record their origin.

## Imaging

_Imaging_ worklist → **Schedule** / **Start examination** → findings and impression → **Sign report** (password). Corrections: **Issue amended report**. Attach exported images/reports; PACS is not connected.

## Clinical content approval

_Clinical catalogue_: propose reference ranges and vital-sign thresholds with their source; a **different** clinician with approval rights approves them. Only approved rules produce flags. Seeded values are placeholders and say so. Dose frequencies in _Medication catalogue_ follow the same rule.

## Prescribing (doctors)

Visit workspace → _Medications_: choose each medicine, dose, route, an **approved** frequency, days and the quantity to supply (a calculated figure is offered when the dose is a plain number - confirm or change it). If allergies are recorded, tick that you reviewed them. Enter your password to **Sign prescription**. Signed prescriptions cannot be edited: cancel an item (before dispensing) and prescribe again. Pharmacy queries arrive as notifications.

## Pharmacy

_Pharmacy_ worklist → open a prescription. Check the allergy banner, then **Verify** each item (or **Query prescriber** with the question). Dispense: pick the pharmacy location, leave the lot on _Earliest expiry first_ (or choose a lot), confirm the quantity (partial supply is allowed), tick counselling, **Dispense**. Expired, quarantined and recalled lots cannot be chosen. A double click or retry never issues stock twice. Returns on the same day: **Reverse**. If the rest will not be supplied, **Stop supplying** (the prescriber is told). Controlled drugs need the controlled-drug permission.

## Stores and procurement

- _Stock_: usable quantities, **Reorder** and **near expiry** badges, unusable stock. Open an item for lots, the ledger, **Transfer**, **Adjust** (goes for approval) and lot status (quarantine/recall; release needs an approver).
- _Procurement_: raise a **requisition** → someone else **approves** → **Create order** (supplier and unit costs from the quotation) → **Issue** → when goods arrive, open the order and **Record goods received** with lot numbers and expiry dates (quarantine anything doubtful).
- _Stock approvals_: approve or reject adjustments; **Start a count** for a location, enter counted quantities, **Submit**; a different person **Approves** and the variances post to the ledger.

## Cashier

_Cashier desk_ → **Open shift** (count the float). Bills with a balance are listed; or search the patient → _Account_. Open the invoice: each line shows its price source and the payer / patient split. **Take payment** (cash needs an open shift; POS and transfers need the slip or bank reference). Overpayments stay as patient credit; deposits can be recorded on the account and **Apply credit** later. Discounts and credit notes are requested here and approved by finance. Lines marked _needs resolution_ must be priced or confirmed as patient pay before **Finalise**. At the end of the day **Close shift** with the counted cash; finance approves the close.

## HMO officer

- Patient record → _Coverage_: **Add cover**, then **Record eligibility check** with the payer's reference (or **Check online** if a connector exists - failures stay "not verified").
- At check-in reception picks _HMO_ and the cover; if missed, change it from the visit's _Payer & billing_ panel (open charges are re-priced).
- _HMO desk_: visits with unclaimed payer charges → open the visit billing page → **Request pre-authorisation** when the tariff needs it; record **submitted**, then the payer's decision with the authorisation code.
- **Create claim** → open it → fix any listed problems → **Validate** → _Claims_ → **Batch & submit** → download the CSV and send it through the payer's channel. Record acknowledgements, queries, approvals or denials.
- _Remittances_: enter (or paste) each payment advice once; amounts are matched to claims line by line. Claims become _paid_ only here. Close claims with an unpaid balance only with finance approval.

## Finance

_Billing approvals_ for discounts, refunds and shift closes; _Price list_ for proposing prices (owner approves); _Payers & tariffs_ to activate verified contracts and approve tariffs; _Finance overview_ for revenue, collections, receivables and the posting journal.

## Medical records

_Duplicate review_: request a merge with evidence, or mark _not the same person_. A **different** records officer approves merges. Verify guardian links; reveal identity numbers only when needed (audited).

## Administrator

Setup checklist decisions; branches/departments/wards/beds/visit types; staff accounts (one-time setup links, never passwords); role assignment and temporary cover (max 31 days). Role permission changes are proposed here and approved by someone else.

## Compliance

_Audit trail_ filters and integrity verification; _Emergency access review_ for every break-glass event.
