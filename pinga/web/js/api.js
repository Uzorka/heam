// A tiny Supabase client (logins, data, actions). Written by hand instead of
// using @supabase/supabase-js to keep the staff app fast on low-end phones.
import { CONFIG } from './config.js';

const STORE_KEY = 'pinga.session';
const memory = {};
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return memory[k] ?? null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { memory[k] = v; } },
  del(k) { try { localStorage.removeItem(k); } catch { delete memory[k]; } },
};

export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.name = 'ApiError'; this.status = status; this.code = code; }
}

let session = null;
try { session = JSON.parse(store.get(STORE_KEY)); } catch { session = null; }

const now = () => Math.floor(Date.now() / 1000);

function save(s) {
  session = s ? {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at || now() + (s.expires_in || 3600),
    user: { id: s.user?.id, email: s.user?.email },
  } : null;
  if (session) store.set(STORE_KEY, JSON.stringify(session)); else store.del(STORE_KEY);
}

export const getSession = () => session;

function headers(withUser = true) {
  const h = { apikey: CONFIG.key, 'content-type': 'application/json' };
  const bearer = withUser && session ? session.access_token : (CONFIG.key.startsWith('sb_') ? null : CONFIG.key);
  if (bearer) h.authorization = 'Bearer ' + bearer;
  return h;
}

async function request(path, { method = 'GET', body, extra, withUser = true, blob = false } = {}) {
  let r;
  const raw = typeof Blob !== 'undefined' && body instanceof Blob;
  try {
    r = await fetch(CONFIG.url + path, {
      method, headers: { ...headers(withUser), ...extra }, body: body === undefined || raw ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('No connection. Check your internet and try again.', 0, 'offline');
  }
  if (blob && r.ok) return r.blob();
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    const msg = data?.msg || data?.message || data?.error_description || data?.error || 'Something went wrong.';
    throw new ApiError(msg, r.status, data?.error_code || data?.code);
  }
  return data;
}

let refreshing = null;
// Renews the login quietly before it expires. If offline, keeps the old one so the app still opens.
async function fresh() {
  if (!session || session.expires_at - 60 > now()) return;
  if (!refreshing) refreshing = request('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST', body: { refresh_token: session.refresh_token }, withUser: false,
  }).then(save, (e) => { if (e.status === 400 || e.status === 401) save(null); })
    .finally(() => { refreshing = null; });
  await refreshing;
}

async function data(path, opts) {
  await fresh();
  return request(path, opts);
}

// ── Logins ───────────────────────────────────────────────────
export async function signIn(email, password) {
  save(await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, withUser: false }));
  return session;
}

// Returns true when the person is signed in straight away, false when they must confirm their email first.
export async function signUp(email, password, redirectTo) {
  const q = redirectTo ? '?redirect_to=' + encodeURIComponent(redirectTo) : '';
  const res = await request('/auth/v1/signup' + q, { method: 'POST', body: { email, password }, withUser: false });
  if (res?.access_token) { save(res); return true; }
  return false;
}

// After clicking the email confirmation link, Supabase sends people back with the login in the address.
export async function signInFromLink(hash) {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  if (!p.get('access_token')) return false;
  const s = { access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: +p.get('expires_in') || 3600 };
  save({ ...s, user: {} });
  const user = await request('/auth/v1/user');
  save({ ...s, user });
  return true;
}

export async function signOut() {
  if (session) request('/auth/v1/logout', { method: 'POST' }).catch(() => {});
  save(null);
  clearCache();
}

// ── Data ─────────────────────────────────────────────────────
export const select = (table, query) => data(`/rest/v1/${table}?${query}`);
export const insert = (table, row) =>
  data(`/rest/v1/${table}`, { method: 'POST', body: row, extra: { prefer: 'return=representation' } }).then((r) => r[0]);
export const update = (table, query, changes) =>
  data(`/rest/v1/${table}?${query}`, { method: 'PATCH', body: changes, extra: { prefer: 'return=representation' } });
export const rpc = (fn, args = {}) => data(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args });
// Photos (private storage).
export const upload = (bucket, path, file) =>
  data(`/storage/v1/object/${bucket}/${path}`, { method: 'POST', body: file, extra: { 'content-type': file.type || 'image/jpeg' } });
export const download = (bucket, path) => data(`/storage/v1/object/authenticated/${bucket}/${path}`, { blob: true });

// ── Server time ──────────────────────────────────────────────
// Phones often have the wrong time. We learn the difference whenever online and use it offline too.
const CLOCK_KEY = 'pinga.clockOffset';
let clockOffset = Number(store.get(CLOCK_KEY)) || 0;
export const serverNow = () => new Date(Date.now() + clockOffset);
export async function syncClock() {
  const t0 = Date.now();
  const server = Date.parse(await rpc('server_now'));
  const t1 = Date.now();
  if (Number.isFinite(server)) { clockOffset = Math.round(server - (t0 + t1) / 2); store.set(CLOCK_KEY, String(clockOffset)); }
}

// ── Offline copies ───────────────────────────────────────────
// Loads fresh data when online and keeps a copy; with no signal, returns the last copy.
export async function cached(key, load) {
  const k = 'pinga.cache.' + key;
  try {
    const value = await load();
    store.set(k, JSON.stringify(value));
    return value;
  } catch (e) {
    const copy = store.get(k);
    if (e.status === 0 && copy !== null) return JSON.parse(copy);
    throw e;
  }
}

export function clearCache() {
  try { Object.keys(localStorage).filter((k) => k.startsWith('pinga.cache.')).forEach((k) => localStorage.removeItem(k)); } catch { /* none */ }
}

export const callFunction = (name, body) => request(`/functions/v1/${name}`, { method: 'POST', body, withUser: false });
