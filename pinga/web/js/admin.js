// Owner and manager screens: team, invites, offices, stores, store assignments, working hours.
import * as api from './api.js';
import { normalizePhone, displayPhone } from './phone.js';
import { watchBest, parseLatLng } from './gps.js';
import { show, go, esc, Say, friendly, toast, header, wireSignOut, onLeave, reloadMe, app, ROLE, fmtTime, fmtDay, fmtDistance, flagLabel } from './ui.js';

let banner = '';
let flags = null;   // what's switched on (payments, face check); loaded once per visit
// A reminder for owners and managers when the trial is ending or payment is due. Staff never see it.
function billingBanner(me) {
  const c = me.companies;
  const owner = me.role === 'owner';
  if (c.status === 'past_due') {
    return owner ? '<a class="banner bad-banner" href="#/billing">Payment due. Your team can still clock in. Pay now ›</a>'
      : '<p class="banner bad-banner">Payment due. Please ask the owner to pay so Pinga keeps running.</p>';
  }
  const left = Math.ceil((new Date(c.trial_ends_at) - Date.now()) / 864e5);
  if (c.status === 'trial' && left <= 3 && owner && flags?.payments) {
    return `<a class="banner" href="#/billing">Your free trial ends ${left <= 0 ? 'today' : `in ${left} day${left === 1 ? '' : 's'}`}. Set up payment ›</a>`;
  }
  return '';
}

const tabs = (on) => `${banner}
  <nav class="tabs">
    ${[['#/overview', 'Overview'], ['#/today', 'Today'], ['#/team', 'Team'], ['#/setup', 'Setup']].map(([h, t]) => `<a href="${h}"${t === on ? ' class="on" aria-current="page"' : ''}>${t}</a>`).join('')}
  </nav>`;

export async function adminRoute(me, name, arg) {
  if (!flags) flags = await api.rpc('app_flags').catch(() => ({}));
  banner = billingBanner(me);
  if (name === 'billing') return import('./billing.js').then((m) => m.billing(me, arg));
  if (name === 'invite') return invite(me);
  if (name === 'person') return person(me, arg);
  if (name === 'offices') return places(me, PLACE.office);
  if (name === 'office') return placeForm(me, PLACE.office, arg);
  if (name === 'stores') return places(me, PLACE.store);
  if (name === 'store') return placeForm(me, PLACE.store, arg);
  if (name === 'assign') return assign(me, arg);
  if (name === 'team') return team(me);
  if (name === 'hours') return hours(me);
  if (name === 'setup') return setup(me);
  if (name === 'face') return faceSettings(me);
  if (name === 'export') return import('./export.js').then((m) => m.exportScreen(me));
  if (name === 'today' || name === 'day') return import('./today.js').then((m) => m.today(me, arg, tabs));
  if (name === 'overview' || me.role === 'owner') return import('./overview.js').then((m) => m.overview(me, tabs));
  return import('./today.js').then((m) => m.today(me, '', tabs));
}

// ── Team ────────────────────────────────────────────────────

async function team(me) {
  const people = await api.select('members',
    `select=id,full_name,phone,role,joined_at&company_id=eq.${me.company_id}&active=is.true&order=full_name`);
  show(`
    <main class="page">
      ${header(me, 'Team')}
      ${tabs('Team')}
      <a class="primary button" href="#/invite">Invite someone</a>
      <ul class="list">
        ${people.map((p) => `
          <li><a class="card row" href="#/person/${p.id}">
            <span><strong>${esc(p.full_name)}</strong><br><span class="muted">${ROLE[p.role]}${p.phone ? ' · ' + esc(displayPhone(p.phone)) : ''}</span></span>
            ${p.joined_at ? '<span class="pill ok">Joined</span>' : '<span class="pill wait">Not joined</span>'}
          </a></li>`).join('')}
      </ul>
    </main>`);
  wireSignOut();
}

