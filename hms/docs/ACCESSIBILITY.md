# Accessibility

Target: WCAG 2.1 level AA for staff screens and the patient portal.

## Automated checks

`tests/e2e/a11y.spec.ts` runs axe-core (WCAG 2.0/2.1 A and AA rules) on login, dashboard, patients,
queue, results, appointments, self-service, HR, roster, payroll, reports and the patient portal. Any
**serious** or **critical** violation fails the build. Phase 6 fixed two label-in-name issues in the top
bar (notification badge and account menu).

`tests/e2e/*.spec.ts` tagged `@mobile` check phone (Pixel 7) and tablet (Galaxy Tab S4) widths for
front desk, ward board, self-service and the portal, including no horizontal scrolling.

## Built-in practices

- Semantic headings, landmarks and a skip link; tables with headers.
- Every form control has a visible label; errors are announced next to fields.
- Status is never shown by colour alone (badges carry text).
- Touch targets at least 44 px on small screens.
- Light and dark themes.

## Not yet verified

- Manual screen-reader testing (NVDA, VoiceOver, TalkBack) on clinical workflows.
- Moderate/minor axe findings are not yet triaged.
- Printed documents (slips, payslips) have not been reviewed for accessibility.
