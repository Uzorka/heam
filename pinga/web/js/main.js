// Pinga web app: sign in, company set-up, team invites, staff home.
import * as api from './api.js';
import { normalizePhone, loginEmailFor, displayPhone, validPin, PHONE_LOGIN_DOMAIN } from './phone.js';
import { catchAll, report } from './report.js';

const app = document.getElementById('app');
const ROLE = { owner: 'Owner', admin: 'Manager', staff: 'Office staff', rep: 'Sales rep' };
const PENDING = 'pinga.pendingCompany';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// A message meant for the person on screen (not a bug, so not reported).
class Say extends Error {}

let me = null; // { id, role, full_name, company_id, companies: { name } }

function friendly(x) {
  if (x instanceof Say) return x.message;
  if (x instanceof api.ApiError && x.status === 0) return x.message;
  if (x instanceof api.ApiError && x.status < 500) return x.message;
  report(x);
  return 'Something went wrong. Please try again.';
}

// Renders a screen. If it has a form, runs onSubmit with its values and shows any problem under it.
function show(html, onSubmit) {
  app.innerHTML = html;
  const form = app.querySelector('form');
  if (form && onSubmit) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      const out = form.querySelector('.error');
      out.textContent = '';
      btn.disabled = true;
      try { await onSubmit(Object.fromEntries(new FormData(form))); } catch (x) { out.textContent = friendly(x); } finally { btn.disabled = false; }
    });
  }
  const first = app.querySelector('input:not([readonly])');
  if (first && matchMedia('(min-width: 700px)').matches) first.focus();
}

const go = (hash) => (location.hash === hash ? route() : (location.hash = hash));

const bar = (title) => `
  <header class="bar">
    <div><div class="muted">${esc(me.companies.name)}</div><h1>${esc(title)}</h1></div>
    <button class="link" id="signout">Sign out</button>
  </header>`;

function wireSignOut() {
  document.getElementById('signout').onclick = async () => { await api.signOut(); me = null; go('#/'); };
}

// ── Signing in ──────────────────────────────────────────────

function phoneSignIn() {
  show(`
    <main class="page narrow">
      <div class="brand">Pinga</div>
      <h1>Sign in</h1>
      <form class="stack">
        <label>Phone number<input name="phone" type="tel" autocomplete="tel" placeholder="0803 123 4567" required></label>
        <label>PIN<input name="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password" placeholder="6 digits" required></label>
        <p class="error" role="alert"></p>
        <button type="submit" class="primary">Sign in</button>
      </form>
      <p class="foot muted">Forgot your PIN? Ask your manager for a new link.</p>
      <p class="foot"><a href="#/owner">Business owner? Sign in with email</a></p>
    </main>`, async ({ phone, pin }) => {
    const p = normalizePhone(phone);
    if (!p) throw new Say('Enter your phone number, like 0803 123 4567.');
    try { await api.signIn(loginEmailFor(p), pin.trim()); } catch (x) {
      if (x.status === 400) throw new Say('Wrong phone number or PIN.');
      throw x;
    }
    go('#/');
  });
}

function ownerSignIn() {
  show(`
    <main class="page narrow">
      <div class="brand">Pinga</div>
      <h1>Owner sign in</h1>
      <form class="stack">
        <label>Email<input name="email" type="email" autocomplete="email" required></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
        <p class="error" role="alert"></p>
        <button type="submit" class="primary">Sign in</button>
      </form>
      <p class="foot">New to Pinga? <a href="#/signup">Start your free 14-day trial</a></p>
      <p class="foot"><a href="#/">Staff sign in</a></p>
    </main>`, async ({ email, password }) => {
    try { await api.signIn(email.trim(), password); } catch (x) {
      if (x.code === 'email_not_confirmed') throw new Say('Please confirm your email first. Check your inbox.');
      if (x.status === 400) throw new Say('Wrong email or password.');
      throw x;
    }
    go('#/');
  });
}