function invite(me) {
  const roles = [['staff', 'Office staff', 'Clocks in at the office'], ['rep', 'Sales rep', 'Visits stores'], ['admin', 'Manager', 'Manages the team']];
  show(`
    <main class="page narrow">
      <a class="back" href="#/team">‹ Team</a>
      <h1>Invite someone</h1>
      <form class="stack">
        <label>Full name<input name="full_name" autocomplete="off" required></label>
        <label>Phone number<input name="phone" type="tel" placeholder="0803 123 4567" required></label>
        <fieldset class="choices"><legend>Role</legend>
          ${roles.map(([v, t, d], i) => `<label class="choice"><input type="radio" name="role" value="${v}"${i ? '' : ' checked'}><span><strong>${t}</strong><br><span class="muted">${d}</span></span></label>`).join('')}
        </fieldset>
        <p class="error" role="alert"></p>
        <button type="submit" class="primary">Create invite</button>
      </form>
    </main>`, async ({ full_name, phone, role }) => {
    const p = normalizePhone(phone);
    if (!p) throw new Say('Enter a valid phone number, like 0803 123 4567.');
    let row;
    try { row = await api.insert('members', { company_id: me.company_id, full_name: full_name.trim(), phone: p, role }); } catch (x) {
      if (x.code === '23505') throw new Say('Someone with this phone number is already in your team.');
      throw x;
    }
    go('#/person/' + row.id);
  });
}

// Loads private photos into <img data-photo="path"> once the screen is shown.
function loadPhotos() {
  const urls = [];
  onLeave(() => urls.forEach((u) => URL.revokeObjectURL(u)));
  app.querySelectorAll('img[data-photo]').forEach(async (img) => {
    try {
      const url = URL.createObjectURL(await api.download('photos', img.dataset.photo));
      urls.push(url);
      img.src = url;
    } catch { img.alt = 'Photo not available'; }
  });
}

