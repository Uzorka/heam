// Part C in a real browser: the landing page, signing up with the 6-digit email code, and the setup
// wizard, at phone, tablet and desktop sizes, against a pretend Supabase. Screenshots: tests/screens/output/signup/.
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import { server } from '../../scripts/serve.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const out = new URL('./output/signup/', import.meta.url).pathname;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const PLANS = { trial_days: 30, starter: { price: 5000, staff: 5, locations: 1 }, business: { shop: 5000, shop_staff: 5, extra_staff: 1000, office_staff: 1500, rep: 2500 }, discounts: [] };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const param = (q, k) => new URLSearchParams(q).get(k)?.replace(/^(eq|is|neq)\./, '');

// One pretend backend per browser window (each size signs up its own business).
function backend() {
  const s = { company: null, branches: [], products: [], staff: [], stock: [], calls: [], signups: [] };
  const owner = () => ({ id: 'm-owner', role: 'owner', full_name: 'Ada Okoro', company_id: 'c9', branch_id: null, companies: s.company });
  s.route = async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname, q = url.search, m = req.method();
    const body = (m === 'POST' || m === 'PATCH') && !p.startsWith('/storage/') ? req.postDataJSON() : null;
    if (p.startsWith('/rest/v1/rpc/')) s.calls.push([p.slice(13), body]);
    if (p === '/auth/v1/signup') { s.signups.push(body); return json(route, { id: 'u-new', email: body.email, confirmation_sent_at: new Date().toISOString() }); }
    if (p === '/auth/v1/resend') return json(route, {});
    if (p === '/auth/v1/verify') {
      if (body.token !== '123456' || body.type !== 'signup') return json(route, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' }, 403);
      return json(route, { access_token: 'at-new', refresh_token: 'rt', expires_in: 3600, user: { id: 'u-new', email: body.email } });
    }
    if (p === '/auth/v1/logout') return route.fulfill({ status: 204 });
    if (p === '/rest/v1/rpc/server_now') return json(route, new Date().toISOString());
    if (p === '/rest/v1/rpc/plans') return json(route, PLANS);
    if (p === '/rest/v1/rpc/app_flags') return json(route, {});
    if (p === '/rest/v1/rpc/create_company') {
      s.company = { id: 'c9', name: body.p_name, business_type: body.p_type, plan: body.p_plan, setup_done: false, setup_step: 3, status: 'trial',
        trial_ends_at: new Date(Date.now() + 30 * 864e5).toISOString(), timezone: 'Africa/Lagos', work_starts: '08:00:00', work_ends: '17:00:00', late_after_minutes: 15, work_days: [1, 2, 3, 4, 5],
        phone: body.p_phone, address: null, logo_path: null, sell_requires_clock_in: true, staff_below_lowest: false };
      return json(route, 'c9');
    }
    if (p === '/rest/v1/rpc/save_setup') { Object.assign(s.company, { setup_step: body.p_step, setup_done: s.company.setup_done || body.p_done }); return json(route, null); }
    if (p === '/rest/v1/rpc/set_business_type') { s.company.business_type = body.p_type; return json(route, null); }
    if (p === '/rest/v1/rpc/set_plan') { s.company.plan = body.p_plan; return json(route, null); }
    if (p === '/rest/v1/rpc/set_stock') { s.stock.push(body); return json(route, null); }
    if (p === '/rest/v1/companies' && m === 'PATCH') { Object.assign(s.company, body); return json(route, [s.company]); }
    if (p === '/rest/v1/members' && m === 'GET') {
      if (param(q, 'user_id')) return json(route, s.company ? [owner()] : []);
      return json(route, s.staff);
    }
    if (p === '/rest/v1/members' && m === 'POST') {
      if (s.company.plan === 'starter' && s.staff.length >= 5) return json(route, { code: 'P0001', message: 'Starter includes up to 5 staff. Move to Business in Setup → Billing to add more.' }, 400);
      const row = { id: 'm' + (s.staff.length + 1), joined_at: null, invite_token: 'c0ffee'.repeat(5) + s.staff.length + 'a', ...body };
      s.staff.push(row);
      return json(route, [row]);
    }
    if (p === '/rest/v1/branches' && m === 'GET') return json(route, s.branches);
    if (p === '/rest/v1/branches' && m === 'POST') {
      if (s.company.plan === 'starter' && s.branches.length) return json(route, { code: 'P0001', message: 'Starter includes 1 shop or office.' }, 400);
      const b = { id: 'b' + (s.branches.length + 1), kind: 'office', ...body }; s.branches.push(b); return json(route, [b]);
    }
    if (p === '/rest/v1/products' && m === 'GET') return json(route, [...s.products].reverse());
    if (p === '/rest/v1/products' && m === 'POST') { const x = { id: 'p' + (s.products.length + 1), ...body }; s.products.push(x); return json(route, [x]); }
    if (p.startsWith('/storage/v1/object/logos/')) return json(route, { Key: p });
    return json(route, []);
  };
  return s;
}

