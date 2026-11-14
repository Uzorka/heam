// Walks through every screen in a real browser on a small phone screen, against a
// pretend Supabase, with a fake camera and fake GPS. Saves screenshots to tests/screens/output/.
// Also measures the first load with a 4x slower CPU and slow 3G, and opening the app with no signal.
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { server } from '../../scripts/serve.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const out = new URL('./output/', import.meta.url).pathname;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// ── Pretend Supabase ────────────────────────────────────────
const YABA = { lat: 6.5095, lng: 3.3711 };
const company = { id: 'c1', name: 'CHF Heron', summary_email: true, status: 'trial', trial_ends_at: new Date(Date.now() + 2 * 864e5 - 3600e3).toISOString(), timezone: 'Africa/Lagos', work_starts: '08:00:00', work_ends: '17:00:00', late_after_minutes: 15, work_days: [1, 2, 3, 4, 5] };
const branches = [{ id: 'b1', company_id: 'c1', name: 'Yaba office', address: '12 Herbert Macaulay Way', radius_m: 100, ...YABA }];
const people = [
  { id: 'm0', user: 'u-owner', full_name: 'Elvis Uzorka', role: 'owner', phone: null, joined_at: '2026-11-14', invite_token: null, reference_photo_path: null, branch_id: null },
  { id: 'm1', user: 'u-sade', full_name: 'Sade Bello', role: 'staff', phone: '+2348031234567', joined_at: '2026-11-14', invite_token: null, reference_photo_path: null },
  { id: 'm3', user: null, full_name: 'Tunde Ade', role: 'staff', phone: '+2348125550101', joined_at: '2026-11-14', invite_token: null, reference_photo_path: null },
  { id: 'm2', user: null, full_name: 'Remi Okafor', role: 'rep', phone: '+2348059876543', joined_at: null, invite_token: 'f'.repeat(32), reference_photo_path: null, daily_visit_target: 4 },
];
const attendance = [];
const stores = [
  { id: 's1', company_id: 'c1', name: 'Shoprite Ikeja', address: 'Obafemi Awolowo Way, Ikeja', lat: 6.6018, lng: 3.3515, radius_m: 100, location_source: 'manager', active: true },
  { id: 's3', company_id: 'c1', name: 'Ebeano Ikota', address: 'Ikota Shopping Complex, Lekki', lat: 6.4440, lng: 3.5560, radius_m: 100, location_source: 'manager', active: true },
];
const assignments = [];
const visits = [];
const dayStatus = new Map(); // `${member}|${day}` -> status
const payRates = new Map();
const bill = { status: 'trial', paid_until: null, card: null, invoices: [] };
const photos = new Map();
let networkDown = false;
let signedInAs = null;

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const dist = (a, b) => { const r = (d) => (d * Math.PI) / 180; const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2; return 2 * 6371000 * Math.asin(Math.sqrt(h)); };
const lagosDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date(iso));
const param = (q, k) => new URLSearchParams(q).get(k)?.replace(/^(eq|is)\./, '');

function board(day) {
  const today = lagosDate(new Date().toISOString());
    const rows = people.filter((x) => x.role === 'staff' || x.role === 'rep').map((x) => {
      const att = attendance.filter((a) => a.member_id === x.id && a.local_date === day);
      const vis = visits.filter((v) => v.member_id === x.id && lagosDate(v.happened_at) === day);
      const set = dayStatus.get(x.id + '|' + day);
      const firstIn = att.find((a) => a.kind === 'in');
      const late = firstIn?.late_minutes || 0;
      const computed = firstIn || vis.length ? (x.role === 'staff' && late > 0 ? 'late' : 'present') : day < today ? 'absent' : 'none';
      return { member_id: x.id, full_name: x.full_name, role: x.role, status: set || computed, set_by_manager: !!set,
        first_in: firstIn?.happened_at || null, last_out: att.filter((a) => a.kind === 'out').pop()?.happened_at || null, late_minutes: late || null,
        visits: new Set(vis.map((v) => v.store_id)).size, visit_target: x.role === 'rep' ? x.daily_visit_target ?? 4 : null,
        to_review: [...att, ...vis].filter((r) => r.flags.length && r.flags.join() !== 'store_located').length };
    });
  return rows.sort((a, b) => a.full_name.localeCompare(b.full_name));
}

