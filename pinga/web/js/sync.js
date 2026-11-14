// Sends saved clock-ins when there is signal. Oldest first. Safe to run any number of
// times: each record has its own id, so a re-send never creates a duplicate.

export function createSync({ store, api, report, memberId }) {
  let running = null;
  const listeners = new Set();
  const reported = new Set();
  const notify = async () => { const n = await count(); listeners.forEach((fn) => fn(n)); };
  const count = async () => (await store.all()).filter((r) => r.member_id === memberId()).length;

  async function send(rec) {
    let path = null;
    if (rec.photo) {
      path = `${rec.company_id}/${rec.member_id}/${rec.id}.jpg`;
      try { await api.upload('photos', path, rec.photo); } catch (e) {
        // Already uploaded on an earlier try that lost signal before finishing.
        if (!(e.status === 409 || /already exists|duplicate/i.test(e.message))) throw e;
      }
    }
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
