import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, formatSummary } from '../../supabase/functions/daily-summary/handler.js';

const content = {
  company: 'CHF Heron', day: '2026-11-13', to: ['owner@chfheron.com'], people: 12, present: 8,
  late: [{ name: 'Sade Bello', minutes: 40 }, { name: 'Tunde Ade', minutes: 18 }], absent: ['Kemi Obi'], away: 1,
  visits_done: 9, visits_planned: 12, below_target: [{ name: 'Remi Okafor', visits: 1, target: 4 }], to_review: 2,
};

function fake({ keyOk = true, due = [{ company_id: 'c1', day: '2026-11-13' }], c = content, resend = 200 } = {}) {
  const calls = [];
  const fetchFn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, headers: init.headers });
    const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
    if (url.endsWith('/summary_key_ok')) return ok(keyOk);
    if (url.endsWith('/summaries_due')) return ok(due);
    if (url.endsWith('/summary_content')) return ok(c);
    if (url.endsWith('/summary_logged')) return ok(null);
    if (url === 'https://api.resend.com/emails') return new Response('{"id":"e1"}', { status: resend });
    throw new Error('unexpected ' + url);
  };
  return { calls, fetchFn };
}
const env = { url: 'https://p.supabase.co', key: 'sb_secret_x', resendKey: 're_test', appUrl: 'https://staging.elvisuzorka.com' };
const req = (key = 'k') => new Request('https://fn', { method: 'POST', headers: { 'x-summary-key': key } });

test('sends one email per company that is due, then logs it', async () => {
  const f = fake();
  const res = await handle(req(), env, f.fetchFn);
  assert.deepEqual(await res.json(), { sent: 1, failed: 0, skipped: 0 });
  const mail = f.calls.find((c) => c.url === 'https://api.resend.com/emails');
  assert.deepEqual(mail.body.to, ['owner@chfheron.com']);
  assert.equal(mail.headers.authorization, 'Bearer re_test');
  assert.equal(mail.body.from, 'Pinga <onboarding@resend.dev>');
  const log = f.calls.find((c) => c.url.endsWith('/summary_logged'));
  assert.equal(log.body.p_ok, true);
});

test('refuses callers without the schedule key', async () => {
  const f = fake({ keyOk: false });
  assert.equal((await handle(req('guess'), env, f.fetchFn)).status, 401);
  assert.equal((await handle(new Request('https://fn', { method: 'POST' }), env, f.fetchFn)).status, 401);
  assert.ok(!f.calls.some((c) => c.url.includes('resend')));
});

test('does nothing (and logs nothing) until the email key is set up', async () => {
  const f = fake();
  const res = await handle(req(), { ...env, resendKey: undefined }, f.fetchFn);
  assert.match((await res.json()).skipped, /not set up/);
  assert.ok(!f.calls.some((c) => c.url.endsWith('/summary_logged')), 'will try again once set up');
});

test('a failed send is logged as failed; a company with no owner email is skipped', async () => {
  const f = fake({ resend: 422 });
  assert.deepEqual(await (await handle(req(), env, f.fetchFn)).json(), { sent: 0, failed: 1, skipped: 0 });
  assert.equal(f.calls.find((c) => c.url.endsWith('/summary_logged')).body.p_ok, false);
  const g = fake({ c: { ...content, to: [] } });
  assert.deepEqual(await (await handle(req(), env, g.fetchFn)).json(), { sent: 0, failed: 0, skipped: 1 });
  assert.match(g.calls.find((c) => c.url.endsWith('/summary_logged')).body.p_detail, /no owner email/);
});


const busy = {
  company: 'Mama Put Stores', day: '2026-11-15', to: ['owner@example.com'], people: 6, present: 4,
  late: [{ name: 'Tolu', minutes: 20 }], absent: ['Bisi'], away: 0, visits_done: 0, visits_planned: 0, below_target: [], to_review: 0,
  face_mismatches: [{ name: 'Sade', what: 'clock-in' }],
  shops: { total: 148600, sales: 37, discount: 2400, cancelled: 1, mistakes: 1, out_of_stock_sales: 2,
    shops: [{ name: 'Surulere shop', total: 61200, sales: 15 }, { name: 'Yaba shop', total: 87400, sales: 22 }],
    best: [{ name: 'Indomie Chicken 70g', qty: 96 }, { name: 'Peak Milk 400g', qty: 18 }, { name: 'Golden Penny Sugar 500g', qty: 11 }, { name: 'Milo', qty: 2 }],
    below_lowest: [{ product: 'Peak Milk 400g', price: 2200, lowest: 2300, seller: 'Kemi', shop: 'Yaba shop' }],
    low_stock: [{ product: 'Golden Penny Sugar 500g', qty: 0, shop: 'Yaba shop' }, { product: 'Milo 400g', qty: 3, shop: 'Surulere shop' }],
    expiring: [{ product: 'Peak Milk 400g', expires_on: '2026-11-25', shop: 'Yaba shop' }, { product: 'Bread', expires_on: '2026-12-10', shop: 'Yaba shop' }] },
};

