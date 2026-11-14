// Staff screens: reference photo, home, clock in / clock out. Everything works without signal.
import * as api from './api.js';
import { outbox } from './outbox.js';
import { createSync } from './sync.js';
import { watchBest, nearest } from './gps.js';
import { startCamera, capture } from './camera.js';
import { report } from './report.js';
import { show, go, esc, friendly, toast, header, wireSignOut, onLeave, reloadMe, app, ROLE, fmtTime, localDate, fmtDistance } from './ui.js';

let current = null; // the signed-in person
const sync = createSync({ store: outbox, api, report, memberId: () => current?.id });

// Send whenever the chance comes: app opened, signal back, every minute while open.
addEventListener('online', () => sync.flush());
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync.flush(); });
setInterval(() => sync.flush(), 60000);

const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

export function staffRoute(me, name, arg) {
  current = me;
  api.syncClock().catch(() => {});
  sync.flush();
  if (me.role === 'rep') return repHome(me);
  if (!me.reference_photo_path) return referencePhoto(me);
  if (name === 'clock') return clock(me, arg === 'out' ? 'out' : 'in');
  return home(me);
}

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

// Signing out with unsent clock-ins would lose them.
const safeToSignOut = async () => {
  if (!(await sync.count())) return true;
  toast("Some clock-ins haven't been sent yet. Connect to the internet first.");
  return false;
};

const waitingText = (n) => (n ? `${n} waiting to send · will send when you have signal` : '');

// ── Home ────────────────────────────────────────────────────

async function home(me) {
  const tz = me.companies.timezone;
  const today = localDate(api.serverNow(), tz);
  const isToday = (r) => localDate(new Date(r.happened_at), tz) === today;
  const sent = await api.cached('today', () => api.select('attendance',
    `select=id,kind,happened_at,late_minutes&member_id=eq.${me.id}&local_date=eq.${today}&order=happened_at`)).catch((e) => {
    if (e.status !== 0) report(e);
    return [];
  });
  const waiting = (await outbox.all()).filter((r) => r.member_id === me.id);
  const events = [...sent.filter(isToday), ...waiting.filter((w) => isToday(w) && !sent.some((s) => s.id === w.id))]
    .sort((a, b) => a.happened_at.localeCompare(b.happened_at));
  const last = events[events.length - 1];
  const firstIn = events.find((e) => e.kind === 'in');

  let status = "You haven't clocked in today.";
  if (last?.kind === 'in') {
    status = `Clocked in at ${fmtTime(firstIn.happened_at, tz)}`;
    if (firstIn.late_minutes > 0) status += ` · <span class="late">${firstIn.late_minutes} min late</span>`;
    else if (firstIn.late_minutes === 0) status += ' · on time';
  } else if (last?.kind === 'out') {
    status = `Clocked out at ${fmtTime(last.happened_at, tz)}`;
  }
  const next = last?.kind === 'in' ? 'out' : 'in';
  const n = waiting.length;

  show(`
    <main class="page narrow">
      ${header(me, greeting())}
      <div class="card hero">
        <h2>${esc(me.full_name.split(' ')[0])}</h2>
        <p class="status">${status}</p>
      </div>
      <a class="primary button big" href="#/clock/${next}">${next === 'in' ? 'Clock in' : 'Clock out'}</a>
      <p class="waiting" id="waiting" role="status">${waitingText(n)}</p>
    </main>`);
  wireSignOut(safeToSignOut);
  const off = sync.onChange((count) => {
    const el = document.getElementById('waiting');
    if (el) el.textContent = waitingText(count);
    if (count < n) { off(); home(me).catch(report); } // something was sent: refresh to show lateness
  });
  onLeave(off);
}

function repHome(me) {
  show(`
    <main class="page narrow">
      ${header(me, greeting())}
      <div class="card hero">
        <h2>${esc(me.full_name.split(' ')[0])}</h2>
        <p>You're all set up as ${ROLE[me.role].toLowerCase()} at ${esc(me.companies.name)}.</p>
      </div>
      <p class="muted center">Store visits arrive in the next update.</p>
    </main>`);
  wireSignOut();
}

// ── Camera screen (shared by reference photo and clock in/out) ──

