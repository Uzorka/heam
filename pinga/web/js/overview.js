// Owner dashboard: the day in 10 seconds. Right now, field visits on a map, patterns, cost of lost time.
import * as api from './api.js';
import { show, esc, header, wireSignOut, onLeave, fmtDay, localDate } from './ui.js';

const naira = (n) => '₦' + Math.round(n).toLocaleString('en-NG');
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// Leaflet (the map) is loaded only here, from our own site, the first time it's needed.
let leaflet = null;
function loadLeaflet() {
  if (!leaflet) {
    leaflet = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'vendor/leaflet/leaflet.css';
      document.head.append(css);
      const js = document.createElement('script');
      js.src = 'vendor/leaflet/leaflet.js';
      js.onload = () => resolve(window.L);
      js.onerror = () => { leaflet = null; reject(new Error('map-load-failed')); };
      document.head.append(js);
    });
  }
  return leaflet;
}

async function drawMap(el, stores) {
  const L = await loadLeaflet();
  const map = L.map(el, { zoomControl: false, attributionControl: true, scrollWheelZoom: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '© OpenStreetMap contributors',
  }).addTo(map);
  const points = stores.map((s) => L.circleMarker([s.lat, s.lng], {
    radius: 8, weight: 2, color: '#fff', fillOpacity: 1, fillColor: s.visited ? '#0b7a5c' : '#9a9aa0',
  }).bindTooltip(`${s.name}: ${s.visited ? 'visited' : 'not yet'}`).addTo(map));
  map.fitBounds(L.featureGroup(points).getBounds().pad(0.2), { maxZoom: 15 });
  return () => map.remove();
}

export async function overview(me, tabs) {
  const tz = me.companies.timezone;
  const day = localDate(api.serverNow(), tz);
  const d = await api.rpc('owner_overview', { p_day: day });
  const h = new Date().getHours();
  const hello = `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, ${me.full_name.split(' ')[0]}`;
  const n = d.now, f = d.field, lost = d.lost;
  const visitPct = f.planned ? Math.min(100, Math.round((100 * f.done) / f.planned)) : 0;

  const attention = [
    ...d.repeat_late.map((x) => `<li><b>${esc(x.name)}</b> was late ${x.times} times in the last 2 weeks.</li>`),
    ...d.visits_dropping.map((x) => `<li><b>${esc(x.name)}</b> made ${plural(x.this_week, 'visit')} this week, down from ${x.last_week}.</li>`),
    ...(n.to_review ? [`<li><b>${plural(n.to_review, 'check-in')}</b> today ${n.to_review === 1 ? 'was' : 'were'} flagged. <a href="#/today">Review on Today</a></li>`] : []),
  ];

  show(`
    <main class="page">
      ${header(me, hello)}
      ${tabs('Overview')}
      <p class="muted dateline">${fmtDay(day + 'T12:00:00Z', tz)}</p>

      <section class="card block" aria-labelledby="now-h">
        <h2 id="now-h">Right now</h2>
        <a class="stats" href="#/today">
          <span><b>${n.present}</b>Present</span>
          <span class="${n.late ? 'warn' : ''}"><b>${n.late}</b>Late</span>
          <span class="${n.absent ? 'bad' : ''}"><b>${n.absent}</b>Not in</span>
          <span><b>${n.away}</b>Leave · Off</span>
        </a>
        ${d.offices.length ? `<ul class="offices">${d.offices.map((o) => `
          <li><span>${esc(o.name)}</span><span class="muted">${o.present} present${o.late ? ` · <span class="late">${o.late} late</span>` : ''}${o.absent ? ` · ${o.absent} not in` : ''}</span></li>`).join('')}</ul>` : ''}
      </section>

      ${f.reps.length ? `
      <section class="card block" aria-labelledby="field-h">
        <h2 id="field-h">Field visits</h2>
        <p class="big-line"><b>${f.done} of ${f.planned}</b> planned visits done</p>
        <div class="meter"><i style="width:${visitPct}%"></i></div>
        ${d.stores.length ? '<div class="map" id="map" role="img" aria-label="Map of stores: green visited, grey not yet"></div><p class="tiny muted legend"><i class="dot on"></i> Visited <i class="dot"></i> Not yet</p>' : ''}
        <ul class="offices">${f.reps.map((r) => `
          <li><span>${esc(r.name)}</span><span class="${r.visits >= r.target ? 'ok-text' : 'muted'}">${r.status === 'leave' || r.status === 'off' ? (r.status === 'leave' ? 'On leave' : 'Off') : `${r.visits} of ${r.target}`}</span></li>`).join('')}</ul>
      </section>` : ''}

      <section class="card block" aria-labelledby="att-h">
        <h2 id="att-h">Needs your attention</h2>
        ${attention.length ? `<ul class="notes">${attention.join('')}</ul>` : '<p class="muted">Nothing unusual.</p>'}
      </section>

      ${lost ? `
      <section class="card block" aria-labelledby="lost-h">
        <h2 id="lost-h">Lost time this month</h2>
        ${lost.with_pay ? `<p class="money">${naira(lost.naira)}</p>` : ''}
        <p class="${lost.with_pay ? 'muted' : 'big-line'}">${lost.hours.toLocaleString('en-NG')} hours lost to lateness and absence</p>
        <p class="tiny muted">${lost.with_pay ? `Based on pay for ${lost.with_pay} of ${plural(lost.people, 'person', 'people')}.` : 'To see this in naira,'} Add monthly pay on each person's page (Team).</p>
      </section>` : ''}

      <a class="secondary button" href="#/export">Export register (Excel or PDF)</a>
    </main>`);
  wireSignOut();

  const el = document.getElementById('map');
  if (el) {
    let remove = null;
    onLeave(() => remove && remove());
    drawMap(el, d.stores).then((r) => { if (document.body.contains(el)) remove = r; else r(); })
      .catch(() => { el.outerHTML = '<p class="tiny muted">The map could not load. Check your connection.</p>'; });
  }
}
