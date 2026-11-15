// Walks through every screen in a real browser on a small phone screen, against a
// pretend Supabase, with a fake camera and fake GPS. Saves screenshots to tests/screens/output/.
// Also measures the first load with a 4x slower CPU and slow 3G, and opening the app with no signal.
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { server } from '../../scripts/serve.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const out = process.env.SHOTS_DIR || new URL('./output/', import.meta.url).pathname;   // SHOTS_DIR / SHOTS_WIDTH: for before/after comparisons
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// ── Pretend Supabase ────────────────────────────────────────
const YABA = { lat: 6.5095, lng: 3.3711 };
const company = { id: 'c1', name: 'CHF Heron', summary_email: true, status: 'trial', trial_ends_at: new Date(Date.now() + 2 * 864e5 - 3600e3).toISOString(), business_type: 'field', timezone: 'Africa/Lagos', work_starts: '08:00:00', work_ends: '17:00:00', late_after_minutes: 15, work_days: [1, 2, 3, 4, 5] };
const branches = [{ id: 'b1', company_id: 'c1', name: 'Yaba office', address: '12 Herbert Macaulay Way', radius_m: 100, ...YABA }];
const people = [
  { id: 'm0', user: 'u-owner', full_name: 'elvis uzorka', role: 'owner', phone: null, joined_at: '2026-11-14', invite_token: null, reference_photo_path: null, branch_id: null },
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
const managerShops = [];
const products = [];
const stockRows = new Map();     // `${branch}|${product}` -> { qty, expires_on }
const stockChanges = [];
const stockImports = [];
const sales = [];
const logos = new Map();
const receiptNo = new Map();
const visits = [];
const dayStatus = new Map(); // `${member}|${day}` -> status
const payRates = new Map();
const bill = { status: 'trial', paid_until: null, card: null, invoices: [], paymentsOn: false };
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
      : body.email === '2348059876543@phone.usepinga.com' && body.password === '482913' ? 'u-remi'
      : body.email === '2348035550101@phone.usepinga.com' && body.password === '482913' ? 'u-kemi' : null;
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
    const role = param(q, 'role');
    return json(route, people.filter((x) => !role || x.role === role).sort((a, b) => a.full_name.localeCompare(b.full_name)));
  }
  if (p === '/rest/v1/members' && m === 'POST') {
    if (people.some((x) => x.phone === body.phone)) return json(route, { code: '23505', message: 'duplicate' }, 409);
    const row = { id: 'm' + (people.length + 10), user: null, joined_at: null, invite_token: 'a1b2'.repeat(8), reference_photo_path: null, ...body };
    people.push(row);
    return json(route, [row]);
  }
  if (p === '/rest/v1/companies' && m === 'PATCH') { Object.assign(company, body, body.work_starts ? { work_starts: body.work_starts + ':00' } : {}); return json(route, [company]); }
  if (p === '/rest/v1/branches' && m === 'GET') return json(route, param(q, 'id') ? branches.filter((b) => b.id === param(q, 'id')) : branches);
  if (p === '/rest/v1/branches' && m === 'PATCH') { Object.assign(branches.find((x) => x.id === param(q, 'id')), body); return json(route, []); }
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
  if (p === '/rest/v1/store_assignments' && m === 'GET') {
    const mid = param(q, 'member_id'), sid = param(q, 'store_id');
    return json(route, assignments.filter((a) => (!mid || a.member_id === mid) && (!sid || a.store_id === sid)).map((a) => ({ store_id: a.store_id, member_id: a.member_id })));
  }
  if (p === '/rest/v1/manager_shops' && m === 'GET') return json(route, managerShops.filter((x) => x.manager_id === param(q, 'manager_id')));
  if (p === '/rest/v1/manager_shops' && m === 'POST') { managerShops.push(...body); return route.fulfill({ status: 201 }); }
  if (p === '/rest/v1/manager_shops' && m === 'DELETE') {
    const mid = param(q, 'manager_id'), drop = /branch_id=in\.\(([^)]*)\)/.exec(decodeURIComponent(q))[1].split(',');
    for (let i = managerShops.length - 1; i >= 0; i--) if (managerShops[i].manager_id === mid && drop.includes(managerShops[i].branch_id)) managerShops.splice(i, 1);
    return route.fulfill({ status: 204 });
  }
  // ── Products and stock ──
  if (p === '/rest/v1/products' && m === 'GET') {
    const id = param(q, 'id');
    return json(route, products.filter((x) => (id ? x.id === id : !q.includes('active=is.true') || x.active)).sort((a, b) => a.name.localeCompare(b.name)));
  }
  if (p === '/rest/v1/products' && m === 'POST') {
    if (products.some((x) => x.name.toLowerCase() === body.name.toLowerCase())) return json(route, { code: '23505', message: 'duplicate key value violates unique constraint "products_name"' }, 409);
    const row = { id: 'p' + (products.length + 1), active: true, code: null, price: null, lowest_price: null, low_stock_at: 5, ...body };
    products.push(row); return json(route, [row]);
  }
  if (p === '/rest/v1/products' && m === 'PATCH') { const x = products.find((y) => y.id === param(q, 'id')); Object.assign(x, body); return json(route, [x]); }
  if (p === '/rest/v1/stock' && m === 'GET') {
    const b = param(q, 'branch_id'), pid = param(q, 'product_id');
    return json(route, [...stockRows].filter(([k]) => k.startsWith(b + '|') && (!pid || k.endsWith('|' + pid))).map(([k, v]) => ({ product_id: k.split('|')[1], ...v })));
  }
  if (p === '/rest/v1/stock_changes' && m === 'GET') {
    const b = param(q, 'branch_id'), pid = param(q, 'product_id');
    return json(route, stockChanges.filter((c) => c.branch_id === b && c.product_id === pid).reverse());
  }
  if (p === '/rest/v1/stock_imports' && m === 'GET') return json(route, [...stockImports].reverse());
  const applyStock = (b, pid, qty, add, exp, reason, note) => {
    const k = b + '|' + pid, old = stockRows.get(k), now = add ? (old?.qty || 0) + qty : qty;
    stockRows.set(k, { qty: now, expires_on: exp || old?.expires_on || null });
    stockChanges.push({ branch_id: b, product_id: pid, change: now - (old?.qty || 0), qty_after: now, reason, note: note || null, by_name: me.full_name, created_at: new Date().toISOString() });
  };
  if (p === '/rest/v1/rpc/import_stock') {
    let fresh = 0, units = 0;
    for (const i of body.p_rows) {
      let x = products.find((y) => (i.code && y.code?.toLowerCase() === i.code.toLowerCase()) || (i.name && y.name.toLowerCase() === i.name.toLowerCase()));
      if (!x) { x = { id: 'p' + (products.length + 1), active: true, name: i.name, code: i.code, price: i.price ?? null, lowest_price: i.lowest_price ?? null, low_stock_at: i.low_stock_at ?? 5 }; products.push(x); fresh++; }
      else Object.assign(x, i.price != null ? { price: i.price } : {});
      applyStock(body.p_branch, x.id, i.qty, body.p_kind === 'delivery', i.expires_on, body.p_kind);
      units += i.qty;
    }
    stockImports.push({ kind: body.p_kind, file_name: body.p_file_name, rows: body.p_rows.length, new_products: fresh, units, by_name: me.full_name, created_at: new Date().toISOString(), branch_id: body.p_branch });
    return json(route, { rows: body.p_rows.length, new_products: fresh, units });
  }
  if (p === '/rest/v1/rpc/set_stock') { applyStock(body.p_branch, body.p_product, body.p_qty, false, body.p_expires_on, 'correction', body.p_note); return json(route, null); }
  if (p === '/rest/v1/rpc/clear_expiry') { stockRows.get(body.p_branch + '|' + body.p_product).expires_on = null; return json(route, null); }
  if (p === '/rest/v1/rpc/stock_alerts') {
    return json(route, [...stockRows].filter(([k]) => k.startsWith(body.p_branch + '|')).flatMap(([k, v]) => {
      const x = products.find((y) => y.id === k.split('|')[1]);
      const soon = v.expires_on && v.qty > 0 && v.expires_on <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
      return soon || v.qty <= x.low_stock_at ? [{ product_id: x.id, product: x.name, qty: v.qty, alert: soon ? 'expiring' : v.qty <= 0 ? 'out' : 'low' }] : [];
    }));
  }
  // ── Sales ──
  if (p === '/rest/v1/sales' && m === 'GET') {
    const id = param(q, 'id'), mid = param(q, 'member_id'), b = param(q, 'branch_id'), day = param(q, 'local_date');
    return json(route, sales.filter((x) => (!id || x.id === id) && (!mid || x.member_id === mid) && (!b || x.branch_id === b) && (!day || x.local_date === day))
      .sort((a, c) => c.happened_at.localeCompare(a.happened_at)));
  }
  if (p === '/rest/v1/rpc/record_sale') {
    const had = sales.find((x) => x.id === body.p_id);
    if (had) return json(route, had);
    let total = 0, discount = 0; const flags = new Set();
    const sale_items = body.p_items.map((i, n) => {
      const x = products.find((y) => y.id === i.product_id), before = stockRows.get(body.p_branch + '|' + x.id)?.qty ?? 0;
      const f = [...(x.lowest_price != null && i.unit_price < x.lowest_price ? ['below_lowest'] : []), ...(before < i.qty ? ['out_of_stock'] : [])];
      f.forEach((y) => flags.add(y));
      total += i.qty * i.unit_price;
      if (x.price != null && i.unit_price < x.price) discount += i.qty * (x.price - i.unit_price);
      applyStock(body.p_branch, x.id, -i.qty, true, null, 'sale');
      return { line: n + 1, product_id: x.id, product_name: x.name, qty: i.qty, unit_price: i.unit_price, list_price: x.price, lowest_price: x.lowest_price, stock_before: before, flags: f };
    });
    const shopName = branches.find((b) => b.id === body.p_branch).name, n = (receiptNo.get(body.p_branch) || 0) + 1;
    receiptNo.set(body.p_branch, n);
    const row = { id: body.p_id, branch_id: body.p_branch, member_id: me.id, seller_name: me.full_name, happened_at: body.p_happened_at, local_date: lagosDate(body.p_happened_at),
      payment_method: body.p_payment || 'cash', receipt_token: body.p_receipt_token || 'server' + 'x'.repeat(20) + sales.length,
      receipt_code: shopName.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() + '-' + String(n).padStart(6, '0'),
      total, discount, flags: [...flags], cancelled_at: null, cancelled_by_name: null, cancel_reason: null, mistake_note: null, mistake_at: null, sale_items };
    sales.push(row);
    return json(route, row);
  }
  if (p === '/rest/v1/rpc/report_sale_mistake') { Object.assign(sales.find((x) => x.id === body.p_sale), { mistake_note: body.p_note, mistake_at: new Date().toISOString() }); return json(route, null); }
  if (p === '/rest/v1/rpc/cancel_sale') {
    const x = sales.find((y) => y.id === body.p_sale);
    Object.assign(x, { cancelled_at: new Date().toISOString(), cancelled_by_name: me.full_name, cancel_reason: body.p_reason });
    x.sale_items.forEach((i) => applyStock(x.branch_id, i.product_id, i.qty, true, null, 'sale_cancelled', body.p_reason));
    return json(route, null);
  }
  if (p === '/rest/v1/rpc/shop_sales_summary') {
    const day = sales.filter((x) => x.branch_id === body.p_branch && x.local_date === body.p_day), live = day.filter((x) => !x.cancelled_at);
    return json(route, { sales: live.length, total: live.reduce((t, x) => t + x.total, 0), discount: live.reduce((t, x) => t + x.discount, 0),
      cancelled: day.length - live.length, flagged: live.filter((x) => x.flags.length).length, mistakes: live.filter((x) => x.mistake_note).length });
  }
  if (p === '/rest/v1/rpc/shops_overview') {
    const live = sales.filter((x) => x.local_date === body.p_day && !x.cancelled_at);
    const shopsList = branches.filter((b) => b.kind === 'shop');   // like the database: offices are never shops
    const qty = new Map(); live.flatMap((x) => x.sale_items).forEach((i) => qty.set(i.product_name, (qty.get(i.product_name) || 0) + i.qty));
    const alertsOf = (b) => [...stockRows].filter(([k]) => k.startsWith(b + '|')).map(([k, v]) => ({ v, x: products.find((y) => y.id === k.split('|')[1]) })).filter(({ v, x }) => v.qty <= x.low_stock_at);
    return json(route, { total: live.reduce((t, x) => t + x.total, 0), sales: live.length, discount: live.reduce((t, x) => t + x.discount, 0),
      shops: shopsList.map((b) => { const mine = live.filter((x) => x.branch_id === b.id), al = alertsOf(b.id);
        return { id: b.id, name: b.name, total: mine.reduce((t, x) => t + x.total, 0), sales: mine.length, to_check: mine.filter((x) => x.flags.length || x.mistake_note).length,
          low: al.filter(({ v }) => v.qty > 0).length, out: al.filter(({ v }) => v.qty <= 0).length, expiring: 0 }; }),
      best: [...qty].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, qty: n })) });
  }
  if (p === '/rest/v1/rpc/set_business_type') { company.business_type = body.p_type; return json(route, null); }
  if (p === '/rest/v1/store_assignments' && m === 'POST') { assignments.push(...body); return route.fulfill({ status: 201 }); }
  if (p === '/rest/v1/store_assignments' && m === 'DELETE') {
    const dq = decodeURIComponent(q);
    const stores = /store_id=in\.\(([^)]*)\)/.exec(dq)?.[1].split(',') || [param(q, 'store_id')];
    const members = /member_id=in\.\(([^)]*)\)/.exec(dq)?.[1].split(',') || [param(q, 'member_id')];
    for (let i = assignments.length - 1; i >= 0; i--) if (stores.includes(assignments[i].store_id) && members.includes(assignments[i].member_id)) assignments.splice(i, 1);
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
      quote: company.business_type === 'storefront' ? (() => {
        const per = new Map(); joined.filter((x) => x.role === 'staff' && x.branch_id).forEach((x) => per.set(x.branch_id, (per.get(x.branch_id) || 0) + 1));
        const extra = [...per.values()].reduce((t, k) => t + Math.max(0, k - 3), 0), loose = joined.filter((x) => x.role === 'staff' && !x.branch_id).length;
        const gross = per.size * 5000 + (extra + loose) * 1000;
        return { staff_seats: 0, rep_seats: 0, staff_price: 1500, rep_price: 2500, shop_seats: per.size, shop_price: 5000, shop_included_staff: 3, shop_extra_staff: extra,
          loose_staff: loose, extra_staff_price: 1000, gross_kobo: gross * 100, discount_percent: 0, discount_min_people: null, amount_kobo: gross * 100 };
      })() : bill.bigTeam
        ? { staff_seats: 99, rep_seats: 1, staff_price: 1500, rep_price: 2500, gross_kobo: 15100000, discount_percent: 10, discount_min_people: 100, amount_kobo: 13590000 }
        : { staff_seats: staff, rep_seats: reps, staff_price: 1500, rep_price: 2500, gross_kobo: (staff * 1500 + reps * 2500) * 100, discount_percent: 0, discount_min_people: null, amount_kobo: (staff * 1500 + reps * 2500) * 100 },
      card: bill.card, invoices: bill.invoices });
  }
  if (p === '/rest/v1/rpc/setup_progress') return json(route, { offices: branches.length > 0, stores: stores.length > 0,
    people: people.filter((x) => ['staff', 'rep'].includes(x.role)).length, first_check_in: attendance.length + visits.length > 0, first_sale: sales.length > 0 });
  if (p === '/rest/v1/rpc/app_flags') return json(route, { payments: bill.paymentsOn, face_check: false });
  if (p === '/functions/v1/billing/status') return json(route, { enabled: bill.paymentsOn });
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
  // Logos: public files.
  if (p.startsWith('/storage/v1/object/logos/') && m === 'POST') { logos.set(p.replace('/storage/v1/object/logos/', ''), req.postDataBuffer()); return json(route, { Key: p }); }
  if (p.startsWith('/storage/v1/object/logos/') && m === 'DELETE') { logos.delete(p.replace('/storage/v1/object/logos/', '')); return json(route, {}); }
  if (p.startsWith('/storage/v1/object/public/logos/')) {
    const bytes = logos.get(p.replace('/storage/v1/object/public/logos/', ''));
    return bytes ? route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: bytes }) : route.fulfill({ status: 404 });
  }
  if (p === '/rest/v1/rpc/receipt') {
    const x = sales.find((y) => y.receipt_token === body.p_token);
    if (!x) return json(route, null);
    const b = branches.find((y) => y.id === x.branch_id);
    return json(route, { business: company.name, logo_path: b.logo_path || company.logo_path || null, shop: b.name, address: b.address || null, phone: b.phone || null,
      number: x.receipt_code, at: x.happened_at, timezone: 'Africa/Lagos', served_by: x.seller_name.split(' ')[0],
      items: x.sale_items.map((i) => ({ name: i.product_name, qty: i.qty, price: i.unit_price })), discount: x.discount, total: x.total,
      payment: x.payment_method, note: company.receipt_note, cancelled: !!x.cancelled_at });
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
const phone = { viewport: { width: Number(process.env.SHOTS_WIDTH) || 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const ctx = await browser.newContext({ ...phone, serviceWorkers: 'block', permissions: ['geolocation', 'camera'],
  geolocation: { latitude: 6.5096, longitude: 3.3712, accuracy: 12 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e));
await page.route(/\/(auth|rest|functions|storage)\/v1\//, fakeSupabase);
await page.route(/tile\.openstreetmap\.org/, (r) => r.abort()); // no map tiles in tests; pins still draw

let n = 0;
const shot = async (name) => {
  // Guard: no unfilled \${…} placeholders may ever reach the screen.
  const text = await page.locator('body').innerText();
  assert.ok(!text.includes('${'), `unfilled placeholder on screen "${name}": ${text.slice(text.indexOf('${'), text.indexOf('${') + 40)}`);
  return page.screenshot({ path: `${out}${String(++n).padStart(2, '0')}-${name}.png` });
};
const step = (name) => console.log('ok -', name);
let EMPTY_CHECKS = () => {};   // replaced below
// Pinga's own dialog (instead of the browser's): returns its question and answers OK (typing `text` if it asks).
const accept = async (text, p = page) => {
  const d = p.locator('dialog.dlg[open]');
  await d.waitFor();
  const q = await d.locator('.dlg-msg').innerText();
  if (text != null) await d.locator('input').fill(text);
  await d.locator('[type=submit]').click();
  await d.waitFor({ state: 'detached' });
  return q;
};
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
await page.getByText('At Yaba office', { exact: true }).waitFor();
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
await page.getByText("Some records haven't been sent yet").waitFor();
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
// CHF Heron is a Field sales business: no shop features anywhere.
assert.equal(company.business_type, 'field');
assert.deepEqual(await page.locator('.tabbar.manager a[href^="#/"] span').allInnerTexts(), ['Overview', 'Today', 'Team', 'Setup'], 'Field sales: no Stock tab');
assert.equal(await page.getByText(/Add your shop|Sales today/).count(), 0, 'Field sales: no shop checklist or sales card');
assert.equal(await page.locator('header .company svg.logo').count(), 1, 'no logo uploaded: the Pinga pin, not an empty space');
step('Field sales (CHF Heron): no Stock tab, no shop checklist, no sales card');
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

await page.getByRole('link', { name: 'Back to Setup' }).click();
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
await page.getByRole('button', { name: 'Ask for a new reference photo' }).click();
await accept();
await page.getByText('Sade will be asked for a reference photo next time they open Pinga.').waitFor();
assert.equal(people.find((x) => x.id === 'm1').reference_photo_path, null);
step('owner asks for a new reference photo');
await page.getByRole('link', { name: 'Back to Team' }).click();

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
await page.getByText("3 stores aren't assigned to a sales rep yet. Tap a store to choose who visits it.").waitFor();
assert.equal(await page.locator('.pill.wait', { hasText: 'Not assigned yet' }).count(), 3);
step('Stores shows which stores have no sales rep yet, with a reminder');
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
await page.getByRole('link', { name: 'Back to Team' }).click();
await page.getByText('3 stores · 3 visits a day').filter({ visible: true }).waitFor();
step('Team shows each sales rep\'s stores and visits a day');
await page.getByRole('link', { name: 'Setup', exact: true }).click();
await page.getByRole('link', { name: /^Stores/ }).click();
await page.getByText('Visited by Remi').first().waitFor();
assert.equal(await page.locator('.pill.wait', { hasText: 'Not assigned yet' }).count(), 0);
await page.getByRole('link', { name: /Spar Lekki/ }).click();
await page.getByRole('group', { name: 'Sales reps who visit this store' }).waitFor();
assert.ok(await page.getByRole('checkbox', { name: /Remi Okafor/ }).isChecked(), 'store screen shows Remi already visits it');
await page.getByRole('checkbox', { name: /Remi Okafor/ }).uncheck();
await page.getByRole('button', { name: 'Save' }).click();
await page.getByText("1 store isn't assigned to a sales rep yet. Tap a store to choose who visits it.").waitFor();
assert.equal(assignments.length, 2);
await shot('owner-stores-coverage');
await page.getByRole('link', { name: /Spar Lekki/ }).click();
await page.getByRole('checkbox', { name: /Remi Okafor/ }).check();
await shot('owner-store-assign-reps');
await page.getByRole('button', { name: 'Save' }).click();
await until(() => assignments.length === 3, 'the store to be assigned again');
await page.getByText('Visited by Remi', { exact: false }).first().waitFor();
step('a store can be assigned to sales reps from the store screen too (untick, save, tick again)');
await page.getByRole('link', { name: 'Team', exact: true }).click();
await page.getByRole('link', { name: /Remi Okafor/ }).click();
await page.getByRole('link', { name: 'Back to Team' }).click();
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
await page.getByText(/^You're at the store/).waitFor();
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
networkDown = true;
await page.getByRole('button', { name: 'Check in anyway (flagged)' }).click();
await accept();
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
assert.match(await page.locator('.tiles').innerText(), /1\s*Present\s*1\s*Late\s*1\s*Not in\s*0\s*Leave or off/);
await page.getByText('3 of 3 planned visits done').waitFor();
await page.locator('.map .leaflet-interactive').first().waitFor();
assert.equal(await page.locator('.map .leaflet-interactive').count(), 3, 'three stores on the map');
await page.getByText('was late 3 times in the last 2 weeks').waitFor();
await page.getByText('hours lost to lateness and absence').waitFor();
step('Overview: present/late/not in, field visits 3 of 3 with stores on a map, patterns, lost time');
await shot('owner-overview');
assert.ok(await page.locator('.tabbar.manager').isVisible(), 'phones get the bottom tab bar');
assert.equal(await page.locator('.tabbar.manager a[href^="#/"]').count(), 4);
step('greeting capitalises the name ("elvis uzorka" → "Good …, Elvis"); bottom tab bar on phones');
const brand = await page.evaluate(async () => {
  await document.fonts.ready;
  const css = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
  return {
    nunito: document.fonts.check('800 16px Nunito') && document.fonts.check('400 16px Nunito') && [...document.fonts].some((f) => f.family.includes('Nunito') && f.status === 'loaded'),
    font: css('body', 'fontFamily'), bg: css('body', 'backgroundColor'), text: css('h1', 'color'),
    card: css('.card', 'backgroundColor'), logo: css('.logo > path', 'fill'),
    tabs: [...document.querySelectorAll('.tabbar.manager a[href^="#/"]')].map((a) => { const i = a.querySelector('svg').getBoundingClientRect(), l = a.querySelector('span').getBoundingClientRect(), b = a.getBoundingClientRect();
      return { w: Math.round(b.width), iconAbove: i.bottom <= l.top + 1, color: getComputedStyle(a).color, on: a.classList.contains('on') }; }),
  };
});
assert.ok(brand.nunito, 'Nunito font loaded');
assert.match(brand.font, /^Nunito/);
assert.equal(brand.bg, 'rgb(255, 248, 238)', 'cream background');
assert.equal(brand.text, 'rgb(20, 33, 61)', 'ink navy headings');
assert.equal(brand.card, 'rgb(255, 255, 255)', 'white cards');
assert.equal(brand.logo, 'rgb(255, 138, 31)', 'mango logo');
assert.equal(new Set(brand.tabs.map((t) => t.w)).size, 1, 'all tabs the same width');
assert.ok(brand.tabs.every((t) => t.iconAbove), 'icon on top, label underneath, on every tab');
assert.deepEqual(brand.tabs.map((t) => t.color), brand.tabs.map((t) => (t.on ? 'rgb(255, 138, 31)' : 'rgb(91, 100, 120)')), 'active tab mango, others muted');
step('brand: Nunito loaded, cream background, ink text, white cards, mango logo; tabs identical, active one mango');
await page.getByRole('link', { name: '1 Late: show on Today' }).click();
await page.getByRole('heading', { name: 'Today' }).waitFor();
const chipOn = async () => (await page.locator('.chip.on').textContent()).replace(/\s+/g, ' ').trim();
assert.equal(await chipOn(), 'Late 1');
assert.deepEqual(await page.locator('.brow b').allTextContents(), ['Sade Bello']);
const chipTops = await page.locator('.chip').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
assert.equal(new Set(chipTops).size, 1, 'filter chips stay in one scrollable row');
assert.ok(await page.locator('.chip.zero').count() > 0, 'chips with 0 are faded');
step('tapping the Late tile opens Today filtered to late people; chips in one row, zeros faded');
await page.goto(base + '#/today/notin');
await page.waitForFunction(() => document.querySelector('.chip.on')?.textContent.replace(/\s+/g, ' ').trim() === 'Not in 1');
assert.deepEqual(await page.locator('.brow b').allTextContents(), ['Tunde Ade']);
step('the "Not in" tile shows people with no check-in or absent');
await page.goto(base + '#/today/all');
await page.getByRole('link', { name: 'Overview', exact: true }).click();
await page.getByRole('heading', { name: /, Elvis$/ }).waitFor();

// ── Manager's Today page ────────────────────────────────────
await page.getByRole('link', { name: 'Today', exact: true }).click();
await page.getByRole('heading', { name: 'Today' }).waitFor();
const statusOf = (name) => page.locator('.brow', { hasText: name }).locator('.right').innerText();
// Waits (up to 5 s) for the Today list to show the expected status after an action.
const statusIs = async (name, re) => {
  let last = '';
  for (let i = 0; i < 50; i++) { last = await statusOf(name).catch(() => ''); if (re.test(last)) return; await page.waitForTimeout(100); }
  assert.match(last, re);
};
await statusIs('Sade Bello', /Late · 12 min\n2 to check/);  // outside the office + face didn't match
await statusIs('Remi Okafor', /Present\n1 to check/);
assert.match(await page.locator('.brow', { hasText: 'Remi Okafor' }).innerText(), /3 of 3 visits/);
await statusIs('Tunde Ade', /No check-in/);
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
await statusIs('Tunde Ade', /Leave\nset by manager/);
step('filter "No check-in", tick one, tap Leave: marked "set by manager" (no confirm for one person)');

let asked = '';
await page.getByRole('checkbox', { name: 'Select all shown' }).check();
await page.getByText('3 selected').waitFor();
await page.getByRole('button', { name: 'Present', exact: true }).click();
asked = await accept();
await page.getByText('3 people marked Present').waitFor();
assert.match(asked, /^Mark 3 people as Present on today\?$/);
await statusIs('Sade Bello', /Present\nset by manager/);
step('select all, Present: asks "Mark 3 people as Present on today?" first');

await page.getByRole('checkbox', { name: 'Select all shown' }).check();
await page.getByRole('button', { name: 'Clear' }).click();
asked = await accept();
await page.getByText('Cleared 3 people').waitFor();
assert.match(asked, /clock-ins and visits are not changed/);
await statusIs('Sade Bello', /Late · 12 min/);
await statusIs('Tunde Ade', /No check-in/);
step('Clear removes only what managers set: Sade is back to Late from her clock-in');

const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date(Date.now() - 864e5));
await page.locator('#day').fill(yesterday);
await page.getByRole('link', { name: 'Back to today' }).waitFor();
assert.match(await page.locator('.dayrow .dval').innerText(), /^\d{1,2} [A-Z][a-z]{2} \d{4}$/, 'dates read like "14 Nov 2026", never 11/14/2026');
await statusIs('Tunde Ade', /Absent/);
await page.getByRole('checkbox', { name: 'Select Tunde Ade' }).check();
await page.getByRole('button', { name: 'Off', exact: true }).click();
await page.getByText('1 person marked Off').waitFor();
await statusIs('Tunde Ade', /Off\nset by manager/);
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
await page.getByRole('link', { name: 'Back to Team' }).click();
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
await page.getByRole('link', { name: 'Back to Setup' }).click();
await page.getByRole('heading', { name: 'Setup' }).waitFor();
assert.equal(await page.getByText(/Your free trial ends/).count(), 0, 'no trial reminder while payments are switched off');
await page.getByRole('link', { name: /^Billing/ }).click();
await page.getByText("Online payment isn't switched on yet. Your trial continues and your team keeps working as normal.").waitFor();
assert.equal(await page.getByRole('button', { name: /^Pay / }).count(), 0, 'no Pay button while switched off');
step('payments switched off (no Paystack key yet): no Pay button, no reminders, trial continues');
await shot('owner-billing-switched-off');

// Switch payments on (as if PAYSTACK_SECRET_KEY had been saved).
bill.paymentsOn = true;
await page.evaluate(() => { location.hash = '#/'; });
await page.reload();
await page.getByRole('link', { name: 'Setup', exact: true }).click();
await page.getByText('Your free trial ends in 2 days. Set up payment ›').waitFor();
step('once payments are on, the owner sees "Your free trial ends in 2 days" (staff never see it)');
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
await page.getByRole('link', { name: 'Back to Setup' }).click();
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
await page.getByRole('link', { name: 'Back to Team' }).click();
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

// ── A brand-new company: nobody invited yet ─────────────────
people.splice(0, people.length, people.find((x) => x.role === 'owner'));
for (const a of [attendance, visits, stores, assignments, branches]) a.splice(0, a.length);
dayStatus.clear();
await page.goto(base + '#/owner');
await page.getByLabel('Email').fill('elvis@chfheron.com');
await page.getByLabel('Password').fill('password1');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByRole('heading', { name: /, Elvis$/ }).waitFor();
await page.waitForTimeout(300);
await shot('owner-overview-empty');
await page.getByRole('heading', { name: 'Get started' }).waitFor();
assert.equal(await page.locator('.tiles').count(), 0, 'no wall of zeros on Overview');
assert.equal(await page.locator('.checklist li.done').count(), 0, 'nothing ticked yet');
assert.equal(await page.locator('.checklist .tick svg').count(), 0, 'steps not done show an empty circle (no tick)');
assert.equal(await page.locator('.checklist a').count(), 1, 'only the next step is a link');
assert.equal(await page.locator('.checklist a .title').innerText(), 'Add an office or branch');
const twoLines = await page.locator('.checklist li').first().evaluate((li) => li.querySelector('.desc').getBoundingClientRect().top > li.querySelector('.title').getBoundingClientRect().bottom - 1);
assert.ok(twoLines, 'title and description on separate lines');
step('new company: Overview shows "Get started" (office, stores, invite, first clock-in), no zeros');
await page.goto(base + '#/today');
await page.getByRole('heading', { name: 'Today' }).waitFor();
await page.waitForTimeout(300);
await shot('owner-today-empty');
await page.getByRole('heading', { name: 'Get started' }).waitFor();
assert.equal(await page.locator('.chip').count(), 0, 'no filter chips until there is at least one person');
// Add an office: its step gets ticked.
branches.push({ id: 'b9', company_id: 'c1', name: 'Head office', radius_m: 100, lat: 6.5, lng: 3.37 });
await page.getByRole('link', { name: 'Overview', exact: true }).click();
await page.getByRole('heading', { name: /, Elvis$/ }).waitFor();
await page.waitForFunction(() => document.querySelectorAll('.checklist li.done').length === 1);
assert.equal(await page.locator('.checklist li.done .title').innerText(), 'Add an office or branch', 'adding an office ticks it');
assert.equal(await page.locator('.checklist li.done .tick svg').count(), 1, 'only the finished step shows a tick');
assert.equal(await page.locator('.checklist a .title').innerText(), 'Add your stores', 'the link moves to the next step');
step('new company: Today shows the checklist and no filter chips; steps tick as they are done');
await shot('owner-overview-getting-started');
await page.getByRole('button', { name: 'Sign out' }).click();

// Desktop: top segmented control, no bottom tab bar.
const desk = await browser.newContext({ viewport: { width: 1100, height: 800 }, serviceWorkers: 'block' });
const dp = await desk.newPage();
await dp.route(/\/(auth|rest|functions|storage)\/v1\//, fakeSupabase);
await dp.goto(base + '#/owner');
await dp.getByLabel('Email').fill('elvis@chfheron.com');
await dp.getByLabel('Password').fill('password1');
await dp.getByRole('button', { name: 'Sign in' }).click();
await dp.getByRole('heading', { name: /, Elvis$/ }).waitFor();
const side = await dp.locator('.appnav').boundingBox();
assert.ok(side.x === 0 && side.height >= 790 && side.width >= 90, 'on a wide screen the menu is down the left side');
step('wide screens: the menu moves to the left side (bottom tab bar on phones only)');
await dp.screenshot({ path: `${out}${String(++n).padStart(2, '0')}-owner-desktop.png` });
await desk.close();

// ── Storefront business: shops, shop staff, managers who look after shops ──
// A separate pretend business for the Storefront demo (CHF Heron itself stays Field sales).
company.business_type = 'storefront';
company.name = 'Mama Put Stores';
branches.splice(0, branches.length);
await page.goto(base + '#/owner');
await page.getByLabel('Email').fill('elvis@chfheron.com');
await page.getByLabel('Password').fill('password1');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByRole('heading', { name: /, Elvis$/ }).waitFor();
await page.getByRole('heading', { name: 'Get started' }).waitFor();
assert.deepEqual(await page.locator('.checklist .title').allInnerTexts(), ['Add your shop', 'Invite your shop staff', 'First clock-in'], 'Storefront checklist: no stores step');
assert.deepEqual(await page.locator('.tabbar.manager a[href^="#/"] span').allInnerTexts(), ['Overview', 'Today', 'Stock', 'Team', 'Setup'], 'Storefront has a Stock tab');
await shot('storefront-overview');
step('Storefront: checklist is shop, staff, first clock-in; tab bar has Stock');
await page.getByRole('link', { name: 'Setup', exact: true }).click();
await page.getByRole('link', { name: /^Business type/ }).waitFor();
assert.equal(await page.getByRole('link', { name: /^Stores/ }).count(), 0, 'no Stores row in a Storefront business');
await shot('storefront-setup');
await page.goto(base + '#/stores');
await page.getByRole('link', { name: /^Shops/ }).waitFor();
step('Storefront: Setup shows Shops and Business type, no Stores (and #/stores goes back to Setup)');
await page.getByRole('link', { name: /^Shops/ }).click();
await page.getByRole('link', { name: 'Add shop' }).click();
await page.getByLabel('Name').fill('Yaba shop');
await page.getByLabel('Location').fill('6.5095, 3.3711');
await page.getByRole('button', { name: 'Save' }).click();
await page.getByText('Shop saved').waitFor();
// Toasts: shown on the screen the action opened, gone after 3 seconds, cleared when you move on.
assert.equal(await page.locator('.toast').count(), 1);
const tb = await page.locator('.toast').boundingBox(), bar = await page.locator('.tabbar.manager').boundingBox();
assert.ok(tb.y + tb.height <= bar.y && bar.y - (tb.y + tb.height) < 16, 'the toast sits just above the tab bar');
await page.getByRole('link', { name: 'Team', exact: true }).click();
await page.getByRole('heading', { name: 'Team' }).waitFor();
assert.equal(await page.locator('.toast').count(), 0, 'the toast does not follow you to another page');
await page.getByRole('link', { name: 'Setup', exact: true }).click();
await page.getByRole('link', { name: /^Shops/ }).click();
await page.getByText('Yaba shop').waitFor();
await page.evaluate(() => import('./js/ui.js').then((m) => m.toast('Test')));
await page.waitForTimeout(3200);
assert.equal(await page.locator('.toast').count(), 0, 'a toast goes away after 3 seconds');
step('Toasts: above the tab bar, 3 seconds, never carried to an unrelated page');
assert.equal(branches.at(-1).kind, 'shop', 'a new shop is saved as a shop');
branches.push({ id: 'b8', company_id: 'c1', name: 'Surulere shop', radius_m: 100, lat: 6.5, lng: 3.35, kind: 'shop' });
await page.getByRole('link', { name: 'Setup', exact: true }).click();
await page.getByRole('link', { name: /^Shops/ }).click();
await page.getByText('Surulere shop').waitFor();
await shot('storefront-shops');
step('Storefront: owner adds a shop');
await page.getByRole('link', { name: 'Team', exact: true }).click();
await page.getByRole('link', { name: 'Invite someone' }).click();
await page.getByRole('heading', { name: 'Invite someone' }).waitFor();
assert.deepEqual(await page.locator('.choice strong').allInnerTexts(), ['Shop staff', 'Manager'], 'Storefront: no sales reps');
await page.getByLabel('Full name').fill('Kemi Yaba');
await page.getByLabel('Phone number').fill('0803 555 0101');
await page.getByRole('combobox', { name: 'Shop' }).selectOption({ label: 'Yaba shop' });
await shot('storefront-invite');
await page.getByRole('button', { name: 'Create invite' }).click();
await page.getByRole('heading', { name: 'Kemi Yaba' }).waitFor();
assert.equal(people.at(-1).branch_id, branches.find((b) => b.name === 'Yaba shop').id, 'shop staff are invited into their shop');
await page.getByText('Shop staff · ').waitFor();
step('Storefront: invite shop staff straight into a shop');
await page.goto(base + '#/invite');
await page.getByRole('heading', { name: 'Invite someone' }).waitFor();
await page.getByLabel('Full name').fill('Ade Manager');
await page.getByLabel('Phone number').fill('0803 555 0102');
await page.getByText('Looks after one or more shops').click();
assert.ok(!(await page.getByRole('combobox').isVisible()), 'no shop question for a manager');
await page.getByRole('button', { name: 'Create invite' }).click();
await page.getByRole('heading', { name: 'Shops they look after' }).waitFor();
await page.getByLabel('Yaba shop').check();
await page.getByRole('button', { name: 'Save shops' }).click();
await page.getByText('Ade looks after 1 shop').waitFor();
assert.deepEqual(managerShops.map((x) => x.branch_id), [branches.find((b) => b.name === 'Yaba shop').id], 'manager now looks after Yaba shop');
await shot('storefront-manager-shops');
await page.getByLabel('Surulere shop').check();
await page.getByLabel('Yaba shop').uncheck();
await page.getByRole('button', { name: 'Save shops' }).click();
await until(() => managerShops.length === 1 && managerShops[0].branch_id === 'b8', 'shops swapped');
step('Storefront: owner chooses which shops a manager looks after (and can change it)');
await page.goto(base + '#/stock');
await page.getByText('No products yet').waitFor();
assert.deepEqual((await page.locator('.chips .chip').allInnerTexts()).sort(), ['Surulere shop', 'Yaba shop'], 'one chip per shop');
await page.getByRole('link', { name: 'Yaba shop' }).click();
await page.waitForFunction(() => document.querySelector('.chip.on')?.textContent === 'Yaba shop');
await shot('stock-empty');
step('Stock: empty shop explains how to start (import or add)');

// Download the template, fill nothing in, import it straight back as a stock count.
await page.getByRole('link', { name: 'Import stock' }).click();
await page.getByRole('heading', { name: 'Import stock' }).waitFor();
await shot('stock-import');
const [tpl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download the template' }).click()]);
assert.equal(tpl.suggestedFilename(), 'Pinga-stock-template.xlsx');
const tplPath = out + 'template.xlsx';
await tpl.saveAs(tplPath);
const opened = execFileSync('python3', ['-c', 'import openpyxl,sys; ws=openpyxl.load_workbook(sys.argv[1]).active; print([c.value for c in ws[1]])', tplPath]).toString();
assert.match(opened, /Product name.*Quantity.*Selling price/, 'the template opens in a spreadsheet program');
await page.getByRole('button', { name: 'Check the file' }).click();
await page.getByText('Choose "stock count" or "delivery".').waitFor();
await page.getByText('This is a stock count').click();
await page.getByLabel('Excel or CSV file').setInputFiles(tplPath);
await page.getByRole('button', { name: 'Check the file' }).click();
await page.getByRole('heading', { name: 'Check before importing' }).waitFor();
assert.match(await page.locator('.big-line').innerText(), /2 products · 144 items · 2 new/);
await shot('stock-import-check');
await page.getByRole('button', { name: 'Save the count for 2 products' }).click();
await page.getByText('Imported 2 products (2 new)').waitFor();
rmSync(tplPath);
step('Import: template downloads as a real Excel file; importing it as a stock count shows a check screen first, then saves');

// A delivery from a CSV with a mistake in it.
await page.getByRole('link', { name: 'Import stock' }).click();
await page.getByText('This is a delivery').click();
await page.getByLabel('Excel or CSV file').setInputFiles({ name: 'delivery 15 Nov.csv', mimeType: 'text/csv',
  buffer: Buffer.from('Item,Qty,Price\r\nPeak Milk 400g,12,\r\nBread,-1,800\r\nGolden Penny Sugar 500g,3,"1,200"\r\n') });
await page.getByRole('button', { name: 'Check the file' }).click();
await page.getByText("1 row can't be imported and will be skipped:").waitFor();
await page.getByText('Row 3 (Bread): quantity "-1" should be a whole number, 0 or more').waitFor();
assert.match(await page.locator('.board').innerText(), /Peak Milk 400g\s+36\s+24 \+ 12/, 'shows what the shop will have after the delivery');
await shot('stock-import-problems');
await page.getByRole('button', { name: 'Add 15 items to Yaba shop' }).click();
await page.getByText('Imported 2 products (1 new)').waitFor();
await page.locator('#plist').getByText('Golden Penny Sugar 500g').waitFor();
assert.deepEqual(await page.locator('#plist .qty b').allInnerTexts(), ['3', '120', '36']);
assert.equal(await page.locator('#plist tbody tr', { hasText: 'Golden Penny Sugar' }).locator('.pill').innerText(), 'Low', '3 left (alert at 5) shows Low');
await shot('stock-list');
step('Import: a delivery adds to stock; a bad row is explained and skipped; low stock is marked');

// Correct one product, with a reason.
await page.locator('#plist').getByText('Peak Milk 400g').click();
await page.getByRole('heading', { name: 'Peak Milk 400g' }).waitFor();
await page.getByLabel('Quantity').fill('30');
await page.getByLabel(/Reason for a change/).fill('6 tins damaged');
await page.getByLabel(/Lowest price/).fill('2600');
await page.getByRole('button', { name: 'Save' }).click();
await page.getByText('The lowest price must be the same as or below the selling price.').waitFor();
await page.getByLabel(/Lowest price/).fill('2300');
await page.getByRole('button', { name: 'Save' }).click();
await page.locator('#plist').waitFor();
assert.equal(stockChanges.at(-1).note, '6 tins damaged');
assert.equal(stockChanges.at(-1).change, -6);
await page.locator('#plist').getByText('Peak Milk 400g').click();
await page.getByRole('heading', { name: 'Recent changes in Yaba shop' }).waitFor();
await shot('stock-product');
step('Product: prices checked (lowest ≤ selling); a stock correction is logged with who and why');
await page.goto(base + '#/imports');
await page.getByRole('heading', { name: 'Import history' }).waitFor();
assert.equal(await page.locator('.list li').count(), 2);
await shot('stock-import-history');
step('Import history lists every file: kind, shop, who, when, how many');

// ── Shop staff sell (with no signal), report a mistake; the owner cancels the sale ──
await page.goto(base + '#/stock');
await page.getByRole('button', { name: 'Sign out' }).click();
const kemi = people.find((x) => x.full_name === 'Kemi Yaba');
Object.assign(kemi, { user: 'u-kemi', joined_at: '2026-11-15', invite_token: null, reference_photo_path: 'c1/kemi/ref.jpg' });
await page.getByLabel('Phone number').fill('0803 555 0101');
await page.getByLabel('PIN').fill('482913');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByRole('link', { name: 'Record a sale' }).waitFor();
assert.deepEqual(await page.locator('.tabbar a[href^="#/"] span').allInnerTexts(), ['Clock', 'Sell', 'My sales'], 'shop staff: Clock, Sell, My sales');
await shot('shop-staff-home');
step('Shop staff: home has Clock in plus Record a sale; tab bar Clock / Sell / My sales');
await page.getByRole('link', { name: 'Record a sale' }).click();
await page.getByRole('heading', { name: 'Sell' }).waitFor();
await page.getByLabel(/^Search product, code/).fill('pm400');
assert.equal(await page.locator('#picks li:not([hidden])').count(), 1, 'search finds by code');
await page.locator('#picks li:not([hidden]) .pick').click();
await page.locator('.pick', { hasText: 'Golden Penny Sugar' }).click();
await page.getByLabel('One more').first().click();
await page.getByLabel('Price each for Peak Milk 400g').fill('2400');
assert.equal(await page.locator('.line').first().locator('.warn-line').count(), 0, '₦2,400 is inside the range: no warning');
await page.getByLabel('Price each for Peak Milk 400g').fill('2200');
await page.getByText('Below the lowest price (₦2,300). Your manager will see it.').waitFor();
await page.locator('.line', { hasText: 'Golden Penny' }).getByRole('spinbutton', { name: 'Quantity' }).fill('4');
await page.getByText('Only 3 in stock. You can still sell; your manager will see it.').waitFor();
assert.equal(await page.locator('#total').innerText(), '₦9,200');
await shot('till-basket');
step('Till: search, tap to add, quantity and haggled price; below-lowest price and short stock are warned, not blocked');
networkDown = true;
await page.getByRole('button', { name: 'Complete sale' }).click();
await page.getByText('Sale saved · ₦9,200').waitFor();
await page.getByText('1 waiting to send').waitFor();
assert.equal(await page.locator('.pick', { hasText: 'Golden Penny Sugar' }).locator('.muted').innerText(), 'Out of stock', 'the phone counts the waiting sale against stock');
assert.equal(await page.locator('#cart').isHidden(), true, 'the till is ready for the next customer');
await shot('till-saved-offline');
step('Till: sale saved with no signal; waits on the phone; stock on screen goes down');
await page.getByRole('link', { name: 'My sales' }).click();
await page.getByText('Waiting to send').waitFor();
networkDown = false;
await page.evaluate(() => dispatchEvent(new Event('online')));
await until(() => sales.length === 1, 'the sale to arrive');
assert.deepEqual(sales[0].flags, ['below_lowest', 'out_of_stock']);
assert.equal(stockRows.get(sales[0].branch_id + '|' + sales[0].sale_items[1].product_id).qty, -1);
await page.getByRole('link', { name: 'Sell' }).click();
await page.getByRole('link', { name: 'My sales' }).click();
await page.getByRole('button', { name: 'Report a mistake' }).waitFor();
await page.getByRole('button', { name: 'Report a mistake' }).click();
await accept('Sugar was 3, not 4');
await page.getByText('Mistake reported: Sugar was 3, not 4').waitFor();
await shot('my-sales');
step('Signal back: the sale is sent once, flagged; staff can report a mistake (they cannot cancel)');
await page.getByRole('button', { name: 'Sign out' }).click();
await page.getByRole('heading', { name: 'Sign in' }).waitFor();

await page.goto(base + '#/owner');
await page.getByLabel('Email').fill('elvis@chfheron.com');
await page.getByLabel('Password').fill('password1');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByRole('heading', { name: /, Elvis$/ }).waitFor();
await page.goto(base + '#/stock/' + sales[0].branch_id);
await page.getByText('1 mistake reported').waitFor();
assert.match(await page.locator('.salescard').innerText(), /₦9,200 · 1 sale/);
await page.locator('.salescard').click();
await page.getByRole('heading', { name: 'To check (1)' }).waitFor();
await page.getByText('Discounts given: ₦600').waitFor();
await shot('owner-shop-sales');
await page.locator('table.sales').first().locator('tbody a').first().click();
await page.getByText('Kemi Yaba reported a mistake:').waitFor();
await page.getByRole('button', { name: 'Cancel this sale' }).click();
await page.getByText('Please say why the sale is cancelled.').waitFor();
await page.getByLabel('Reason for cancelling').fill('Wrong quantity of sugar; Kemi will re-enter');
await page.getByRole('button', { name: 'Cancel this sale' }).click();
await page.getByText(/Cancelled by elvis uzorka, .*Wrong quantity of sugar/).waitFor();
assert.equal(stockRows.get(sales[0].branch_id + '|' + sales[0].sale_items[1].product_id).qty, 3, 'stock went back');
await shot('owner-sale-cancelled');
step('Owner: sees the day\'s sales, discounts and what to check; cancels with a reason; stock goes back');

// A second sale today, then the Overview and Billing.
sales.push({ id: 'sale-2', branch_id: sales[0].branch_id, member_id: kemi.id, seller_name: 'Kemi Yaba', happened_at: new Date().toISOString(), local_date: sales[0].local_date,
  total: 10000, discount: 0, flags: [], cancelled_at: null, mistake_note: null, sale_items: [{ line: 1, product_name: 'Indomie Chicken 70g', qty: 40, unit_price: 250, flags: [] }] });
await page.goto(base + '#/overview');
await page.getByRole('heading', { name: 'Sales today' }).waitFor();
assert.match(await page.locator('[aria-labelledby=sales-h] .big-line').innerText(), /₦10,000 · 1 sale/, 'the cancelled sale is left out');
assert.match(await page.locator('[aria-labelledby=sales-h]').innerText(), /Best sellers: Indomie Chicken 70g, 40 sold/);
assert.match(await page.locator('.stockrow').innerText(), /^Stock · Yaba shop\s+1 product running low\s+→$/, 'a labelled Stock row');
await page.locator('.stockrow').click();
await page.getByRole('heading', { name: 'Stock' }).waitFor();
await page.goto(base + '#/overview');
await page.getByRole('heading', { name: 'Sales today' }).waitFor();
assert.match(await page.locator('[aria-labelledby=sales-h] .shops').innerText(), /₦10,000 · 1 sale/, 'counts in words');
await page.locator('[aria-labelledby=sales-h]').evaluate((el) => scrollTo(0, el.getBoundingClientRect().top + scrollY - 70));
await shot('owner-overview-shops');
step('Overview: today\'s sales per shop, best sellers and stock alerts, each linking to the shop');
await page.goto(base + '#/billing');
await page.getByRole('heading', { name: 'Billing' }).waitFor();
assert.match(await page.locator('.offices').innerText(), /Shops · 1 × ₦5,000/);
await shot('owner-billing-shops');
step('Billing: priced per shop (₦5,000 incl. 3 staff; ₦1,000 per extra)');

// ── Logo and receipts ──
company.receipt_note = 'Thank you for shopping with us!';
const bigLogo = out + 'big-logo.png';
execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageDraw, ImageFont
# A realistic shop logo, 1600 × 1200: a mango badge with "MP" and the shop name.
im = Image.new('RGB', (1600, 1200), (255, 248, 238))
d = ImageDraw.Draw(im)
d.rounded_rectangle((500, 140, 1100, 740), radius=150, fill=(255, 138, 31))
big = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 300)
small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 120)
d.text((800, 440), 'MP', font=big, fill=(20, 33, 61), anchor='mm')
d.text((800, 930), 'MAMA PUT', font=small, fill=(20, 33, 61), anchor='mm')
for k in range(0, 1600, 8):
    d.line((k, 1180, k + 4, 1180), fill=(255, 138, 31), width=6)
im.save(sys.argv[1])`, bigLogo]);
await page.goto(base + '#/setup');
await page.getByRole('link', { name: /^Logo and receipts/ }).click();
await page.getByRole('heading', { name: 'Logo and receipts' }).waitFor();
await page.locator('.logo-file').setInputFiles(bigLogo);
await page.getByText(/^Ready: /).waitFor();
const ready = await page.locator('.logo-status').innerText();
const [, w, h, kb] = /Ready: (\d+) × (\d+) px, (\d+) KB/.exec(ready);
assert.ok(Math.max(w, h) <= 512 && Number(kb) <= 200, `shrunk to ${w}×${h}, ${kb} KB`);
assert.equal(Math.max(w, h), 512, 'the logo keeps the full 512 px');
await page.getByLabel('Thank-you note on receipts').fill('Thank you! Goods sold are not returnable after 7 days.');
await shot('setup-logo');
await page.getByRole('button', { name: 'Save' }).click();
await page.getByText('Saved').waitFor();
assert.ok(company.logo_path && company.logo_path.startsWith('c1/logo-'), 'logo saved in the business\'s own folder');
assert.ok(logos.get(company.logo_path).length <= 200 * 1024, 'the uploaded file is under 200 KB');
await page.goto(base + '#/setup');
await page.waitForFunction(() => document.querySelector('header .biz-logo')?.naturalWidth > 0);
await shot('setup-logo-saved');
rmSync(bigLogo);
step(`Logo: a ${'1600×1200'} picture is shrunk to ${w}×${h}, ${kb} KB before upload; shown at the top of the app`);
// The shop's phone for its receipts.
const yaba = branches.find((b) => b.name === 'Yaba shop');
await page.goto(base + '#/office/' + yaba.id);
await page.getByLabel(/Shop phone/).fill('0803 000 0001');
await page.getByRole('button', { name: 'Save' }).click();
await page.getByText('Shop saved').waitFor();
assert.equal(yaba.phone, '0803 000 0001');
step('Shop phone (for receipts) saved on the shop');

// Kemi sells and sends a receipt.
await page.getByRole('button', { name: 'Sign out' }).click();
await page.getByRole('heading', { name: 'Sign in' }).waitFor();
await page.getByLabel('Phone number').fill('0803 555 0101');
await page.getByLabel('PIN').fill('482913');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByRole('link', { name: 'Record a sale' }).click();
await page.getByRole('heading', { name: 'Sell' }).waitFor();
assert.ok(await page.locator('header .biz-logo').count(), 'the business logo at the top of the staff app');
await page.locator('.pick', { hasText: 'Indomie Chicken 70g' }).click();
await page.locator('.pick', { hasText: 'Peak Milk 400g' }).click();
await page.getByText('Transfer', { exact: true }).click();
await shot('till-payment');
await page.getByRole('button', { name: 'Complete sale' }).click();
await page.getByRole('heading', { name: /^Sale saved · ₦2,750$/ }).waitFor();
const sold = sales.at(-1);
assert.equal(sold.payment_method, 'transfer', 'payment method saved with the sale');
assert.match(sold.receipt_token, /^[A-Za-z0-9_-]{32}$/, 'the receipt link was made on the phone');
await page.getByLabel(/Customer's WhatsApp number/).fill('0803 123 4567');
await page.waitForFunction(() => /YAB-000/.test(decodeURIComponent(document.getElementById('wa').href)));
const wa = decodeURIComponent(await page.getByRole('link', { name: 'Send receipt on WhatsApp' }).getAttribute('href'));
assert.ok(wa.startsWith('https://wa.me/2348031234567?text=Thank you for shopping at Mama Put Stores (Yaba shop). Your receipt YAB-'), wa);
assert.ok(wa.endsWith(`r.html#${sold.receipt_token}`), 'the message carries the receipt link');
await shot('till-send-receipt');
step('Sale: payment method chosen; "Send receipt" opens WhatsApp to the customer with the receipt number and link');

// No signal: the receipt waits, then is ready to send.
await page.getByRole('button', { name: 'Next sale' }).click();
networkDown = true;
await page.locator('.pick', { hasText: 'Indomie Chicken 70g' }).click();
await page.getByRole('button', { name: 'Complete sale' }).click();
await page.getByRole('button', { name: 'Send receipt when online' }).waitFor();
await page.getByLabel(/Customer's WhatsApp number/).fill('0803 765 4321');
await page.getByRole('button', { name: 'Send receipt when online' }).click();
await page.getByText('Receipt will send when online').first().waitFor();
await shot('till-receipt-offline');
networkDown = false;
await page.evaluate(() => dispatchEvent(new Event('online')));
await page.getByRole('link', { name: 'Send on WhatsApp' }).waitFor();
assert.match(decodeURIComponent(await page.getByRole('link', { name: 'Send on WhatsApp' }).getAttribute('href')), /^https:\/\/wa\.me\/2348037654321\?text=.*YAB-0000\d\d/);
await shot('till-receipt-ready');
step('No signal: "Receipt will send when online"; once the sale is sent, the receipt is ready to send on WhatsApp');

// The receipt page: no sign-in, any phone.
const rp = await ctx.newPage();
await rp.route(/\/(auth|rest|functions|storage)\/v1\//, fakeSupabase);
await rp.goto(base + 'r.html#' + sold.receipt_token);
await rp.getByText(sold.receipt_code).waitFor();
const rtext = await rp.locator('.paper').innerText();
for (const want of ['Mama Put Stores', 'Yaba shop', '0803 000 0001', 'Kemi', '1 × ₦250', 'Total', '₦2,750', 'Transfer', 'Thank you! Goods sold are not returnable after 7 days.']) assert.ok(rtext.includes(want), `receipt shows ${want}`);
await rp.waitForFunction(() => document.querySelector('.head img')?.naturalWidth > 0);
await rp.screenshot({ path: `${out}${String(++n).padStart(2, '0')}-receipt.png`, fullPage: true });
const [img] = await Promise.all([rp.waitForEvent('download'), rp.getByRole('button', { name: 'Save as image' }).click()]);
assert.equal(img.suggestedFilename(), `Receipt-${sold.receipt_code}.png`);
step('Receipt page: opens with no sign-in; logo, shop, number, staff, items, total, payment, thank-you note; saves as an image');
sold.cancelled_at = new Date().toISOString();
await rp.reload();
await rp.getByRole('alert').getByText('CANCELLED').waitFor();
await rp.screenshot({ path: `${out}${String(++n).padStart(2, '0')}-receipt-cancelled.png`, fullPage: true });
await rp.goto(base + 'r.html#notarealreceiptlinknotareal00');
await rp.getByRole('heading', { name: 'Receipt not found' }).waitFor();
await rp.close();
step('Receipt page: a cancelled sale shows CANCELLED; a wrong link shows "Receipt not found"');
await page.getByRole('button', { name: 'Sign out' }).click();
await page.getByRole('heading', { name: 'Sign in' }).waitFor();
await page.goto(base + '#/owner');
await page.getByLabel('Email').fill('elvis@chfheron.com');
await page.getByLabel('Password').fill('password1');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByRole('heading', { name: /, Elvis$/ }).waitFor();

// Switch to Both: offices and shops, stores and reps back.
await page.goto(base + '#/business');
await page.getByText('Offices, shops and sales reps').click();
await shot('business-type');
await page.getByRole('button', { name: 'Save' }).click();
await page.getByRole('link', { name: /^Stores/ }).waitFor();
assert.equal(company.business_type, 'both');
await page.getByRole('link', { name: /^Offices and shops/ }).click();
await page.getByRole('link', { name: 'Add location' }).click();
await page.getByRole('group', { name: 'Is this an office or a shop?' }).waitFor();
await shot('both-add-location');
await page.getByLabel('Name').fill('Head office');
await page.getByLabel('Location').fill('6.5, 3.37');
await page.getByRole('radio', { name: /^Office/ }).check();
await page.getByRole('button', { name: 'Save' }).click();
await page.getByText('Location saved').waitFor();
assert.equal(branches.at(-1).kind, 'office');
step('Both: Stores come back, locations are marked office or shop');
// Back to Field sales in the app: the choice is saved and every shop feature goes away.
await page.goto(base + '#/business');
await page.getByRole('radio', { name: /^Field sales/ }).check();
await page.getByRole('button', { name: 'Save' }).click();
await page.getByRole('link', { name: /^Business type/ }).waitFor();
assert.equal(company.business_type, 'field', 'saved');
assert.match(await page.getByRole('link', { name: /^Business type/ }).innerText(), /Field sales/);
assert.deepEqual(await page.locator('.tabbar.manager a[href^="#/"] span').allInnerTexts(), ['Overview', 'Today', 'Team', 'Setup'], 'Stock tab gone');
await page.goto(base + '#/stock');
await page.getByRole('heading', { name: /, Elvis$/ }).waitFor();
assert.equal(await page.getByText(/Add your shop|Sales today/).count(), 0, 'no shop features once back to Field sales');
step('Switching back to Field sales is saved and removes the Stock tab and shop features');
company.name = 'CHF Heron';
await page.getByRole('button', { name: 'Sign out' }).click();

// ── Three screen sizes: phone, tablet, desktop ──────────────
// Same screens at 375, 820 and 1440 px: the right menu for each size, nothing wider than the screen,
// tables on bigger screens, the two-column till; on desktop also the keyboard (Tab, Esc, scanner, shortcuts).
company.business_type = 'storefront';
company.name = 'Mama Put Stores';
const SIZES = [['phone', 375, 812, { isMobile: true, hasTouch: true }], ['tablet', 820, 1180, { isMobile: true, hasTouch: true }], ['desktop', 1440, 900, {}]];
const shopId = branches.find((b) => b.name === 'Yaba shop').id;
for (const [size, width, height, extra] of SIZES) {
  const c = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, serviceWorkers: 'block', ...extra });
  const pg = await c.newPage();
  pg.on('pageerror', (e) => errors.push(e));
  await pg.route(/\/(auth|rest|functions|storage)\/v1\//, fakeSupabase);
  await pg.route(/tile\.openstreetmap\.org/, (r) => r.abort());
  const snap = async (name, full = true) => {
    await pg.waitForTimeout(250);
    const wide = await pg.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(wide <= 0, `${size} ${name}: nothing wider than the screen (${wide}px too wide)`);
    if (size !== 'phone') {
      const [navRight, mainLeft] = await pg.evaluate(() => [document.getElementById('appnav')?.getBoundingClientRect().right ?? 0, document.querySelector('main').getBoundingClientRect().left]);
      assert.ok(mainLeft >= navRight, `${size} ${name}: the page is beside the menu, not under it`);
    }
    const skipOnScreen = await pg.evaluate(() => { const r = document.querySelector('.skip')?.getBoundingClientRect(); return !!r && r.right > 0 && r.left < innerWidth && r.width > 2; });
    assert.ok(!skipOnScreen, `${size} ${name}: "Skip to content" only shows for keyboard users`);
    if (size === 'phone' && full) {
      // The last thing on the page scrolls clear of the tab bar.
      const clear = await pg.evaluate(() => { scrollTo(0, document.documentElement.scrollHeight); const nav = document.getElementById('appnav');
        const last = [...document.querySelectorAll('main > *')].filter((e) => e.offsetHeight).pop();
        const ok = !nav || nav.classList.contains('sub') || last.getBoundingClientRect().bottom <= nav.getBoundingClientRect().top; scrollTo(0, 0); return ok; });
      assert.ok(clear, `phone ${name}: the bottom of the page scrolls clear of the tab bar`);
    }
    // Screenshot the whole page the way the screen shows it: menus stay where they really are.
    if (full) {
      const tall = await pg.evaluate(() => document.documentElement.scrollHeight);
      await pg.setViewportSize({ width, height: Math.max(height, tall) });
      await pg.waitForTimeout(150);
      await pg.screenshot({ path: `${out}size-${size}-${name}.png` });
      await pg.setViewportSize({ width, height });
    } else await pg.screenshot({ path: `${out}size-${size}-${name}.png` });
  };
  const signIn = async (who) => {
    if (who === 'owner') {
      await pg.goto(base + '#/owner');
      await pg.getByLabel('Email').fill('elvis@chfheron.com');
      await pg.getByLabel('Password').fill('password1');
    } else {
      await pg.goto(base + '#/');
      await pg.getByLabel('Phone number').fill('0803 555 0101');
      await pg.getByLabel('PIN').fill('482913');
    }
    await pg.getByRole('button', { name: 'Sign in' }).click();
  };
  await signIn('owner');
  await pg.getByRole('heading', { name: /, Elvis$/ }).waitFor();
  const nav = await pg.locator('#appnav').boundingBox();
  if (size === 'phone') assert.ok(nav.y > height - 100 && nav.width === width, 'phone: tab bar along the bottom');
  if (size === 'tablet') assert.ok(nav.x === 0 && nav.width < 120 && nav.height >= height - 1, 'tablet: side rail');
  if (size === 'desktop') {
    assert.ok(nav.x === 0 && nav.width >= 200, 'desktop: sidebar');
    assert.ok(await pg.locator('.nav-brand').filter({ hasText: 'Mama Put Stores' }).isVisible(), 'desktop: business name at the top of the sidebar');
    const cols = await pg.evaluate(() => getComputedStyle(document.querySelector('.dash')).gridTemplateColumns.split(' ').length);
    assert.equal(cols, 3, 'desktop: Overview cards in a grid of 3');
    // Keyboard: Tab reaches "Skip to content" first, then the menu.
    await pg.keyboard.press('Tab');
    assert.equal(await pg.evaluate(() => document.activeElement.textContent), 'Skip to content');
    await pg.keyboard.press('Tab');
    assert.equal(await pg.evaluate(() => document.activeElement.textContent.trim()), 'Overview');
    const outline = await pg.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    assert.notEqual(outline, 'none', 'the focused link has a visible outline');
  }
  assert.ok(!(await pg.locator('[aria-labelledby=sales-h]').innerText()).includes('Head office'), 'offices never appear in Sales today');
  await snap('overview');
  await pg.getByRole('link', { name: 'Today', exact: true }).click();
  await pg.getByRole('heading', { name: 'Today' }).waitFor();
  await snap('today');
  await pg.goto(base + '#/stock/' + shopId);
  await pg.locator('#plist').waitFor();
  const headerShown = await pg.locator('#plist thead').isVisible();
  assert.equal(headerShown, size !== 'phone', size === 'phone' ? 'phone: stock as cards' : `${size}: stock as a table`);
  assert.ok(branches.some((b) => b.kind === 'office'), 'the business has an office too');
  assert.ok(!(await pg.locator('.chips').innerText()).includes('Head office'), 'offices never appear as shops in Stock');
  await snap('stock');
  await pg.goto(base + '#/sales/' + shopId);
  await pg.getByRole('heading', { name: /^Sales/ }).waitFor();
  await snap('sales');
  await pg.goto(base + '#/overview');
  await pg.getByRole('heading', { name: /, Elvis$/ }).waitFor();
  await pg.getByRole('button', { name: 'Sign out' }).click();
  await pg.getByRole('heading', { name: 'Sign in' }).waitFor();

  // The till.
  await signIn('kemi');
  await pg.getByRole('link', { name: 'Record a sale' }).waitFor();
  await pg.goto(base + '#/sell');
  await pg.getByRole('heading', { name: 'Sell' }).waitFor();
  const grid = await pg.evaluate(() => [document.querySelector('.till-products').getBoundingClientRect().left, document.querySelector('.till-sale').getBoundingClientRect().left]);
  if (size === 'phone') assert.ok(grid[0] === grid[1], 'phone: one column');
  else assert.ok(grid[1] > grid[0] + 200, `${size}: products left, the sale right`);
  if (size === 'desktop') {
    // A barcode scanner types the code and presses Enter: the product is added at once.
    assert.equal(await pg.evaluate(() => document.activeElement.id), 'q', 'the cursor starts in the search box');
    await pg.keyboard.type('PM400');
    await pg.keyboard.press('Enter');
    await pg.locator('.line', { hasText: 'Peak Milk 400g' }).waitFor();
    assert.equal(await pg.locator('#q').inputValue(), '', 'search box cleared, ready for the next scan');
    // Type part of a name, choose with ↓, add with Enter.
    await pg.keyboard.type('indo');
    await pg.keyboard.press('ArrowDown');
    await pg.keyboard.press('Enter');
    await pg.locator('.line', { hasText: 'Indomie Chicken 70g' }).waitFor();
    // Esc closes a dialog and changes nothing.
    await pg.getByRole('button', { name: 'Clear this sale' }).click();
    await pg.locator('dialog.dlg[open]').waitFor();
    await pg.keyboard.press('Escape');
    await pg.locator('dialog.dlg').waitFor({ state: 'detached' });
    assert.equal(await pg.locator('.line').count(), 2, 'Esc closed the question; the sale is still there');
    await pg.locator('#q').focus();
    await pg.keyboard.press('F7');
    assert.ok(await pg.locator('input[name=pay][value=transfer]').isChecked(), 'F7: paid by Transfer');
    await snap('sell', false);
    const before = sales.length;
    await pg.keyboard.press('F9');
    await pg.getByRole('heading', { name: /^Sale saved/ }).waitFor();
    assert.equal(sales.length, before + 1);
    assert.equal(sales.at(-1).payment_method, 'transfer');
    await snap('sell-saved', false);
    await pg.keyboard.press('Escape');
    await pg.locator('#cart').waitFor();
    step('desktop till: scan or type + Enter adds, ↑↓ chooses, F7 Transfer, F9 completes, Esc next sale; Esc closes dialogs; Tab order and focus outlines');
  } else {
    await pg.locator('.pick', { hasText: 'Peak Milk 400g' }).click();
    await pg.locator('.pick', { hasText: 'Indomie Chicken 70g' }).click();
    assert.equal(await pg.getByLabel('Price each for Peak Milk 400g').inputValue(), '2,500', 'prices in boxes have commas');
    await pg.getByLabel('Price each for Peak Milk 400g').fill('2400');
    assert.equal(await pg.getByLabel('Price each for Peak Milk 400g').inputValue(), '2,400', 'commas appear as you type');
    await pg.getByText('Transfer', { exact: true }).click();
    await snap('sell', false);
  }
  await pg.getByRole('button', { name: 'Sign out' }).click();
  await pg.getByRole('heading', { name: 'Sign in' }).waitFor();

  // A receipt.
  await pg.goto(base + 'r.html#' + sales.find((x) => x.receipt_token?.length >= 32 && !x.cancelled_at).receipt_token);
  await pg.locator('.paper').waitFor();
  await snap('receipt');
  await c.close();
  step(`${size} (${width} px): ${size === 'phone' ? 'bottom tab bar' : size === 'tablet' ? 'side rail, two-column till' : 'sidebar, card grid, tables, full-screen till'}; nothing wider than the screen`);
}
company.business_type = 'field';
company.name = 'CHF Heron';

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
