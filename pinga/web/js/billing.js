// Owner's billing page: plan, price for the current team, pay with Paystack, saved card, history.
import * as api from './api.js';
import { CONFIG } from './config.js';
import { publicBase } from './device.js';
import { show, go, esc, toast, friendly, app, fmtDay, backLink, reloadMe } from './ui.js';

const naira = (kobo) => '₦' + Math.round(kobo / 100).toLocaleString('en-NG');
const day = (d, tz) => fmtDay(d + 'T12:00:00Z', tz);
const STATUS = { paid: ['ok', 'Paid'], open: ['', 'Not paid yet'], failed: ['bad', 'Declined'], void: ['', 'Replaced'] };

export async function billing(me, arg) {
  if (me.role !== 'owner') return go('#/setup');
  const tz = me.companies.timezone;
  const reference = new URLSearchParams((arg || '').replace(/^\?/, '') || location.search).get('reference');
  if (location.search) history.replaceState(null, '', location.pathname + '#/billing');   // don't re-check it on every visit
  if (reference) return returning(me, reference);

  const [b, payments] = await Promise.all([
    api.rpc('billing_overview'),
    api.callFunction('billing/status', {}).then((r) => !!r.enabled).catch(() => false),
  ]);
  const q = b.quote;
  const paidAhead = b.paid_until && b.paid_until >= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const head = {
    trial: ['Free trial', !payments && b.trial_days_left <= 0 ? 'Continues until online payment is switched on.'
      : `${b.trial_days_left} day${b.trial_days_left === 1 ? '' : 's'} left · ends ${day(b.trial_ends, tz)}`, ''],
    active: ['Active', `Paid until ${b.paid_until ? day(b.paid_until, tz) : '—'}`, 'ok'],
    past_due: ['Payment due', 'Your team can still clock in and check in. Please pay to keep using Pinga.', 'bad'],
    cancelled: ['Cancelled', 'Contact Pinga to restart your subscription.', 'bad'],
  }[b.status] || [b.status, '', ''];

  show(`
    <main class="page narrow">
      ${backLink('#/setup', 'Setup')}
      <h1>Billing</h1>
      ${CONFIG.env !== 'live' && payments ? '<p class="banner">Test mode: payments use Paystack test cards. No real money is taken.</p>' : ''}
      <section class="card block">
        <p class="plan-state ${head[2]}">${head[0]}</p>
        <p class="muted">${esc(head[1])}</p>
        ${b.card ? `<p class="small">${esc(b.card.label)}${b.card.expires ? ` (expires ${esc(b.card.expires)})` : ''} · renews automatically each month</p>` : ''}
      </section>
      ${planCard(b)}
      <section class="card block">
        <h2>Your monthly price</h2>
        <ul class="offices">
          ${q.plan === 'starter' ? `<li><span>Starter · 1 shop or office, up to ${q.starter_staff} staff <span class="muted">(${q.people} now)</span></span><span>${naira(q.starter_price * 100)}</span></li>` : ''}
          ${q.shop_seats ? `<li><span>Shops · ${q.shop_seats} × ${naira(q.shop_price * 100)} <span class="muted">(up to ${q.shop_included_staff} staff each)</span></span><span>${naira(q.shop_seats * q.shop_price * 100)}</span></li>` : ''}
          ${q.shop_extra_staff ? `<li><span>Extra shop staff · ${q.shop_extra_staff} × ${naira(q.extra_staff_price * 100)}</span><span>${naira(q.shop_extra_staff * q.extra_staff_price * 100)}</span></li>` : ''}
          ${q.loose_staff ? `<li><span>Staff not in a shop yet · ${q.loose_staff} × ${naira(q.extra_staff_price * 100)}</span><span>${naira(q.loose_staff * q.extra_staff_price * 100)}</span></li>` : ''}
          ${q.plan !== 'starter' && (q.staff_seats || (!q.rep_seats && !q.shop_seats && !q.loose_staff)) ? `<li><span>Office staff · ${q.staff_seats} × ${naira(q.staff_price * 100)}</span><span>${naira(q.staff_seats * q.staff_price * 100)}</span></li>` : ''}
          ${q.rep_seats ? `<li><span>Sales reps · ${q.rep_seats} × ${naira(q.rep_price * 100)}</span><span>${naira(q.rep_seats * q.rep_price * 100)}</span></li>` : ''}
          ${q.discount_percent > 0 ? `<li><span>Volume discount (${q.discount_min_people}+ people) · ${Number(q.discount_percent)}% off</span><span>−${naira(q.gross_kobo - q.amount_kobo)}</span></li>` : ''}
          ${q.capped ? `<li><span>Never more than Starter for the same set-up</span><span>−${naira(q.gross_kobo * (100 - q.discount_percent) / 100 - q.amount_kobo)}</span></li>` : ''}
          <li class="total"><span>Total a month</span><span>${naira(q.amount_kobo)}</span></li>
        </ul>
        <p class="tiny muted">Counted from people who have joined and are active. Owners and managers are free.${me.companies.business_type !== 'field' ? ` A shop is counted once one of its staff has joined.` : ''}</p>
      </section>
      ${!payments ? `<p class="muted center">Online payment isn't switched on yet. Your trial continues and your team keeps working as normal.</p>`
        : q.amount_kobo && !paidAhead ? `
        <button class="primary" id="pay">Pay ${naira(q.amount_kobo)} with Paystack</button>
        <p class="tiny muted center">${b.status === 'trial' ? 'Your first paid month starts when the free trial ends. ' : ''}Card, bank transfer or USSD. A card is saved for automatic monthly renewal.</p>
        <p class="error center" id="err" role="alert"></p>`
        : q.amount_kobo ? '' : '<p class="muted center">Nothing to pay yet. Invite your team first.</p>'}
      ${b.invoices.length ? `<h2 class="section">Payments</h2><div class="tablewrap"><table class="rtable">
        <thead><tr><th>Amount</th><th class="d">Period</th><th class="num">Status</th></tr></thead>
        <tbody>${b.invoices.filter((i) => i.status !== 'void').map((i) => `
        <tr><td class="main"><strong>${naira(i.amount_kobo)}</strong><span class="sub muted">${day(i.period_start, tz)} – ${day(i.period_end, tz)}</span></td>
          <td class="d">${day(i.period_start, tz)} – ${day(i.period_end, tz)}</td>
          <td class="end"><span class="pill ${STATUS[i.status][0]}">${STATUS[i.status][1]}</span></td></tr>`).join('')}</tbody></table></div>` : ''}
    </main>`);

  const change = document.getElementById('change-plan');
  if (change) {
    change.onclick = async () => {
      change.disabled = true;
      try {
        await api.rpc('set_plan', { p_plan: change.dataset.plan });
        reloadMe();
        toast(`You're on ${change.dataset.plan === 'starter' ? 'Starter' : 'Business'} now`);
        go('#/billing');
      } catch (x) { toast(friendly(x)); change.disabled = false; }
    };
  }
  const pay = document.getElementById('pay');
  if (pay) {
    pay.onclick = async () => {
      pay.disabled = true;
      pay.textContent = 'Opening Paystack…';
      try {
        const { url } = await api.callFunctionAsUser('billing/checkout', { return_to: `${publicBase()}#/billing` });
        location.href = url;   // Paystack's own secure payment page
      } catch (x) {
        document.getElementById('err').textContent = /not set up/i.test(x.message) ? "Online payment isn't switched on yet." : friendly(x);
        pay.disabled = false;
        pay.textContent = `Pay ${naira(q.amount_kobo)} with Paystack`;
      }
    };
  }
}