test('subject is short: company · sales · in · to check', () => {
  assert.equal(formatSummary(busy).subject, 'Mama Put Stores · ₦148,600 · 5 of 6 in · 9 to check');
});

test('"Needs your attention" comes first, red before amber, one short line each', () => {
  const { text } = formatSummary(busy, 'https://pinga.elvisuzorka.com');
  const lines = text.split('\n');
  assert.equal(lines[2], '₦148,600 sales   ·   5 of 6 in');
  const at = lines.indexOf('NEEDS YOUR ATTENTION');
  assert.equal(at, 4, 'attention straight after the headline');
  assert.deepEqual(lines.slice(at + 1, at + 10), [
    '● 1 mistake reported by staff',
    '● Out of stock: Golden Penny Sugar 500g (Yaba shop)',
    "● Sade's face didn't match (clock-in)",
    '● 1 person not in',
    '○ Peak Milk 400g sold at ₦2,200, below the lowest price of ₦2,300 (Kemi, Yaba shop)',
    '○ 2 sales made while out of stock',
    '○ 1 sale cancelled',
    '○ Peak Milk 400g expires in 10 days (Yaba shop)',
    '○ 1 person late',
  ]);
  assert.ok(lines.indexOf('SALES BY SHOP') > at);
});

test('counts are words, not bare numbers in brackets', () => {
  const { text } = formatSummary(busy);
  assert.match(text, /Surulere shop: ₦61,200 · 15 sales/);
  assert.match(text, /Indomie Chicken 70g — 96 sold/);
  assert.ok(!/Milo — 2 sold/.test(text), 'top 3 best sellers only');
  assert.match(text, /Milo 400g: 3 left \(Surulere shop\)/);
  assert.match(text, /Bread: expires 10 Dec/, 'expiring after 14 days goes in Stock, not attention');
  assert.match(text, /Late: Tolu \(20 min\)/);
  assert.match(text, /Not in: Bisi/);
  assert.ok(!/\(\d+\)/.test(text), 'no "(15)"-style counts');
});

test('a quiet day: "All good today", empty sections hidden', () => {
  const quiet = { ...busy, present: 6, late: [], absent: [], face_mismatches: [],
    shops: { ...busy.shops, cancelled: 0, mistakes: 0, out_of_stock_sales: 0, below_lowest: [], low_stock: [], expiring: [], best: [], shops: [busy.shops.shops[1]] } };
  const { text, html, subject } = formatSummary(quiet, 'https://pinga.elvisuzorka.com');
  assert.equal(subject, 'Mama Put Stores · ₦148,600 · 6 of 6 in');
  assert.match(text, /All good today 🎉/);
  assert.ok(!/NEEDS YOUR ATTENTION|BEST SELLERS|STOCK\n/.test(text));
  assert.ok(!/Needs your attention|Best sellers|>Stock</.test(html));
  assert.match(html, /All good today/);
});

test('HTML: Pinga logo, brand colours, Open Pinga button, small turn-off line; names made safe', () => {
  const { html } = formatSummary({ ...busy, absent: ['<b>x</b>'] }, 'https://pinga.elvisuzorka.com/');
  assert.match(html, /src="https:\/\/pinga\.elvisuzorka\.com\/icons\/icon-192\.png"/);
  assert.match(html, /#FFF8EE/);
  assert.match(html, /#FF8A1F/);
  assert.match(html, />Open Pinga</);
  assert.match(html, /font-size:12px;color:#5B6478">You can turn this email off/);
  assert.ok(!html.includes('<b>x</b>'));
});

test('Field sales company: no sales sections; store visits under attendance', () => {
  const field = { ...busy, company: 'CHF Heron', shops: undefined, face_mismatches: [], visits_done: 9, visits_planned: 12, below_target: [{ name: 'Remi', visits: 1, target: 4 }] };
  const { text, subject } = formatSummary(field);
  assert.equal(subject, 'CHF Heron · 5 of 6 in · 3 to check');
  assert.ok(!/SALES|sold/.test(text));
  assert.match(text, /Store visits: 9 of 12 done/);
  assert.match(text, /○ 1 sales rep below their visit target/);
});