async function fakeSupabase(route) {
  if (networkDown) return route.abort('internetdisconnected');
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname, q = url.search, m = req.method();
  const body = m === 'POST' || m === 'PATCH' ? (p.startsWith('/storage/') ? null : req.postDataJSON()) : null;
  const me = people.find((x) => x.user === signedInAs);

  if (p === '/auth/v1/token') {
    const who = body.email === 'elvis@chfheron.com' && body.password === 'password1' ? 'u-owner'
      : body.email === '2348031234567@phone.usepinga.com' && body.password === '482913' ? 'u-sade'
      : body.email === '2348059876543@phone.usepinga.com' && body.password === '482913' ? 'u-remi' : null;
    if (!who) return json(route, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
    signedInAs = who;
    return json(route, { access_token: 'at-' + who, refresh_token: 'rt', expires_in: 3600, user: { id: who, email: body.email } });
  }
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204 });
  if (p === '/rest/v1/rpc/server_now') return json(route, new Date().toISOString());

  if (p === '/rest/v1/members' && m === 'GET') {
    const uid = param(q, 'user_id');
    if (uid) { const x = people.find((y) => y.user === uid); return json(route, x ? [{ ...x, company_id: 'c1', companies: company }] : []); }
    if (param(q, 'id')) return json(route, people.filter((x) => x.id === param(q, 'id')));
    return json(route, [...people].sort((a, b) => a.full_name.localeCompare(b.full_name)));
  }
  if (p === '/rest/v1/members' && m === 'POST') {
    if (people.some((x) => x.phone === body.phone)) return json(route, { code: '23505', message: 'duplicate' }, 409);
    const row = { id: 'm' + (people.length + 10), user: null, joined_at: null, invite_token: 'a1b2'.repeat(8), reference_photo_path: null, ...body };
    people.push(row);
    return json(route, [row]);
  }
  if (p === '/rest/v1/companies' && m === 'PATCH') { Object.assign(company, body, body.work_starts ? { work_starts: body.work_starts + ':00' } : {}); return json(route, [company]); }
  if (p === '/rest/v1/branches' && m === 'GET') return json(route, param(q, 'id') ? branches.filter((b) => b.id === param(q, 'id')) : branches);
  if (p === '/rest/v1/branches' && m === 'POST') { const b = { id: 'b' + (branches.length + 1), ...body }; branches.push(b); return json(route, [b]); }
  if (p === '/rest/v1/attendance' && m === 'GET') {
    const mid = param(q, 'member_id'), day = param(q, 'local_date');
    return json(route, attendance.filter((a) => a.member_id === mid && (!day || a.local_date === day))
      .sort((a, b) => (q.includes('.desc') ? b.happened_at.localeCompare(a.happened_at) : a.happened_at.localeCompare(b.happened_at))));
  }
  if (p === '/rest/v1/rpc/record_attendance') {
    const existing = attendance.find((a) => a.id === body.p_id);
    if (existing) return json(route, existing);
    const d = dist(YABA, { lat: body.p_lat, lng: body.p_lng });
    const day = lagosDate(body.p_happened_at);
    const first = body.p_kind === 'in' && !attendance.some((a) => a.member_id === me.id && a.kind === 'in' && a.local_date === day);
    const row = { id: body.p_id, member_id: me.id, kind: body.p_kind, happened_at: body.p_happened_at, local_date: day,
      distance_m: Math.round(d), late_minutes: first ? 12 : null, photo_path: body.p_photo_path,
      flags: [...(d > 150 ? ['outside_radius'] : []), ...(body.p_photo_path ? [] : ['no_photo'])] };
    attendance.push(row);
    return json(route, row);
  }
  if (p === '/rest/v1/stores' && m === 'GET') {
    const mine = me?.role === 'rep' ? stores.filter((x) => assignments.some((a) => a.member_id === me.id && a.store_id === x.id)) : stores;
    return json(route, param(q, 'id') ? mine.filter((x) => x.id === param(q, 'id')) : [...mine].sort((a, b) => a.name.localeCompare(b.name)));
  }
  if (p === '/rest/v1/stores' && m === 'POST') { const x = { id: 's' + (stores.length + 10), active: true, ...body }; stores.push(x); return json(route, [x]); }
  if (p === '/rest/v1/stores' && m === 'PATCH') { Object.assign(stores.find((x) => x.id === param(q, 'id')), body); return json(route, []); }
  if (p === '/rest/v1/store_assignments' && m === 'GET') return json(route, assignments.filter((a) => a.member_id === param(q, 'member_id')).map((a) => ({ store_id: a.store_id })));
  if (p === '/rest/v1/store_assignments' && m === 'POST') { assignments.push(...body); return route.fulfill({ status: 201 }); }
  if (p === '/rest/v1/store_assignments' && m === 'DELETE') {
    const ids = /store_id=in\.\(([^)]*)\)/.exec(decodeURIComponent(q))[1].split(',');
    for (const id of ids) assignments.splice(assignments.findIndex((a) => a.member_id === param(q, 'member_id') && a.store_id === id), 1);
    return route.fulfill({ status: 204 });
  }
  if (p === '/rest/v1/members' && m === 'PATCH') { Object.assign(people.find((x) => x.id === param(q, 'id')), body); return json(route, []); }
  if (p === '/rest/v1/visits' && m === 'GET') {
    return json(route, visits.filter((v) => v.member_id === param(q, 'member_id')).sort((a, b) => b.happened_at.localeCompare(a.happened_at)));
  }
  if (p === '/rest/v1/rpc/record_visit') {
    const existing = visits.find((v) => v.id === body.p_id);
    if (existing) return json(route, existing);
    const st = stores.find((x) => x.id === body.p_store);
    const flags = [];
    if (!assignments.some((a) => a.member_id === me.id && a.store_id === st.id)) flags.push('not_assigned');
    let d = null;
    if (st.lat == null) { if (body.p_accuracy <= 50) { Object.assign(st, { lat: body.p_lat, lng: body.p_lng, location_source: 'first_visit' }); d = 0; flags.push('store_located'); } else flags.push('no_store_location'); }
    else { d = dist(st, { lat: body.p_lat, lng: body.p_lng }); if (d > st.radius_m + Math.min(body.p_accuracy, 50)) flags.push('outside_radius'); }
    if (!body.p_selfie_path) flags.push('no_photo');
    const row = { id: body.p_id, member_id: me.id, store_id: st.id, happened_at: body.p_happened_at, distance_m: d == null ? null : Math.round(d),
      selfie_path: body.p_selfie_path, shelf_photo_path: body.p_shelf_path, note: body.p_note, flags };
    visits.push(row);
    return json(route, row);
  }
  if (p === '/rest/v1/rpc/day_board') return json(route, board(body.p_day));
  if (p === '/rest/v1/rpc/register') {
    const rows = [];
    for (let d = new Date(body.p_from + 'T12:00:00Z'); d <= new Date(body.p_to + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
      const day = d.toISOString().slice(0, 10);
      rows.push(...board(day).map((r) => ({ day, ...r })));
    }
    return json(route, rows);
  }
  if (p === '/rest/v1/rpc/owner_overview') {
    const b = board(body.p_day);
    const reps = b.filter((r) => r.role === 'rep');
    const paid = payRates.size;
    return json(route, {
      day: body.p_day,
      now: { people: b.length, present: b.filter((r) => r.status === 'present').length, late: b.filter((r) => r.status === 'late').length,
        absent: b.filter((r) => ['absent', 'none'].includes(r.status)).length, away: b.filter((r) => ['leave', 'off'].includes(r.status)).length,
        to_review: b.reduce((n, r) => n + r.to_review, 0) },
      offices: [{ name: 'Yaba office', present: 0, late: b.filter((r) => r.role === 'staff' && r.status === 'late').length, absent: b.filter((r) => r.role === 'staff' && ['absent', 'none'].includes(r.status)).length, away: 0 }],
      field: { planned: reps.reduce((n, r) => n + r.visit_target, 0), done: reps.reduce((n, r) => n + Math.min(r.visits, r.visit_target), 0),
        reps: reps.map((r) => ({ name: r.full_name, visits: r.visits, target: r.visit_target, status: r.status })) },
      stores: stores.filter((x) => x.lat != null && assignments.some((a) => a.store_id === x.id))
        .map((x) => ({ name: x.name, lat: x.lat, lng: x.lng, visited: visits.some((v) => v.store_id === x.id && lagosDate(v.happened_at) === body.p_day) })),
      repeat_late: [{ name: 'Sade Bello', times: 3 }],
      visits_dropping: [],
      lost: me.role === 'owner' ? { hours: 31.5, naira: paid ? 48500 : 0, with_pay: paid, people: b.length } : null,
    });
  }
  if (p === '/rest/v1/pay_rates' && m === 'GET') { const v = payRates.get(param(q, 'member_id')); return json(route, v == null ? [] : [{ monthly_naira: v }]); }
  if (p === '/rest/v1/pay_rates' && m === 'POST') { payRates.set(body.member_id, body.monthly_naira); return route.fulfill({ status: 201 }); }
  if (p === '/rest/v1/pay_rates' && m === 'DELETE') { payRates.delete(param(q, 'member_id')); return route.fulfill({ status: 204 }); }
  if (p === '/rest/v1/companies' && m === 'GET') return json(route, [company]);
  if (p === '/rest/v1/rpc/set_day_status') {
    let n = 0;
    for (const id of body.p_members) {
      const k = id + '|' + body.p_day;
      if (body.p_status) { dayStatus.set(k, body.p_status); n++; } else if (dayStatus.delete(k)) n++;
    }
    return json(route, n);
  }
  if (p === '/rest/v1/rpc/billing_overview') {
    const joined = people.filter((x) => x.joined_at && ['staff', 'rep'].includes(x.role));
    const staff = joined.filter((x) => x.role === 'staff').length, reps = joined.filter((x) => x.role === 'rep').length;
    return json(route, { status: bill.status, trial_ends: company.trial_ends_at.slice(0, 10), trial_days_left: 2, paid_until: bill.paid_until,
      quote: bill.bigTeam
        ? { staff_seats: 99, rep_seats: 1, staff_price: 1500, rep_price: 2500, gross_kobo: 15100000, discount_percent: 10, discount_min_people: 100, amount_kobo: 13590000 }
        : { staff_seats: staff, rep_seats: reps, staff_price: 1500, rep_price: 2500, gross_kobo: (staff * 1500 + reps * 2500) * 100, discount_percent: 0, discount_min_people: null, amount_kobo: (staff * 1500 + reps * 2500) * 100 },
      card: bill.card, invoices: bill.invoices });
  }
  if (p === '/functions/v1/billing/checkout') {
    assert.match(req.headers().authorization || '', /^Bearer at-u-owner$/, 'checkout is sent with the owner\'s login');
    // Pretend the owner paid on Paystack's page and was sent back.
    return json(route, { url: `${base}#/billing?trxref=PNG-TEST000000000001&reference=PNG-TEST000000000001`, reference: 'PNG-TEST000000000001' });
  }
  if (p === '/functions/v1/billing/verify') {
    Object.assign(bill, { status: 'active', paid_until: '2026-12-16', card: { label: 'Visa •••• 4081', expires: '12/30' },
      invoices: [{ reference: body.reference, period_start: '2026-11-17', period_end: '2026-12-16', amount_kobo: 550000, status: 'paid' }] });
    company.status = 'active';
    return json(route, { result: 'paid' });
  }
  if (p === '/rest/v1/rpc/face_check_status') return json(route, { enabled: false, last_run: null, match_percent: company.face_match_percent ?? 90, waiting: attendance.filter((a) => a.photo_path).length });
  if (p === '/rest/v1/rpc/set_face_match_percent') { company.face_match_percent = body.p_percent; return json(route, null); }
  if (p === '/rest/v1/rpc/clear_reference_photo') { people.find((x) => x.id === body.p_member).reference_photo_path = null; return json(route, null); }
  if (p === '/rest/v1/rpc/set_reference_photo') { me.reference_photo_path = body.p_path; return json(route, null); }
  if (p.startsWith('/storage/v1/object/authenticated/photos/')) {
    const bytes = photos.get(p.replace('/storage/v1/object/authenticated/photos/', ''));
    return bytes ? route.fulfill({ status: 200, contentType: 'image/jpeg', body: bytes }) : json(route, { message: 'Not found' }, 404);
  }
  if (p.startsWith('/storage/v1/object/photos/') && m === 'POST') {
    const path = p.replace('/storage/v1/object/photos/', '');
    if (photos.has(path)) return json(route, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }, 400);
    photos.set(path, req.postDataBuffer());
    return json(route, { Key: 'photos/' + path });
  }
  if (p === '/rest/v1/rpc/invite_preview') {
    const x = people.find((y) => y.invite_token === body.p_token);
    return json(route, x ? [{ first_name: x.full_name.split(' ')[0], company_name: company.name }] : []);
  }
  if (p === '/functions/v1/accept-invite') {
    const x = people.find((y) => y.invite_token === body.token);
    Object.assign(x, { user: 'u-remi', joined_at: '2026-11-14', invite_token: null });
    return json(route, { login_email: x.phone.slice(1) + '@phone.usepinga.com' });
  }
  return json(route, { message: 'not faked: ' + m + ' ' + p }, 404);
}

