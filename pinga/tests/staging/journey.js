// End-to-end check on STAGING with the real login service, invite function and photo storage.
// Creates a throw-away company and staff member, walks the staff journey, then deletes it all.
//   NODE_USE_ENV_PROXY=1 node tests/staging/journey.js
import assert from 'node:assert/strict';
import { CONFIG_FOR } from '../../scripts/projects.js';

const { ref, key } = CONFIG_FOR.staging;
const base = `https://${ref}.supabase.co`;
const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN || 'proxy-injected'}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d));
  return d;
};
const call = async (path, { method = 'GET', body, token, type = 'application/json' } = {}) => {
  const headers = { apikey: key, 'content-type': type };
  if (token) headers.authorization = 'Bearer ' + token;
  const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : type === 'application/json' ? JSON.stringify(body) : body });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
};
const step = (s) => console.log('ok -', s);

// A tiny real JPEG (1×1 pixel).
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=', 'base64');
const phone = '+234700' + String(Date.now()).slice(-7);
const login = phone.slice(1) + '@phone.usepinga.com';

const [{ company, member, token }] = await sql(`
  with c as (insert into public.companies (name) values ('Staging check (auto-deleted)') returning id),
       b as (insert into public.branches (company_id, name, lat, lng) select id, 'Yaba', 6.5095, 3.3711 from c),
       m as (insert into public.members (company_id, full_name, phone, role) select id, 'Check Person', '${phone}', 'staff' from c returning id, invite_token),
       s as (insert into public.stores (company_id, name, address) select id, 'Check Store', 'No location yet' from c returning id),
       a as (insert into public.store_assignments (company_id, member_id, store_id) select (select id from c), m.id, s.id from m, s)
  select (select id from c) as company, m.id as member, m.invite_token as token, (select id from s) as store from m;`);
const [{ store }] = await sql(`select id as store from public.stores where company_id = '${company}'`);

