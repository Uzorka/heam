// Owner dashboard: the day in 10 seconds. Right now, field visits on a map, patterns, cost of lost time.
import * as api from './api.js';
import { show, esc, header, wireSignOut, onLeave, fmtDay, localDate, firstName } from './ui.js';
import { happyPin } from './icons.js';
import { checklist, setupDone } from './getstarted.js';

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
    radius: 8, weight: 2, color: '#fff', fillOpacity: 1, fillColor: s.visited ? '#1E7B45' : '#9A9AA0',
  }).bindTooltip(`${s.name}: ${s.visited ? 'visited' : 'not yet'}`).addTo(map));
  map.fitBounds(L.featureGroup(points).getBounds().pad(0.2), { maxZoom: 15 });
  return () => map.remove();
}

export async function overview(me, tabs) {
  const tz = me.companies.timezone;
  const day = localDate(api.serverNow(), tz);
  const sells = ['storefront', 'both'].includes(me.companies.business_type);
  const [d, progress, sh] = await Promise.all([
    api.rpc('owner_overview', { p_day: day }),
    api.rpc('setup_progress').catch(() => null),
    sells ? api.rpc('shops_overview', { p_day: day }).catch(() => null) : null,
  ]);
  const h = new Date().getHours();
  const hello = `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, ${firstName(me.full_name)}`;
  const n = d.now, f = d.field, lost = d.lost;
  const visitPct = f.planned ? Math.min(100, Math.round((100 * f.done) / f.planned)) : 0;
  const nobody = !n.people;                          // a new company: no wall of zeros
  const allIn = n.people > 0 && !n.late && !n.absent;

  const attention = [
    ...d.repeat_late.map((x) => `<li><b>${esc(x.name)}</b> was late ${x.times} times in the last 2 weeks.</li>`),
    ...d.visits_dropping.map((x) => `<li><b>${esc(x.name)}</b> made ${plural(x.this_week, 'visit')} this week, down from ${x.last_week}.</li>`),
    ...(n.to_review ? [`<li><b>${plural(n.to_review, 'check-in')}</b> today ${n.to_review === 1 ? 'was' : 'were'} flagged. <a href="#/today">Review on Today</a></li>`] : []),
  ];
  // Each tile opens Today, filtered to that group.
  const tile = (cls, num, label, filter) => `<a class="tile ${cls}" href="#/today/${filter}" aria-label="${num} ${label}: show on Today"><b>${num}</b><span>${label}</span></a>`;

  show(`
    <main class="page">
      ${header(me, hello)}
      ${tabs('Overview')}
      <p class="muted dateline">${fmtDay(day + 'T12:00:00Z', tz)}</p>

      ${progress && !setupDone(progress, me.companies.business_type) ? checklist(progress, me.companies.business_type) : ''}

      ${sh && sh.shops.length ? shopsCard(sh) : ''}

      ${nobody ? '' : `
      <section class="card block" aria-labelledby="now-h">
        <h2 id="now-h">Right now</h2>
        <div class="tiles">
          ${tile('present', n.present, 'Present', 'present')}
          ${tile('late', n.late, 'Late', 'late')}
          ${tile('notin', n.absent, 'Not in', 'notin')}
          ${tile('away', n.away, 'Leave or off', 'away')}
        </div>
        ${allIn ? `<div class="happy-state">${happyPin(48)}<p>Everyone's in today. Nice.</p></div>` : ''}
        ${d.offices.length ? `<ul class="offices">${d.offices.map((o) => `
          <li><span>${esc(o.name)}</span><span class="muted">${o.present} present${o.late ? ` · <span class="late">${o.late} late</span>` : ''}${o.absent ? ` · ${o.absent} not in` : ''}</span></li>`).join('')}</ul>` : ''}
      </section>`}

      ${f.reps.length ? `
      <section class="card block" aria-labelledby="field-h">
        <h2 id="field-h">Field visits</h2>
        <p class="big-line"><b>${f.done} of ${f.planned}</b> planned visits done</p>
        <div class="meter"><i style="width:${visitPct}%"></i></div>
        ${d.stores.length ? '<div class="map" id="map" role="img" aria-label="Map of stores: green visited, grey not yet"></div><p class="tiny muted legend"><i class="dot on"></i> Visited <i class="dot"></i> Not yet</p>' : ''}
        <ul class="offices">${f.reps.map((r) => `
          <li><span>${esc(r.name)}</span><span class="${r.visits >= r.target ? 'ok-text' : 'muted'}">${r.status === 'leave' || r.status === 'off' ? (r.status === 'leave' ? 'On leave' : 'Off') : `${r.visits} of ${r.target}`}</span></li>`).join('')}</ul>
      </section>` : ''}

      ${nobody ? '' : `
      <section class="card block" aria-labelledby="att-h">
        <h2 id="att-h">Needs your attention</h2>
        ${attention.length ? `<ul class="notes">${attention.join('')}</ul>` : '<p class="muted">Nothing unusual.</p>'}
      </section>`}

      ${lost && !nobody ? `
      <section class="card block" aria-labelledby="lost-h">
        <h2 id="lost-h">Lost time this month</h2>
        ${lost.with_pay ? `<p class="money">${naira(lost.naira)}</p>` : ''}
        <p class="${lost.with_pay ? 'muted' : 'big-line'}">${lost.hours.toLocaleString('en-NG')} hours lost to lateness and absence</p>
        <p class="tiny muted">${lost.with_pay
          ? `Based on pay for ${lost.with_pay} of ${plural(lost.people, 'person', 'people')}. To include everyone, add monthly pay on each person's page (Team).`
          : "To see this in naira, add monthly pay on each person's page (Team)."}</p>
      </section>` : ''}

      ${nobody ? '' : '<a class="secondary button" href="#/export">Export register (Excel or PDF)</a>'}
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

// Storefront / Both: today's sales per shop, best sellers, and stock that needs attention.
function shopsCard(sh) {
  const many = sh.shops.length > 1;
  const alerts = (x) => [x.out ? `<span class="pill bad">${x.out} out</span>` : '', x.low ? `<span class="pill wait">${x.low} low</span>` : '',
    x.expiring ? `<span class="pill wait">${x.expiring} expiring</span>` : ''].join(' ');
  return `
      <section class="card block" aria-labelledby="sales-h">
        <h2 id="sales-h">Sales today</h2>
        <p class="big-line"><b>${naira(sh.total)}</b> · ${plural(sh.sales, 'sale')}${Number(sh.discount) ? ` <span class="muted">· ${naira(sh.discount)} in discounts</span>` : ''}</p>
        <ul class="offices shops">${sh.shops.map((x) => `
          <li><a href="#/sales/${x.id}"><span>${esc(x.name)}${x.to_check ? ` <span class="pill info">${x.to_check} to check</span>` : ''}</span>
            <span><b>${naira(x.total)}</b> <span class="muted">(${x.sales})</span></span></a>
            ${x.out || x.low || x.expiring ? `<a class="stockline" href="#/stock/${x.id}">${many ? '' : 'Stock: '}${alerts(x)}</a>` : ''}</li>`).join('')}</ul>
        ${sh.best.length ? `<p class="small"><span class="muted">Best sellers:</span> ${sh.best.slice(0, 3).map((b) => `${esc(b.name)} (${b.qty})`).join(', ')}</p>` : ''}
      </section>`;
}
