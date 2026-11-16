// Deploys the backend to a Supabase project through Supabase's management API. No CLI needed.
//   node scripts/deploy.js staging
//   CONFIRM_LIVE=yes node scripts/deploy.js live      (only after staging has been checked)
//
// Needs a Supabase personal access token in SUPABASE_ACCESS_TOKEN (in our cloud sessions the
// network proxy adds it automatically).
//
// What it does, in order:
//   1. Applies any new files in supabase/migrations, each in its own transaction, and records
//      them in supabase_migrations.schema_migrations (same place the Supabase CLI uses).
//   2. Deploys the accept-invite function.
//   3. Sets the minimum password length to 6 (staff PINs are 6 digits).
//   4. Smoke test with the publishable key.
import { readdirSync, readFileSync } from 'node:fs';
import { CONFIG_FOR, MAIL_DOMAIN } from './projects.js';

const env = process.argv[2];
const project = CONFIG_FOR[env];
if (!project) { console.error('Usage: node scripts/deploy.js staging|live'); process.exit(1); }
if (env === 'live' && process.env.CONFIRM_LIVE !== 'yes') {
  console.error('Refusing to deploy to LIVE without CONFIRM_LIVE=yes. Deploy and check staging first.');
  process.exit(1);
}

const API = `https://api.supabase.com/v1/projects/${project.ref}`;
const auth = { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN || 'proxy-injected'}` };

async function call(path, init = {}) {
  const r = await fetch(API + path, { ...init, headers: { ...auth, ...init.headers } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${path} → ${r.status}: ${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { return text; }
}
const sql = (query) => call('/database/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
const lit = (s) => `'${s.replace(/'/g, "''")}'`;

console.log(`Deploying to ${env.toUpperCase()} (${project.ref})`);

// 1. Database
await sql(`create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`);
const applied = new Set((await sql('select version from supabase_migrations.schema_migrations')).map((r) => r.version));
const dir = new URL('../supabase/migrations/', import.meta.url);
for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  const [version, ...rest] = file.replace(/\.sql$/, '').split('_');
  if (applied.has(version)) { console.log(`  database: ${file} already applied`); continue; }
  const body = readFileSync(new URL(file, dir), 'utf8');
  await sql(`begin;\n${body}\ninsert into supabase_migrations.schema_migrations (version, name) values (${lit(version)}, ${lit(rest.join('_'))});\ncommit;`);
  console.log(`  database: ${file} applied`);
}
await sql("notify pgrst, 'reload schema';");

// 2. Functions
for (const [slug, files] of [['accept-invite', ['index.ts', 'handler.js']], ['daily-summary', ['index.ts', 'handler.js']], ['face-check', ['index.ts', 'handler.js']], ['billing', ['index.ts', 'handler.js']]]) {
  const fnDir = new URL(`../supabase/functions/${slug}/`, import.meta.url);
  const form = new FormData();
  form.append('metadata', JSON.stringify({ name: slug, entrypoint_path: 'index.ts', verify_jwt: false }));
  for (const f of files) form.append('file', new Blob([readFileSync(new URL(f, fnDir))]), f);
  await call(`/functions/deploy?slug=${slug}`, { method: 'POST', body: form });
  console.log(`  function: ${slug} deployed`);
}