function ownerSignUp() {
  show(`
    <main class="page narrow">
      <div class="brand">Pinga</div>
      <h1>Start free trial</h1>
      <p class="muted">14 days free. No card needed.</p>
      <form class="stack">
        <label>Your name<input name="name" autocomplete="name" required></label>
        <label>Business name<input name="company" autocomplete="organization" required></label>
        <label>Email<input name="email" type="email" autocomplete="email" required></label>
        <label>Password<input name="password" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters" required></label>
        <p class="error" role="alert"></p>
        <button type="submit" class="primary">Create account</button>
      </form>
      <p class="foot"><a href="#/owner">I already have an account</a></p>
    </main>`, async ({ name, company, email, password }) => {
    try { localStorage.setItem(PENDING, JSON.stringify({ name, company })); } catch { /* private mode */ }
    let signedIn;
    try { signedIn = await api.signUp(email.trim(), password, location.origin + location.pathname); } catch (x) {
      if (x.code === 'user_already_exists') throw new Say('This email already has an account. Sign in instead.');
      if (x.code === 'weak_password') throw new Say('Please choose a stronger password.');
      throw x;
    }
    if (signedIn) return go('#/');
    show(`
      <main class="page narrow">
        <div class="brand">Pinga</div>
        <h1>Check your email</h1>
        <p>We sent a link to <strong>${esc(email)}</strong>. Open it on this device to finish setting up.</p>
      </main>`);
  });
}

// ── Joining from an invite link ─────────────────────────────

async function join(token) {
  const rows = await api.rpc('invite_preview', { p_token: token });
  if (!rows.length) {
    return show(`
      <main class="page narrow">
        <div class="brand">Pinga</div>
        <h1>This link has expired</h1>
        <p>Ask your manager to send you a new one.</p>
        <p class="foot"><a href="#/">Go to sign in</a></p>
      </main>`);
  }
  const { first_name, company_name } = rows[0];
  show(`
    <main class="page narrow">
      <div class="brand">Pinga</div>
      <h1>Welcome, ${esc(first_name)}</h1>
      <p>${esc(company_name)} uses Pinga for attendance. Choose a 6-digit PIN. You'll use it with your phone number to sign in.</p>
      <form class="stack">
        <label>New PIN<input name="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" placeholder="6 digits" required></label>
        <label>Type it again<input name="again" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" required></label>
        <p class="error" role="alert"></p>
        <button type="submit" class="primary">Save PIN</button>
      </form>
    </main>`, async ({ pin, again }) => {
    if (!validPin(pin)) throw new Say('Use 6 digits that are hard to guess (not 123456 or 111111).');
    if (pin !== again) throw new Say('The two PINs are different. Try again.');
    const { login_email } = await api.callFunction('accept-invite', { token, pin });
    await api.signIn(login_email, pin);
    me = null;
    go('#/');
  });
}

// ── First-time company set-up (owner) ───────────────────────

function createCompany() {
  let pending = {};
  try { pending = JSON.parse(localStorage.getItem(PENDING)) || {}; } catch { /* none */ }
  show(`
    <main class="page narrow">
      <div class="brand">Pinga</div>
      <h1>Set up your company</h1>
      <form class="stack">
        <label>Your name<input name="name" value="${esc(pending.name)}" autocomplete="name" required></label>
        <label>Business name<input name="company" value="${esc(pending.company)}" autocomplete="organization" required></label>
        <p class="error" role="alert"></p>
        <button type="submit" class="primary">Continue</button>
      </form>
    </main>`, async ({ name, company }) => {
    await api.rpc('create_company', { p_name: company, p_owner_name: name });
    try { localStorage.removeItem(PENDING); } catch { /* fine */ }
    me = null;
    go('#/');
  });
}

function noCompany() {
  show(`
    <main class="page narrow">
      <div class="brand">Pinga</div>
      <h1>No access</h1>
      <p>Your account is not active in any company. Please speak to your manager.</p>
      <button class="secondary" id="signout">Sign out</button>
    </main>`);
  document.getElementById('signout').onclick = async () => { await api.signOut(); go('#/'); };
}

// ── Owners and managers ─────────────────────────────────────