async function person(me, id) {
  const tz = me.companies.timezone;
  const mid = encodeURIComponent(id);
  const [[p], records] = await Promise.all([
    api.select('members', `select=id,full_name,phone,role,joined_at,invite_token,reference_photo_path,daily_visit_target,branch_id&id=eq.${mid}`),
    api.select('attendance', `select=id,kind,happened_at,late_minutes,distance_m,photo_path,flags,face_similarity&member_id=eq.${mid}&order=happened_at.desc&limit=10`),
  ]);
  if (!p) return go('#/team');
  const isRep = p.role === 'rep', isStaff = p.role === 'staff', seesPay = me.role === 'owner' && (isRep || isStaff);
  const [offices, pay] = await Promise.all([
    isStaff ? api.select('branches', `select=id,name&company_id=eq.${me.company_id}&order=name`) : [],
    seesPay ? api.select('pay_rates', `select=monthly_naira&member_id=eq.${mid}`) : [],
  ]);
  const monthly = pay[0]?.monthly_naira;
  const [assigned, visits, stores] = isRep ? await Promise.all([
    api.select('store_assignments', `select=store_id&member_id=eq.${mid}`),
    api.select('visits', `select=id,store_id,happened_at,distance_m,selfie_path,shelf_photo_path,note,flags,face_similarity&member_id=eq.${mid}&order=happened_at.desc&limit=10`),
    api.select('stores', `select=id,name&company_id=eq.${me.company_id}`),
  ]) : [[], [], []];
  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const visitRow = (v) => `
      <li class="card row record">
        ${v.selfie_path ? `<img class="thumb" data-photo="${esc(v.selfie_path)}" alt="Selfie at the store">` : '<span class="thumb"></span>'}
        <span class="grow"><strong>${esc(storeName.get(v.store_id) || 'Store')}</strong><br>
          <span class="muted">${fmtDay(v.happened_at, tz)} · ${fmtTime(v.happened_at, tz)}</span>
          ${v.note ? `<br><span class="note">“${esc(v.note)}”</span>` : ''}
          ${v.flags.length ? '<br>' + v.flags.map((f) => `<span class="pill warn">${esc(flagLabel(f, 'store'))}${f === 'outside_radius' && v.distance_m != null ? ` (${fmtDistance(v.distance_m)})` : ''}${f === 'face_mismatch' && v.face_similarity != null ? ` (${Math.round(v.face_similarity)}% alike)` : ''}</span>`).join(' ') : ''}</span>
        ${v.shelf_photo_path ? `<img class="thumb" data-photo="${esc(v.shelf_photo_path)}" alt="Shelf photo">` : ''}
      </li>`;
  const details = isRep || isStaff ? `
      <h2 class="section">Details</h2>
      <div class="card stack">
        <form class="stack details">
          ${isRep ? `<label>Visits per day<input name="target" type="number" min="0" max="50" value="${p.daily_visit_target ?? 4}" required></label>` : ''}
          ${isStaff ? `<label>Home office<select name="branch"><option value="">Not set</option>${offices.map((o) => `<option value="${o.id}"${o.id === p.branch_id ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
            <span class="hint muted">Used on the owner's dashboard when they haven't clocked in yet.</span></label>` : ''}
          ${seesPay ? `<label><span>Monthly pay (₦) <span class="muted">(optional)</span></span><input name="pay" type="number" min="0" step="1" inputmode="numeric" value="${monthly ?? ''}" placeholder="e.g. 150000">
            <span class="hint muted">Only you (the owner) can see this. Used to show the cost of lost time.</span></label>` : ''}
          <p class="error" role="alert"></p>
          <button type="submit" class="secondary">Save</button>
        </form>
        ${isRep ? `<a class="row link-row" href="#/assign/${p.id}"><span>Assigned stores</span><span><b>${assigned.length}</b> <span class="chev">›</span></span></a>` : ''}
      </div>
      ${visits.length ? `<h2 class="section">Recent visits</h2><ul class="list">${visits.map(visitRow).join('')}</ul>` : ''}` : '';
  const first = p.full_name.split(' ')[0];
  const share = (token) => {
    const link = `${location.origin}${location.pathname}#/join/${token}`;
    const text = `Hi ${first}, ${me.companies.name} uses Pinga${isRep ? ' for store visits' : ' for attendance'}. Open this link to set your PIN: ${link}`;
    return `
      <div class="card stack">
        <p>Send ${esc(first)} this link. It works for 7 days.</p>
        <input readonly value="${esc(link)}" id="link" aria-label="Invite link">
        <a class="primary button" href="https://wa.me/${p.phone.slice(1)}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Send on WhatsApp</a>
        <button class="secondary" id="copy">Copy link</button>
      </div>`;
  };
  const row = (r) => {
    const late = r.kind === 'in' && r.late_minutes > 0 ? ` · <span class="late">${r.late_minutes} min late</span>` : '';
    const flags = r.flags.map((f) => `<span class="pill warn">${esc(flagLabel(f, 'office'))}${f === 'outside_radius' && r.distance_m != null ? ` (${fmtDistance(r.distance_m)})` : ''}${f === 'face_mismatch' && r.face_similarity != null ? ` (${Math.round(r.face_similarity)}% alike)` : ''}</span>`).join(' ');
    return `
      <li class="card row record">
        ${r.photo_path ? `<img class="thumb" data-photo="${esc(r.photo_path)}" alt="Photo at ${r.kind === 'in' ? 'clock-in' : 'clock-out'}">` : '<span class="thumb"></span>'}
        <span class="grow"><strong>${r.kind === 'in' ? 'In' : 'Out'} ${fmtTime(r.happened_at, tz)}</strong>${late}<br>
          <span class="muted">${fmtDay(r.happened_at, tz)}</span>${flags ? '<br>' + flags : ''}</span>
      </li>`;
  };
  show(`
    <main class="page narrow">
      <a class="back" href="#/team">‹ Team</a>
      <div class="person">
        ${p.reference_photo_path ? `<img class="face" data-photo="${esc(p.reference_photo_path)}" alt="Reference photo">` : ''}
        <div><h1>${esc(p.full_name)}</h1>
        <p class="muted">${ROLE[p.role]}${p.phone ? ' · ' + esc(displayPhone(p.phone)) : ''}</p></div>
      </div>
      <div id="share">
        ${p.role === 'owner' ? '<p>Owners sign in with their email.</p>'
          : p.invite_token ? share(p.invite_token)
          : `<p>${esc(first)} has joined.</p><button class="secondary" id="reset">Forgot PIN? Create a new PIN link</button>`}
        ${(isRep || isStaff) && p.reference_photo_path ? '<button class="link block" id="retake">Ask for a new reference photo</button>' : ''}
        ${(isRep || isStaff) && p.joined_at && !p.reference_photo_path ? `<p class="muted small">${esc(first)} will be asked for a reference photo next time they open Pinga.</p>` : ''}
      </div>
      ${details}
      ${records.length ? `<h2 class="section">Recent clock-ins</h2><ul class="list">${records.map(row).join('')}</ul>` : ''}
    </main>`, isRep || isStaff ? async ({ target, branch, pay: newPay }) => {
    const changes = isRep ? { daily_visit_target: Number(target) } : { branch_id: branch || null };
    await api.update('members', `id=eq.${p.id}`, changes);
    if (seesPay) {
      if (newPay === '' || newPay === undefined) await api.remove('pay_rates', `member_id=eq.${p.id}`);
      else await api.upsert('pay_rates', { member_id: p.id, company_id: me.company_id, monthly_naira: Number(newPay) });
    }
    toast(isRep ? `Target saved: ${Number(target)} visits a day` : 'Saved');
  } : undefined);
  loadPhotos();
  const wireCopy = () => {
    const btn = document.getElementById('copy');
    if (!btn) return;
    btn.onclick = async () => {
      const input = document.getElementById('link');
      try { await navigator.clipboard.writeText(input.value); } catch { input.select(); document.execCommand('copy'); }
      btn.textContent = 'Copied';
    };
  };
  wireCopy();
  const retake = document.getElementById('retake');
  if (retake) {
    retake.onclick = async () => {
      if (!confirm(`Ask ${first} to take a new reference photo? Their current one will be replaced.`)) return;
      retake.disabled = true;
      try {
        await api.rpc('clear_reference_photo', { p_member: p.id });
        toast(`${first} will be asked for a new photo next time they open Pinga`);
        person(me, id);
      } catch (x) { retake.disabled = false; toast(friendly(x)); }
    };
  }
  const reset = document.getElementById('reset');
  if (reset) {
    reset.onclick = async () => {
      reset.disabled = true;
      try {
        document.getElementById('share').innerHTML = share(await api.rpc('renew_invite', { p_member: p.id }));
        wireCopy();
      } catch (x) { reset.disabled = false; toast(friendly(x)); }
    };
  }
}

