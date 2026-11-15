// Owner sign-up: name, phone, email and password, then the 6-digit code from the email.
// Loaded only on these screens (not part of the staff app).
import * as api from './api.js';
import { normalizePhone } from './phone.js';
import { show, go, esc, Say, toast, friendly, app } from './ui.js';
import { publicBase } from './device.js';
import { wordmark } from './icons.js';

export const PENDING = 'pinga.pendingCompany';   // what the owner told us before their business exists
const EMAIL = 'pinga.verifyEmail';
const PLAN = { starter: 'Starter', business: 'Business' };

export const pending = () => { try { return JSON.parse(localStorage.getItem(PENDING)) || {}; } catch { return {}; } };
export const setPending = (x) => { try { localStorage.setItem(PENDING, JSON.stringify({ ...pending(), ...x })); } catch { /* private mode */ } };

export function signUp(arg) {
  const plan = PLAN[arg] ? arg : pending().plan || 'starter';
  show(`
    <main class="page narrow signup">
      <div class="brand">${wordmark()}</div>
      <h1>Start free</h1>
      <p class="muted">First month free. No card needed.</p>
      <form class="stack" novalidate>
        <label>Your name<input name="name" autocomplete="name" required></label>
        <label>Phone number<input name="phone" type="tel" autocomplete="tel" placeholder="0803 123 4567" required></label>
        <label>Email<input name="email" type="email" autocomplete="email" required></label>
        <label>Password<input name="password" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters" required></label>
        <fieldset class="choices plan-pick"><legend>Plan</legend>
          ${Object.entries(PLAN).map(([v, t]) => `<label class="choice"><input type="radio" name="plan" value="${v}"${v === plan ? ' checked' : ''}><span><strong>${t}</strong><br><span class="muted">${v === 'starter' ? 'One shop or office, up to 5 staff' : 'Many shops, managers, field sales'}</span></span></label>`).join('')}
        </fieldset>
        <p class="hint muted">You can change plan any time. We'll ask for a card only when the free month ends.</p>
        <p class="error" role="alert"></p>
        <button type="submit" class="primary">Create account</button>
      </form>
      <p class="foot"><a href="#/owner">I already have an account</a></p>
    </main>`, async ({ name, phone, email, password, plan: chosen }) => {
    if (!name.trim()) throw new Say('Please enter your name.');
    const p = normalizePhone(phone);
    if (!p) throw new Say('Enter your phone number, like 0803 123 4567.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Say('Enter your email address, like ada@example.com.');
    if (password.length < 8) throw new Say('Use at least 8 characters for your password.');
    setPending({ name: name.trim(), phone: p, plan: chosen || plan });
    let signedIn;
    try { signedIn = await api.signUp(email.trim(), password, publicBase()); } catch (x) {
      if (x.code === 'user_already_exists') throw new Say('This email already has an account. Sign in instead.');
      if (x.code === 'weak_password') throw new Say('Please choose a stronger password.');
      if (x.code === 'over_email_send_rate_limit') throw new Say('Too many tries. Please wait a minute and try again.');
      throw x;
    }
    if (signedIn) return go('#/');
    try { sessionStorage.setItem(EMAIL, email.trim()); } catch { /* fine */ }
    go('#/verify');
  });
}

// "Enter the 6-digit code we sent to you@example.com"
export function verify() {
  let email = '';
  try { email = sessionStorage.getItem(EMAIL) || ''; } catch { /* fine */ }
  if (!email) return go('#/signup');
  show(`
    <main class="page narrow signup">
      <div class="brand">${wordmark()}</div>
      <h1>Check your email</h1>
      <p>We sent a 6-digit code to <strong>${esc(email)}</strong>. Enter it here, or tap the link in the email on this phone.</p>
      <form class="stack">
        <label class="sr" for="code">6-digit code</label>
        <input id="code" name="code" class="code-input" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="••••••" required>
        <p class="error" role="alert"></p>
        <button type="submit" class="primary">Continue</button>
      </form>
      <p class="foot muted">No email? Check spam, or <button type="button" class="link" id="resend">send a new code</button>.</p>
      <p class="foot"><a href="#/signup">Use a different email</a></p>
    </main>`, async ({ code }) => {
    const token = code.replace(/\D/g, '');
    if (token.length !== 6) throw new Say('The code has 6 digits.');
    try { await api.verifyEmailCode(email, token); } catch (x) {
      if (x.status === 403 || x.code === 'otp_expired' || x.status === 400) throw new Say('That code is wrong or too old. Check the newest email, or send a new code.');
      throw x;
    }
    try { sessionStorage.removeItem(EMAIL); } catch { /* fine */ }
    go('#/');
  });
  const input = app.querySelector('#code');
  input.focus();
  // Pasting or typing the 6th digit sends it straight away.
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 6);
    if (input.value.length === 6) app.querySelector('form').requestSubmit();
  });
  const resend = app.querySelector('#resend');
  let wait = 0;
  resend.onclick = async () => {
    if (wait) return;
    try {
      await api.resendEmailCode(email);
      toast('New code sent');
      wait = 60;
      const t = setInterval(() => {
        wait -= 1;
        resend.textContent = wait ? `send a new code (${wait}s)` : 'send a new code';
        if (!wait) clearInterval(t);
      }, 1000);
    } catch (x) { toast(x.code === 'over_email_send_rate_limit' ? 'Please wait a minute before asking for another code.' : friendly(x)); }
  };
}
