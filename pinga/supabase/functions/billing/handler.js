// Billing with Paystack. One function, four routes:
//   POST /billing/checkout  owner starts a payment → Paystack Checkout link
//   POST /billing/verify    app returns from Paystack → confirm that payment
//   POST /billing/webhook   Paystack tells us about a payment (signed with our secret key)
//   POST /billing/renew     daily job (schedule key): renew with saved cards
//   POST /billing/status    is online payment switched on? (no secrets: just on/off)
// Payments are confirmed with Paystack's own record before anything is marked paid.
// TEST MODE ONLY unless ALLOW_LIVE_PAYMENTS=yes is set: a live key (sk_live_…) is refused.
// Plain JS with no imports: runs on Supabase (Deno) and in our Node tests.

const PAYSTACK = 'https://api.paystack.co';
const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
});
const keyHeaders = (key) => (key.startsWith('sb_') ? { apikey: key } : { apikey: key, authorization: `Bearer ${key}` });
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

// Paystack signs each webhook with HMAC-SHA512 of the raw body, using our secret key.
export async function paystackSignature(secret, rawBody) {
  const te = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, te.encode(rawBody)));
}
const sameText = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

export function paystackKeyProblem(key, allowLive) {
  if (!key) return 'Payments are not set up yet (PAYSTACK_SECRET_KEY).';
  if (key.startsWith('sk_test_')) return null;
  if (key.startsWith('sk_live_')) return allowLive === 'yes' ? null : 'A live Paystack key was found, but live payments are switched off. Use the test key (sk_test_…).';
  return 'PAYSTACK_SECRET_KEY does not look like a Paystack secret key.';
}

export async function handle(req, env, fetchFn = fetch) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'apikey, authorization, content-type', 'access-control-allow-methods': 'POST' } });
  }
  if (req.method !== 'POST') return json(405, { error: 'Use POST' });
  const route = new URL(req.url).pathname.split('/').pop();
  const service = { ...keyHeaders(env.key), 'content-type': 'application/json' };

  const rpc = async (fn, args = {}, headers = service) => {
    const r = await fetchFn(`${env.url}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
    const data = await r.json().catch(() => null);
    if (!r.ok) { const e = new Error(data?.message || `${fn} failed`); e.status = r.status; throw e; }
    return data;
  };
  const problem = paystackKeyProblem(env.paystackKey, env.allowLive);
  const paystack = async (path, init = {}) => {
    const r = await fetchFn(PAYSTACK + path, { ...init, headers: { authorization: `Bearer ${env.paystackKey}`, 'content-type': 'application/json' } });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok && data.status === true, data: data.data, message: data.message };
  };
  // Ask Paystack what really happened, then record it.
  const confirm = async (reference) => {
    const v = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
    if (!v.ok || !v.data) return 'not found at Paystack';
    const d = v.data;
    if (d.status !== 'success' && d.status !== 'failed') return 'not paid';   // e.g. checkout closed: nothing to record
    return rpc('billing_confirm', {
      p_reference: d.reference, p_status: d.status, p_amount_kobo: d.amount, p_currency: d.currency,
      p_channel: d.channel || d.authorization?.channel || null,
      p_card: d.authorization ? { ...d.authorization, email: d.customer?.email } : {},
    });
  };

  // Let the app know whether payments are switched on (hides "Pay" and reminders until then).
  const report = () => rpc('billing_report', { p_enabled: !problem }).catch(() => {});

  try {
    if (route === 'status') {
      await report();
      return json(200, { enabled: !problem });
    }

    if (route === 'checkout') {
      await report();
      if (problem) return json(503, { error: problem });
      const userToken = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      if (!userToken || !env.anonKey) return json(401, { error: 'Please sign in again.' });
      // Runs as the signed-in person: the database checks they are the owner.
      const asUser = { apikey: env.anonKey, authorization: `Bearer ${userToken}`, 'content-type': 'application/json' };
      const inv = await rpc('billing_start_checkout', {}, asUser);
      const body = await req.json().catch(() => ({}));
      const back = typeof body.return_to === 'string' && env.appUrl && body.return_to.startsWith(env.appUrl) ? body.return_to : `${env.appUrl || ''}/#/billing`;
      const init = await paystack('/transaction/initialize', {
        method: 'POST',
        body: JSON.stringify({
          email: inv.email, amount: inv.amount_kobo, currency: 'NGN', reference: inv.reference, callback_url: back,
          metadata: { company_id: inv.company_id, invoice_id: inv.invoice_id, period: `${inv.period_start} to ${inv.period_end}` },
        }),
      });
      if (!init.ok || !init.data?.authorization_url) return json(502, { error: 'Paystack could not start the payment. Please try again.', detail: init.message });
      return json(200, { url: init.data.authorization_url, reference: inv.reference });
    }

    if (route === 'verify') {
      if (problem) return json(503, { error: problem });
      const { reference } = await req.json().catch(() => ({}));
      if (typeof reference !== 'string' || !/^PNG-[A-Z0-9]{16}$/.test(reference)) return json(400, { error: 'Unknown payment.' });
      return json(200, { result: await confirm(reference) });
    }

    if (route === 'webhook') {
      if (problem) return json(503, { error: problem });
      const raw = await req.text();
      const sig = req.headers.get('x-paystack-signature') || '';
      if (!sameText(sig, await paystackSignature(env.paystackKey, raw))) return json(401, { error: 'Bad signature' });
      const event = JSON.parse(raw);
      if (event.event === 'charge.success' && /^PNG-/.test(event.data?.reference || '')) {
        return json(200, { result: await confirm(event.data.reference) });
      }
      return json(200, { ignored: event.event });
    }

    if (route === 'renew') {
      const key = req.headers.get('x-job-key') || '';
      if (!key || !(await rpc('job_key_ok', { p_key: key }))) return json(401, { error: 'Not allowed' });
      await report();
      if (problem) return json(200, { skipped: problem });
      const due = await rpc('billing_due');
      const out = { due: due.length, charged: 0, failed: 0, no_card: 0 };
      for (const d of due) {
        if (!d.authorization_code) { out.no_card++; continue; }
        const c = await paystack('/transaction/charge_authorization', {
          method: 'POST',
          body: JSON.stringify({ authorization_code: d.authorization_code, email: d.email, amount: d.amount_kobo, currency: 'NGN', reference: d.reference }),
        });
        const result = c.ok ? await confirm(d.reference)
          : await rpc('billing_confirm', { p_reference: d.reference, p_status: 'failed', p_amount_kobo: d.amount_kobo, p_currency: 'NGN', p_channel: 'card', p_card: {} });
        if (result === 'paid') out.charged++; else out.failed++;
      }
      return json(200, out);
    }
    return json(404, { error: 'Unknown route' });
  } catch (e) {
    if (e.status === 401 || e.status === 403) return json(403, { error: e.message || 'Not allowed' });
    if (e.status && e.status < 500) return json(400, { error: e.message });
    console.error('billing error', route, e);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
}
