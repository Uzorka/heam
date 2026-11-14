// Owner and manager screens: team, invites, offices, working hours.
import * as api from './api.js';
import { normalizePhone, displayPhone } from './phone.js';
import { watchBest, parseLatLng } from './gps.js';
import { show, go, esc, Say, friendly, toast, header, wireSignOut, onLeave, reloadMe, app, ROLE, fmtTime, fmtDay, fmtDistance } from './ui.js';

const FLAG = {
  outside_radius: 'Outside the office',
  weak_gps: 'Weak GPS signal',
  suspicious_gps: 'Possible fake location',
  impossible_speed: 'Impossible travel speed',
  clock_changed: 'Phone clock was changed',
  no_photo: 'No photo',
  no_office: 'No office set up',
};

const tabs = (on) => `
  <nav class="tabs">
    ${[['#/', 'Team'], ['#/offices', 'Offices'], ['#/hours', 'Hours']].map(([h, t]) => `<a href="${h}"${t === on ? ' class="on" aria-current="page"' : ''}>${t}</a>`).join('')}
  </nav>`;

export function adminRoute(me, name, arg) {
  if (name === 'invite') return invite(me);
  if (name === 'person') return person(me, arg);
  if (name === 'offices') return offices(me);
  if (name === 'office') return officeForm(me, arg);
  if (name === 'hours') return hours(me);
  return team(me);
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
      <a class="back" href="#/">‹ Team</a>
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
  const [[p], records] = await Promise.all([
    api.select('members', `select=id,full_name,phone,role,joined_at,invite_token,reference_photo_path&id=eq.${encodeURIComponent(id)}`),
    api.select('attendance', `select=id,kind,happened_at,late_minutes,distance_m,photo_path,flags&member_id=eq.${encodeURIComponent(id)}&order=happened_at.desc&limit=10`),
  ]);
  if (!p) return go('#/');
  const first = p.full_name.split(' ')[0];
  const share = (token) => {
    const link = `${location.origin}${location.pathname}#/join/${token}`;
    const text = `Hi ${first}, ${me.companies.name} uses Pinga for attendance. Open this link to set your PIN: ${link}`;
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
    const flags = r.flags.map((f) => `<span class="pill warn">${FLAG[f] || esc(f)}${f === 'outside_radius' && r.distance_m != null ? ` (${fmtDistance(r.distance_m)})` : ''}</span>`).join(' ');
    return `
      <li class="card row record">
        ${r.photo_path ? `<img class="thumb" data-photo="${esc(r.photo_path)}" alt="Photo at ${r.kind === 'in' ? 'clock-in' : 'clock-out'}">` : '<span class="thumb"></span>'}
        <span class="grow"><strong>${r.kind === 'in' ? 'In' : 'Out'} ${fmtTime(r.happened_at, tz)}</strong>${late}<br>
          <span class="muted">${fmtDay(r.happened_at, tz)}</span>${flags ? '<br>' + flags : ''}</span>
      </li>`;
  };
  show(`
    <main class="page narrow">
      <a class="back" href="#/">‹ Team</a>
      <div class="person">
        ${p.reference_photo_path ? `<img class="face" data-photo="${esc(p.reference_photo_path)}" alt="Reference photo">` : ''}
        <div><h1>${esc(p.full_name)}</h1>
        <p class="muted">${ROLE[p.role]}${p.phone ? ' · ' + esc(displayPhone(p.phone)) : ''}</p></div>
      </div>
      <div id="share">
        ${p.role === 'owner' ? '<p>Owners sign in with their email.</p>'
          : p.invite_token ? share(p.invite_token)
          : `<p>${esc(first)} has joined.</p><button class="secondary" id="reset">Forgot PIN? Create a new PIN link</button>`}
      </div>
      ${records.length ? `<h2 class="section">Recent clock-ins</h2><ul class="list">${records.map(row).join('')}</ul>` : ''}
    </main>`);
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

// ── Offices ─────────────────────────────────────────────────

async function offices(me) {
  const list = await api.select('branches', `select=id,name,address,radius_m&company_id=eq.${me.company_id}&order=name`);
  show(`
    <main class="page">
      ${header(me, 'Offices')}
      ${tabs('Offices')}
      <a class="primary button" href="#/office/new">Add office</a>
      ${list.length ? '' : '<p class="muted center empty">Add your office so staff can clock in there.</p>'}
      <ul class="list">
        ${list.map((b) => `
          <li><a class="card row" href="#/office/${b.id}">
            <span><strong>${esc(b.name)}</strong><br><span class="muted">${b.address ? esc(b.address) + ' · ' : ''}Clock-in area ${b.radius_m} m</span></span>
            <span class="chev">›</span>
          </a></li>`).join('')}
      </ul>
    </main>`);
  wireSignOut();
}

async function officeForm(me, id) {
  const isNew = id === 'new';
  const b = isNew ? { radius_m: 100 } : (await api.select('branches', `select=*&id=eq.${encodeURIComponent(id)}`))[0];
  if (!b) return go('#/offices');
  show(`
    <main class="page narrow">
      <a class="back" href="#/offices">‹ Offices</a>
      <h1>${isNew ? 'Add office' : esc(b.name)}</h1>
      <form class="stack">
        <label>Name<input name="name" value="${esc(b.name)}" placeholder="e.g. Yaba office" required></label>
        <label><span>Address <span class="muted">(optional)</span></span><input name="address" value="${esc(b.address)}"></label>
        <label>Location<input name="where" id="where" value="${b.lat != null ? `${b.lat}, ${b.lng}` : ''}" placeholder="6.5095, 3.3711" inputmode="decimal" required>
          <span class="hint muted">Stand in the office and tap the button below, or paste the numbers from Google Maps.</span></label>
        <button type="button" class="secondary" id="here">Use my current location</button>
        <label>Clock-in area (metres)<input name="radius_m" type="number" min="20" max="2000" value="${b.radius_m}" required>
          <span class="hint muted">Staff must be this close to clock in without a flag. 100 m suits most offices.</span></label>
        <p class="error" role="alert"></p>
        <button type="submit" class="primary">Save</button>
      </form>
    </main>`, async ({ name, address, where, radius_m }) => {
    const pos = parseLatLng(where);
    if (!pos) throw new Say('Location should look like 6.5095, 3.3711.');
    const row = { name: name.trim(), address: address.trim() || null, lat: pos.lat, lng: pos.lng, radius_m: Number(radius_m) };
    try {
      if (isNew) await api.insert('branches', { company_id: me.company_id, ...row });
      else await api.update('branches', `id=eq.${b.id}`, row);
    } catch (x) {
      if (x.code === '23505') throw new Say('You already have an office with this name.');
      throw x;
    }
    toast('Office saved');
    go('#/offices');
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

// ── Working hours ───────────────────────────────────────────

function hours(me) {
  const c = me.companies;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  show(`
    <main class="page">
      ${header(me, 'Working hours')}
      ${tabs('Hours')}
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
