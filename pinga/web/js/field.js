// Sales rep screens: Today (my stores, nearest first, progress), store check-in, History.
// Same layout and flow as the CHF Heron field sales tracker. Works without signal.
import { ask } from './dialog.js';
import * as api from './api.js';
import { sync, outbox, uuid, safeToSignOut } from './queue.js';
import { watchBest, distanceM } from './gps.js';
import { startCamera, capture } from './camera.js';
import { report } from './report.js';
import { show, go, esc, toast, wireSignOut, onLeave, app, fmtTime, fmtDay, localDate, fmtDistance, flagLabel, firstName } from './ui.js';
import { ICON, logo } from './icons.js';

const SORT_KEY = 'pinga.sort';
let SORT = 'near';
try { SORT = localStorage.getItem(SORT_KEY) || 'near'; } catch { /* default */ }
let POS = null; // last GPS reading { lat, lng, accuracy, t }

export function fieldRoute(me, name, arg) {
  if (name === 'visit') return visit(me, arg);
  if (name === 'history') return history(me);
  return today(me);
}

// ── Shared data (kept on the phone for offline use) ─────────

const loadStores = () => api.cached('stores', () => api.select('stores', 'select=id,name,address,lat,lng,radius_m&active=is.true&order=name'))
  .catch((e) => { if (e.status !== 0) report(e); return []; });

const loadVisits = (me) => {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  return api.cached('visits', () => api.select('visits',
    `select=id,store_id,happened_at,flags&member_id=eq.${me.id}&happened_at=gte.${since}&order=happened_at.desc`))
    .catch((e) => { if (e.status !== 0) report(e); return []; });
};

// Sent visits plus the ones still waiting on this phone.
async function allVisits(me) {
  const [sent, waiting] = await Promise.all([loadVisits(me), outbox.all()]);
  const mine = waiting.filter((w) => w.type === 'visit' && w.member_id === me.id && !sent.some((s) => s.id === w.id))
    .map((w) => ({ id: w.id, store_id: w.store_id, happened_at: w.happened_at, flags: [], waiting: true }));
  return [...mine, ...sent].sort((a, b) => b.happened_at.localeCompare(a.happened_at));
}

const topBar = (me, sub, title) => `
  <header class="bar">
    <div><div class="company">${logo(18)}${esc(sub)}</div><h1>${esc(title)}</h1></div>
    <button class="link" id="signout">Sign out</button>
  </header>`;

const tabBar = (on) => `
  <nav class="tabbar appnav" aria-label="Sections">
    <a href="#/"${on === 'today' ? ' class="on" aria-current="page"' : ''}>${ICON.today}<span>Today</span></a>
    <a href="#/history"${on === 'history' ? ' class="on" aria-current="page"' : ''}>${ICON.history}<span>History</span></a>
  </nav>`;

// ── Today ───────────────────────────────────────────────────