function cameraScreen({ title, intro = '', back = true }) {
  show(`
    <main class="page narrow">
      ${back ? '<a class="back" href="#/">‹ Back</a>' : '<div class="brand">Pinga</div>'}
      <h1>${title}</h1>
      ${intro}
      <div class="camera"><video playsinline muted></video></div>
      <p class="where" id="where"></p>
      <p class="error" id="err" role="alert"></p>
      <button class="primary" id="go" disabled>Please wait…</button>
    </main>`);
  const video = app.querySelector('video');
  let stopCam = null;
  const camera = startCamera(video).then((stop) => { stopCam = stop; return true; }, () => {
    app.querySelector('.camera').classList.add('off');
    return false;
  });
  return { video, camera, el: (id) => document.getElementById(id), stop: () => stopCam?.() };
}

// ── Reference photo (once, after joining) ───────────────────

function referencePhoto(me) {
  const s = cameraScreen({ title: 'Your photo', back: false,
    intro: '<p>Take one clear photo of your face. Pinga uses it to check that it\'s really you when you clock in.</p>' });
  const btn = s.el('go');
  onLeave(s.stop);
  s.camera.then((ok) => {
    if (!ok) { s.el('err').textContent = 'Pinga needs your camera. Allow the camera for this site in Chrome, then try again.'; btn.textContent = 'Try again'; btn.disabled = false; btn.onclick = () => go('#/'); return; }
    btn.textContent = 'Take photo';
    btn.disabled = false;
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        const path = `${me.company_id}/${me.id}/reference-${Date.now()}.jpg`;
        await api.upload('photos', path, await capture(s.video));
        await api.rpc('set_reference_photo', { p_path: path });
        s.stop();
        toast('Photo saved');
        reloadMe();
        go('#/');
      } catch (x) {
        s.el('err').textContent = x.status === 0 ? 'No connection. You need internet for this one-time step.' : friendly(x);
        btn.disabled = false;
        btn.textContent = 'Take photo';
      }
    };
  });
}

// ── Clock in / clock out ────────────────────────────────────

async function clock(me, kind) {
  const tz = me.companies.timezone;
  const verb = kind === 'in' ? 'clock in' : 'clock out';
  const s = cameraScreen({ title: kind === 'in' ? 'Clock in' : 'Clock out' });
  const where = s.el('where'), btn = s.el('go'), err = s.el('err');
  let pos = null, cameraOk = false, ready = false;
  where.textContent = 'Finding your location…';

  const offices = await api.cached('branches', () =>
    api.select('branches', `select=id,name,lat,lng,radius_m&company_id=eq.${me.company_id}`)).catch(() => []);

  const update = () => {
    if (!pos || !ready) return;
    btn.disabled = false;
    btn.textContent = cameraOk ? `Take photo and ${verb}` : `${kind === 'in' ? 'Clock in' : 'Clock out'} without photo`;
    const n = nearest(offices, pos);
    if (!n) { where.textContent = `Location found (within ${Math.round(pos.accuracy)} m)`; where.className = 'where'; return; }
    const inside = n.distance <= n.place.radius_m + Math.min(pos.accuracy, 50);
    where.className = 'where ' + (inside ? 'good' : 'warn');
    where.textContent = inside ? `At ${n.place.name} ✓`
      : `You're ${fmtDistance(n.distance)} from ${n.place.name}. You can still ${verb}; your manager will see this.`;
  };

  const stopGps = watchBest((p) => { pos = p; update(); }, (why) => {
    if (pos) return;
    where.className = 'where bad';
    where.textContent = why === 'denied'
      ? 'Pinga needs your location. Allow location for this site in Chrome settings, then come back.'
      : 'Can\'t find your location. Turn on Location (GPS) and move near a window or outside.';
    btn.textContent = 'Try again';
    btn.disabled = false;
    btn.onclick = () => go('#/clock/' + kind);
  });
  onLeave(() => { stopGps(); s.stop(); });

  cameraOk = await s.camera;
  if (!cameraOk) err.textContent = 'Camera not available. You can continue; your manager will see there is no photo.';
  ready = true;
  update();

  btn.onclick = async () => {
    if (!pos) return go('#/clock/' + kind);
    btn.disabled = true;
    try {
      let photo = null;
      if (cameraOk) photo = await capture(s.video).catch((e) => { report(e); return null; });
      const rec = {
        id: uuid(), member_id: me.id, company_id: me.company_id, kind,
        happened_at: api.serverNow().toISOString(),
        lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, photo,
      };
      await sync.add(rec);       // saved on the phone first
      sync.flush();              // then sent in the background
      toast(`${kind === 'in' ? 'Clocked in' : 'Clocked out'} at ${fmtTime(rec.happened_at, tz)}`);
      go('#/');
    } catch (x) {
      report(x);
      err.textContent = "Couldn't save on this phone. Please try again.";
      btn.disabled = false;
    }
  };
}
