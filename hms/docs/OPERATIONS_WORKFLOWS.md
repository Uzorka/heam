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

_Visit queue_ → _Awaiting vitals_ → after vitals (recorded in Phase 2) move to **Ready for doctor**. Nurses cannot take patients into consultation.

## Doctor

_Visit queue_ → _Ready for doctor_ (or _My patients_) → **In consultation** (adds you to the care team) → **Awaiting services / review** or **Ready to discharge**. The front desk closes the visit.

## Medical records

_Duplicate review_: request a merge with evidence, or mark _not the same person_. A **different** records officer approves merges. Verify guardian links; reveal identity numbers only when needed (audited).

## Administrator

Setup checklist decisions; branches/departments/wards/beds/visit types; staff accounts (one-time setup links, never passwords); role assignment and temporary cover (max 31 days). Role permission changes are proposed here and approved by someone else.

## Compliance

_Audit trail_ filters and integrity verification; _Emergency access review_ for every break-glass event.
