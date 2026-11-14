// Shared screen helpers.
import * as api from './api.js';
import { report } from './report.js';
import { logo, ICON } from './icons.js';

export const app = document.getElementById('app');
export const ROLE = { owner: 'Owner', admin: 'Manager', staff: 'Office staff', rep: 'Sales rep' };

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// A message meant for the person on screen (not a bug, so not reported).
export class Say extends Error {}

export function friendly(x) {
  if (x instanceof Say) return x.message;
  if (x instanceof api.ApiError && x.status > 0 && x.status < 500) return x.message;
  if (x instanceof api.ApiError && x.status === 0) return x.message;
  report(x);
  return 'Something went wrong. Please try again.';
}

let leave = null;
// Runs when the person leaves the current screen (e.g. to switch the camera off).
export const onLeave = (fn) => { leave = fn; };

// Renders a screen. If it has a form, runs onSubmit with its values and shows any problem under it.
export function show(html, onSubmit) {
  if (leave) { const fn = leave; leave = null; try { fn(); } catch (e) { report(e); } }
  const sameScreen = app.dataset.hash === location.hash;
  app.dataset.hash = location.hash;
  app.innerHTML = html;
  if (!sameScreen) scrollTo(0, 0);   // a new screen starts at the top
  const form = app.querySelector('form');
  if (form && onSubmit) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      const out = form.querySelector('.error');
      out.textContent = '';
      btn.disabled = true;
      try { await onSubmit(Object.fromEntries(new FormData(form)), form); } catch (x) { out.textContent = friendly(x); } finally { btn.disabled = false; }
    });
  }
  const first = app.querySelector('input:not([readonly])');
  if (first && matchMedia('(min-width: 700px)').matches) first.focus();
}

export const go = (hash) => (location.hash === hash ? dispatchEvent(new HashChangeEvent('hashchange')) : (location.hash = hash));
export const reloadMe = () => dispatchEvent(new Event('pinga:reload'));

let lastToast = null;
export function toast(text) {
  if (lastToast) lastToast.remove();
  const t = lastToast = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.remove(), 4000);
}

export const header = (me, title) => `
  <header class="bar">
    <div><div class="company">${logo(18)}${esc(me.companies.name)}</div><h1>${esc(title)}</h1></div>
    <button class="link" id="signout">Sign out</button>
  </header>`;

// guard: optional check that can stop signing out (returns false).
export function wireSignOut(guard) {
  document.getElementById('signout').onclick = async () => {
    if (guard && !(await guard())) return;
    await api.signOut();
    if (lastToast) lastToast.remove();
    reloadMe();
    go('#/');
  };
}

// "elvis uzorka" → "Elvis". Names are shown the way people expect, whatever was typed.
export const firstName = (full) => { const f = String(full || '').trim().split(/\s+/)[0] || ''; return f.charAt(0).toUpperCase() + f.slice(1); };

// A back link: arrow icon + label; screen readers hear "Back to Team".
export const backLink = (href, label) => `<a class="back" href="${href}" aria-label="Back to ${esc(label)}">${ICON.back}${esc(label)}</a>`;
export const chev = `<span class="chev">${ICON.chevron}</span>`;

export const fmtTime = (iso, tz) => new Date(iso).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz });
export const fmtDay = (iso, tz) => new Date(iso).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz });
export const localDate = (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
export const fmtDistance = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

// Plain-English reasons a record was flagged for the manager.
export const FLAG = {
  weak_gps: 'Weak GPS signal',
  suspicious_gps: 'Possible fake location',
  impossible_speed: 'Impossible travel speed',
  clock_changed: 'Phone clock was changed',
  no_photo: 'No photo',
  no_office: 'No office set up',
  not_assigned: 'Store not assigned to them',
  store_located: 'Store location saved from this visit',
  no_store_location: 'Store location unknown',
  face_mismatch: "Face didn't match",
  no_face: 'No face in photo',
};
export const flagLabel = (f, place) => (f === 'outside_radius' ? `Outside the ${place}` : FLAG[f] || f);