async function today(me) {
  const tz = me.companies.timezone;
  const day = localDate(api.serverNow(), tz);
  const [stores, visits, waitingCount] = await Promise.all([loadStores(), allVisits(me), sync.count()]);
  const todays = visits.filter((v) => localDate(new Date(v.happened_at), tz) === day);
  const doneAt = new Map(todays.map((v) => [v.store_id, v.happened_at]));
  const lastVisit = new Map();
  for (const v of visits) if (!lastVisit.has(v.store_id)) lastVisit.set(v.store_id, v.happened_at);

  const target = me.daily_visit_target || 4;
  const n = doneAt.size;
  const pct = Math.min(100, Math.round((100 * n) / target));
  const headline = n >= target ? 'Target reached' : n ? `${target - n} more store${target - n > 1 ? 's' : ''} to go` : 'No visits yet today';

  show(`
    <main class="page narrow has-tabs">
      ${topBar(me, `${me.companies.name} · ${fmtDay(api.serverNow().toISOString(), tz)}`, `Hi, ${firstName(me.full_name)}`)}
      <p class="banner" id="waiting"${waitingCount ? '' : ' hidden'}>${waitingCount} check-in${waitingCount > 1 ? 's' : ''} saved on this phone. They'll send when you have signal.</p>
      <div class="card prog">
        <div class="ring${n >= target ? ' done' : ''}" style="--p:${pct}"><div>${n}<small>of ${target}</small></div></div>
        <div><h3>${headline}</h3><p class="muted">${n} of ${target} visits done today</p></div>
      </div>
      <div class="sortbar">
        <h3>My stores (${stores.length})</h3>
        <div class="seg" role="group" aria-label="Sort stores">
          <button type="button" data-sort="near" aria-pressed="${SORT === 'near'}"${SORT === 'near' ? ' class="on"' : ''}>Nearest</button>
          <button type="button" data-sort="az" aria-pressed="${SORT === 'az'}"${SORT === 'az' ? ' class="on"' : ''}>A–Z</button>
        </div>
      </div>
      <p class="sortnote" id="sortnote"></p>
      <input id="sq" type="search" placeholder="Search my stores" aria-label="Search my stores"${stores.length > 6 ? '' : ' hidden'}>
      <div class="slist" id="sl"></div>
    </main>
    ${tabBar('today')}`);
  wireSignOut(safeToSignOut);

  const draw = () => {
    const q = (document.getElementById('sq')?.value || '').toLowerCase();
    const near = SORT === 'near' && POS;
    let rows = stores.filter((s) => !q || `${s.name} ${s.address || ''}`.toLowerCase().includes(q))
      .map((s) => ({ ...s, d: POS && s.lat != null ? distanceM(POS, s) : null }));
    if (near) rows.sort((a, b) => (a.d ?? 9e9) - (b.d ?? 9e9));
    rows.sort((a, b) => doneAt.has(a.id) - doneAt.has(b.id)); // visited ones go to the bottom
    const next = near ? rows.find((s) => !doneAt.has(s.id) && s.d != null) : null;
    let rank = 0;
    const list = document.getElementById('sl');
    if (!list) return;
    list.innerHTML = rows.map((s) => {
      const done = doneAt.has(s.id);
      const isNext = next && s.id === next.id;
      const rk = near && !done && s.d != null ? ++rank : 0;
      const pills = [];
      if (isNext) pills.push('<span class="pill near">Nearest · go here next</span>');
      if (done) pills.push(`<span class="pill ok">Visited ${fmtTime(doneAt.get(s.id), tz)}</span>`);
      else if (!isNext) pills.push(lastVisit.has(s.id) ? `<span class="muted">Last visit ${fmtDay(lastVisit.get(s.id), tz)}</span>` : '<span class="pill wait">Not visited yet</span>');
      if (s.d != null && SORT === 'near' && !done) pills.push(`<span class="pill">${fmtDistance(s.d)}</span>`);
      return `
        <button type="button" class="store${done ? ' done' : ''}${isNext ? ' next' : ''}" data-s="${s.id}">
          <span class="ic-box">${done ? ICON.check : rk ? `<b>${rk}</b>` : ICON.store}</span>
          <span class="grow"><b>${esc(s.name)}</b>${s.address ? `<span class="tiny muted">${esc(s.address)}</span>` : ''}<span class="tiny">${pills.join(' ')}</span></span>
          ${done ? '' : `<span class="chev">${ICON.chevron}</span>`}
        </button>`;
    }).join('') || `<p class="empty muted">${stores.length ? 'No store matches your search.' : 'No stores on your list yet. Ask your manager to assign your stores.'}</p>`;
    list.querySelectorAll('[data-s]').forEach((el) => {
      el.onclick = () => (doneAt.has(el.dataset.s) ? toast('Already checked in here today') : go('#/visit/' + el.dataset.s));
    });
    const left = rows.filter((s) => !doneAt.has(s.id)).length;
    document.getElementById('sortnote').innerHTML = SORT === 'az' ? 'Sorted A–Z by store name.'
      : !POS ? 'Finding your location…'
      : next ? `Sorted <b>nearest first</b> from where you are (${fmtTime(new Date(POS.t).toISOString(), tz)}). Tap Nearest to refresh.`
      : left ? 'Sorted by distance. Your remaining stores have no location yet.' : 'All stores visited today.';
  };
  draw();
  document.getElementById('sq').oninput = draw;

  let stopGps = () => {};
  const locate = () => {
    stopGps();
    stopGps = watchBest((p) => { POS = { ...p, t: Date.now() }; draw(); }, () => {
      if (!POS) document.getElementById('sortnote').textContent = "Can't find your location. Turn on Location to sort by distance.";
    }, { goodM: 50, maxMs: 15000 });
  };
  document.querySelectorAll('[data-sort]').forEach((b) => {
    b.onclick = () => {
      SORT = b.dataset.sort;
      try { localStorage.setItem(SORT_KEY, SORT); } catch { /* fine */ }
      document.querySelectorAll('[data-sort]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
      if (SORT === 'near') locate();
      draw();
    };
  });
  if (SORT === 'near' && (!POS || Date.now() - POS.t > 120000)) locate();

  const off = sync.onChange((count) => {
    const el = document.getElementById('waiting');
    if (!el) return;
    el.hidden = !count;
    el.textContent = `${count} check-in${count > 1 ? 's' : ''} saved on this phone. They'll send when you have signal.`;
    if (count < waitingCount) { off(); today(me).catch(report); } // something was sent: reload from the server
  });
  onLeave(() => { off(); stopGps(); });
}

// ── Check in at a store ─────────────────────────────────────

async function visit(me, storeId) {
  const tz = me.companies.timezone;
  const store = (await loadStores()).find((s) => s.id === storeId);
  if (!store) return go('#/');
  show(`
    <main class="page narrow">
      <a class="back" href="#/">${ICON.back}My stores</a>
      <p class="muted eyebrow">Check in at</p>
      <h1>${esc(store.name)}</h1>
      ${store.address ? `<p class="muted">${esc(store.address)}</p>` : ''}
      <div class="gps" id="g" role="status">Getting your location…</div>
      <div class="camera"><video playsinline muted></video></div>
      <p class="center muted small" id="camnote">Your selfie is taken when you check in.</p>
      <div class="stack tight">
        <img class="shot" id="shot" alt="Shelf photo" hidden>
        <button type="button" class="secondary" id="shelf">Add shelf photo (optional)</button>
        <label><span>Note <span class="muted">(optional)</span></span><textarea id="note" rows="2" maxlength="500" placeholder="e.g. Low stock on Sebamed, met the store manager"></textarea></label>
      </div>
      <p class="error" id="err" role="alert"></p>
      <button class="primary" id="go" disabled>Waiting for location…</button>
      <button class="link block hide" id="alt">Check in anyway (flagged)</button>
    </main>`);

  const video = app.querySelector('video'), g = document.getElementById('g'), btn = document.getElementById('go'),
    alt = document.getElementById('alt'), err = document.getElementById('err'), shelfBtn = document.getElementById('shelf'),
    shot = document.getElementById('shot'), camnote = document.getElementById('camnote');
  let pos = null, stopCam = null, cameraOk = false, cameraTried = false, mode = 'selfie', shelf = null, state = 'wait', shotUrl = null;

  const camera = async (facing) => {
    if (stopCam) stopCam();
    stopCam = null;
    video.classList.toggle('mirror', facing === 'user');
    try { stopCam = await startCamera(video, facing); return true; } catch { return false; }
  };

  const update = () => {
    if (!pos || !cameraTried) return;   // wait for both GPS and the camera
    const acc = Math.round(pos.accuracy);
    alt.classList.add('hide');
    btn.disabled = mode !== 'selfie';
    const label = cameraOk ? 'Take selfie and check in' : 'Check in without selfie';
    if (store.lat == null) {
      state = 'in';
      g.className = 'gps warn';
      g.textContent = pos.accuracy <= 50 ? "This store's location isn't saved yet. Checking in here will save it."
        : `GPS is weak (±${acc} m). Step outside or near the entrance for a better fix.`;
      btn.textContent = label;
      return;
    }
    const d = distanceM(pos, store);
    if (d <= store.radius_m + Math.min(pos.accuracy, 50)) {
      state = 'in';
      g.className = 'gps ok';
      g.innerHTML = `${ICON.checkSmall}<span>You're at the store (${fmtDistance(d)} away).</span>`;
      btn.textContent = label;
      return;
    }
    state = 'out';
    g.className = 'gps bad';
    g.innerHTML = `<b>You're outside this store's zone</b><br>You're ${fmtDistance(d)} from ${esc(store.name)}. Go to the store, or pick the store you're actually at.<br><span class="tiny">If you check in from here, your manager will see it flagged.</span>`;
    btn.textContent = 'Pick another store';
    alt.classList.remove('hide');
  };

  const stopGps = watchBest((p) => { pos = p; update(); }, (why) => {
    if (pos) return;
    g.className = 'gps bad';
    g.textContent = why === 'denied' ? 'Pinga needs your location. Allow location for this site in Chrome settings, then try again.'
      : "Can't find your location. Turn on Location (GPS) and step outside.";
    btn.disabled = false;
    btn.textContent = 'Try again';
    state = 'nogps';
  });
  onLeave(() => { stopGps(); if (stopCam) stopCam(); if (shotUrl) URL.revokeObjectURL(shotUrl); });

  cameraOk = await camera('user');
  cameraTried = true;
  if (!cameraOk) { app.querySelector('.camera').classList.add('off'); camnote.textContent = 'Camera not available. You can still check in; your manager will see there is no selfie.'; shelfBtn.hidden = true; }
  update();

  // Shelf photo: switch to the back camera, take it, switch back.
  shelfBtn.onclick = async () => {
    if (mode === 'selfie') {
      mode = 'shelf';
      btn.disabled = shelfBtn.disabled = true;     // wait until the back camera is ready
      shelfBtn.textContent = 'Starting camera…';
      camnote.textContent = 'Point the back camera at the shelf.';
      if (!(await camera('environment'))) {
        toast('Back camera not available.');
        mode = 'selfie';
        shelfBtn.textContent = 'Add shelf photo (optional)';
        camnote.textContent = 'Your selfie is taken when you check in.';
        await camera('user');
        shelfBtn.disabled = false;
        return update();
      }
      shelfBtn.textContent = 'Take shelf photo';
      shelfBtn.className = 'primary';
      shelfBtn.disabled = false;
      return;
    }
    try { shelf = await capture(video, 480, 80 * 1024); } catch (e) { report(e); toast("Couldn't take the photo. Try again."); return; }
    if (shotUrl) URL.revokeObjectURL(shotUrl);
    shotUrl = URL.createObjectURL(shelf);
    shot.src = shotUrl;
    shot.hidden = false;
    mode = 'selfie';
    shelfBtn.disabled = true;
    shelfBtn.textContent = 'Retake shelf photo';
    shelfBtn.className = 'secondary';
    camnote.textContent = 'Your selfie is taken when you check in.';
    await camera('user');
    shelfBtn.disabled = false;
    update();
  };

  const submit = async () => {
    btn.disabled = alt.disabled = true;
    try {
      const selfie = cameraOk ? await capture(video).catch((e) => { report(e); return null; }) : null;
      const rec = {
        type: 'visit', id: uuid(), member_id: me.id, company_id: me.company_id, store_id: store.id,
        happened_at: api.serverNow().toISOString(), lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy,
        selfie, shelf, note: document.getElementById('note').value.trim(),
      };
      await sync.add(rec);   // saved on the phone first
      sync.flush();          // then sent in the background
      toast(`Checked in at ${store.name}, ${fmtTime(rec.happened_at, tz)}`);
      go('#/');
    } catch (x) {
      report(x);
      err.textContent = "Couldn't save on this phone. Please try again.";
      btn.disabled = alt.disabled = false;
    }
  };
  btn.onclick = () => {
    if (state === 'nogps') return go('#/visit/' + store.id);
    if (state === 'out') { toast('Pick the store you are at, or tap Nearest to find it'); return go('#/'); }
    if (state === 'in') submit();
  };
  alt.onclick = async () => {
    if (await ask(`You're outside ${store.name}'s zone. Check in anyway? Your manager will see it flagged.`, { ok: 'Check in anyway' })) submit();
  };
}

// ── History ─────────────────────────────────────────────────

async function history(me) {
  const tz = me.companies.timezone;
  const [stores, visits] = await Promise.all([loadStores(), allVisits(me)]);
  const names = new Map(stores.map((s) => [s.id, s.name]));
  const days = new Map();
  for (const v of visits) {
    const d = localDate(new Date(v.happened_at), tz);
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(v);
  }
  show(`
    <main class="page narrow has-tabs">
      ${topBar(me, 'Last 30 days', 'History')}
      ${visits.length ? [...days.values()].map((list) => `
        <h3 class="section">${fmtDay(list[0].happened_at, tz)} · ${list.length} visit${list.length > 1 ? 's' : ''}</h3>
        <ul class="list">${list.map((v) => `
          <li class="card row"><span class="grow"><b>${esc(names.get(v.store_id) || 'Store')}</b><br><span class="muted">${fmtTime(v.happened_at, tz)}</span>
            ${v.waiting ? '<br><span class="pill wait">Waiting to send</span>' : ''}
            ${v.flags.filter((f) => f !== 'store_located').map((f) => `<br><span class="pill warn">${esc(flagLabel(f, 'store'))}</span>`).join('')}</span></li>`).join('')}
        </ul>`).join('') : '<p class="empty muted center">No visits in the last 30 days.</p>'}
    </main>
    ${tabBar('history')}`);
  wireSignOut(safeToSignOut);
}
