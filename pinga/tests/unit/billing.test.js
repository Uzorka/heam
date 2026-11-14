import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { handle, paystackSignature, paystackKeyProblem } from '../../supabase/functions/billing/handler.js';

const SK = 'sk_test_0123456789abcdef';
const env = { url: 'https://p.supabase.co', key: 'sb_secret_x', anonKey: 'sb_publishable_y', paystackKey: SK, appUrl: 'https://staging.elvisuzorka.com' };
const REF = 'PNG-ABCDEF0123456789';

// A pretend Supabase + Paystack that records every call.
function fake({ verify = { status: 'success', reference: REF, amount: 550000, currency: 'NGN', channel: 'card', authorization: { authorization_code: 'AUTH_x', reusable: true, last4: '4081' }, customer: { email: 'o@x.com' } },
  confirmResult = 'paid', due = [], keyOk = true, charge = true, startError = null } = {}) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, headers: init.headers, body });
    const ok = (d, status = 200) => new Response(JSON.stringify(d), { status });
    if (url.endsWith('/rpc/billing_start_checkout')) return startError ? ok({ message: startError }, 403)
      : ok({ reference: REF, amount_kobo: 550000, email: 'owner@chfheron.com', company_id: 'c1', invoice_id: 'i1', period_start: '2026-11-19', period_end: '2026-12-18' });
    if (url.endsWith('/rpc/billing_confirm')) return ok(confirmResult);
    if (url.endsWith('/rpc/billing_due')) return ok(due);
    if (url.endsWith('/rpc/job_key_ok')) return ok(keyOk);
    if (url === 'https://api.paystack.co/transaction/initialize') return ok({ status: true, data: { authorization_url: 'https://checkout.paystack.com/abc', reference: REF } });
    if (url.startsWith('https://api.paystack.co/transaction/verify/')) return ok({ status: true, data: verify });
    if (url === 'https://api.paystack.co/transaction/charge_authorization') return ok({ status: charge, data: { status: charge ? 'success' : 'failed' } }, charge ? 200 : 400);
    throw new Error('unexpected ' + url);
  };
  return { calls, fetchFn };
}
const post = (route, { body = {}, headers = {} } = {}) => new Request(`https://p.supabase.co/functions/v1/billing/${route}`, {
  method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('only Paystack TEST keys are accepted unless live payments are switched on', () => {
  assert.equal(paystackKeyProblem('sk_test_abc'), null);
  assert.match(paystackKeyProblem('sk_live_abc'), /live payments are switched off/);
  assert.equal(paystackKeyProblem('sk_live_abc', 'yes'), null);
  assert.match(paystackKeyProblem(undefined), /not set up yet/);
  assert.match(paystackKeyProblem('pk_test_abc'), /does not look like/);
});

test('checkout: runs as the owner, then opens Paystack Checkout for the exact amount', async () => {
  const f = fake();
  const res = await handle(post('checkout', { headers: { authorization: 'Bearer user-jwt' }, body: { return_to: 'https://staging.elvisuzorka.com/#/billing' } }), env, f.fetchFn);
  assert.deepEqual(await res.json(), { url: 'https://checkout.paystack.com/abc', reference: REF });
  const start = f.calls.find((c) => c.url.endsWith('/rpc/billing_start_checkout'));
  assert.equal(start.headers.authorization, 'Bearer user-jwt', 'the database decides if this person is the owner');
  const init = f.calls.find((c) => c.url.endsWith('/transaction/initialize'));
  assert.equal(init.headers.authorization, `Bearer ${SK}`);
  assert.deepEqual({ email: init.body.email, amount: init.body.amount, currency: init.body.currency, reference: init.body.reference, callback_url: init.body.callback_url },
    { email: 'owner@chfheron.com', amount: 550000, currency: 'NGN', reference: REF, callback_url: 'https://staging.elvisuzorka.com/#/billing' });
});

test('checkout: refused for non-owners, without a login, or before Paystack is set up', async () => {
  assert.equal((await handle(post('checkout', { headers: { authorization: 'Bearer staff' } }), env, fake({ startError: 'Only the owner can pay' }).fetchFn)).status, 403);
  assert.equal((await handle(post('checkout'), env, fake().fetchFn)).status, 401);
  const off = await handle(post('checkout', { headers: { authorization: 'Bearer x' } }), { ...env, paystackKey: undefined }, fake().fetchFn);
  assert.equal(off.status, 503);
  assert.match((await off.json()).error, /not set up yet/);
  const live = await handle(post('checkout', { headers: { authorization: 'Bearer x' } }), { ...env, paystackKey: 'sk_live_real' }, fake().fetchFn);
  assert.equal(live.status, 503, 'a live key is refused');
});

test('checkout never sends people back to another website', async () => {
  const f = fake();
  await handle(post('checkout', { headers: { authorization: 'Bearer u' }, body: { return_to: 'https://evil.example/#/billing' } }), env, f.fetchFn);
  assert.equal(f.calls.find((c) => c.url.endsWith('/transaction/initialize')).body.callback_url, 'https://staging.elvisuzorka.com/#/billing');
});

test('webhook: a correctly signed charge.success is checked with Paystack, then recorded', async () => {
  const raw = JSON.stringify({ event: 'charge.success', data: { reference: REF, amount: 550000 } });
  const sig = createHmac('sha512', SK).update(raw).digest('hex');      // how Paystack signs
  assert.equal(await paystackSignature(SK, raw), sig, 'our check matches Paystack\'s signing method');
  const f = fake();
  const res = await handle(post('webhook', { body: raw, headers: { 'x-paystack-signature': sig } }), env, f.fetchFn);
  assert.deepEqual(await res.json(), { result: 'paid' });
  assert.ok(f.calls.some((c) => c.url === `https://api.paystack.co/transaction/verify/${REF}`), 'confirmed with Paystack, not trusted blindly');
  const saved = f.calls.find((c) => c.url.endsWith('/rpc/billing_confirm')).body;
  assert.deepEqual({ ref: saved.p_reference, status: saved.p_status, amount: saved.p_amount_kobo, currency: saved.p_currency, channel: saved.p_channel, code: saved.p_card.authorization_code },
    { ref: REF, status: 'success', amount: 550000, currency: 'NGN', channel: 'card', code: 'AUTH_x' });
});

test('webhook: a forged or unsigned message is rejected and nothing is recorded', async () => {
  const raw = JSON.stringify({ event: 'charge.success', data: { reference: REF } });
  for (const sig of ['', 'deadbeef', createHmac('sha512', 'sk_test_wrong').update(raw).digest('hex')]) {
    const f = fake();
    assert.equal((await handle(post('webhook', { body: raw, headers: { 'x-paystack-signature': sig } }), env, f.fetchFn)).status, 401);
    assert.ok(!f.calls.some((c) => c.url.includes('billing_confirm')));
  }
});

test('verify (owner returns from Paystack): closing checkout records nothing', async () => {
  const f = fake({ verify: { status: 'abandoned', reference: REF, amount: 550000, currency: 'NGN' } });
  assert.deepEqual(await (await handle(post('verify', { body: { reference: REF } }), env, f.fetchFn)).json(), { result: 'not paid' });
  assert.ok(!f.calls.some((c) => c.url.includes('billing_confirm')));
  assert.equal((await handle(post('verify', { body: { reference: '../../etc' } }), env, fake().fetchFn)).status, 400);
});

test('renew: charges saved cards, records declines, and leaves companies without a card to pay themselves', async () => {
  const due = [
    { company_id: 'a', reference: 'PNG-AAAAAAAAAAAAAAAA', amount_kobo: 550000, authorization_code: 'AUTH_a', email: 'a@x.com' },
    { company_id: 'b', reference: 'PNG-BBBBBBBBBBBBBBBB', amount_kobo: 150000, authorization_code: null, email: null },
  ];
  const ok = fake({ due });
  const r = await (await handle(post('renew', { headers: { 'x-job-key': 'k' } }), env, ok.fetchFn)).json();
  assert.deepEqual(r, { due: 2, charged: 1, failed: 0, no_card: 1 });
  const charge = ok.calls.find((c) => c.url.endsWith('/charge_authorization')).body;
  assert.deepEqual(charge, { authorization_code: 'AUTH_a', email: 'a@x.com', amount: 550000, currency: 'NGN', reference: 'PNG-AAAAAAAAAAAAAAAA' });

  const declined = fake({ due: [due[0]], charge: false, confirmResult: 'failed' });
  assert.deepEqual(await (await handle(post('renew', { headers: { 'x-job-key': 'k' } }), env, declined.fetchFn)).json(), { due: 1, charged: 0, failed: 1, no_card: 0 });
  assert.equal(declined.calls.find((c) => c.url.endsWith('/rpc/billing_confirm')).body.p_status, 'failed');
});

test('renew: refuses callers without the schedule key, and does nothing before Paystack is set up', async () => {
  assert.equal((await handle(post('renew', { headers: { 'x-job-key': 'guess' } }), env, fake({ keyOk: false }).fetchFn)).status, 401);
  const f = fake({ due: [{ company_id: 'a', reference: 'PNG-AAAAAAAAAAAAAAAA', amount_kobo: 1, authorization_code: 'AUTH', email: 'e' }] });
  const r = await (await handle(post('renew', { headers: { 'x-job-key': 'k' } }), { ...env, paystackKey: undefined }, f.fetchFn)).json();
  assert.match(r.skipped, /not set up yet/);
  assert.ok(!f.calls.some((c) => c.url.includes('billing_due')), 'nobody is marked as owing before billing is switched on');
});
