import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// A pretend browser storage and network.
const stored = new Map();
globalThis.localStorage = {
  getItem: (k) => (stored.has(k) ? stored.get(k) : null),
  setItem: (k, v) => stored.set(k, String(v)),
  removeItem: (k) => stored.delete(k),
};
let calls = [];
let responder = () => new Response('[]');
globalThis.fetch = async (url, init = {}) => { calls.push({ url, ...init, body: init.body && JSON.parse(init.body) }); return responder(url, init); };

const { CONFIG } = await import('../../web/js/config.js');
CONFIG.url = 'https://proj.supabase.co';
CONFIG.key = 'sb_publishable_test';
const api = await import('../../web/js/api.js');

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const login = (expiresIn = 3600) => ({ access_token: 'at1', refresh_token: 'rt1', expires_in: expiresIn, user: { id: 'u1', email: 'a@b.c' } });

beforeEach(async () => { await api.signOut(); calls = []; });

test('signing in keeps the login on the phone', async () => {
  responder = () => json(login());
  await api.signIn('a@b.c', 'pw');
  assert.equal(calls[0].url, 'https://proj.supabase.co/auth/v1/token?grant_type=password');
  assert.deepEqual(calls[0].body, { email: 'a@b.c', password: 'pw' });
  assert.equal(api.getSession().user.id, 'u1');
  assert.equal(JSON.parse(stored.get('pinga.session')).access_token, 'at1');
});

test('data requests carry the person\'s login', async () => {
  responder = () => json(login());
  await api.signIn('a@b.c', 'pw');
  responder = () => json([{ id: 1 }]);
  const rows = await api.select('members', 'select=id');
  assert.deepEqual(rows, [{ id: 1 }]);
  const h = calls.at(-1).headers;
  assert.equal(h.apikey, 'sb_publishable_test');
  assert.equal(h.authorization, 'Bearer at1');
});

test('an expiring login is renewed quietly first', async () => {
  responder = () => json(login(30));
  await api.signIn('a@b.c', 'pw');
  responder = (url) => (url.includes('refresh_token') ? json({ ...login(), access_token: 'at2' }) : json([]));
  await api.select('members', 'select=id');
  assert.ok(calls.some((c) => c.url.includes('grant_type=refresh_token') && c.body.refresh_token === 'rt1'));
  assert.equal(calls.at(-1).headers.authorization, 'Bearer at2');
});

test('a revoked login signs the person out', async () => {
  responder = () => json(login(30));
  await api.signIn('a@b.c', 'pw');
  responder = (url) => (url.includes('refresh_token') ? json({ error: 'invalid_grant' }, 400) : json([]));
  await api.select('members', 'select=id');
  assert.equal(api.getSession(), null);
});

test('no signal: a clear message, and the login is kept', async () => {
  responder = () => json(login(30));
  await api.signIn('a@b.c', 'pw');
  responder = () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(api.select('members', 'select=id'), (e) => e.status === 0 && /No connection/.test(e.message));
  assert.equal(api.getSession().access_token, 'at1');
});

test('server errors become readable messages with their code', async () => {
  responder = () => json({ code: '23505', message: 'duplicate key value' }, 409);
  await assert.rejects(api.insert('members', {}), (e) => e.status === 409 && e.code === '23505');
  responder = () => json({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
  await assert.rejects(api.signIn('a@b.c', 'x'), (e) => e.code === 'invalid_credentials');
});

test('without a login, requests use only the publishable key', async () => {
  responder = () => json([]);
  await api.rpc('invite_preview', { p_token: 'x' });
  assert.equal(calls.at(-1).headers.authorization, undefined);
  assert.deepEqual(calls.at(-1).body, { p_token: 'x' });
});
