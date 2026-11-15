// Shared screen helpers.
import * as api from './api.js';
import { report } from './report.js';
import { logo, ICON } from './icons.js';
import { CONFIG } from './config.js';
import { openExternal } from './device.js';

export const app = document.getElementById('app');
export const ROLE = { owner: 'Owner', admin: 'Manager', staff: 'Office staff', rep: 'Sales rep' };

// Business type: Field sales / Storefront / Both. Decides which features show.
export const BUSINESS = {
  field: { name: 'Field sales', blurb: 'Office staff clock in; sales reps visit the stores you assign them.' },
  storefront: { name: 'Storefront', blurb: 'Your staff work in your shops. Attendance, stock and sales.' },
  both: { name: 'Both', blurb: 'Offices, shops and sales reps: everything on.' },
};
export function feats(me) {
  const type = me?.companies?.business_type || 'field';
  // Words follow the type: "Shop staff" in a Storefront business.
  ROLE.staff = type === 'storefront' ? 'Shop staff' : type === 'both' ? 'Staff' : 'Office staff';
  return { type, visits: type !== 'storefront', shop: type !== 'field', offices: type !== 'storefront' };
}

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

// ── Navigation: one nav for every size (bottom bar on phones, side rail on tablets, sidebar on desktop) ──
// A screen either includes its own nav (main screens) or uses the one set here (sub-screens: shown at the
// side on tablets and desktops, hidden on phones where those screens have a back link).
let sharedNav = '';
export const setNav = (html) => { sharedNav = html; };

function placeNav() {
  document.getElementById('appnav')?.remove();
  const own = app.querySelector('.appnav');   // a main screen's own nav (inside or after its <main>)
  let nav = own;
  if (!nav && sharedNav) {
    const t = document.createElement('template');
    t.innerHTML = sharedNav.trim();
    nav = t.content.firstElementChild;
    nav.classList.add('sub');
  }
  document.body.classList.toggle('with-nav', !!nav);
  document.body.classList.toggle('nav-phone', !!own);
  document.body.classList.toggle('till-mode', !!app.querySelector('main.till'));
  if (!nav) return;
  nav.id = 'appnav';
  // First in the page, so the keyboard reaches it first; "Skip to content" jumps past it.
  if (!nav.querySelector('.skip')) nav.insertAdjacentHTML('afterbegin', '<a class="skip" href="#main" data-skip>Skip to content</a>');
  app.prepend(nav);
  const main = app.querySelector('main');
  if (main) main.id = 'main';
}

let leave = null;
// Runs when the person leaves the current screen (e.g. to switch the camera off).
export const onLeave = (fn) => { leave = fn; };

// Renders a screen. If it has a form, runs onSubmit with its values and shows any problem under it.
export function show(html, onSubmit) {
  if (leave) { const fn = leave; leave = null; try { fn(); } catch (e) { report(e); } }
  const sameScreen = app.dataset.hash === location.hash;
  app.dataset.hash = location.hash;
  if (!sameScreen) carryToast();
  app.innerHTML = html;
  placeNav();
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

// Clicks anywhere in the app: table rows that open a page, links that leave the app, "Skip to content".
document.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (a?.dataset.skip !== undefined && a?.hasAttribute('data-skip')) { e.preventDefault(); const m = document.getElementById('main'); m?.setAttribute('tabindex', '-1'); m?.focus(); return; }
  if (a && a.target === '_blank' && /^https?:/.test(a.href) && !a.hasAttribute('download')) { e.preventDefault(); openExternal(a.href); return; }
  const row = e.target.closest('tr[data-href]');
  if (row && !e.target.closest('a, button, input, label, select')) location.hash = row.dataset.href;
});

export const go = (hash) => (location.hash === hash ? dispatchEvent(new HashChangeEvent('hashchange')) : (location.hash = hash));
export const reloadMe = () => dispatchEvent(new Event('pinga:reload'));

// Toasts: short, 3 seconds, just above the tab bar, one at a time.
// A toast from an action that opens another screen ("Shop saved" → the Shops list) shows on that screen;
// any other change of screen clears it, so a toast never follows you somewhere unrelated.
let lastToast = null;
const clearToast = () => { if (lastToast) { lastToast.remove(); lastToast = null; } document.body.classList.remove('toasting'); };
function carryToast() {
  if (!lastToast) return;
  if (!lastToast.moved && Date.now() - lastToast.born < 1500) lastToast.moved = true;
  else clearToast();
}
export function toast(text) {
  clearToast();
  const t = lastToast = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = text;
  t.born = Date.now();
  t.moved = false;
  document.body.append(t);
  document.body.classList.add('toasting');   // room at the bottom of the page so it covers nothing
  setTimeout(() => { if (lastToast === t) clearToast(); }, 3000);
}

// Business logos are public files (receipts and emails show them without signing in).
export const logoUrl = (path) => (path ? `${CONFIG.url}/storage/v1/object/public/logos/${path}` : '');

// The business's own logo at the top (a shop's logo for its staff); the name in text if there's none.
export const header = (me, title) => {
  const src = logoUrl(me.shop_logo || me.companies.logo_path);
  return `
  <header class="bar">
    <div><div class="company">${src ? `<img class="biz-logo" src="${esc(src)}" alt="" onerror="this.remove()">` : logo(18)}${esc(me.companies.name)}</div><h1>${esc(title)}</h1></div>
    <button class="link" id="signout">Sign out</button>
  </header>`;
};

// guard: optional check that can stop signing out (returns false).
export function wireSignOut(guard) {
  document.getElementById('signout').onclick = async () => {
    if (guard && !(await guard())) return;
    await api.signOut();
    clearToast();
    setNav('');
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
