# Incident response

## Triggers

Suspected unauthorised access, lost device with active session, audit chain failure, data sent to the
wrong party, ransomware/outage, break-glass review marked _concern_.

## Immediate steps

1. **Contain**: suspend affected accounts (Staff & access → Change status ends all sessions); rotate exposed credentials; isolate systems if needed.
2. **Preserve evidence**: do not modify the database; snapshot it; export the relevant audit trail range; record times.
3. **Assess**: which records, which people, what data categories (health data is sensitive personal data), how many subjects.
4. **Notify**: hospital data protection officer and management immediately. Under the NDPA 2023 personal data breaches likely to risk data subjects must be reported to the Nigeria Data Protection Commission within 72 hours and affected subjects informed where high risk - confirm exact obligations with legal counsel.
5. **Recover**: restore from backup if integrity is in doubt (see Backup & restore); verify audit chain.
6. **Review**: root cause, fixes, training; update this runbook.

## Downtime procedure (24-hour operations)

- Switch to paper registration, triage, medication and observation forms (pre-printed, numbered).
- Record a downtime log with start/end times.
- After recovery, back-enter records with the original event time noted in the record and a "back-entered" remark; reconcile MRNs for anyone registered on paper.
- Emergency care must never wait for the system.
