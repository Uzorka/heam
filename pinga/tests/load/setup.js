// Load test set-up and clean-up (STAGING ONLY).
//   NODE_USE_ENV_PROXY=1 node tests/load/setup.js create <tokens.json>   → 50 companies × (1 manager + 10 staff), signed in
//   NODE_USE_ENV_PROXY=1 node tests/load/setup.js check                  → what the load test saved
//   NODE_USE_ENV_PROXY=1 node tests/load/setup.js clean <tokens.json>    → delete everything, restore sign-in limit
// Test companies are named "Load test NN (auto-deleted)"; test phones start +2347001.
import { writeFileSync, rmSync } from 'node:fs';
import { CONFIG_FOR } from '../../scripts/projects.js';

const { ref, key } = CONFIG_FOR.staging;
const base = `https://${ref}.supabase.co`;
const COMPANIES = 50, STAFF = 10, PIN = '482913';
const SIGNIN_LIMIT_NORMAL = 150;   // Supabase default; restored on clean-up

const mgmt = (path, init = {}) => fetch(`https://api.supabase.com/v1/projects/${ref}${path}`,
  { ...init, headers: { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN || 'proxy-injected'}`, 'content-type': 'application/json', ...init.headers } });
const sql = async (query) => {
  const r = await mgmt('/database/query', { method: 'POST', body: JSON.stringify({ query }) });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d));
  return d;
};
const setSignInLimit = (n) => mgmt('/config/auth', { method: 'PATCH', body: JSON.stringify({ rate_limit_token_refresh: n }) });
const pool = async (items, n, fn) => {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
};
const phone = (c, p) => `+2347001${String(c).padStart(2, '0')}${String(p).padStart(2, '0')}`;

const [cmd, file] = process.argv.slice(2);

if (cmd === 'create') {
  const [{ n }] = await sql("select count(*)::int as n from public.companies where name like 'Load test %'");
  if (n) throw new Error('Old load-test data exists: run clean first');
  // 50 companies, each with an office, 1 manager (admin) and 10 office staff, all invited.
  const values = [];
  for (let c = 1; c <= COMPANIES; c++) {
    values.push(`(${c}, '${phone(c, 0)}', 'admin', 'Manager ${c}')`);
    for (let p = 1; p <= STAFF; p++) values.push(`(${c}, '${phone(c, p)}', 'staff', 'Staff ${c}-${p}')`);
  }
  const people = await sql(`
    with c as (insert into public.companies (name) select 'Load test ' || lpad(g::text, 2, '0') || ' (auto-deleted)' from generate_series(1, ${COMPANIES}) g returning id, name),
         cn as (select id, substring(name from 11 for 2)::int as n from c),
         b as (insert into public.branches (company_id, name, lat, lng) select id, 'Office', 6.5095, 3.3711 from cn),
         v(n, phone, role, name) as (values ${values.join(',')}),
         m as (insert into public.members (company_id, full_name, phone, role) select cn.id, v.name, v.phone, v.role::public.member_role from v join cn on cn.n = v.n returning id, company_id, phone, role, invite_token)
    select * from m`);
  console.log(`created ${COMPANIES} companies, ${people.length} people`);

  // Join every invite through Pinga's real invite function (creates the phone + PIN logins).
  const t0 = Date.now();
  const joined = await pool(people, 10, async (m) => {
    const r = await fetch(`${base}/functions/v1/accept-invite`, { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: JSON.stringify({ token: m.invite_token, pin: PIN }) });
    return r.status;
  });
  console.log(`invites accepted: ${joined.filter((s) => s === 200).length}/${people.length} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // Sign everyone in now (as phones are each morning). One test machine = one address, so lift the limit briefly.
  await setSignInLimit(5000);
  await new Promise((r) => setTimeout(r, 5000));
  const sessions = await pool(people, 10, async (m) => {
    const r = await fetch(`${base}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' },
      body: JSON.stringify({ email: m.phone.slice(1) + '@phone.usepinga.com', password: PIN }) });
    const d = await r.json();
    return { ...m, token: d.access_token, status: r.status };
  });
  const ok = sessions.filter((s) => s.token);
  console.log(`signed in: ${ok.length}/${people.length}`);
  writeFileSync(file, JSON.stringify({
    staff: ok.filter((s) => s.role === 'staff').map(({ id, company_id, token }) => ({ id, company_id, token })),
    managers: ok.filter((s) => s.role === 'admin').map(({ token }) => ({ token })),
  }));
}

if (cmd === 'check') {
  console.log(JSON.stringify(await sql(`
    select count(*) as records, count(distinct a.member_id) as people, count(distinct a.company_id) as companies,
           count(*) filter (where a.photo_path is not null) as with_photo,
           count(*) filter (where a.flags <> '{}') as flagged,
           count(*) - count(distinct a.id) as duplicates,
           round(percentile_cont(0.95) within group (order by extract(epoch from a.received_at - a.happened_at))::numeric, 2) as p95_seconds_tap_to_saved
    from public.attendance a join public.companies c on c.id = a.company_id where c.name like 'Load test %'`)[0]));
  console.log(JSON.stringify(await sql(`select count(*) as photos, pg_size_pretty(sum((metadata->>'size')::bigint)) as size
    from storage.objects o where o.bucket_id = 'photos' and split_part(o.name, '/', 1)::uuid in (select id from public.companies where name like 'Load test %')`)[0]));
}

if (cmd === 'clean') {
  await sql(`
    set local storage.allow_delete_query = 'true';
    delete from storage.objects where bucket_id = 'photos' and split_part(name, '/', 1) in (select id::text from public.companies where name like 'Load test %');
    delete from public.companies where name like 'Load test %';
    delete from auth.users where email like '2347001%@phone.usepinga.com';`);
  await setSignInLimit(SIGNIN_LIMIT_NORMAL);
  const cfg = await (await mgmt('/config/auth')).json();
  const [{ left }] = await sql("select (select count(*) from public.companies where name like 'Load test %') + (select count(*) from auth.users where email like '2347001%@phone.usepinga.com') as left");
  if (file) rmSync(file, { force: true });
  console.log(`cleaned: ${left} test rows left; sign-in limit back to ${cfg.rate_limit_token_refresh}`);
}
