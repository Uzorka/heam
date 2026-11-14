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
import { CONFIG_FOR } from './projects.js';

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
for (const [slug, files] of [['accept-invite', ['index.ts', 'handler.js']], ['daily-summary', ['index.ts', 'handler.js']]]) {
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
  await call('/secrets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ name: 'APP_URL', value: project.site }]) });
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
const secrets = (await call('/secrets')).map((x) => x.name);
console.log(`  summary: scheduled hourly; email ${secrets.includes('RESEND_API_KEY') ? 'is set up' : 'NOT set up yet (add RESEND_API_KEY in Supabase → Edge Functions → Secrets)'}`);

// 3. Login settings
const authConfig = { password_min_length: 6, ...(project.site ? { site_url: project.site } : {}) };
await call('/config/auth', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(authConfig) });
console.log(`  logins: minimum password length 6${project.site ? `, app address ${project.site}` : ''}`);

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
await check('summary function refuses callers without the schedule key', fetch(`${base}/functions/v1/daily-summary`, { method: 'POST', headers: pub, body: '{}' })
  .then((r) => r.status === 401));
console.log('Done.');