// ── Browser on a small phone, with fake camera and GPS ──────
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const phone = { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const ctx = await browser.newContext({ ...phone, serviceWorkers: 'block', permissions: ['geolocation', 'camera'],
  geolocation: { latitude: 6.5096, longitude: 3.3712, accuracy: 12 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e));
await page.route(/\/(auth|rest|functions|storage)\/v1\//, fakeSupabase);
await page.route(/tile\.openstreetmap\.org/, (r) => r.abort()); // no map tiles in tests; pins still draw

let n = 0;
const shot = async (name) => page.screenshot({ path: `${out}${String(++n).padStart(2, '0')}-${name}.png` });
const step = (name) => console.log('ok -', name);
const until = async (fn, what) => { for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error('Timed out waiting for ' + what); };
const goOnline = () => page.evaluate(() => dispatchEvent(new Event('online')));

// Slow phone + slow 3G: how long until the sign-in screen is usable?
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 50000, uploadThroughput: 50000 });
const t0 = Date.now();
await page.goto(base);
await page.getByRole('heading', { name: 'Sign in' }).waitFor();
const loadMs = Date.now() - t0;
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
step(`sign-in screen ready in ${(loadMs / 1000).toFixed(1)}s on a 4x slower phone over slow 3G`);
await shot('staff-sign-in');

// ── Staff: sign in, reference photo ─────────────────────────
await page.getByLabel('Phone number').fill('0803 123 4567');
await page.getByLabel('PIN').fill('999999');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByText('Wrong phone number or PIN.').waitFor();
step('wrong PIN shows a plain message');
await page.getByLabel('PIN').fill('482913');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByRole('heading', { name: 'Your photo' }).waitFor();
await page.getByRole('button', { name: 'I agree, take photo' }).waitFor();
await page.waitForTimeout(500);
await shot('staff-reference-photo');
await page.getByRole('button', { name: 'I agree, take photo' }).click();
await page.getByText("You haven't clocked in today.").waitFor();
const ref = [...photos.keys()].find((k) => k.includes('reference'));
assert.ok(ref?.startsWith('c1/m1/'), 'reference photo saved in own folder');
step(`first sign-in asks for a reference photo (${(photos.get(ref).length / 1024).toFixed(0)} KB)`);
await shot('staff-home');

// ── Clock in at the office ──────────────────────────────────
await page.getByRole('link', { name: 'Clock in' }).click();
await page.getByText('At Yaba office ✓').waitFor();
await page.getByRole('button', { name: 'Take photo and clock in' }).waitFor();
await shot('staff-clock-in');
await page.getByRole('button', { name: 'Take photo and clock in' }).click();
await page.getByText(/Clocked in at .* · 12 min late/).waitFor();
assert.equal(attendance.length, 1);
const photoKb = photos.get(attendance[0].photo_path).length / 1024;
assert.ok(photoKb <= 50, `photo is ${photoKb} KB`);
step(`clock-in at the office: GPS + photo (${photoKb.toFixed(0)} KB, under 50 KB) sent; lateness shown`);
await shot('staff-clocked-in');

// ── Clock out with no signal; sends later ───────────────────
networkDown = true;
await page.getByRole('link', { name: 'Clock out' }).click();
await page.getByRole('button', { name: 'Take photo and clock out' }).click();
await page.getByText(/Clocked out at/).first().waitFor();
await page.getByText('1 waiting to send · will send when you have signal').waitFor();
assert.equal(attendance.length, 1, 'nothing reached the server yet');
step('no signal: clock-out saved on the phone, "1 waiting to send" shown');
await shot('staff-offline-waiting');
await page.reload();
await page.getByText('1 waiting to send').waitFor();
step('closing and reopening the app with no signal keeps the waiting clock-out');
await page.getByRole('button', { name: 'Sign out' }).click();
await page.getByText("Some check-ins haven't been sent yet").waitFor();
step('cannot sign out while clock-ins are waiting (they would be lost)');
const tappedAt = Date.now();
await page.waitForTimeout(1500);
networkDown = false;
await goOnline();
await page.getByText('1 waiting to send').waitFor({ state: 'hidden' });
assert.equal(attendance.length, 2);
assert.ok(Date.parse(attendance[1].happened_at) < tappedAt, 'saved time is when they tapped, not when it was sent');
step('signal back: sent automatically, with the time of tapping');

// ── Clock in from 1 km away: allowed but flagged ────────────
await ctx.setGeolocation({ latitude: 6.5185, longitude: 3.3711, accuracy: 15 });
await page.getByRole('link', { name: 'Clock in' }).click();
await page.getByText("You're 1.0 km from Yaba office. You can still clock in; your manager will see this.").waitFor();
await shot('staff-clock-in-far');
await page.getByRole('button', { name: 'Take photo and clock in' }).click();
await page.getByText(/Clocked in at/).first().waitFor();
await until(() => attendance.length === 3, 'the far clock-in to be sent');
assert.deepEqual(attendance[2].flags, ['outside_radius']);
step('clock-in 1 km away is allowed but flagged for the manager');
await ctx.setGeolocation({ latitude: 6.5096, longitude: 3.3712, accuracy: 12 });
await page.getByRole('button', { name: 'Sign out' }).click();

// ── Owner: offices, hours, a person's clock-ins ─────────────
await page.getByRole('link', { name: 'Business owner? Sign in with email' }).click();
await page.getByLabel('Email').fill('elvis@chfheron.com');
await page.getByLabel('Password').fill('password1');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByRole('heading', { name: /, Elvis$/ }).waitFor();
step('owner signs in and lands on Overview');
await page.getByRole('link', { name: 'Today', exact: true }).click();
await page.getByText('Late · 12 min').waitFor();
step('Today shows Sade late');
await page.getByRole('link', { name: 'Team', exact: true }).click();
await page.getByRole('heading', { name: 'Team' }).waitFor();
step('Team is its own tab');
await shot('owner-team');

await page.getByRole('link', { name: 'Setup', exact: true }).click();
await page.getByText('Off until the AWS keys are added. Clock-ins work as normal.').waitFor();
step('Setup shows face check is off (waiting for the AWS keys) and clock-ins work as normal');
await shot('owner-setup');
await page.getByRole('link', { name: /^Offices/ }).click();
await page.getByRole('link', { name: 'Add office' }).click();
await page.getByLabel('Name').fill('Ikeja office');
await page.getByRole('button', { name: 'Use my current location' }).click();
await page.getByText(/Location found \(within/).waitFor();
assert.equal(await page.getByLabel('Location').inputValue(), '6.509600, 3.371200');
await shot('owner-add-office');
await page.getByRole('button', { name: 'Save' }).click();
await page.getByText('Ikeja office').waitFor();
step('owner adds an office by standing in it and tapping "Use my current location"');
await shot('owner-offices');

await page.getByRole('link', { name: '‹ Setup' }).click();
await page.getByRole('link', { name: /^Working hours/ }).click();
await page.getByLabel('Work starts').fill('08:30');
await shot('owner-hours');
await page.getByRole('button', { name: 'Save' }).click();
await page.getByText('Working hours saved').waitFor();
assert.equal(company.work_starts, '08:30:00');
step('owner changes working hours');

// As if the face check had run: Sade's first clock-in didn't match her reference photo.
Object.assign(attendance[0], { flags: [...attendance[0].flags, 'face_mismatch'], face_similarity: 41.2 });
await page.getByRole('link', { name: 'Team', exact: true }).click();
await page.getByRole('link', { name: /Sade Bello/ }).click();
await page.getByRole('heading', { name: 'Recent clock-ins' }).waitFor();
await page.waitForFunction(() => [...document.querySelectorAll('img[data-photo]')].every((i) => i.complete && i.naturalWidth > 0));
await page.getByText(/Outside the office \(1\.0 km\)/).waitFor();
await page.getByText("Face didn't match (41% alike)").waitFor();
step('owner sees each clock-in with its photo, lateness and flags, including "Face didn\'t match (41% alike)"');
await shot('owner-person-clock-ins');
page.once('dialog', (d) => d.accept());
await page.getByRole('button', { name: 'Ask for a new reference photo' }).click();
await page.getByText('Sade will be asked for a reference photo next time they open Pinga.').waitFor();
assert.equal(people.find((x) => x.id === 'm1').reference_photo_path, null);
step('owner asks for a new reference photo');
await page.getByRole('link', { name: '‹ Team' }).click();

// ── Owner: stores and a rep's stores ────────────────────────
await page.getByRole('link', { name: 'Setup', exact: true }).click();
await page.getByRole('link', { name: /^Stores/ }).click();
await page.getByRole('link', { name: 'Add store' }).click();
await page.getByLabel('Name').fill('Spar Lekki');
await page.getByLabel('Address (optional)').fill('Admiralty Way, Lekki');
await shot('owner-add-store');
await page.getByRole('button', { name: 'Save' }).click();
await page.getByText('No location yet · first visit will save it').waitFor();
step('owner adds a store with just a name and address');
await shot('owner-stores');
await page.getByRole('link', { name: 'Team', exact: true }).click();
await page.getByRole('link', { name: /Remi Okafor/ }).click();
await page.getByRole('heading', { name: 'Details' }).waitFor();
await page.getByLabel('Visits per day').fill('3');
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.getByText('Target saved: 3 visits a day').waitFor();
await page.getByRole('link', { name: /Assigned stores/ }).click();
await page.getByRole('heading', { name: 'Stores for Remi' }).waitFor();
for (const n of ['Shoprite Ikeja', 'Spar Lekki', 'Ebeano Ikota']) await page.getByText(n, { exact: true }).click();
await page.getByText('3 selected').waitFor();
await shot('owner-assign-stores');
await page.getByRole('button', { name: 'Save' }).click();
await page.getByText('Remi now covers 3 stores').waitFor();
assert.equal(assignments.length, 3);
step('owner sets a daily target and ticks the stores a rep covers');
await page.getByRole('link', { name: '‹ Team' }).click();
await page.getByRole('button', { name: 'Sign out' }).click();

// ── New sales rep joins from their WhatsApp link ────────────
await page.goto(base + '#/join/' + 'f'.repeat(32));
await page.getByRole('heading', { name: 'Welcome, Remi' }).waitFor();
await page.getByLabel('New PIN').fill('111111');
await page.getByLabel('Type it again').fill('111111');
await page.getByRole('button', { name: 'Save PIN' }).click();
await page.getByText('Use 6 digits that are hard to guess').waitFor();
step('easy PINs are refused');
await page.getByLabel('New PIN').fill('482913');
await page.getByLabel('Type it again').fill('482913');
await page.getByRole('button', { name: 'Save PIN' }).click();
await page.getByRole('heading', { name: 'Your photo' }).waitFor();
step('new rep sets a PIN from the invite link and is signed in');
await page.getByRole('button', { name: 'I agree, take photo' }).click();

// ── Field visits ────────────────────────────────────────────
await ctx.setGeolocation({ latitude: 6.6019, longitude: 3.3516, accuracy: 12 }); // standing at Shoprite Ikeja
await page.getByRole('heading', { name: 'Hi, Remi' }).waitFor();
await page.getByText('No visits yet today').waitFor();
await page.getByText('Nearest · go here next').waitFor();
const order = await page.locator('.store b:not(.ic b)').allTextContents();
assert.deepEqual(order.filter((x) => isNaN(x)), ['Shoprite Ikeja', 'Ebeano Ikota', 'Spar Lekki'], 'nearest first; stores with no location last');
step('rep sees "0 of 3", their stores nearest first, the nearest highlighted');
await shot('rep-today');

await page.getByRole('button', { name: /Shoprite Ikeja/ }).click();
await page.getByText("✓ You're at the store").waitFor();
await shot('rep-check-in');
await page.getByRole('button', { name: 'Add shelf photo (optional)' }).click();
await page.getByRole('button', { name: 'Take shelf photo' }).click();
await page.getByRole('img', { name: 'Shelf photo' }).waitFor();
await page.getByLabel('Note (optional)').fill('Low stock on Sebamed, met the store manager');
await page.getByRole('button', { name: 'Take selfie and check in' }).waitFor();
await shot('rep-check-in-with-shelf-photo');
await page.getByRole('button', { name: 'Take selfie and check in' }).click();
await page.getByText('1 of 3 visits done today').waitFor();
await page.getByText(/Visited \d/).waitFor();
await until(() => visits.length === 1, 'the visit to be sent');
assert.deepEqual(visits[0].flags, []);
assert.ok(photos.has(visits[0].selfie_path) && photos.has(visits[0].shelf_photo_path), 'selfie and shelf photo uploaded');
assert.ok(photos.get(visits[0].shelf_photo_path).length <= 80 * 1024);
step('check-in at the store: GPS + selfie + shelf photo + note; "1 of 3" and "Visited"');
await shot('rep-today-1-done');

await ctx.setGeolocation({ latitude: 6.4400, longitude: 3.4700, accuracy: 12 }); // at Spar Lekki
await page.getByRole('button', { name: /Spar Lekki/ }).click();
await page.getByText("This store's location isn't saved yet. Checking in here will save it.").waitFor();
await page.getByRole('button', { name: 'Take selfie and check in' }).click();
await page.getByText('2 of 3 visits done today').waitFor();
await until(() => visits.length === 2, 'the second visit to be sent');
assert.deepEqual(visits[1].flags, ['store_located']);
assert.equal(stores.find((x) => x.name === 'Spar Lekki').lat, 6.44);
step('first visit to a store with no location saves its location (flagged for the manager)');

await page.getByRole('button', { name: /Ebeano Ikota/ }).click();
await page.getByText("You're outside this store's zone").waitFor();
await page.getByRole('button', { name: 'Pick another store' }).waitFor();
await shot('rep-outside-zone');
page.once('dialog', (d) => d.accept());
networkDown = true;
await page.getByRole('button', { name: 'Check in anyway (flagged)' }).click();
await page.getByText('Target reached').waitFor();
await page.getByText('1 check-in saved on this phone').waitFor();
step('outside the zone: "Pick another store", or check in anyway after a warning; no signal: saved on the phone');
await shot('rep-target-reached-offline');
networkDown = false;
await goOnline();
await page.getByText('1 check-in saved on this phone').waitFor({ state: 'hidden' });
await until(() => visits.length === 3, 'the third visit to be sent');
assert.deepEqual(visits[2].flags, ['outside_radius']);
step('signal back: the visit is sent and flagged "outside the store"');

await page.getByRole('link', { name: 'History' }).click();
await page.getByRole('heading', { name: 'History' }).waitFor();
await page.getByText('3 visits').waitFor();
await shot('rep-history');
step('History shows the last 30 days, with flags');
await page.getByRole('button', { name: 'Sign out' }).click();

// Owner sees Remi's visits.
await page.getByRole('link', { name: 'Business owner? Sign in with email' }).click();
await page.getByLabel('Email').fill('elvis@chfheron.com');
await page.getByLabel('Password').fill('password1');
await page.getByRole('button', { name: 'Sign in' }).click();

// ── Owner dashboard ─────────────────────────────────────────
await page.getByRole('heading', { name: /, Elvis$/ }).waitFor();
assert.match(await page.locator('.stats').innerText(), /1\s*Present\s*1\s*Late\s*1\s*Not in\s*0\s*Leave · Off/);
await page.getByText('3 of 3 planned visits done').waitFor();
await page.locator('.map .leaflet-interactive').first().waitFor();
assert.equal(await page.locator('.map .leaflet-interactive').count(), 3, 'three stores on the map');
await page.getByText('was late 3 times in the last 2 weeks').waitFor();
await page.getByText('hours lost to lateness and absence').waitFor();
step('Overview: present/late/not in, field visits 3 of 3 with stores on a map, patterns, lost time');
await shot('owner-overview');

// ── Manager's Today page ────────────────────────────────────
await page.getByRole('link', { name: 'Today', exact: true }).click();
await page.getByRole('heading', { name: 'Today' }).waitFor();
const statusOf = (name) => page.locator('.brow', { hasText: name }).locator('.right').innerText();
assert.match(await statusOf('Sade Bello'), /Late · 12 min\n2 to check/);  // outside the office + face didn't match
assert.match(await statusOf('Remi Okafor'), /Present\n1 to check/);
assert.match(await page.locator('.brow', { hasText: 'Remi Okafor' }).innerText(), /3 of 3 visits/);
assert.match(await statusOf('Tunde Ade'), /No check-in/);
step('Today shows everyone: Late (12 min), Present with "3 of 3 visits", No check-in, and records to check');
await shot('owner-today');

await page.getByRole('button', { name: /^No check-in/ }).click();
assert.equal(await page.locator('.brow').count(), 1);
await page.getByRole('checkbox', { name: 'Select Tunde Ade' }).check();
await page.getByText('1 selected').waitFor();
await shot('owner-today-bulk-bar');
await page.getByRole('button', { name: 'Leave', exact: true }).click();     // one person: no confirm needed
await page.getByText('1 person marked On leave').waitFor();
await page.getByRole('button', { name: /^All/ }).click();
assert.match(await statusOf('Tunde Ade'), /Leave\nset by manager/);
step('filter "No check-in", tick one, tap Leave: marked "set by manager" (no confirm for one person)');

let asked = '';
page.once('dialog', (d) => { asked = d.message(); d.accept(); });
await page.getByRole('checkbox', { name: 'Select all shown' }).check();
await page.getByText('3 selected').waitFor();
await page.getByRole('button', { name: 'Present', exact: true }).click();
await page.getByText('3 people marked Present').waitFor();
assert.match(asked, /^Mark 3 people as Present on today\?$/);
assert.match(await statusOf('Sade Bello'), /Present\nset by manager/);
step('select all, Present: asks "Mark 3 people as Present on today?" first');

page.once('dialog', (d) => { asked = d.message(); d.accept(); });
await page.getByRole('checkbox', { name: 'Select all shown' }).check();
await page.getByRole('button', { name: 'Clear' }).click();
await page.getByText('Cleared 3 people').waitFor();
assert.match(asked, /clock-ins and visits are not changed/);
assert.match(await statusOf('Sade Bello'), /Late · 12 min/);
assert.match(await statusOf('Tunde Ade'), /No check-in/);
step('Clear removes only what managers set: Sade is back to Late from her clock-in');

const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date(Date.now() - 864e5));
await page.locator('#day').fill(yesterday);
await page.getByRole('link', { name: 'Back to today' }).waitFor();
assert.match(await statusOf('Tunde Ade'), /Absent/);
await page.getByRole('checkbox', { name: 'Select Tunde Ade' }).check();
await page.getByRole('button', { name: 'Off', exact: true }).click();
await page.getByText('1 person marked Off').waitFor();
assert.match(await statusOf('Tunde Ade'), /Off\nset by manager/);
assert.ok(dayStatus.has('m3|' + yesterday));
step('fix a past date: yesterday shows Absent; marked Off');
await shot('owner-fix-past-date');
await page.getByRole('link', { name: 'Back to today' }).click();
await page.getByRole('heading', { name: 'Today' }).waitFor();

// Pay (owner only) and the cost of lost time.
await page.getByRole('link', { name: 'Team', exact: true }).click();
await page.getByRole('link', { name: /Sade Bello/ }).click();
await page.getByLabel('Home office').selectOption({ label: 'Yaba office' });
await page.getByLabel('Monthly pay (₦) (optional)').fill('150000');
await shot('owner-person-pay');
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.getByText('Saved', { exact: true }).waitFor();
assert.equal(payRates.get('m1'), 150000);
assert.equal(people.find((x) => x.id === 'm1').branch_id, 'b1');
await page.getByRole('link', { name: '‹ Team' }).click();
await page.getByRole('link', { name: 'Overview', exact: true }).click();
await page.getByText('₦48,500').waitFor();
step('owner sets monthly pay and home office; Overview shows lost time in naira');
await shot('owner-overview-naira');

// Export the register (real Excel file) and the evening email switch.
await page.getByRole('link', { name: 'Setup', exact: true }).click();
await page.getByRole('switch', { name: 'Evening summary email' }).or(page.getByLabel('Evening summary email')).uncheck();
await page.getByText('Evening summary off').waitFor();
assert.equal(company.summary_email, false);
step('owner can turn the evening email off');
await page.getByRole('link', { name: /^Export register/ }).click();
await shot('owner-export');
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Excel file' }).click()]);
const xlsxPath = out + 'register.xlsx';
await dl.saveAs(xlsxPath);
const sheet = JSON.parse(execFileSync('python3', ['-I', '-c', 'import json,sys,openpyxl; ws=openpyxl.load_workbook(sys.argv[1]).active; print(json.dumps([list(r) for r in ws.iter_rows(values_only=True)]))', xlsxPath]).toString());
assert.deepEqual(sheet[0].slice(0, 4), ['Date', 'Name', 'Role', 'Status']);
assert.ok(sheet.length > 3 && sheet.some((r) => r[1] === 'Sade Bello'), 'register rows for this month');
step(`Excel export downloads a real .xlsx (${sheet.length - 1} rows) that a spreadsheet program opens`);

// ── Billing (Paystack, test mode) ───────────────────────────
await page.getByRole('link', { name: '‹ Setup' }).click();
await page.getByText('Your free trial ends in 2 days. Set up payment ›').waitFor();
step('owner sees "Your free trial ends in 2 days" (staff never see it)');
await page.getByRole('link', { name: /^Billing/ }).click();
await page.getByText('Free trial', { exact: true }).waitFor();
await page.getByText('Test mode: payments use Paystack test cards. No real money is taken.').waitFor();
assert.match(await page.locator('.offices').innerText(), /Office staff · 2 × ₦1,500\s+₦3,000\s+Sales reps · 1 × ₦2,500\s+₦2,500\s+Total a month\s+₦5,500/);
step('Billing: free trial, price for the team (2 office staff × ₦1,500 + 1 rep × ₦2,500 = ₦5,500), test-mode notice');
await shot('owner-billing-trial');
await page.getByRole('button', { name: 'Pay ₦5,500 with Paystack' }).click();
await page.getByRole('heading', { name: 'Payment received' }).waitFor();
step('Pay → Paystack → back to Pinga: payment confirmed with Paystack');
await shot('owner-billing-paid');
await page.getByRole('link', { name: 'Back to Billing' }).click();
await page.getByText('Active', { exact: true }).waitFor();
await page.getByText(/Visa •••• 4081 \(expires 12\/30\) · renews automatically each month/).waitFor();
assert.equal(await page.getByRole('button', { name: /^Pay / }).count(), 0, 'no Pay button once paid ahead');
step('Billing shows Active, the saved card for monthly renewal, and the payment');
await shot('owner-billing-active');
bill.bigTeam = true;   // as if the team had grown to 100 people
await page.reload();
await page.getByText('Volume discount (100+ people) · 10% off').waitFor();
assert.match(await page.locator('.offices').innerText(), /−₦15,100\s+Total a month\s+₦135,900/);
step('a team of 100+ sees the volume discount: ₦151,000 − 10% = ₦135,900 a month');
await shot('owner-billing-volume-discount');
bill.bigTeam = false;

// Face-match threshold (owner only).
await page.getByRole('link', { name: '‹ Setup' }).click();
await page.getByRole('link', { name: /^Face check/ }).click();
await page.getByLabel('Match needed (%)').fill('80');
await shot('owner-face-setting');
await page.getByRole('button', { name: 'Save' }).click();
await page.getByText('Saved: selfies must be 80% alike').waitFor();
assert.equal(company.face_match_percent, 80);
step('owner lowers the face-match threshold to 80% for the pilot');
await page.getByRole('heading', { name: 'Setup' }).waitFor();   // saving returns to Setup
await page.getByRole('link', { name: 'Team', exact: true }).click();
await page.getByRole('link', { name: /Remi Okafor/ }).click();
await page.getByRole('heading', { name: 'Recent visits' }).waitFor();
await page.waitForFunction(() => [...document.querySelectorAll('img[data-photo]')].every((i) => i.complete && i.naturalWidth > 0));
await page.getByText('“Low stock on Sebamed, met the store manager”').waitFor();
await page.getByText('Store location saved from this visit').waitFor();
step('owner sees each visit with selfie, shelf photo, note and flags');
await shot('owner-rep-visits');
await page.getByRole('link', { name: '‹ Team' }).click();
await page.getByRole('button', { name: 'Sign out' }).click();

await page.goto(base + '#/join/' + 'f'.repeat(32));
await page.getByRole('heading', { name: 'This link has expired' }).waitFor();
step('a used invite link cannot be used again');

// No signal on a screen that needs it.
networkDown = true;
await page.goto(base + '#/join/' + 'e'.repeat(32));
await page.getByText('No connection. Check your internet and try again.').waitFor();
step('no signal shows a calm message with "Try again", not a crash');
networkDown = false;

assert.deepEqual(errors, [], 'no uncaught errors in the page');
step('no uncaught errors');

// ── The app opens with no signal at all (service worker) ────
const swCtx = await browser.newContext(phone);
const swPage = await swCtx.newPage();
await swPage.goto(base);
await swPage.evaluate(() => navigator.serviceWorker.ready);
await swPage.waitForTimeout(500);
await swCtx.setOffline(true);
await swPage.reload();
await swPage.getByRole('heading', { name: 'Sign in' }).waitFor();
step('the app opens with no signal at all once it has been opened before');
await swCtx.close();

await browser.close();
server.close();
console.log(`\nScreenshots saved in ${out}`);
