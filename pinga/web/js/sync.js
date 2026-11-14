// Sends saved clock-ins and store visits when there is signal. Oldest first. Safe to run any number of
// times: each record has its own id, so a re-send never creates a duplicate.

export function createSync({ store, api, report, memberId }) {
  let running = null;
  const listeners = new Set();
  const reported = new Set();
  const notify = async () => { const n = await count(); listeners.forEach((fn) => fn(n)); };
  const count = async () => (await store.all()).filter((r) => r.member_id === memberId()).length;

  async function upload(rec, blob, name) {
    if (!blob) return null;
    const path = `${rec.company_id}/${rec.member_id}/${name}.jpg`;
    try { await api.upload('photos', path, blob); } catch (e) {
      // Already uploaded on an earlier try that lost signal before finishing.
      if (!(e.status === 409 || /already exists|duplicate/i.test(e.message))) throw e;
    }
    return path;
  }

  async function send(rec) {
    if (rec.type === 'visit') {
      const selfie = await upload(rec, rec.selfie, rec.id);
      const shelf = await upload(rec, rec.shelf, rec.id + '-shelf');
      return api.rpc('record_visit', {
        p_id: rec.id, p_store: rec.store_id, p_happened_at: rec.happened_at,
        p_lat: rec.lat, p_lng: rec.lng, p_accuracy: rec.accuracy,
        p_selfie_path: selfie, p_shelf_path: shelf, p_note: rec.note || null,
        p_device_now: api.serverNow().toISOString(),
      });
    }
    const path = await upload(rec, rec.photo, rec.id);
    return api.rpc('record_attendance', {
      p_id: rec.id, p_kind: rec.kind, p_happened_at: rec.happened_at,
      p_lat: rec.lat, p_lng: rec.lng, p_accuracy: rec.accuracy,
      p_photo_path: path, p_device_now: api.serverNow().toISOString(),
    });
  }

  async function flushNow() {
    for (const rec of await store.all()) {
      if (!api.getSession() || rec.member_id !== memberId()) continue;
      try {
        await send(rec);
        await store.remove(rec.id);
        await notify();
      } catch (e) {
        if (e.status === 0) return;           // no signal: stop, try again later
        if (!reported.has(rec.id)) { reported.add(rec.id); report(e, { record: rec.id }); }
        // Keep it; it will be tried again next time.
      }
    }
  }

  return {
    count,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    async add(rec) { await store.put(rec); await notify(); },
    flush() {
      if (!running) running = flushNow().finally(() => { running = null; notify(); });
      return running;
    },
  };
}
