// "Set your PIN" — turns an invite link into a working phone + PIN login.
// Plain JavaScript with no imports, so it runs on Supabase (Deno) and in our Node tests.

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });

// New-style Supabase secret keys go in the apikey header only; older JWT keys also as Bearer.
export const keyHeaders = (key) =>
  key.startsWith('sb_') ? { apikey: key } : { apikey: key, authorization: `Bearer ${key}` };

export const validPin = (pin) => typeof pin === 'string' && /^[0-9]{6}$/.test(pin) && !/^(\d)\1{5}$/.test(pin)
  && !['123456', '654321', '012345', '123123'].includes(pin);

export async function handle(req, { url, key }, fetchFn = fetch) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'apikey, authorization, content-type',
        'access-control-allow-methods': 'POST',
      },
    });
  }
  if (req.method !== 'POST') return json(405, { error: 'Use POST' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Bad request' }); }
  const token = typeof body?.token === 'string' ? body.token : '';
  const pin = body?.pin;
  if (!/^[0-9a-f]{32}$/.test(token)) return json(400, { error: 'This link is not valid.' });
  if (!validPin(pin)) return json(400, { error: 'Choose 6 digits that are not easy to guess.' });

  const h = { ...keyHeaders(key), 'content-type': 'application/json' };
  const rpc = async (fn, args) => {
    const r = await fetchFn(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: h, body: JSON.stringify(args) });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, data };
  };

  const prep = await rpc('invite_prepare', { p_token: token });
  const row = Array.isArray(prep.data) ? prep.data[0] : null;
  if (!prep.ok || !row) return json(500, { error: 'Something went wrong. Please try again.' });
  if (!row.ok) return json(400, { error: row.reason });

  let userId = row.existing_user;
  if (userId) {
    // Returning person (forgot PIN): set the new PIN.
    const r = await fetchFn(`${url}/auth/v1/admin/users/${userId}`, {
      method: 'PUT', headers: h, body: JSON.stringify({ password: pin }),
    });
    if (!r.ok) return json(500, { error: 'Could not save your PIN. Please try again.' });
  } else {
    const r = await fetchFn(`${url}/auth/v1/admin/users`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ email: row.login_email, password: pin, email_confirm: true }),
    });
    const user = await r.json().catch(() => null);
    if (!r.ok || !user?.id) return json(500, { error: 'Could not save your PIN. Please try again.' });
    userId = user.id;
  }

  const done = await rpc('invite_complete', { p_token: token, p_user: userId });
  if (!done.ok) return json(400, { error: done.data?.message || 'This link has expired.' });

  return json(200, { login_email: row.login_email });
}
