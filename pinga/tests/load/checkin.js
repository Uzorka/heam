// k6 load test (STAGING ONLY). Every staff member clocks in once, the way the phone does it:
//   1. ask the server's time   2. upload the selfie   3. record the clock-in   4. reload today's records
// Meanwhile each company's manager keeps the Today page open (refresh every 30 s).
//   k6 run -e TOKENS=tokens.json -e PHOTO=selfie.jpg -e MODE=normal tests/load/checkin.js   (500 in 5 minutes)
//   ... -e MODE=rush                                                                          (500 in about 1 minute)
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import exec from 'k6/execution';

const BASE = 'https://zgwgszomktveikhecmiz.supabase.co';                 // staging only
const KEY = 'sb_publishable_cp82R2d3yddf5HUTlvEmxg_JqrgGF5b';
const data = JSON.parse(open(__ENV.TOKENS));
const photo = open(__ENV.PHOTO, 'b');
const RUSH = __ENV.MODE === 'rush';
const KIND = __ENV.KIND || 'in';

const t = { upload: new Trend('step_upload_photo', true), record: new Trend('step_record_clock_in', true),
  today: new Trend('step_reload_today', true), total: new Trend('clock_in_total', true), board: new Trend('manager_today_page', true) };

export const options = {
  scenarios: {
    staff: RUSH
      ? { executor: 'ramping-arrival-rate', startRate: 0, timeUnit: '1s', preAllocatedVUs: 200, maxVUs: 400,
        stages: [{ target: 15, duration: '20s' }, { target: 15, duration: '20s' }, { target: 0, duration: '20s' }], exec: 'clockIn' }
      // A morning: arrivals build up, peak around 8:00, then tail off. 500 in total over 5 minutes.
      : { executor: 'ramping-arrival-rate', startRate: 0, timeUnit: '10s', preAllocatedVUs: 100, maxVUs: 300,
        stages: [{ target: 24, duration: '90s' }, { target: 24, duration: '120s' }, { target: 0, duration: '90s' }], exec: 'clockIn' },
    managers: { executor: 'per-vu-iterations', vus: data.managers.length, iterations: RUSH ? 3 : 10, exec: 'manager', maxDuration: '6m' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],                 // fewer than 1 in 100 requests may fail
    clock_in_total: ['p(95)<4000'],                 // 95% of clock-ins complete within 4 s (on the phone it's instant: saved first)
    step_record_clock_in: ['p(95)<1500'],
    manager_today_page: ['p(95)<2500'],
  },
};

const hdr = (token, extra = {}) => ({ headers: { apikey: KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extra } });
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); });

export function clockIn() {
  const i = exec.scenario.iterationInTest;
  if (i >= data.staff.length) return;            // everyone has clocked in
  const s = data.staff[i];
  const id = uuid();
  const started = Date.now();
  const happened = new Date().toISOString();

  http.post(`${BASE}/rest/v1/rpc/server_now`, '{}', hdr(s.token));
  const path = `${s.company_id}/${s.id}/${id}.jpg`;
  const up = http.post(`${BASE}/storage/v1/object/photos/${path}`, photo, hdr(s.token, { 'content-type': 'image/jpeg' }));
  t.upload.add(up.timings.duration);
  const rec = http.post(`${BASE}/rest/v1/rpc/record_attendance`, JSON.stringify({
    p_id: id, p_kind: KIND, p_happened_at: happened, p_lat: 6.5095 + Math.random() * 0.0004, p_lng: 3.3711 + Math.random() * 0.0004,
    p_accuracy: 8 + Math.random() * 20, p_photo_path: path, p_device_now: new Date().toISOString(),
  }), hdr(s.token));
  t.record.add(rec.timings.duration);
  const day = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);    // Lagos date
  const today = http.get(`${BASE}/rest/v1/attendance?select=id,kind,happened_at,late_minutes&member_id=eq.${s.id}&local_date=eq.${day}`, hdr(s.token));
  t.today.add(today.timings.duration);
  t.total.add(Date.now() - started);
  check(up, { 'photo uploaded': (r) => r.status === 200 });
  check(rec, { 'clock-in saved': (r) => r.status === 200 && JSON.parse(r.body).id === id });
  check(today, { 'today reloaded': (r) => r.status === 200 });
}

export function manager() {
  const m = data.managers[exec.vu.idInTest % data.managers.length];
  sleep(Math.random() * 10);
  const day = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
  const r = http.post(`${BASE}/rest/v1/rpc/day_board`, JSON.stringify({ p_day: day }), hdr(m.token));
  t.board.add(r.timings.duration);
  check(r, { 'manager sees Today': (x) => x.status === 200 && JSON.parse(x.body).length === 10 });
  sleep(RUSH ? 20 : 30);
}
