// Pinga web app: signing in, joining, and sending each person to their screens.
import * as api from './api.js';
import { normalizePhone, loginEmailFor, validPin, PHONE_LOGIN_DOMAIN } from './phone.js';
import { catchAll } from './report.js';
import { show, go, esc, Say, friendly, toast } from './ui.js';

const PENDING = 'pinga.pendingCompany';

let me = null; // { id, role, full_name, company_id, reference_photo_path, companies: {...} }

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
    await api.signOut();
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

// ── Navigation ──────────────────────────────────────────────

const loadMe = () => api.cached('me', async () => {
  const uid = api.getSession().user.id;
  const rows = await api.select('members',
    'select=id,role,full_name,company_id,reference_photo_path,companies(name,timezone,work_starts,work_ends,late_after_minutes,work_days)' +
    `&user_id=eq.${uid}&active=is.true&order=created_at&limit=1`);
  return rows[0] || null;
});

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
  // Managers' screens are downloaded only by managers, keeping the staff app small.
  if (me.role === 'owner' || me.role === 'admin') return (await import('./admin.js')).adminRoute(me, name, arg);
  return (await import('./staff.js')).staffRoute(me, name, arg);
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
addEventListener('pinga:reload', () => { me = null; api.clearCache(); });
start();

// Offline support: keep the app's files on the phone.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
