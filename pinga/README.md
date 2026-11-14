# Pinga

Office attendance and field sales visits for businesses whose staff use low-cost Android phones.

## What's here

| Folder | What it is |
| --- | --- |
| `web/` | The app people use (staff, reps, managers, owners). Plain HTML, CSS and JavaScript. No build step. |
| `supabase/migrations/` | The database: tables and the rules for who can see what. |
| `supabase/functions/accept-invite/` | Server code that turns an invite link into a phone + PIN login. |
| `tests/` | Database rule tests, unit tests and a browser walk-through of every screen. |
| `scripts/` | Local web server and the size check. |

There are no packages to install. You need Node.js 20+ and, for the database tests, PostgreSQL 15+.

## Run it on your computer

```
npm run dev          # opens on http://localhost:8080 (uses the STAGING Supabase project)
npm test             # every test, then the size check
```

Individual checks: `npm run test:unit`, `npm run test:db`, `npm run test:screens`, `npm run size`.
`test:screens` saves screenshots of every screen in `tests/screens/output/`.

## How logins work

- **Owners** sign up with email and password and get a 14-day trial.
- **Everyone else** is invited by phone number. The manager sends the invite link by WhatsApp; the person opens it and picks a 6-digit PIN. From then on they sign in with phone number + PIN. No SMS fees.
- **Forgot PIN:** the manager opens the person and taps "Create a new PIN link".
- One phone number belongs to one company. A manager can never reset the PIN of someone who works at another company.

## Clocking in (office attendance)

- Staff tap **Clock in**. The app takes a fresh GPS reading and one small selfie (under 50 KB), finds the nearest office, and saves it **on the phone first**. It is sent when there is signal: on opening the app, when signal returns, and every minute while open. The time saved is the moment of tapping.
- "3 waiting to send" shows under the button until everything is sent. Staff can't sign out while anything is waiting.
- Phones with the wrong clock are handled: the app learns the server's time whenever online.
- Nothing is blocked. Instead, the manager sees a flag on that clock-in: outside the office, weak GPS, possible fake location, impossible travel speed, phone clock changed, no photo.
- Lateness is worked out by the server from the company's working hours and grace minutes (Lagos time).
- New staff take one reference photo after setting their PIN (used for face checks in step 6).
- The app opens with no signal once it has been opened before (the "service worker" keeps its files on the phone).

Managers set up **Offices** (stand in the office and tap "Use my current location", or paste from Google Maps) and **Hours** (start, end, grace minutes, work days).

## Store visits (field sales)

Same layout and flow as the CHF Heron field sales tracker.

- **Today:** "Hi, Remi", a progress ring ("2 of 4 visits done today"), and My stores sorted **nearest first** (or A–Z), with the nearest unvisited store highlighted "go here next". Visited stores move to the bottom with "Visited 9:14 am".
- **Check in at a store:** fresh GPS + selfie, optional shelf photo (back camera) and note. Inside the store's area: "You're at the store". Outside: "Pick another store", or "Check in anyway (flagged)" after a warning.
- Saved on the phone first, like clock-ins. **History** shows the last 30 days.
- Managers add **Stores** (a name and address is enough; the first visit with good GPS saves the location, flagged for checking), set each rep's **visits per day**, and tick the **stores each rep covers**. Each rep's page shows recent visits with selfie, shelf photo, note and flags.

## Manager's Today page

Managers land on **Today**: everyone (office staff and sales reps) with their status for the day.

- **Statuses:** Present, Late (office staff, with minutes), No check-in (today), Absent (a past work day with no check-in), Leave, Off (also non-work days). A status set by a manager always wins and is marked "set by manager".
- **Filters:** All, No check-in, Late, Absent, Present, Leave · Off, with counts. Search when the list is long.
- **Bulk actions:** tick people (or "Select all shown") and tap Present, Absent, Leave or Off. With more than one person it asks first. **Clear** removes only statuses a manager set; clock-ins and visits are never changed.
- **Fix past dates:** pick any past date (not future ones). People aren't counted absent for days before they were added.

## Owner dashboard (Overview)

Owners land on **Overview**, the day in 10 seconds:

- **Right now:** present, late, not in, leave/off, and per office (staff are grouped by the office they clocked in at, otherwise their home office).
- **Field visits:** planned vs done, and assigned stores on a street map (green visited, grey not yet). The map (Leaflet 1.9.4, BSD licence, in `web/vendor/`) loads only on this screen; staff phones never download it.
- **Needs your attention:** staff late 3+ times in 2 weeks; reps whose visits dropped 30%+ week on week; flagged check-ins.
- **Lost time this month:** hours lost to lateness and absence, and in naira for people whose monthly pay is entered. **Pay is visible only to owners** (not managers, not staff).

**Setup** holds Offices, Stores, Working hours, Export register, and the evening email switch.

**Export register:** any period up to 3 months, as a real Excel file (written by `web/js/xlsx.js`, no library) or a printable page to save as PDF.

## Evening summary email

Every hour Supabase's scheduler calls the `daily-summary` function; after 7 pm (company time) each company's owner gets one short email: who was present, late, not in, store visits vs target, and flagged check-ins. A log stops it ever sending twice in a day. Owners can turn it off in Setup.

To switch sending on: create a free account at resend.com, make an API key, and add it in **Supabase → Edge Functions → Secrets** as `RESEND_API_KEY` (staging first, then live). Until a sending domain (e.g. usepinga.com) is verified in Resend, emails go from `onboarding@resend.dev` and only to the Resend account's own email address. Optional secret `SUMMARY_FROM` (e.g. `Pinga <summary@usepinga.com>`) once the domain is verified.

## Face check (AWS Rekognition, EU Ireland)

Every few minutes the `face-check` function compares new clock-in and visit selfies with each person's reference photo (AWS Rekognition CompareFaces, about $0.001 per check). **Nothing is ever blocked:** a clock-in or visit is saved straight away; the result arrives a few minutes later.

- **Each company sets how alike a selfie must be** (Setup → Face check, owner only; 50–99%, default **90%**). Lower it (e.g. 80%) if cheap or cracked phone cameras cause too many false flags. A new setting applies to selfies checked from then on.
- At or above the company's setting is a match. Below that: flag "Face didn't match (41% alike)". No face found: flag "No face in photo". Both count as "to check" on Today and face mismatches are listed in the owner's evening email.
- No reference photo yet: no AWS call (no charge); checked once they take one. AWS errors retry up to 3 times, then stop. Only the last 3 days are checked, so switching on never bills for an old backlog.
- Staff agree to the use of their photo on the reference photo screen (Nigeria Data Protection Act); the time is recorded. Managers can "Ask for a new reference photo".
- Requests to AWS are signed by our own code (`signV4` in `supabase/functions/face-check/handler.js`), tested against AWS's published example and AWS's own signer. No AWS library.

**Switched off until these Supabase secrets exist** (Pinga Staging → Edge Functions → Secrets): `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` = `eu-west-1`. Setup shows "Face check: Off/On". Use an AWS key whose only permission is `rekognition:CompareFaces`.

## Billing (Paystack)

- **Price:** per active, joined person per month, by module: Office Attendance per office staff member, Field Sales per sales rep. Owners and managers are free. **Placeholder prices ₦1,500 and ₦2,500** in `billing_prices` (migration `20261120000001_billing.sql`): confirm before going live.
- **Volume discounts** in `billing_discounts` (same migration family, `20261121000001_…`): a company with at least `min_people` billable people gets `percent_off` its whole monthly price; the highest tier it reaches applies. **Placeholder: 100+ people → 10% off.** Prices and discounts are the only two tables to edit (via SQL or the Supabase table editor); companies can't change them.
- **Paystack fees (paid by Pinga, live mode only):** 1.5% + ₦100 per local transaction; the ₦100 is waived under ₦2,500; fees are capped at ₦2,000. Test mode is free.
- **14-day free trial.** Paying during the trial starts the first paid month when the trial ends.
- **Paying:** Setup → Billing → "Pay ₦X with Paystack" opens Paystack's own checkout (card, transfer, USSD). A card is saved (masked; the Paystack code never leaves the server) and renewed automatically each month at the current team size (daily job, 07:10 Lagos, at most one attempt per company per day).
- **Every payment is checked with Paystack** (and must match the invoice amount in naira exactly) before it is marked paid. Paystack's webhook messages are accepted only with a valid signature.
- **Late payment never stops staff:** owners see "Payment due" (managers are asked to tell the owner).
- **Test mode only:** the `billing` function refuses a live key (`sk_live_…`) unless `ALLOW_LIVE_PAYMENTS=yes` is set.