// ── Offices and stores ──────────────────────────────────────

const PLACE = {
  office: {
    table: 'branches', plural: 'Offices', one: 'office', path: 'office', back: '#/offices',
    empty: 'Add your office so staff can clock in there.', example: 'e.g. Yaba office',
    area: 'Clock-in area', areaHint: 'Staff must be this close to clock in without a flag. 100 m suits most offices.',
    needsLocation: true, hint: 'Stand in the office and tap the button below, or paste the numbers from Google Maps.',
  },
  store: {
    table: 'stores', plural: 'Stores', one: 'store', path: 'store', back: '#/stores',
    empty: 'Add the stores your sales reps visit, then assign them on each rep\'s page.', example: 'e.g. Shoprite Ikeja',
    area: 'Check-in area', areaHint: 'Reps must be this close to check in without a flag. 100 m suits most stores.',
    needsLocation: false, hint: 'Optional. Leave empty and the first visit with good GPS will save it. Or stand in the store and tap the button below, or paste from Google Maps.',
  },
};

const whereText = (k, b) => (k.table !== 'stores' ? `${k.area} ${b.radius_m} m`
  : b.lat == null ? 'No location yet · first visit will save it'
  : b.location_source === 'first_visit' ? 'Location from first visit · please check' : `${k.area} ${b.radius_m} m`);

