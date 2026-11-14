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

App: run `npm run stamp` (tells phones a new version exists; the tests fail if you forget), then upload the contents of `web/` to the hosting (Hostinger or Cloudflare Pages). It's static files, nothing to build. The app uses the live project only on the live web addresses listed in `web/js/config.js`; anywhere else it uses staging.

Still to set per project (Dashboard → Authentication → URL Configuration): Site URL = the app's web address, once hosting is chosen, so the owner's email confirmation link opens the app.

## Roll back

- **App:** re-upload the previous version of `web/` (every version is in git: `git checkout <earlier-commit> -- web/`).
- **Database:** never edit an old migration. Write a new migration that undoes the change and push it the same way. For data mistakes on live, restore from Supabase's daily backup (Pro plan).

## Size budget

The staff app's JavaScript must stay under 100 KB (gzipped). `npm run size` checks it and fails if over. Managers' screens (`admin.js`) are only downloaded by managers and are reported separately.