// Evening summary: app address for the email's button, and the hourly schedule.
// The schedule proves itself with a random key that is created in the database and never leaves it.
if (project.site) {
  await call('/secrets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ name: 'APP_URL', value: project.site }, { name: 'SUMMARY_FROM', value: `Pinga <summary@${MAIL_DOMAIN}>` }]) });
}
await sql(`create extension if not exists pg_net;
  create extension if not exists pg_cron;
  insert into private.settings (key, value) values ('summary_key', encode(extensions.gen_random_bytes(24), 'hex')) on conflict (key) do nothing;
  select cron.schedule('pinga-daily-summary', '5 * * * *', $job$
    select net.http_post(
      url := 'https://${project.ref}.supabase.co/functions/v1/daily-summary',
      headers := jsonb_build_object('content-type', 'application/json', 'x-summary-key', (select value from private.settings where key = 'summary_key')),
      body := '{}'::jsonb)
  $job$);`);
// Face check every 5 minutes. It does nothing (and costs nothing) until the AWS secrets exist.
await sql(`select cron.schedule('pinga-face-check', '*/5 * * * *', $job$
    select net.http_post(
      url := 'https://${project.ref}.supabase.co/functions/v1/face-check',
      headers := jsonb_build_object('content-type', 'application/json', 'x-job-key', (select value from private.settings where key = 'summary_key')),
      body := '{}'::jsonb, timeout_milliseconds := 60000)
  $job$);`);
// Billing renewals once a day at 07:10 Lagos time (06:10 UTC). Does nothing until Paystack is set up.
await sql(`select cron.schedule('pinga-billing-renew', '10 6 * * *', $job$
    select net.http_post(
      url := 'https://${project.ref}.supabase.co/functions/v1/billing/renew',
      headers := jsonb_build_object('content-type', 'application/json', 'x-job-key', (select value from private.settings where key = 'summary_key')),
      body := '{}'::jsonb, timeout_milliseconds := 60000)
  $job$);`);
const secrets = (await call('/secrets')).map((x) => x.name);
console.log(`  billing: renewals daily at 07:10 Lagos; Paystack ${secrets.includes('PAYSTACK_SECRET_KEY') ? 'key found' : 'NOT set up yet (add PAYSTACK_SECRET_KEY, a TEST key sk_test_…)'}`);
const awsReady = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'].every((n) => secrets.includes(n));
console.log(`  face check: scheduled every 5 minutes; ${awsReady ? 'ON (AWS keys found)' : 'OFF until AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION are added'}`);
console.log(`  summary: scheduled hourly; email ${secrets.includes('RESEND_API_KEY') ? 'is set up' : 'NOT set up yet (add RESEND_API_KEY in Supabase → Edge Functions → Secrets)'}`);

// 3. Login settings
// New owners confirm their email with a 6-digit code (typed into the app). Supabase only lets us change
// the email itself once our own sender (Resend SMTP) is set up; until then its standard email with a link is sent.
const authConfig = { password_min_length: 6, ...(project.site ? { site_url: project.site } : {}), mailer_autoconfirm: false, mailer_otp_length: 6, mailer_otp_exp: 3600 };
await call('/config/auth', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(authConfig) });
const authNow = await call('/config/auth');
console.log(`  logins: minimum password length 6${project.site ? `, app address ${project.site}` : ''}; sign-up codes 6 digits, 1 hour`);
if (authNow.smtp_host) {
  const codeEmail = readFileSync(new URL('../supabase/templates/confirm-code.html', import.meta.url), 'utf8');
  // The sender follows MAIL_DOMAIN (the SMTP password itself is only ever entered in the Supabase dashboard).
  await call('/config/auth', { method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ smtp_admin_email: `no-reply@${MAIL_DOMAIN}`, smtp_sender_name: 'Pinga', rate_limit_email_sent: Math.max(30, authNow.rate_limit_email_sent || 0),
      mailer_subjects_confirmation: 'Your Pinga code: {{ .Token }}', mailer_templates_confirmation_content: codeEmail }) });
  console.log(`  sign-up email: the code email, through ${authNow.smtp_host}, from no-reply@${MAIL_DOMAIN}; evening email from summary@${MAIL_DOMAIN}`);
} else {
  console.log("  sign-up email: Supabase's standard email with a link (2 an hour, team addresses only) until Resend is added as SMTP in Supabase → Authentication → Emails → SMTP; then deploy again for the code email");
}

// 4. Smoke test, as the public app would
const pub = { apikey: project.key, 'content-type': 'application/json' };
const base = `https://${project.ref}.supabase.co`;
const check = async (name, ok) => { if (!(await ok)) throw new Error('Smoke test failed: ' + name); console.log(`  check: ${name}`); };
await check('server clock answers', fetch(`${base}/rest/v1/rpc/server_now`, { method: 'POST', headers: pub, body: '{}' }).then((r) => r.ok));
await check('wrong invite link shows nothing', fetch(`${base}/rest/v1/rpc/invite_preview`, { method: 'POST', headers: pub, body: JSON.stringify({ p_token: 'x' }) })
  .then((r) => r.json()).then((d) => Array.isArray(d) && d.length === 0));
await check('visitors cannot read people', fetch(`${base}/rest/v1/members?select=id`, { headers: pub }).then((r) => r.status === 401 || r.status === 403));
await check('visitors cannot read companies', fetch(`${base}/rest/v1/companies?select=id`, { headers: pub }).then((r) => r.status === 401 || r.status === 403));
await check('invite function refuses a bad link', fetch(`${base}/functions/v1/accept-invite`, { method: 'POST', headers: pub, body: JSON.stringify({ token: 'x', pin: '482913' }) })
  .then((r) => r.status === 400));
await check('billing refuses unsigned or unset-up payment messages', fetch(`${base}/functions/v1/billing/webhook`, { method: 'POST', headers: pub, body: '{"event":"charge.success","data":{"reference":"PNG-X"}}' })
  .then((r) => r.status === 401 || r.status === 503));
const payments = await fetch(`${base}/functions/v1/billing/status`, { method: 'POST', headers: pub, body: '{}' }).then((r) => r.json());
console.log(`  payments: ${payments.enabled ? 'ON (Paystack test key found)' : 'switched OFF until PAYSTACK_SECRET_KEY (sk_test_…) is saved; app hides Pay and reminders'}`);
await check('billing renewals refuse callers without the schedule key', fetch(`${base}/functions/v1/billing/renew`, { method: 'POST', headers: pub, body: '{}' })
  .then((r) => r.status === 401));
await check('face-check function refuses callers without the schedule key', fetch(`${base}/functions/v1/face-check`, { method: 'POST', headers: pub, body: '{}' })
  .then((r) => r.status === 401));
await check('summary function refuses callers without the schedule key', fetch(`${base}/functions/v1/daily-summary`, { method: 'POST', headers: pub, body: '{}' })
  .then((r) => r.status === 401));
console.log('Done.');
