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

## Business types (Field sales / Storefront / Both)

Picked at sign-up; the owner can change it any time in Setup → Business type (nothing is deleted when it changes).

- **Field sales**: offices, office staff, sales reps and store visits (as before).
- **Storefront**: shops instead of offices, shop staff and managers. No stores, reps or store visits (the database refuses them). A Stock tab appears (products, stock and sales arrive in Part B).
- **Both**: everything on. Each location is marked office or shop.

Staff are invited straight into their shop. The owner ticks which shops each manager looks after (on the manager's page); a manager then sees only the staff of those shops (plus staff not in any shop yet) everywhere: Team, Today, Overview, exports. Owners see every shop. Office staff are visible to every manager as before. Enforced in the database (`private.can_see_member`, `manager_shops`), tested in `tests/db/test_business.sql`.

## Products and stock (Storefront and Both)

Stock tab (owners and managers). Products and prices are one list for the business; stock is kept per shop.

- **Import** an Excel (.xlsx) or CSV file. Each time, say whether it's a **stock count** (the file's numbers replace what's recorded; products not in the file stay as they are) or a **delivery** (the numbers are added). A check screen shows every product's new number, which are new, and any rows that can't be imported (in plain English, with the row number); good rows can still go in. Up to 5,000 products per file. Most column names work ("Item", "Qty", "SKU", "Selling price"…); dates are read day first (31/03/2027). A template is on the import screen.
- Files are read in the browser by our own code (`web/js/sheet.js`, no library), then saved in one go by the database (`import_stock`): if anything is wrong, nothing is half-saved.
- **Every import is logged** (kind, shop, file, who, when, how many): Stock → Import history. Every stock change is logged too (count, delivery, correction with a reason; sales in Part C), shown on each product.
- **Prices**: selling price and an optional lowest allowed price per product (lowest ≤ selling, checked in the app and the database).
- **Alerts**: low stock (at or below the product's alert level, default 5), out of stock, expiring within 30 days, expired.
- Who: owners every shop; managers only their shops; shop staff can read the price list and their own shop's stock (for the till in Part C), nothing else. Stock can only change through the logged functions. Tested in `tests/db/test_stock.sql` and `tests/unit/sheet.test.js`.

## Sales at the till (Storefront and Both)

Shop staff get a Sell tab: search or scroll the price list, tap to add, change the quantity and the price (customers haggle), Save sale. It works with no signal: the sale waits on the phone (the same outbox as clock-ins) and is sent when signal comes back; each sale has its own id, so a re-send is never counted twice. The price list and the shop's stock are kept on the phone; sales still waiting count against the stock shown.

- Below the product's lowest allowed price: allowed, warned on screen, flagged for the manager.
- More than the recorded stock: allowed, warned, flagged ("Sold when out of stock"); the stock goes negative so the wrong count shows.
- Above the selling price: the phone asks "Save anyway?" (usually a typing slip).
- My sales: today's sales; "Report a mistake" sends a note to the manager. Staff can't cancel.
- Managers and owners: Stock → Sales today (total, discounts, what to check), each sale with its products and flags; Cancel needs a reason, puts the stock back, and keeps who, when and why.
- Rules in the database (`record_sale`, `cancel_sale`, `report_sale_mistake`), tested in `tests/db/test_sales.sql`.

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

## Brand and design

- **Colours** are CSS variables at the top of `web/css/app.css`: mango `#FF8A1F` (primary), ink navy `#14213D` (text), cream `#FFF8EE` (background), white cards; green, amber and red for statuses only. Buttons use ink text on mango (white on mango is too faint to read). Orange *text* uses a deeper `--mango-ink` so it stays readable on cream.
- **Font:** Nunito 400/700/800, self-hosted in `web/fonts/` and slimmed to the characters Pinga uses (including ₦): about 37 KB for all three. Licence: `web/fonts/OFL.txt`.
- **Logo** (map pin with a check cut out), the **happy pin** and all **icons** are inline SVG in `web/js/icons.js`. App icons in `web/icons/` are drawn from the same logo.
- **Navigation:** bottom tab bar with icons on phones; top segmented control on desktop (700 px and wider).
- New companies see a **Get started** checklist (office, stores, invite, first clock-in) instead of zeros.

## Who can see what (enforced by the database)

| | Own company | Other companies |
| --- | --- | --- |
| Owner | Everything; can change working hours and add managers | Nothing |
| Manager | Everything; can invite staff and reps, assign stores; cannot touch owners | Nothing |
| Office staff | Themselves and the office locations | Nothing |
| Sales rep | Themselves and only the stores assigned to them | Nothing |
| Platform admin | Can view all companies (read-only) | — |

Nobody in a company can change their own billing status or trial. People are deactivated, never deleted, so their history is kept.

## Pilot: CHF Heron (live)

- **Live app:** https://pinga.elvisuzorka.com (Hostinger), live Supabase project **Pinga** (`ltizbbzhfmexwezjdszs`, Free plan for the pilot; upgrade to Pro before more companies join).
- **Staging app:** https://staging.elvisuzorka.com, project **Pinga Staging**. Try every change here first.
- Live has the same database, functions and security rules as staging (all 239 rule checks pass on live, rolled back, nothing written). Face check, evening email and payments are off until their keys are added to the live project's secrets.

Owner set-up on the live app:
1. https://pinga.elvisuzorka.com/#/signup → your name, "CHF Heron", email, password → confirm the email → you land on **Get started**.
2. **Add an office or branch:** stand in the Yaba office and tap "Use my current location"; repeat in Ikeja (radius 100 m to start).
3. **Invite your staff** (Team → Invite someone, by phone number; send the link on WhatsApp). Each person sets a PIN and takes one reference photo.
4. For sales reps: Setup → Stores (add stores), then each rep's page → Assigned stores and visits per day.

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

## Load and low-end phone tests (Step 8)

Run against **staging only** (Supabase Free plan, from one test machine through the session's network proxy, so real phones on a Pro plan should do at least as well).

```
NODE_USE_ENV_PROXY=1 node tests/load/setup.js create tokens.json      # 50 test companies × (1 manager + 10 staff), signed in
k6 run -e TOKENS=tokens.json -e PHOTO=selfie.jpg -e MODE=normal tests/load/checkin.js
k6 run -e TOKENS=tokens.json -e PHOTO=selfie.jpg -e MODE=rush -e KIND=out tests/load/checkin.js
NODE_USE_ENV_PROXY=1 node tests/load/setup.js check
NODE_USE_ENV_PROXY=1 node tests/load/setup.js clean tokens.json       # deletes it all, restores the sign-in limit (150)
NODE_USE_ENV_PROXY=1 node tests/phone/lowend.js                       # hosted site, slow 3G, 4× slower CPU
```

Results (15 Nov 2026, staging):

| Test | Result |
| --- | --- |
| 500 staff clock in over 5 min, 50 companies at once, 50 managers watching Today | 0 failures in 2,500 requests; clock-in saved in 0.36 s (95th percentile); whole clock-in incl. photo 1.43 s; Today page 0.37 s; 500 records, 500 photos, 0 duplicates |
| Rush: 500 clock-outs in about 1 min | 0 failures; saving still 0.34 s; photo upload slows to 3.4 s (95th percentile), which staff don't wait for (saved on the phone first, sent in the background) |
| Low-end phone (slow 3G, 4× slower CPU, 360 px) | first open 4.4 s; reopen 1.4 s, with no signal 0.2 s; Clock in → camera + GPS ready 0.8 s; tap → saved on phone 0.2 s → on the server 2.2 s; 4.8 MB of JavaScript memory |

## Roll back

- **App:** re-upload the previous version of `web/` (every version is in git: `git checkout <earlier-commit> -- web/`).
- **Database:** never edit an old migration. Write a new migration that undoes the change and push it the same way. For data mistakes on live, restore from Supabase's daily backup (Pro plan).

## Size budget

The staff app's JavaScript must stay under 100 KB (gzipped). `npm run size` checks it and fails if over. Managers' screens (`admin.js`) are only downloaded by managers and are reported separately.
