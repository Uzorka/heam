# DPIA preparation notes

Input for the hospital's Data Protection Impact Assessment under the Nigeria Data Protection Act 2023
(NDPA). These notes describe what the software does; the lawful bases, retention periods and the
assessment itself must be decided by the hospital's Data Protection Officer and legal adviser.

## Processing activities

| Activity                        | Data subjects         | Categories                                                        | System location                    |
| ------------------------------- | --------------------- | ----------------------------------------------------------------- | ---------------------------------- |
| Registration and identification | Patients, next of kin | Identity, contact, identity numbers (encrypted), guardians        | Patients                           |
| Clinical care                   | Patients              | Health data (special category): notes, results, prescriptions     | Encounters, lab, imaging, pharmacy |
| Maternity and newborn records   | Mothers, babies       | Pregnancy, delivery, newborn records; guardian links              | Maternity, wards                   |
| Billing and insurance           | Patients, payers      | Charges, payments, HMO membership, claims (minimum clinical data) | Billing, HMO                       |
| Patient portal                  | Patients, guardians   | Released results and documents, appointments                      | Portal                             |
| Employment and payroll          | Staff                 | Employment, credentials, rosters, attendance, leave, pay, bank    | HR, payroll                        |
| Security and audit              | Staff, portal users   | Sign-ins, IP addresses, actions                                   | Audit trail                        |

## Questions the hospital must answer

1. Lawful basis for each activity (e.g. provision of health care; contract of employment; legal obligation).
2. Retention period per record type and the destruction procedure (the software keeps records; it does not auto-delete).
3. Who may be a guardian with portal access, and how identity is verified before linking.
4. Which results may be released to the portal and when (e.g. only after discussion for sensitive results).
5. Processors and transfers: hosting provider, storage region, SMS/email providers when enabled, payment providers.
6. Data-subject requests: who handles access, rectification and objection requests and in what time.
7. Breach notification procedure (see `INCIDENT_RESPONSE.md`).

## Risk-reducing features available

- Role-based, branch-scoped access with care-relationship rules and break-glass review.
- Minimum necessary views (HMO, laboratory and HR staff do not see charts; reports are aggregated).
- Encryption of identity numbers, bank account numbers and MFA secrets at field level.
- Append-only, hash-chained audit trail of views, changes, exports and denials.
- Portal shows only clinician-released content; guardians only through verified links.
- Exports permissioned, watermarked and audited.

## Gaps to plan for

- No automated retention / anonymisation jobs.
- No in-app data-subject request workflow; requests are handled by medical records using the patient record and audit trail.
- Integrations (SMS, email, payers, national exchanges) are disabled; each needs its own assessment before enabling.