await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch();
const SIZES = [['phone', 375, 812, { isMobile: true, hasTouch: true }], ['tablet', 820, 1180, { isMobile: true, hasTouch: true }], ['desktop', 1440, 900, {}]];
const until = async (fn, ms = 5000) => { const t = Date.now(); while (!(await fn())) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 50)); } };

for (const [size, width, height, extra] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, serviceWorkers: 'block', permissions: ['geolocation'],
    geolocation: { latitude: 6.5095, longitude: 3.3711, accuracy: 12 }, ...extra });
  const be = backend();
  await ctx.route(/\/(auth|rest|functions|storage)\/v1\//, be.route);
  // Map tiles: a plain square instead of OpenStreetMap (no outside calls in tests).
  await ctx.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#EDE6DA"/><path d="M0 128h256M128 0v256" stroke="#fff" stroke-width="10"/></svg>' }));
  // WhatsApp opens in a new window: record it instead.
  await ctx.addInitScript(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Screenshots wait for any "Saved" message to go, so they show the screen itself.
  const shot = async (name, full = false) => {
    await page.locator('.toast').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    await page.screenshot({ path: `${out}${size}-${name}.png`, fullPage: full });
  };
  const noSideScroll = async (what) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${size}: ${what} fits the screen width`);

  // ── The landing page ──
  await page.goto(base + 'home/');
  await page.getByRole('heading', { name: 'Run your shops and your team from your phone.' }).waitFor();
  await until(() => page.evaluate(() => document.querySelector('[data-p="business.rep"]').textContent === '₦2,500'));
  assert.equal(await page.locator('header .btn-main').getAttribute('href'), base + '#/signup/starter', 'Start free goes to sign-up with the Starter plan');
  assert.equal(await page.locator('#pricing .plan').nth(1).locator('a.btn').getAttribute('href'), base + '#/signup/business', 'the Business card signs up on Business');
  assert.ok(await page.getByText('Coming soon').first().isVisible(), 'Premium is shown as coming soon');
  await noSideScroll('landing page');
  await shot('01-landing', true);
  await page.locator('#faq summary').first().click();
  assert.ok(await page.getByText("No. Your first month is free and we don't ask for a card.", { exact: false }).isVisible(), 'FAQs open');
  console.log(`ok - ${size}: landing page with what it does, who it's for, plans and prices (from the database), FAQs and Start free`);

  // ── Sign up ──
  await page.locator('header .btn-main').click();
  await page.getByRole('heading', { name: 'Start free' }).waitFor();
  assert.ok(await page.locator('input[name=plan][value=starter]').isChecked(), 'the plan chosen on the landing page is ticked');
  await page.getByLabel('Your name').fill('ada okoro');
  await page.getByLabel('Phone number').fill('0803 111 2222');
  await page.getByLabel('Email').fill('ada@mamaput.ng');
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByText('Use at least 8 characters for your password.').waitFor();
  await page.getByLabel('Password').fill('mamaput2026');
  await shot('02-signup');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('heading', { name: 'Check your email' }).waitFor();
  assert.equal(be.signups[0].email, 'ada@mamaput.ng');
  await page.getByLabel('6-digit code').fill('654321');
  await page.getByText('That code is wrong or too old.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'send a new code' }).click();
  await page.getByText('New code sent').waitFor();
  await shot('03-code');
  await page.getByLabel('6-digit code').fill('123456');   // the 6th digit sends it
  console.log(`ok - ${size}: sign-up (name, phone, email, password), then the 6-digit email code; a wrong code says so; a new code can be sent`);

  // ── 1. Business type ──
  await page.getByRole('heading', { name: 'What kind of business?' }).waitFor();
  assert.equal(await page.locator('.wiz-step').textContent(), 'Step 1 of 6');
  await page.locator('.type-card', { hasText: 'Field sales' }).click();
  assert.ok(await page.locator('#plan-note').isVisible(), 'choosing Field sales on Starter explains it comes with Business');
  await page.locator('.type-card', { hasText: 'Shop / Storefront' }).click();
  assert.ok(await page.locator('#plan-note').isHidden());
  await shot('04-type');
  await page.getByRole('button', { name: 'Next' }).click();

  // ── 2. Business details ──
  await page.getByRole('heading', { name: 'Your business' }).waitFor();
  assert.equal(await page.locator('.wiz-step').textContent(), 'Step 2 of 6');
  assert.equal(await page.getByLabel('Business phone (optional)').inputValue(), '0803 111 2222', 'the phone from sign-up is filled in');
  await page.getByRole('link', { name: 'Back' }).click();
  await page.getByRole('heading', { name: 'What kind of business?' }).waitFor();
  assert.ok(await page.locator('input[name=type][value=storefront]').isChecked(), 'Back keeps the answer');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByText('Please enter the business name.').waitFor();
  await page.getByLabel('Business name').fill('Mama Put Stores');
  await page.getByLabel('Address (optional)').fill('12 Herbert Macaulay Way, Yaba');
  await shot('05-details');
  await page.getByRole('button', { name: 'Next' }).click();

  // ── 3. The shop, with a pin on the map ──
  await page.getByRole('heading', { name: 'Add your shop' }).waitFor();
  assert.deepEqual(be.calls.find((c) => c[0] === 'create_company')[1], { p_name: 'Mama Put Stores', p_owner_name: 'Ada Okoro', p_type: 'storefront', p_plan: 'starter', p_phone: '+2348031112222' });
  assert.equal(be.company.address, '12 Herbert Macaulay Way, Yaba');
  assert.equal(await page.locator('.wiz-step').textContent(), 'Step 3 of 6');
  await page.locator('.leaflet-marker-icon').waitFor();
  await page.getByLabel('Shop name').fill('Yaba shop');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByText('Show us where the shop is', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Use my current location' }).click();
  await page.getByText('Found you (within 12 m).', { exact: false }).waitFor();
  await shot('06-shop-map');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('heading', { name: 'Your products' }).waitFor();
  assert.equal(be.branches[0].name, 'Yaba shop');
  assert.ok(Math.abs(be.branches[0].lat - 6.5095) < 1e-4 && be.branches[0].kind === 'shop', 'the shop is saved where the pin is');
  console.log(`ok - ${size}: wizard steps 1-3: business type cards with examples, details (Back keeps answers), the shop on a map (GPS pin)`);

  // ── 4. Products ──
  assert.equal(await page.locator('.wiz-step').textContent(), 'Step 4 of 6');
  assert.ok(await page.getByText('Comes with the Business plan').isVisible(), 'Starter: Excel import shown as a Business feature');
  await shot('07-products-choice');
  await page.getByRole('link', { name: /Add a few by hand/ }).click();
  await page.getByLabel('Product name').fill('Peak Milk 400g');
  await page.getByLabel('Price (₦)').pressSequentially('2500');
  assert.equal(await page.getByLabel('Price (₦)').inputValue(), '2,500', 'prices get commas as you type');
  await page.getByLabel('In stock').fill('24');
  await page.getByRole('button', { name: 'Add product' }).click();
  await page.locator('.wiz-list', { hasText: 'Peak Milk 400g' }).waitFor();
  await page.getByLabel('Product name').fill('Coke 50cl');
  await page.getByLabel('Price (₦)').pressSequentially('300');
  await page.getByRole('button', { name: 'Add product' }).click();
  await page.locator('.wiz-list', { hasText: 'Coke 50cl' }).waitFor();
  assert.deepEqual(be.stock[0], { p_branch: 'b1', p_product: 'p1', p_qty: 24, p_expires_on: null, p_note: 'Added during setup' });
  await shot('08-products');
  await page.getByRole('button', { name: 'Next' }).click();

  // ── 5. Invite staff ──
  await page.getByRole('heading', { name: 'Invite your staff' }).waitFor();
  assert.equal(await page.locator('.wiz-step').textContent(), 'Step 5 of 6');
  await page.getByLabel('Full name').fill('kemi adebayo');
  await page.getByLabel('Phone number').fill('0805 333 4444');
  await page.getByRole('button', { name: 'Send invite on WhatsApp' }).click();
  await page.locator('.wiz-list', { hasText: 'Kemi Adebayo' }).waitFor();
  const wa = await page.evaluate(() => window.__opened[0]);
  assert.ok(wa.startsWith('https://wa.me/2348053334444?text=') && decodeURIComponent(wa).includes(`${base}#/join/`), 'the invite link goes to their WhatsApp');
  assert.equal(be.staff[0].branch_id, 'b1', 'with one shop, staff are put in it');
  await shot('09-invite');
  await page.getByRole('button', { name: 'Next' }).click();

  // ── 6. Done ──
  await page.getByRole('heading', { name: "You're ready" }).waitFor();
  assert.equal(await page.locator('.wiz-step').textContent(), 'Step 6 of 6');
  assert.ok(be.company.setup_done, 'finishing the wizard marks the business as set up');
  assert.equal(await page.getByRole('link', { name: 'Open Sell' }).getAttribute('href'), '#/sell');
  assert.equal(await page.getByRole('link', { name: 'See Today' }).getAttribute('href'), '#/today');
  await noSideScroll('the wizard');
  await shot('10-done');
  console.log(`ok - ${size}: wizard steps 4-6: products by hand (Excel is Business), invite on WhatsApp, "You're ready" with Sell and Today`);

  // Progress is saved: an owner who leaves on step 3 comes back to step 3.
  be.company.setup_done = false; be.company.setup_step = 3;
  await page.evaluate(() => { location.hash = '#/'; });
  await page.getByRole('heading', { name: 'Your shops' }).waitFor();
  assert.ok(await page.getByText('Starter includes 1 shop or office.', { exact: false }).isVisible(), 'Starter: one shop');
  await page.locator('#skip').count().then((n) => assert.equal(n, 0, 'nothing to skip once the shop is added'));
  console.log(`ok - ${size}: progress is saved (coming back opens the step they left)`);

  assert.deepEqual(errors, [], `${size}: no errors on the page`);
  await ctx.close();
}

// A Field sales business has no products step (5 steps), and the plan moves to Business.
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block', isMobile: true, hasTouch: true });
  const be = backend();
  await ctx.route(/\/(auth|rest|functions|storage)\/v1\//, be.route);
  await ctx.route(/tile\.openstreetmap\.org/, (r) => r.abort());
  const page = await ctx.newPage();
  await page.goto(base + '#/signup/starter');
  await page.getByLabel('Your name').fill('Bola Ade');
  await page.getByLabel('Phone number').fill('08031112223');
  await page.getByLabel('Email').fill('bola@distri.ng');
  await page.getByLabel('Password').fill('distri2026!');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('6-digit code').fill('123456');
  await page.locator('.type-card', { hasText: 'Field sales' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('heading', { name: 'Your business' }).waitFor();
  assert.equal(await page.locator('.wiz-step').textContent(), 'Step 2 of 5');
  await page.getByLabel('Business name').fill('Bola Distribution');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('heading', { name: 'Add your office' }).waitFor();
  assert.equal(be.company.plan, 'business', 'Field sales starts on Business');
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('heading', { name: 'Invite your staff' }).waitFor();
  assert.equal(await page.locator('.wiz-step').textContent(), 'Step 4 of 5', 'no products step for Field sales');
  assert.equal(await page.locator('select[name=branch]').count(), 0, 'no shop to choose for office staff');
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('heading', { name: "You're ready" }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Open Sell' }).count(), 0, 'no Sell button without shops');
  console.log('ok - Field sales: 5 steps (no products), starts on Business, every optional step can be skipped');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`Screenshots saved in ${out}`);
