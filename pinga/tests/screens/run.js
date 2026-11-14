// Walks through every screen in a real browser on a small phone screen, against a
// pretend Supabase, with a fake camera and fake GPS. Saves screenshots to tests/screens/output/.
// Also measures the first load with a 4x slower CPU and slow 3G, and opening the app with no signal.
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import { server } from '../../scripts/serve.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const out = new URL('./output/', import.meta.url).pathname;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// ── Pretend Supabase ────────────────────────────────────────
const YABA = { lat: 6.5095, lng: 3.3711 };
const company = { id: 'c1', name: 'CHF Heron', timezone: 'Africa/Lagos', work_starts: '08:00:00', work_ends: '17:00:00', late_after_minutes: 15, work_days: [1, 2, 3, 4, 5] };
const branches = [{ id: 'b1', company_id: 'c1', name: 'Yaba office', address: '12 Herbert Macaulay Way', radius_m: 100, ...YABA }];
const people = [
  { id: 'm0', user: 'u-owner', full_name: 'Elvis Uzorka', role: 'owner', phone: null, joined_at: '2026-11-14', invite_token: null, reference_photo_path: null },
  { id: 'm1', user: 'u-sade', full_name: 'Sade Bello', role: 'staff', phone: '+2348031234567', joined_at: '2026-11-14', invite_token: null, reference_photo_path: null },
  { id: 'm2', user: null, full_name: 'Remi Okafor', role: 'rep', phone: '+2348059876543', joined_at: null, invite_token: 'f'.repeat(32), reference_photo_path: null },
];
const attendance = [];
const photos = new Map();
let networkDown = false;
let signedInAs = null;

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const dist = (a, b) => { const r = (d) => (d * Math.PI) / 180; const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2; return 2 * 6371000 * Math.asin(Math.sqrt(h)); };
const lagosDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date(iso));
const param = (q, k) => new URLSearchParams(q).get(k)?.replace(/^(eq|is)\./, '');

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
    const row = { id: 'm' + people.length, user: null, joined_at: null, invite_token: 'a1b2'.repeat(8), reference_photo_path: null, ...body };
    people.push(row);
    return json(route, [row]);
  }
  if (p === '/rest/v1/companies' && m === 'PATCH') { Object.assign(company, body, { work_starts: body.work_starts + ':00' }); return json(route, [company]); }
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

let n = 0;
const shot = async (name) => page.screenshot({ path: `${out}${String(++n).padStart(2, '0')}-${name}.png` });
const step = (name) => console.log('ok -', name);
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
await page.getByRole('button', { name: 'Take photo' }).waitFor();
await page.waitForTimeout(500);
await shot('staff-reference-photo');
await page.getByRole('button', { name: 'Take photo' }).click();
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
await page.getByText("Some clock-ins haven't been sent yet").waitFor();
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
assert.deepEqual(attendance[2].flags, ['outside_radius']);
step('clock-in 1 km away is allowed but flagged for the manager');
await ctx.setGeolocation({ latitude: 6.5096, longitude: 3.3712, accuracy: 12 });
await page.getByRole('button', { name: 'Sign out' }).click();

// ── Owner: offices, hours, a person's clock-ins ─────────────
await page.getByRole('link', { name: 'Business owner? Sign in with email' }).click();
await page.getByLabel('Email').fill('elvis@chfheron.com');
await page.getByLabel('Password').fill('password1');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByRole('heading', { name: 'Team' }).waitFor();
step('owner signs in and sees the team');
await shot('owner-team');

await page.getByRole('link', { name: 'Offices' }).click();
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

await page.getByRole('link', { name: 'Hours' }).click();
await page.getByLabel('Work starts').fill('08:30');
await shot('owner-hours');
await page.getByRole('button', { name: 'Save' }).click();
await page.getByText('Working hours saved').waitFor();
assert.equal(company.work_starts, '08:30:00');
step('owner changes working hours');

await page.getByRole('link', { name: 'Team' }).click();
await page.getByRole('link', { name: /Sade Bello/ }).click();
await page.getByRole('heading', { name: 'Recent clock-ins' }).waitFor();
await page.waitForFunction(() => [...document.querySelectorAll('img[data-photo]')].every((i) => i.complete && i.naturalWidth > 0));
await page.getByText(/Outside the office \(1\.0 km\)/).waitFor();
step('owner sees each clock-in with its photo, lateness and any flags');
await shot('owner-person-clock-ins');
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
await page.getByText("You're all set up as sales rep at CHF Heron.").waitFor();
step('new rep sets a PIN from the invite link and is signed in');
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
