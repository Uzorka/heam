# Hospital setup checklist

Facts below were gathered from public sources and are **not** treated as true. Each appears in
_Administration → Setup checklist_ where an authorised person records a decision (name and time are
audited).

| Item                                | Public value                                          | Source                     | Status                                        |
| ----------------------------------- | ----------------------------------------------------- | -------------------------- | --------------------------------------------- |
| Hospital name                       | Aduraking Hospital and Maternity                      | Facility registry, website | Awaiting approval                             |
| Tagline                             | "Your Health, Our Priority."                          | adurakinghospital.com      | Awaiting approval                             |
| Main campus address                 | 90 Lagos Road, Haruna, Ikorodu, Lagos                 | Facility registry          | Awaiting approval                             |
| Main campus beds / clinical staff   | 9 / 18                                                | Facility registry          | Unknown - **not** used as configured capacity |
| Annex                               | Listed at the same address; 10 beds / 17 staff        | Facility registry          | Unknown - not combined with main campus       |
| 1 Ifesowapo Street, Olosogbo Agbede | Possible address                                      | One HMO directory          | Unknown - not a branch                        |
| Phone / email                       | 0704 932 2369 / adurakinghospital@gmail.com           | Facility registry          | Unknown                                       |
| HMO listings                        | Hygeia, Reliance Health (Alafia), Fountain Healthcare | Provider directories       | Listing ≠ contract; nothing activated         |
| Logo                                | —                                                     | —                          | Upload approved logo (never fabricated)       |

## Decisions the hospital must make

- Confirm branches and which are operational; replace DEMO wards/beds with the real layout.
- Departments, visit types, consultation lengths, queue entry stage.
- Staff list, role assignments, who approves role changes, merges and break-glass reviews.
- Privacy notice wording and version; lawful bases per processing purpose (NDPA 2023, legal review).
- Retention schedule (record types, periods, destruction approval) - retention workflows stay disabled until approved.
- Clinical content: the seeded lab reference ranges and vital-sign thresholds are **placeholders** (DRAFT). The laboratory director / medical director must validate them against the hospital's analysers and population and approve them in _Clinical catalogue_ (approver ≠ author). Until then results and vitals are shown without flags.
- Triage acuity categories (Immediate … Non-urgent) are a placeholder scale; confirm or replace with the hospital's approved triage system.
- SOAP note headings need medical director sign-off before customisation.
- Decide whether nurses may collect specimens (currently a laboratory permission) and whether lab results always need a second verifier (setting, default on).
- Imaging: confirm modalities actually offered on site; PACS/DICOM integration needs vendor details.
- Formulary: replace the DEMO medicines with the hospital's list; record NAFDAC numbers and mark them verified only after checking the NAFDAC register; decide which items are controlled and who holds controlled-drug dispensing rights.
- Dose frequencies: the seeded list carries a DEMO approval for local testing only. Pharmacy and the medical director must review the list and approve it under their own names before go-live.
- Stock: real stores, pharmacies and quarantine locations per branch; reorder levels; near-expiry window (setting, default 90 days); whether pharmacists may verify their own prescriptions (setting, default no); opening stock entered via goods receipts or approved adjustments, not edited directly.
- Suppliers and approval chain for requisitions, stock adjustments and counts.
- Prices, tariffs, HMO contracts and rules (Phase 4) - entered and approved by finance/HMO officers.
- Payroll policies (Phase 6) - reviewed by a payroll specialist against current Nigerian law.