async function team() {
  const people = await api.select('members',
    `select=id,full_name,phone,role,joined_at&company_id=eq.${me.company_id}&active=is.true&order=full_name`);
  show(`
    <main class="page">
      ${bar('Team')}
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

function invite() {
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

async function person(id) {
  const [p] = await api.select('members', `select=id,full_name,phone,role,joined_at,invite_token&id=eq.${encodeURIComponent(id)}`);
  if (!p) return go('#/');
  const share = (token) => {
    const link = `${location.origin}${location.pathname}#/join/${token}`;
    const first = p.full_name.split(' ')[0];
    const text = `Hi ${first}, ${me.companies.name} uses Pinga for attendance. Open this link to set your PIN: ${link}`;
    return `
      <div class="card stack">
        <p>Send ${esc(first)} this link. It works for 7 days.</p>
        <input readonly value="${esc(link)}" id="link" aria-label="Invite link">
        <a class="primary button" href="https://wa.me/${p.phone.slice(1)}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Send on WhatsApp</a>
        <button class="secondary" id="copy">Copy link</button>
      </div>`;
  };
  const isOwner = p.role === 'owner';
  show(`
    <main class="page narrow">
      <a class="back" href="#/">‹ Team</a>
      <h1>${esc(p.full_name)}</h1>
      <p class="muted">${ROLE[p.role]}${p.phone ? ' · ' + esc(displayPhone(p.phone)) : ''}</p>
      <div id="share">
        ${isOwner ? '<p>Owners sign in with their email.</p>'
          : p.invite_token ? share(p.invite_token)
          : `<p>${esc(p.full_name.split(' ')[0])} has joined.</p><button class="secondary" id="reset">Forgot PIN? Create a new PIN link</button>`}
      </div>
    </main>`);
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

// ── Staff and sales reps ────────────────────────────────────

function staffHome() {
  const h = new Date().getHours();
  const hello = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  show(`
    <main class="page narrow">
      ${bar(hello)}
      <div class="card hero">
        <h2>${esc(me.full_name.split(' ')[0])}</h2>
        <p>You're all set up as ${ROLE[me.role].toLowerCase()} at ${esc(me.companies.name)}.</p>
      </div>
      <p class="muted center">${me.role === 'rep' ? 'Store visits arrive' : 'Clocking in arrives'} in the next update.</p>
    </main>`);
  wireSignOut();
}

// ── Navigation ──────────────────────────────────────────────

async function loadMe() {
  const uid = api.getSession().user.id;
  const rows = await api.select('members',
    `select=id,role,full_name,company_id,companies(name)&user_id=eq.${uid}&active=is.true&order=created_at&limit=1`);
  return rows[0] || null;
}

async function route() {
  const hash = location.hash;
  if (hash.includes('access_token=')) {
    history.replaceState(null, '', location.pathname);
    await api.signInFromLink(hash);
    return go('#/');
  }
  const [, name = '', arg = ''] = /^#\/([a-z]*)\/?(.*)$/.exec(hash) || [];
  if (name === 'join') return join(arg);
  if (!api.getSession()) {
    me = null;
    return name === 'owner' ? ownerSignIn() : name === 'signup' ? ownerSignUp() : phoneSignIn();
  }
  if (!me) me = await loadMe();
  if (!me) {
    const isStaffLogin = (api.getSession().user.email || '').endsWith('@' + PHONE_LOGIN_DOMAIN);
    return isStaffLogin ? noCompany() : createCompany();
  }
  if (me.role === 'owner' || me.role === 'admin') {
    if (name === 'invite') return invite();
    if (name === 'person') return person(arg);
    return team();
  }
  return staffHome();
}

function toast(text) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.remove(), 4000);
}

function start() {
  route().catch((x) => {
    show(`
      <main class="page narrow">
        <div class="brand">Pinga</div>
        <h1>Can't load right now</h1>
        <p>${esc(friendly(x))}</p>
        <button class="primary" id="retry">Try again</button>
      </main>`);
    document.getElementById('retry').onclick = start;
  });
}

catchAll(() => toast('Something went wrong. Please try again.'));
addEventListener('hashchange', start);
start();