// Starter or Business, and moving between them. Down to Starter only when the business fits it.
function planCard(b) {
  const p = b.plans, starter = b.plan === 'starter';
  if (!p) return '';
  const blockers = b.starter_blockers || [];
  return `
    <section class="card block plan-card">
      <h2>Your plan: ${starter ? 'Starter' : 'Business'}</h2>
      <p class="muted">${starter
        ? `${naira(p.starter.price * 100)} a month for 1 shop or office and up to ${p.starter.staff} staff. Sell, stock, receipts, attendance and the evening email.`
        : `${naira(p.business.shop * 100)} a shop (${p.business.shop_staff} staff included), ${naira(p.business.extra_staff * 100)} each extra shop staff, ${naira(p.business.office_staff * 100)} each office staff, ${naira(p.business.rep * 100)} each sales rep. Many shops, managers, field sales, Excel import and export.`}</p>
      ${starter ? `<button class="secondary" id="change-plan" data-plan="business">Move to Business</button>
        <p class="tiny muted">You never pay more on Business than on Starter for the same set-up.</p>`
        : blockers.length ? `<p class="tiny muted">Starter fits 1 shop or office, up to ${p.starter.staff} staff, no managers or sales reps. You have ${esc(blockers.join(', '))}.</p>`
        : '<button class="secondary" id="change-plan" data-plan="starter">Move to Starter</button>'}
      <p class="tiny muted">Premium, with AI cameras, is coming soon.</p>
    </section>`;
}

// Back from Paystack: confirm the payment with Paystack, then show the result.
async function returning(me, reference) {
  show(`
    <main class="page narrow">
      ${backLink('#/billing', 'Billing')}
      <h1>Confirming payment…</h1>
      <p class="muted">This takes a few seconds.</p>
    </main>`);
  let result;
  try { ({ result } = await api.callFunction('billing/verify', { reference })); } catch (x) { result = 'error'; toast(friendly(x)); }
  const done = result === 'paid' || result === 'already paid';
  show(`
    <main class="page narrow">
      <h1>${done ? 'Payment received' : 'Payment not completed'}</h1>
      <p>${done ? 'Thank you. Your subscription is active.' : 'No money was taken. You can try again from Billing.'}</p>
      <a class="primary button" href="#/billing">Back to Billing</a>
    </main>`);
  if (done) app.dataset.paid = reference;
}