**Built, but switched off until the key is saved.** Without `PAYSTACK_SECRET_KEY` nobody is charged, no company is ever marked "payment due", trials simply continue, and the app hides the Pay button and trial reminders (Billing says "Online payment isn't switched on yet"). The billing function reports on/off (`app_flags()`); the deploy script prints it.

To switch on (staging): Paystack Dashboard (Test mode) → Settings → API Keys & Webhooks:
1. Copy the **Test Secret Key** (`sk_test_…`) into Supabase → Pinga Staging → Edge Functions → Secrets as `PAYSTACK_SECRET_KEY`.
2. Set **Test Webhook URL** to `https://zgwgszomktveikhecmiz.supabase.co/functions/v1/billing/webhook`.

## Who can see what (enforced by the database)

| | Own company | Other companies |
| --- | --- | --- |
| Owner | Everything; can change working hours and add managers | Nothing |
| Manager | Everything; can invite staff and reps, assign stores; cannot touch owners | Nothing |
| Office staff | Themselves and the office locations | Nothing |
| Sales rep | Themselves and only the stores assigned to them | Nothing |
| Platform admin | Can view all companies (read-only) | — |

Nobody in a company can change their own billing status or trial. People are deactivated, never deleted, so their history is kept.

## Staging and live

There are two Supabase projects: **staging** (for testing) and **live** (real customers). Every change goes to staging first.

The app chooses automatically (`web/js/config.js`): it uses **live only** on the live web addresses listed there; everywhere else (your computer, staging address, previews) it uses staging. So it can't touch live data by accident.

## Deploy

Two Supabase projects, both in eu-west-1 (Ireland): **Pinga Staging** (`zgwgszomktveikhecmiz`) and **Pinga** live (`ltizbbzhfmexwezjdszs`). Their addresses are in `scripts/projects.js` and `web/js/config.js` (a test checks they agree).

Backend (database, invite function, login settings), using Supabase's management API. It needs a Supabase personal access token; in our cloud sessions it is saved as a network secret for api.supabase.com.

```
npm run deploy:staging                       # deploy, then run every security check and a full staff journey on staging
CONFIRM_LIVE=yes npm run deploy:live         # only after staging is checked
```

Only new files in `supabase/migrations` are applied; each is recorded in `supabase_migrations.schema_migrations`.

App (staging is at https://staging.elvisuzorka.com, on Hostinger): get an upload pass from Hostinger (`hosting_files_generate-upload-url` for the site; it lasts a few hours and is never stored), then

```
npm run stamp && npm test
UPLOAD_URL=... X_AUTH=... X_AUTH_REST=... NODE_USE_ENV_PROXY=1 node scripts/publish.js
```

Then clear Hostinger's cache for the site (hPanel → Website → Cache Manager → Clear all, or the Hostinger API `hosting_cache_clear`). Without this, Hostinger's CDN can keep serving old copies of some files for a while, and a phone could get a mix of old and new code.

Server settings (https only, security headers; the app's code files are always re-checked so phones never mix versions) are in `hosting/htaccess`. Before that, run `npm run stamp` (tells phones a new version exists; the tests fail if you forget), then upload the contents of `web/` to the hosting (Hostinger or Cloudflare Pages). It's static files, nothing to build. The app uses the live project only on the live web addresses listed in `web/js/config.js`; anywhere else it uses staging.

Still to set per project (Dashboard → Authentication → URL Configuration): Site URL = the app's web address, once hosting is chosen, so the owner's email confirmation link opens the app.

## Roll back

- **App:** re-upload the previous version of `web/` (every version is in git: `git checkout <earlier-commit> -- web/`).
- **Database:** never edit an old migration. Write a new migration that undoes the change and push it the same way. For data mistakes on live, restore from Supabase's daily backup (Pro plan).

## Size budget

The staff app's JavaScript must stay under 100 KB (gzipped). `npm run size` checks it and fails if over. Managers' screens (`admin.js`) are only downloaded by managers and are reported separately.