async function places(me, k) {
  const cols = k.table === 'stores' ? 'id,name,address,radius_m,lat,location_source' : 'id,name,address,radius_m';
  const list = await api.select(k.table, `select=${cols}&company_id=eq.${me.company_id}&order=name`);
  show(`
    <main class="page">
      ${header(me, k.plural)}
      ${tabs('Setup')}
      <a class="back" href="#/setup">‹ Setup</a>
      <a class="primary button" href="#/${k.path}/new">Add ${k.one}</a>
      ${list.length ? '' : `<p class="muted center empty">${k.empty}</p>`}
      <ul class="list">
        ${list.map((b) => `
          <li><a class="card row" href="#/${k.path}/${b.id}">
            <span><strong>${esc(b.name)}</strong><br><span class="muted">${b.address ? esc(b.address) + ' · ' : ''}${whereText(k, b)}</span></span>
            <span class="chev">›</span>
          </a></li>`).join('')}
      </ul>
    </main>`);
  wireSignOut();
}

async function placeForm(me, k, id) {
  const isNew = id === 'new';
  const b = isNew ? { radius_m: 100 } : (await api.select(k.table, `select=*&id=eq.${encodeURIComponent(id)}`))[0];
  if (!b) return go(k.back);
  show(`
    <main class="page narrow">
      <a class="back" href="${k.back}">‹ ${k.plural}</a>
      <h1>${isNew ? `Add ${k.one}` : esc(b.name)}</h1>
      <form class="stack">
        <label>Name<input name="name" value="${esc(b.name)}" placeholder="${k.example}" required></label>
        <label><span>Address <span class="muted">(optional)</span></span><input name="address" value="${esc(b.address)}"></label>
        <label><span>Location${k.needsLocation ? '' : ' <span class="muted">(optional)</span>'}</span><input name="where" id="where" value="${b.lat != null ? `${b.lat}, ${b.lng}` : ''}" placeholder="6.5095, 3.3711" inputmode="decimal"${k.needsLocation ? ' required' : ''}>
          <span class="hint muted">${b.location_source === 'first_visit' ? 'Saved from the first visit. Change it if it looks wrong.' : k.hint}</span></label>
        <button type="button" class="secondary" id="here">Use my current location</button>
        <label>${k.area} (metres)<input name="radius_m" type="number" min="20" max="2000" value="${b.radius_m}" required>
          <span class="hint muted">${k.areaHint}</span></label>
        <p class="error" role="alert"></p>
        <button type="submit" class="primary">Save</button>
      </form>
    </main>`, async ({ name, address, where, radius_m }) => {
    const pos = where.trim() ? parseLatLng(where) : null;
    if (where.trim() && !pos) throw new Say('Location should look like 6.5095, 3.3711.');
    if (k.needsLocation && !pos) throw new Say('Please add the location.');
    const row = { name: name.trim(), address: address.trim() || null, lat: pos?.lat ?? null, lng: pos?.lng ?? null, radius_m: Number(radius_m) };
    if (k.table === 'stores') {
      const moved = !pos || pos.lat !== b.lat || pos.lng !== b.lng;
      row.location_source = !pos ? null : moved ? 'manager' : b.location_source;
    }
    try {
      if (isNew) await api.insert(k.table, { company_id: me.company_id, ...row });
      else await api.update(k.table, `id=eq.${b.id}`, row);
    } catch (x) {
      if (x.code === '23505') throw new Say(`You already have an ${k.one} with this name.`);
      throw x;
    }
    toast(`${k.one[0].toUpperCase() + k.one.slice(1)} saved`);
    go(k.back);
  });
  const btn = document.getElementById('here');
  btn.onclick = () => {
    btn.disabled = true;
    btn.textContent = 'Finding your location…';
    const stop = watchBest((p) => {
      document.getElementById('where').value = `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
      btn.textContent = `Location found (within ${Math.round(p.accuracy)} m)`;
    }, () => { btn.disabled = false; btn.textContent = 'Use my current location'; toast('Could not get your location. Turn on Location and allow it for this site.'); },
    { goodM: 15, maxMs: 30000 });
    onLeave(stop);
  };
}

// ── Which stores a rep covers ───────────────────────────────

async function assign(me, id) {
  const [[p], stores, current] = await Promise.all([
    api.select('members', `select=id,full_name&id=eq.${encodeURIComponent(id)}`),
    api.select('stores', `select=id,name,address&company_id=eq.${me.company_id}&active=is.true&order=name`),
    api.select('store_assignments', `select=store_id&member_id=eq.${encodeURIComponent(id)}`),
  ]);
  if (!p) return go('#/team');
  const first = p.full_name.split(' ')[0];
  const had = new Set(current.map((a) => a.store_id));
  show(`
    <main class="page narrow">
      <a class="back" href="#/person/${p.id}">‹ ${esc(p.full_name)}</a>
      <h1>Stores for ${esc(first)}</h1>
      <p class="muted" id="count"></p>
      ${stores.length ? `<input id="sq" type="search" placeholder="Search stores" aria-label="Search stores"${stores.length > 8 ? '' : ' hidden'}>` : `<p class="empty">No stores yet. <a href="#/store/new">Add a store</a> first.</p>`}
      <form class="stack">
        <fieldset class="choices">
          ${stores.map((s) => `<label class="choice" data-name="${esc(`${s.name} ${s.address || ''}`.toLowerCase())}"><input type="checkbox" name="s" value="${s.id}"${had.has(s.id) ? ' checked' : ''}><span><strong>${esc(s.name)}</strong>${s.address ? `<br><span class="muted">${esc(s.address)}</span>` : ''}</span></label>`).join('')}
        </fieldset>
        <p class="error" role="alert"></p>
        <button type="submit" class="primary"${stores.length ? '' : ' hidden'}>Save</button>
      </form>
    </main>`, async (_, form) => {
    const now = new Set(new FormData(form).getAll('s'));
    const add = [...now].filter((s) => !had.has(s));
    const drop = [...had].filter((s) => !now.has(s));
    if (add.length) await api.insertRows('store_assignments', add.map((store_id) => ({ company_id: me.company_id, member_id: p.id, store_id })));
    if (drop.length) await api.remove('store_assignments', `member_id=eq.${p.id}&store_id=in.(${drop.join(',')})`);
    toast(`${first} now covers ${now.size} store${now.size === 1 ? '' : 's'}`);
    go('#/person/' + p.id);
  });
  const count = () => { document.getElementById('count').textContent = `Tick the stores ${first} covers. ${app.querySelectorAll('input[name=s]:checked').length} selected.`; };
  count();
  app.querySelector('form').addEventListener('change', count);
  const sq = document.getElementById('sq');
  if (sq) sq.oninput = () => app.querySelectorAll('[data-name]').forEach((l) => { l.hidden = !l.dataset.name.includes(sq.value.toLowerCase()); });
}

// ── Setup ───────────────────────────────────────────────────

async function setup(me) {
  const isOwner = me.role === 'owner';
  const [[co], face] = await Promise.all([
    isOwner ? api.select('companies', `select=summary_email&id=eq.${me.company_id}`) : [{}],
    api.rpc('face_check_status').catch(() => null),
  ]);
  show(`
    <main class="page">
      ${header(me, 'Setup')}
      ${tabs('Setup')}
      <ul class="list">
        <li><a class="card row" href="#/offices"><span><strong>Offices</strong><br><span class="muted">Where office staff clock in</span></span><span class="chev">›</span></a></li>
        <li><a class="card row" href="#/stores"><span><strong>Stores</strong><br><span class="muted">Where sales reps check in</span></span><span class="chev">›</span></a></li>
        <li><a class="card row" href="#/hours"><span><strong>Working hours</strong><br><span class="muted">Start, end, grace minutes, work days</span></span><span class="chev">›</span></a></li>
        ${isOwner ? '<li><a class="card row" href="#/billing"><span><strong>Billing</strong><br><span class="muted">Plan, price for your team, payments</span></span><span class="chev">›</span></a></li>' : ''}
        <li><a class="card row" href="#/export"><span><strong>Export register</strong><br><span class="muted">Excel or PDF, for any period</span></span><span class="chev">›</span></a></li>
        ${face ? `<li><${isOwner ? 'a href="#/face"' : 'div'} class="card row"><span><strong>Face check</strong><br><span class="muted">${face.enabled
          ? `On. Selfies must be ${face.match_percent}% alike to the reference photo.${face.waiting ? ` ${face.waiting} waiting.` : ''}`
          : `Off until the AWS keys are added. Clock-ins work as normal.${face.waiting ? ` ${face.waiting} selfie${face.waiting === 1 ? '' : 's'} will be checked when it's switched on.` : ''}`}</span></span>
          <span class="pill ${face.enabled ? 'ok' : ''}">${face.enabled ? 'On' : 'Off'}</span>${isOwner ? '<span class="chev">›</span>' : ''}</${isOwner ? 'a' : 'div'}></li>` : ''}
        ${isOwner ? `<li class="card row"><span><strong>Evening summary email</strong><br><span class="muted">A short summary of the day, around 7 pm</span></span>
          <label class="switch"><input type="checkbox" id="summary"${co.summary_email ? ' checked' : ''} aria-label="Evening summary email"><span></span></label></li>` : ''}
      </ul>
    </main>`);
  wireSignOut();
  const sw = document.getElementById('summary');
  if (sw) {
    sw.onchange = async () => {
      try {
        await api.update('companies', `id=eq.${me.company_id}`, { summary_email: sw.checked });
        toast(sw.checked ? 'Evening summary on' : 'Evening summary off');
      } catch (x) { sw.checked = !sw.checked; toast(friendly(x)); }
    };
  }
}

// ── Face check setting (owner) ──────────────────────────────

async function faceSettings(me) {
  if (me.role !== 'owner') return go('#/setup');
  const f = await api.rpc('face_check_status');
  show(`
    <main class="page narrow">
      <a class="back" href="#/setup">‹ Setup</a>
      <h1>Face check</h1>
      <p class="muted">Each clock-in and store visit selfie is compared with the person's reference photo. If it isn't alike enough, it is flagged "Face didn't match" for you to look at. Nobody is ever blocked.</p>
      <form class="stack">
        <label>Match needed (%)<input name="pct" type="number" min="50" max="99" step="1" value="${f.match_percent}" required>
          <span class="hint muted">90 suits most phones. If cheap or cracked cameras cause too many false flags, try 80. Lower numbers catch fewer real mismatches.</span></label>
        <p class="error" role="alert"></p>
        <button type="submit" class="primary">Save</button>
      </form>
    </main>`, async ({ pct }) => {
    const n = Number(pct);
    if (!Number.isInteger(n) || n < 50 || n > 99) throw new Say('Choose a whole number from 50 to 99.');
    await api.rpc('set_face_match_percent', { p_percent: n });
    toast(`Saved: selfies must be ${n}% alike`);
    go('#/setup');
  });
}

// ── Working hours ───────────────────────────────────────────

function hours(me) {
  const c = me.companies;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  show(`
    <main class="page">
      ${header(me, 'Working hours')}
      ${tabs('Setup')}
      <a class="back" href="#/setup">‹ Setup</a>
      <form class="stack narrow-form">
        <div class="pair">
          <label>Work starts<input name="work_starts" type="time" value="${c.work_starts.slice(0, 5)}" required></label>
          <label>Work ends<input name="work_ends" type="time" value="${c.work_ends.slice(0, 5)}" required></label>
        </div>
        <label>Late after (minutes)<input name="late_after_minutes" type="number" min="0" max="240" value="${c.late_after_minutes}" required>
          <span class="hint muted">With 15, someone clocking in at 8:14 is on time; at 8:20 they are 20 minutes late.</span></label>
        <fieldset class="days"><legend>Work days</legend>
          ${days.map((d, i) => `<label><input type="checkbox" name="d${i + 1}"${c.work_days.includes(i + 1) ? ' checked' : ''}><span>${d}</span></label>`).join('')}
        </fieldset>
        <p class="error" role="alert"></p>
        <button type="submit" class="primary">Save</button>
      </form>
    </main>`, async (v) => {
    const work_days = days.map((_, i) => i + 1).filter((n) => v['d' + n]);
    if (!work_days.length) throw new Say('Choose at least one work day.');
    if (v.work_ends <= v.work_starts) throw new Say('Work must end after it starts.');
    await api.update('companies', `id=eq.${me.company_id}`, {
      work_starts: v.work_starts, work_ends: v.work_ends, late_after_minutes: Number(v.late_after_minutes), work_days,
    });
    toast('Working hours saved');
    reloadMe();
    go('#/hours');
  });
  wireSignOut();
}
