import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSync } from '../../web/js/sync.js';

// In-memory stand-ins for the phone's storage and for Supabase.
function setup({ upload, rpc } = {}) {
  const rows = new Map();
  const store = {
    all: async () => [...rows.values()].sort((a, b) => a.happened_at.localeCompare(b.happened_at)),
    put: async (r) => { rows.set(r.id, r); },
    remove: async (id) => { rows.delete(id); },
  };
  const sent = [];
  const uploads = [];
  const reports = [];
  const api = {
    getSession: () => ({ access_token: 'x' }),
    serverNow: () => new Date('2026-11-16T08:30:00Z'),
    upload: upload || (async (bucket, path) => { uploads.push(path); }),
    rpc: rpc || (async (fn, args) => { sent.push(args); return {}; }),
  };
  const sync = createSync({ store, api, report: (e) => reports.push(e), memberId: () => 'me' });
  return { sync, rows, sent, uploads, reports, api };
}
const rec = (id, at, extra = {}) => ({ id, member_id: 'me', company_id: 'co', kind: 'in', happened_at: at, lat: 6.5, lng: 3.3, accuracy: 10, photo: null, ...extra });
const offline = () => Object.assign(new Error('No connection'), { status: 0 });

test('saved clock-ins are sent oldest first, then removed from the phone', async () => {
  const t = setup();
  await t.sync.add(rec('b', '2026-11-16T09:00:00Z'));
  await t.sync.add(rec('a', '2026-11-16T08:00:00Z'));
  assert.equal(await t.sync.count(), 2);
  await t.sync.flush();
  assert.deepEqual(t.sent.map((s) => s.p_id), ['a', 'b']);
  assert.equal(await t.sync.count(), 0);
});

test('the time sent is the time of tapping, plus the phone clock for checking', async () => {
  const t = setup();
  await t.sync.add(rec('a', '2026-11-16T07:55:00Z'));
  await t.sync.flush();
  assert.equal(t.sent[0].p_happened_at, '2026-11-16T07:55:00Z');
  assert.equal(t.sent[0].p_device_now, '2026-11-16T08:30:00.000Z');
});

test('the photo is uploaded first into the person\'s own folder', async () => {
  const t = setup();
  await t.sync.add(rec('a', '2026-11-16T08:00:00Z', { photo: { size: 20000 } }));
  await t.sync.flush();
  assert.deepEqual(t.uploads, ['co/me/a.jpg']);
  assert.equal(t.sent[0].p_photo_path, 'co/me/a.jpg');
});

test('no signal: nothing is lost, it waits for next time', async () => {
  let online = false;
  const t = setup({ rpc: async (fn, args) => { if (!online) throw offline(); t.sent.push(args); } });
  await t.sync.add(rec('a', '2026-11-16T08:00:00Z'));
  await t.sync.flush();
  assert.equal(await t.sync.count(), 1);
  assert.equal(t.reports.length, 0, 'no signal is normal, not an error');
  online = true;
  await t.sync.flush();
  assert.equal(await t.sync.count(), 0);
});

test('signal lost after the photo uploaded: the re-send skips the "already there" photo', async () => {
  let tries = 0;
  const t = setup({
    upload: async () => { if (++tries > 1) throw Object.assign(new Error('The resource already exists'), { status: 400 }); },
    rpc: async (fn, args) => { if (tries === 1) throw offline(); t.sent.push(args); },
  });
  await t.sync.add(rec('a', '2026-11-16T08:00:00Z', { photo: { size: 1 } }));
  await t.sync.flush();
  await t.sync.flush();
  assert.equal(t.sent.length, 1);
  assert.equal(await t.sync.count(), 0);
});

test('a refused record is reported once, kept, and does not block the others', async () => {
  const t = setup({ rpc: async (fn, args) => { if (args.p_id === 'bad') throw Object.assign(new Error('nope'), { status: 400 }); t.sent.push(args); } });
  await t.sync.add(rec('bad', '2026-11-16T08:00:00Z'));
  await t.sync.add(rec('good', '2026-11-16T09:00:00Z'));
  await t.sync.flush();
  await t.sync.flush();
  assert.deepEqual(t.sent.map((s) => s.p_id), ['good']);
  assert.equal(await t.sync.count(), 1);
  assert.equal(t.reports.length, 1);
});

test('someone else\'s saved clock-ins (shared phone) are left alone', async () => {
  const t = setup();
  await t.sync.add(rec('theirs', '2026-11-16T08:00:00Z', { member_id: 'other' }));
  await t.sync.flush();
  assert.equal(t.sent.length, 0);
  assert.equal(t.rows.size, 1);
});

test('tapping many times at once sends each record only once', async () => {
  const t = setup();
  await t.sync.add(rec('a', '2026-11-16T08:00:00Z'));
  await Promise.all([t.sync.flush(), t.sync.flush(), t.sync.flush()]);
  assert.equal(t.sent.length, 1);
});

test('the "waiting to send" badge is told about changes', async () => {
  const t = setup();
  const seen = [];
  t.sync.onChange((n) => seen.push(n));
  await t.sync.add(rec('a', '2026-11-16T08:00:00Z'));
  await t.sync.flush();
  assert.deepEqual(seen.slice(0, 2), [1, 0]);
});

test('a store visit sends its selfie and shelf photo, then the visit', async () => {
  const t = setup();
  await t.sync.add({ type: 'visit', id: 'v1', member_id: 'me', company_id: 'co', store_id: 's9', happened_at: '2026-11-16T09:00:00Z',
    lat: 6.6, lng: 3.35, accuracy: 12, selfie: { size: 1 }, shelf: { size: 2 }, note: 'Low stock' });
  await t.sync.flush();
  assert.deepEqual(t.uploads, ['co/me/v1.jpg', 'co/me/v1-shelf.jpg']);
  assert.equal(t.sent[0].p_store, 's9');
  assert.equal(t.sent[0].p_selfie_path, 'co/me/v1.jpg');
  assert.equal(t.sent[0].p_shelf_path, 'co/me/v1-shelf.jpg');
  assert.equal(t.sent[0].p_note, 'Low stock');
});

test('a visit without a shelf photo or note sends neither', async () => {
  const t = setup();
  await t.sync.add({ type: 'visit', id: 'v2', member_id: 'me', company_id: 'co', store_id: 's9', happened_at: '2026-11-16T09:00:00Z',
    lat: 6.6, lng: 3.35, accuracy: 12, selfie: { size: 1 }, shelf: null, note: '' });
  await t.sync.flush();
  assert.deepEqual(t.uploads, ['co/me/v2.jpg']);
  assert.equal(t.sent[0].p_shelf_path, null);
  assert.equal(t.sent[0].p_note, null);
});
