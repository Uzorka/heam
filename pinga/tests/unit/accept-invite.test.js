import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../../supabase/functions/accept-invite/handler.js';

const TOKEN = 'a'.repeat(32);
const env = { url: 'https://proj.supabase.co', key: 'sb_secret_test' };
const post = (body) => new Request('https://fn/accept-invite', { method: 'POST', body: JSON.stringify(body) });
const reply = (status, body) => new Response(JSON.stringify(body), { status });

// A pretend Supabase that records every call.
function fakeSupabase({ prepare, createUser = reply(200, { id: 'new-user' }), updateUser = reply(200, {}), complete = reply(200, 'm1') }) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body) });
    if (url.endsWith('/rpc/invite_prepare')) return prepare;
    if (url.endsWith('/rpc/invite_complete')) return complete;
    if (url.endsWith('/admin/users') && init.method === 'POST') return createUser;
    if (url.includes('/admin/users/') && init.method === 'PUT') return updateUser;
    throw new Error('unexpected ' + url);
  };
  return { calls, fetchFn };
}

test('a new person: login created with their PIN, invite completed', async () => {
  const sb = fakeSupabase({ prepare: reply(200, [{ ok: true, login_email: '2348030000009@phone.usepinga.com', existing_user: null }]) });
  const res = await handle(post({ token: TOKEN, pin: '482913' }), env, sb.fetchFn);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { login_email: '2348030000009@phone.usepinga.com' });
  const create = sb.calls.find((c) => c.url.endsWith('/admin/users'));
  assert.deepEqual(create.body, { email: '2348030000009@phone.usepinga.com', password: '482913', email_confirm: true });
  assert.deepEqual(sb.calls.at(-1).body, { p_token: TOKEN, p_user: 'new-user' });
});

test('a returning person (forgot PIN): PIN is updated, no new login', async () => {
  const sb = fakeSupabase({ prepare: reply(200, [{ ok: true, login_email: 'x@phone.usepinga.com', existing_user: 'u7' }]) });
  const res = await handle(post({ token: TOKEN, pin: '482913' }), env, sb.fetchFn);
  assert.equal(res.status, 200);
  assert.ok(sb.calls.some((c) => c.method === 'PUT' && c.url.endsWith('/admin/users/u7') && c.body.password === '482913'));
  assert.ok(!sb.calls.some((c) => c.method === 'POST' && c.url.endsWith('/admin/users')));
});

test('an expired or blocked invite is refused with a plain message', async () => {
  const sb = fakeSupabase({ prepare: reply(200, [{ ok: false, reason: 'This link has expired. Ask your manager for a new one.' }]) });
  const res = await handle(post({ token: TOKEN, pin: '482913' }), env, sb.fetchFn);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /expired/);
  assert.equal(sb.calls.length, 1);
});

test('weak PINs and bad links are refused before touching the database', async () => {
  const sb = fakeSupabase({});
  for (const body of [{ token: TOKEN, pin: '111111' }, { token: TOKEN, pin: '12' }, { token: 'short', pin: '482913' }, { pin: '482913' }]) {
    assert.equal((await handle(post(body), env, sb.fetchFn)).status, 400);
  }
  assert.equal((await handle(new Request('https://fn', { method: 'POST', body: 'not json' }), env, sb.fetchFn)).status, 400);
  assert.equal((await handle(new Request('https://fn', { method: 'GET' }), env, sb.fetchFn)).status, 405);
  assert.equal(sb.calls.length, 0);
});

test('if creating the login fails, the invite is not used up', async () => {
  const sb = fakeSupabase({ prepare: reply(200, [{ ok: true, login_email: 'x@phone.usepinga.com', existing_user: null }]), createUser: reply(500, {}) });
  const res = await handle(post({ token: TOKEN, pin: '482913' }), env, sb.fetchFn);
  assert.equal(res.status, 500);
  assert.ok(!sb.calls.some((c) => c.url.endsWith('/rpc/invite_complete')));
});

test('server key is sent the way Supabase expects', async () => {
  const sb = fakeSupabase({ prepare: reply(200, [{ ok: false, reason: 'x' }]) });
  await handle(post({ token: TOKEN, pin: '482913' }), env, sb.fetchFn);
  assert.equal(sb.calls[0].headers.apikey, 'sb_secret_test');
  assert.equal(sb.calls[0].headers.authorization, undefined);

  const legacy = fakeSupabase({ prepare: reply(200, [{ ok: false, reason: 'x' }]) });
  await handle(post({ token: TOKEN, pin: '482913' }), { ...env, key: 'eyJhbGciOi.legacy.jwt' }, legacy.fetchFn);
  assert.equal(legacy.calls[0].headers.authorization, 'Bearer eyJhbGciOi.legacy.jwt');
});
