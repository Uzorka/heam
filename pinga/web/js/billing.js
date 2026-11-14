// Owner's billing page: plan, price for the current team, pay with Paystack, saved card, history.
import * as api from './api.js';
import { CONFIG } from './config.js';
import { show, go, esc, toast, friendly, app, fmtDay } from './ui.js';

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
      <a class="back" href="#/setup">‹ Setup</a>
      <h1>Billing</h1>
      ${CONFIG.env !== 'live' && payments ? '<p class="banner">Test mode: payments use Paystack test cards. No real money is taken.</p>' : ''}
      <section class="card block">
        <p class="plan-state ${head[2]}">${head[0]}</p>
        <p class="muted">${esc(head[1])}</p>
        ${b.card ? `<p class="small">${esc(b.card.label)}${b.card.expires ? ` (expires ${esc(b.card.expires)})` : ''} · renews automatically each month</p>` : ''}
      </section>
      <section class="card block">
        <h2>Your monthly price</h2>
        <ul class="offices">
          ${q.staff_seats || !q.rep_seats ? `<li><span>Office staff · ${q.staff_seats} × ${naira(q.staff_price * 100)}</span><span>${naira(q.staff_seats * q.staff_price * 100)}</span></li>` : ''}
          ${q.rep_seats ? `<li><span>Sales reps · ${q.rep_seats} × ${naira(q.rep_price * 100)}</span><span>${naira(q.rep_seats * q.rep_price * 100)}</span></li>` : ''}
          ${q.discount_percent > 0 ? `<li><span>Volume discount (${q.discount_min_people}+ people) · ${Number(q.discount_percent)}% off</span><span>−${naira(q.gross_kobo - q.amount_kobo)}</span></li>` : ''}
          <li class="total"><span>Total a month</span><span>${naira(q.amount_kobo)}</span></li>
        </ul>
        <p class="tiny muted">Counted from people who have joined and are active. Owners and managers are free.</p>
      </section>
      ${!payments ? `<p class="muted center">Online payment isn't switched on yet. Your trial continues and your team keeps working as normal.</p>`
        : q.amount_kobo && !paidAhead ? `
        <button class="primary" id="pay">Pay ${naira(q.amount_kobo)} with Paystack</button>
        <p class="tiny muted center">${b.status === 'trial' ? 'Your first paid month starts when the free trial ends. ' : ''}Card, bank transfer or USSD. A card is saved for automatic monthly renewal.</p>
        <p class="error center" id="err" role="alert"></p>`
        : q.amount_kobo ? '' : '<p class="muted center">Nothing to pay yet. Invite your team first.</p>'}
      ${b.invoices.length ? `<h2 class="section">Payments</h2><ul class="list">${b.invoices.filter((i) => i.status !== 'void').map((i) => `
        <li class="card row"><span><strong>${naira(i.amount_kobo)}</strong><br><span class="muted">${day(i.period_start, tz)} – ${day(i.period_end, tz)}</span></span>
        <span class="pill ${STATUS[i.status][0]}">${STATUS[i.status][1]}</span></li>`).join('')}</ul>` : ''}
    </main>`);

  const pay = document.getElementById('pay');
  if (pay) {
    pay.onclick = async () => {
      pay.disabled = true;
      pay.textContent = 'Opening Paystack…';
      try {
        const { url } = await api.callFunctionAsUser('billing/checkout', { return_to: `${location.origin}${location.pathname}#/billing` });
        location.href = url;   // Paystack's own secure payment page
      } catch (x) {
        document.getElementById('err').textContent = /not set up/i.test(x.message) ? "Online payment isn't switched on yet." : friendly(x);
        pay.disabled = false;
        pay.textContent = `Pay ${naira(q.amount_kobo)} with Paystack`;
      }
    };
  }
}

// Back from Paystack: confirm the payment with Paystack, then show the result.
async function returning(me, reference) {
  show(`
    <main class="page narrow">
      <a class="back" href="#/billing">‹ Billing</a>
      <h1>Confirming payment…</h1>
      <p class="muted">This takes a few seconds.</p>
    </main>`);
  let result;
  try { ({ result } = await api.callFunction('billing/verify', { reference })); } catch (x) { result = 'error'; toast(friendly(x)); }
  const done = result === 'paid' || result === 'already paid';
  show(`
    <main class="page narrow">
      <a class="back" href="#/billing">‹ Billing</a>
      <h1>${done ? 'Payment received' : "Payment not completed"}</h1>
      <p>${done ? 'Thank you. Your subscription is active.' : 'No money was taken. You can try again from Billing.'}</p>
      <a class="primary button" href="#/billing">Back to Billing</a>
    </main>`);
  if (done) app.dataset.paid = reference;
}
