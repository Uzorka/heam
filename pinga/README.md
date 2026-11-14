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

Database changes (staging first, then live):

```
npx supabase link --project-ref <staging-ref>
npx supabase db push                      # applies new files in supabase/migrations
npx supabase functions deploy accept-invite
```

Repeat with `<live-ref>` after checking staging.

App: upload the contents of `web/` to the hosting (Hostinger or Cloudflare Pages). It's static files, nothing to build.

Supabase settings needed once per project (Dashboard → Authentication):
- Site URL: the app's address (so the owner's email confirmation link comes back to the app).
- Email sign-ups on. Minimum password length 6 (PINs are 6 digits).

## Roll back

- **App:** re-upload the previous version of `web/` (every version is in git: `git checkout <earlier-commit> -- web/`).
- **Database:** never edit an old migration. Write a new migration that undoes the change and push it the same way. For data mistakes on live, restore from Supabase's daily backup (Pro plan).

## Size budget

The staff app's JavaScript must stay under 100 KB (gzipped). `npm run size` checks it and fails if over.