try {
  const preview = await call('/rest/v1/rpc/invite_preview', { method: 'POST', body: { p_token: token } });
  assert.deepEqual(preview.data, [{ first_name: 'Check', company_name: 'Staging check (auto-deleted)' }]);
  step('invite link shows the first name and company');

  const weak = await call('/functions/v1/accept-invite', { method: 'POST', body: { token, pin: '111111' } });
  assert.equal(weak.status, 400);
  const accepted = await call('/functions/v1/accept-invite', { method: 'POST', body: { token, pin: '482913' } });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  assert.equal(accepted.data.login_email, login);
  step('invite function creates the phone + PIN login (weak PIN refused)');

  const again = await call('/functions/v1/accept-invite', { method: 'POST', body: { token, pin: '482913' } });
  assert.equal(again.status, 400);
  step('the same invite link cannot be used twice');

  const wrong = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: login, password: '999999' } });
  assert.equal(wrong.status, 400);
  const session = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: login, password: '482913' } });
  assert.equal(session.status, 200, JSON.stringify(session.data));
  const t = session.data.access_token;
  step('signs in with phone + PIN (wrong PIN refused)');

  const me = await call(`/rest/v1/members?select=id,full_name,companies(name)&user_id=eq.${session.data.user.id}`, { token: t });
  assert.equal(me.data.length, 1);
  const all = await call('/rest/v1/members?select=id', { token: t });
  assert.equal(all.data.length, 1, 'staff see only themselves');
  step('staff see only themselves');

  const path = `${company}/${member}/check.jpg`;
  const up = await call(`/storage/v1/object/photos/${path}`, { method: 'POST', body: jpeg, token: t, type: 'image/jpeg' });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const dup = await call(`/storage/v1/object/photos/${path}`, { method: 'POST', body: jpeg, token: t, type: 'image/jpeg' });
  assert.ok(dup.status === 409 || /already exists|Duplicate/i.test(JSON.stringify(dup.data)), 'second upload is reported as already there');
  const other = await call(`/storage/v1/object/photos/${company}/someone-else/x.jpg`, { method: 'POST', body: jpeg, token: t, type: 'image/jpeg' });
  assert.ok(other.status >= 400, 'cannot upload into another folder');
  step('selfie uploads into own folder only; a re-upload is recognised');

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const rec = await call('/rest/v1/rpc/record_attendance', { method: 'POST', token: t, body: {
    p_id: id, p_kind: 'in', p_happened_at: now, p_lat: 6.5096, p_lng: 3.3712, p_accuracy: 12, p_photo_path: path, p_device_now: now } });
  assert.equal(rec.status, 200, JSON.stringify(rec.data));
  assert.deepEqual(rec.data.flags, []);
  const resend = await call('/rest/v1/rpc/record_attendance', { method: 'POST', token: t, body: {
    p_id: id, p_kind: 'in', p_happened_at: now, p_lat: 6.5096, p_lng: 3.3712, p_accuracy: 12, p_photo_path: path, p_device_now: now } });
  assert.equal(resend.data.id, id);
  const mine = await call(`/rest/v1/attendance?select=id&member_id=eq.${member}`, { token: t });
  assert.equal(mine.data.length, 1);
  step(`clock-in recorded at the office with no flags (${rec.data.distance_m} m away); re-send saved once`);

  // Face check: queued, and switched off until the AWS secrets exist (nothing blocked).
  assert.equal(rec.data.face_status, 'pending', 'selfie queued for a face check');
  const [{ id: callId }] = await sql(`select net.http_post(url := '${base}/functions/v1/face-check',
    headers := jsonb_build_object('content-type','application/json','x-job-key',(select value from private.settings where key='summary_key')), body := '{}'::jsonb) as id`);
  let answer = [];
  for (let i = 0; i < 20 && !answer.length; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    answer = await sql(`select status_code, content from net._http_response where id = ${callId}`);
  }
  const awsOn = (await sql("select value from private.settings where key = 'face_check'"))[0]?.value?.includes('"enabled": true');
  assert.equal(answer[0]?.status_code, 200, 'face-check job answers');
  if (!awsOn) {
    assert.match(answer[0].content, /off until AWS_ACCESS_KEY_ID/);
    const [{ face_status }] = await sql(`select face_status from public.attendance where id = '${id}'`);
    assert.equal(face_status, 'pending', 'still waiting, not failed');
  }
  step(`face check job runs; ${awsOn ? 'AWS keys found: checking is ON' : 'OFF until the AWS keys are added, selfie waits safely'}`);

  const stores = await call('/rest/v1/stores?select=id,name,lat', { token: t });
  assert.deepEqual(stores.data.map((x) => x.name), ['Check Store'], 'sees only assigned stores');
  const later = new Date(Date.now() + 1000).toISOString();
  const v = await call('/rest/v1/rpc/record_visit', { method: 'POST', token: t, body: {
    p_id: crypto.randomUUID(), p_store: store, p_happened_at: later, p_lat: 6.5097, p_lng: 3.3713, p_accuracy: 12,
    p_selfie_path: path, p_shelf_path: null, p_note: ' Low stock ', p_device_now: later } });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.deepEqual(v.data.flags, ['store_located']);
  assert.equal(v.data.note, 'Low stock');
  const located = await call(`/rest/v1/stores?select=lat&id=eq.${store}`, { token: t });
  assert.equal(located.data[0].lat, 6.5097);
  step('store visit recorded; a store with no location gets it from the first visit (flagged)');
} finally {
  await sql(`
    set local storage.allow_delete_query = 'true';
    delete from storage.objects where bucket_id = 'photos' and name like '${company}/%';
    delete from public.companies where id = '${company}';
    delete from auth.users where email = '${login}';`);
  const [{ left }] = await sql(`select (select count(*) from public.companies where id = '${company}') + (select count(*) from auth.users where email = '${login}') as left`);
  assert.equal(Number(left), 0);
  step('test company, login and photo deleted');
}
