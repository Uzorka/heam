# Go-live checklist

Real patient data may only be entered after every item is signed off. Record name, role and date.

## Governance

- [ ] Hospital management go-live decision signed
- [ ] DPIA completed and reviewed (NDPA 2023); records of processing; DPO appointed/confirmed
- [ ] Privacy notice and consent wording approved; lawful bases confirmed
- [ ] Retention schedule approved
- [ ] Contracts: hosting, data processing agreements, support

## Configuration

- [ ] All setup checklist facts verified or rejected
- [ ] Branches confirmed; DEMO wards/beds replaced with real layout
- [ ] Staff accounts created from HR list; demo accounts **absent**; roles reviewed by management
- [ ] Two-step verification enrolled for all privileged users
- [ ] Clinical templates, reference ranges and dictionaries signed by named clinicians (Phase 2+)
- [ ] Prices/tariffs approved; HMO contracts verified and activated individually (Phase 4)

## Technical

- [ ] Production secrets in a secrets manager; keys backed up with dual control
- [ ] HTTPS, HSTS, DB encryption at rest, private networking
- [ ] Backups + successful restore test recorded; RPO/RTO agreed
- [ ] Monitoring/alerting with PHI scrubbing; on-call contacts
- [ ] Penetration test and remediation; dependency audit reviewed
- [ ] Migration of legacy data rehearsed and reconciled (counts, duplicates)

## People & process

- [ ] UAT by reception, nursing, doctors, records, admin (and later modules) with sign-off
- [ ] Training delivered; quick-reference guides at each desk
- [ ] Downtime paper forms printed; downtime drill completed
- [ ] Emergency care fallback confirmed: the system never blocks emergency treatment

## HR, payroll and portal (Phase 6)

- [ ] Delete all DEMO pay components and the DEMO payroll run from any non-local environment (never seed demo data there)
- [ ] Enter real pay components (basic, allowances, PAYE, pension, NHF, etc.) from authoritative sources with references; second-person approval
- [ ] Parallel-run at least one payroll month against the existing process and reconcile
- [ ] Policy for portal release of results (which results, after discussion?) approved by the medical director
- [ ] Guardian identity verification procedure for portal access to children's records approved by medical records / DPO
- [ ] Existing deployments: role-change requests for template updates (`export.data` for owner, medical director, finance; `portal.accounts.manage` for medical records)
