// Shop staff: record sales (works with no signal) and see today's sales.
// The price list and the shop's stock are kept on the phone; each sale waits in the outbox until sent.
import { ask } from './dialog.js';
import { copyText } from './device.js';
import * as api from './api.js';
import { sync, outbox, uuid, safeToSignOut, waitingText, setMember } from './queue.js';
import { report } from './report.js';
import { show, esc, toast, header, wireSignOut, onLeave, app, fmtTime, localDate, friendly, moneyInput, parseMoney, properName, firstName, fmtMoney, Say, logoUrl } from './ui.js';
import { ICON } from './icons.js';
import { makeToken, receiptUrl, receiptMessage, whatsappHref, pendingReceipts, queueReceipt, dropReceipt } from './receipts.js';

const BASKET = 'pinga.basket';
const naira = (n) => '₦' + Number(n).toLocaleString('en-NG', { maximumFractionDigits: 2 });

export const tabBar = (on) => `
  <nav class="tabbar appnav" aria-label="Sections">
    <a href="#/sell"${on === 'sell' ? ' class="on" aria-current="page"' : ''}>${ICON.shop}<span>Sell</span></a>
    <a href="#/home"${on === 'home' ? ' class="on" aria-current="page"' : ''}>${ICON.clock}<span>Clock</span></a>
    <a href="#/mysales"${on === 'mysales' ? ' class="on" aria-current="page"' : ''}>${ICON.receipt}<span>My sales</span></a>
  </nav>`;

const quiet = (e) => { if (e.status !== 0) report(e); return []; };

// The basket survives the app being closed (e.g. a call comes in mid-sale).
let basket = [];
try { basket = JSON.parse(sessionStorage.getItem(BASKET)) || []; } catch { /* empty */ }
const keep = () => { try { sessionStorage.setItem(BASKET, JSON.stringify(basket)); } catch { /* fine */ } };

const PAY = { cash: 'Cash', transfer: 'Transfer', card: 'POS card' };
const PAID = { ...PAY, split: 'Split payment' };
let payment = 'cash';
let justSold = null;   // the sale just saved: { id, token, total, payment } → "Send receipt"

// Has this sale reached the server yet?
const isSent = async (id) => !(await outbox.all()).some((w) => w.id === id);
// The receipt's number and names, once the sale is on the server (null if it isn't yet or there's no signal).
const receiptInfo = (token) => api.rpc('receipt', { p_token: token }).catch(() => null);

// "Send receipt": WhatsApp (with the customer's number if given) or copy the link.
// With no signal, the receipt waits and is offered again once the sale has been sent.
async function receiptPanel(me, sale, onDone) {
  const sent = await isSent(sale.id);
  const url = receiptUrl(sale.token);
  const el = document.getElementById('sendbox');
  el.hidden = false;
  el.innerHTML = `
    <h2>Sale saved · ${naira(sale.total)}</h2>
    <p class="muted">Paid by ${PAID[sale.payment] || 'Cash'}</p>
    ${sale.change > 0 ? `<p class="change-big">Change to give: <b>${naira(sale.change)}</b></p>` : ''}
    <label><span>Customer's WhatsApp number <span class="muted">(optional)</span></span><input id="cphone" type="tel" inputmode="tel" placeholder="0803 123 4567" autocomplete="off" value="${esc(sale.phone || '')}"></label>
    ${sent ? `<a class="primary button" id="wa" target="_blank" rel="noopener" href="#">Send receipt on WhatsApp</a>
      <button class="secondary" id="copy">Copy receipt link</button>`
      : `<button class="primary" id="later">Send receipt when online</button>
      <p class="muted small">No signal right now. The receipt will be ready to send as soon as you're online.</p>`}
    <button class="link block" id="next">Next sale</button>`;
  let text = receiptMessage({ business: me.companies.name, total: sale.total, url });
  const phone = () => document.getElementById('cphone').value.trim();
  const wa = document.getElementById('wa');
  const setHref = () => { if (wa) wa.href = whatsappHref(phone(), text); };
  if (sent) receiptInfo(sale.token).then((r) => { if (r) { text = receiptMessage({ business: r.business, shop: r.shop, number: r.number, total: r.total, url }); setHref(); } });
  setHref();
  document.getElementById('cphone').addEventListener('input', setHref);
  if (wa) wa.addEventListener('click', () => { dropReceipt(sale.token); setTimeout(onDone, 300); });
  const copy = document.getElementById('copy');
  if (copy) copy.onclick = async () => {
    if (!(await copyText(url))) { await ask('Copy this receipt link:', { input: url, ok: 'Done', cancel: 'Close' }); return; }
    copy.textContent = 'Link copied';
  };
  const later = document.getElementById('later');
  if (later) later.onclick = () => {
    queueReceipt({ token: sale.token, sale_id: sale.id, member_id: me.id, total: sale.total, phone: phone(), at: Date.now() });
    toast('Receipt will send when online');
    onDone();
  };
  document.getElementById('next').onclick = onDone;
}

// Receipts asked for with no signal: "will send when online", then "ready to send" once the sale is in.
async function pendingList(me) {
  const list = pendingReceipts(me.id);
  if (!list.length) return '';
  const waiting = new Set((await outbox.all()).map((w) => w.id));
  const rows = await Promise.all(list.map(async (r) => {
    if (waiting.has(r.sale_id)) return `<li class="brow"><span class="grow"><strong>${naira(r.total)}</strong><span class="muted small">Receipt will send when online${r.phone ? ` · ${esc(r.phone)}` : ''}</span></span></li>`;
    const info = await receiptInfo(r.token);
    const text = info ? receiptMessage({ business: info.business, shop: info.shop, number: info.number, total: info.total, url: receiptUrl(r.token) })
      : receiptMessage({ business: me.companies.name, total: r.total, url: receiptUrl(r.token) });
    return `<li class="brow"><span class="grow"><strong>${naira(r.total)}${info ? ` · ${esc(info.number)}` : ''}</strong><span class="muted small">Receipt ready to send${r.phone ? ` · ${esc(r.phone)}` : ''}</span></span>
      <a class="button primary small-btn" target="_blank" rel="noopener" data-token="${esc(r.token)}" href="${esc(whatsappHref(r.phone, text))}">Send on WhatsApp</a></li>`;
  }));
  return `<section class="card pending" aria-labelledby="pr-h"><h2 id="pr-h">Receipts to send</h2><ul class="board">${rows.join('')}</ul></section>`;
}

// ── Sell ────────────────────────────────────────────────────
// Is this person clocked in right now (counting clock-ins still waiting to send)?
async function clockedIn(me) {
  const tz = me.companies.timezone, day = localDate(api.serverNow(), tz);
  const [sent, waiting] = await Promise.all([
    api.cached('today', () => api.select('attendance', `select=id,kind,happened_at,late_minutes&member_id=eq.${me.id}&local_date=eq.${day}&order=happened_at`)).catch(() => []),
    outbox.all(),
  ]);
  const events = [...sent, ...waiting.filter((w) => !w.type && w.member_id === me.id && localDate(new Date(w.happened_at), tz) === day && !sent.some((x) => x.id === w.id))]
    .filter((e) => localDate(new Date(e.happened_at), tz) === day).sort((a, b) => a.happened_at.localeCompare(b.happened_at));
  return events.at(-1)?.kind === 'in';
}

// Products and stock for one shop (shop staff: their own; managers and owners: the one they chose).
const loadShopStock = (shopId) => api.cached('shopstock-' + shopId, () => api.select('stock', `select=product_id,qty&branch_id=eq.${shopId}`)).catch(quiet);
const loadQuick = (shopId) => api.cached('quick-' + shopId, () => api.rpc('shop_quick_picks', { p_branch: shopId })).catch(() => []);
const loadProductsFull = (me) => api.cached('products', () => api.select('products',
  `select=id,name,code,price,lowest_price,category&company_id=eq.${me.company_id}&active=is.true&order=name`)).catch(quiet);

async function stockLeft(me, shopId) {
  const [stock, waiting] = await Promise.all([loadShopStock(shopId), outbox.all()]);
  const left = new Map(stock.map((x) => [x.product_id, x.qty]));
  for (const w of waiting) if (w.type === 'sale' && w.branch_id === shopId) for (const i of w.items) left.set(i.product_id, (left.get(i.product_id) ?? 0) - i.qty);
  return left;
}

// ── Held sales (kept on this phone) ──
const HELD = 'pinga.held';
const heldAll = () => { try { return JSON.parse(localStorage.getItem(HELD)) || []; } catch { return []; } };
const heldSave = (list) => { try { localStorage.setItem(HELD, JSON.stringify(list)); } catch { /* full */ } };
const heldFor = (shopId) => heldAll().filter((h) => h.shop === shopId);

// The customer and payment for the sale being made (with the basket, kept while the app is closed).
let customer = { name: '', phone: '' };
let split = { cash: null, transfer: null, card: null };
let received = null;   // cash handed over, for the change

// ── Opening the till each day (cash in the drawer; optional, ₦0 by default) ──
async function askOpeningCash(me, shopId) {
  const key = `pinga.tillasked.${shopId}.${localDate(api.serverNow(), me.companies.timezone)}`;
  try { if (localStorage.getItem(key)) return; } catch { /* ask */ }
  let status;
  try { status = await api.rpc('till_status', { p_branch: shopId }); } catch { return; }   // no signal: ask next time, once we can check
  if (status.opened) { try { localStorage.setItem(key, '1'); } catch { /* fine */ } return; }
  const v = await ask('Cash in the drawer to start the day', { input: '', placeholder: '0', money: true, ok: 'Open the till', cancel: 'Skip (₦0)',
    hint: 'Count the cash already in the drawer. It is added to the cash you take today, so the count at closing time matches.' });
  const amount = parseMoney(v) || 0;
  await sync.add({ type: 'till_open', id: uuid(), member_id: me.id, company_id: me.company_id, branch_id: shopId, opening: amount, happened_at: api.serverNow().toISOString() });
  try { localStorage.setItem(key, '1'); } catch { /* fine */ }
  sync.flush();
}

// ── Sell: full screen, for shop staff and for managers and owners ──
// opts: { shopId, shopName, exitTo }
export async function sell(me, opts = {}) {
  // Whoever sells (shop staff, a manager or the owner): their sales go through this phone's outbox.
  setMember(me);
  sync.flush();
  const shopId = opts.shopId || me.branch_id;
  const shopName = opts.shopName || '';
  const exitTo = opts.exitTo || '#/home';
  const again = () => sell(me, opts).catch(report);
  // The owner's till rules for shop staff (the server enforces them too).
  const staffRule = me.role === 'staff';
  const manages = !staffRule;
  const belowOk = !!me.companies.staff_below_lowest;
  if (staffRule && me.companies.sell_requires_clock_in !== false && !(await clockedIn(me))) {
    show(`
      <main class="page narrow has-tabs">
        ${header(me, 'Sell')}
        <div class="card stack center">
          <p><strong>Clock in to start selling</strong></p>
          <p class="muted">${esc(me.companies.name)} asks staff to clock in before using the till.</p>
          <a class="primary button big" href="#/clock/in">${ICON.clock}Clock in</a>
        </div>
      </main>
      ${tabBar('sell')}`);
    return wireSignOut(safeToSignOut);
  }
  const [products, left, quick] = await Promise.all([loadProductsFull(me), stockLeft(me, shopId), loadQuick(shopId)]);
  const byId = new Map(products.map((p) => [p.id, p]));
  basket = basket.filter((b) => byId.has(b.product_id));
  const cats = [...new Set(products.map((p) => p.category).filter(Boolean))].sort();
  const quickList = quick.map((id) => byId.get(id)).filter(Boolean).slice(0, 8);
  const held = heldFor(shopId);
  const stockText = (id) => { const n = left.get(id); return n == null ? 'Not counted' : n <= 0 ? 'Out of stock' : `${n} left`; };
  const total = () => basket.reduce((t, b) => t + b.qty * (b.unit_price || 0), 0);
  const itemsN = () => basket.reduce((t, b) => t + b.qty, 0);

  const warnings = (b) => {
    const p = byId.get(b.product_id), out = [];
    const n = left.get(b.product_id) ?? 0;
    if (b.qty > n) out.push(`<span class="warn-line">${n <= 0 ? 'Out of stock' : `Only ${n} in stock`}. You can still sell; ${manages ? 'it will be flagged' : 'your manager will see it'}.</span>`);
    if (p.lowest_price != null && b.unit_price < p.lowest_price) out.push(staffRule && !belowOk
      ? `<span class="warn-line bad-text">Can't go below ${naira(p.lowest_price)} (the lowest price).</span>`
      : `<span class="warn-line">Below the lowest price (${naira(p.lowest_price)}). ${manages ? 'It will be flagged.' : 'Your manager will see it.'}</span>`);
    if (staffRule && p.price != null && b.unit_price > p.price) out.push(`<span class="warn-line bad-text">Can't go above ${naira(p.price)} (the selling price).</span>`);
    return out.join('');
  };
  const range = (p) => (p.price == null ? 'No price set: type the price'
    : p.lowest_price != null && p.lowest_price < p.price ? `${naira(p.lowest_price)} – ${naira(p.price)}` : naira(p.price));

  // Cash: amount received → change. Split: the parts must add up to the total.
  const payBox = () => {
    const t = total();
    if (payment === 'cash') {
      const quickCash = [...new Set([t, ...[1000, 2000, 5000, 10000, 20000].filter((v) => v > t).slice(0, 3)])].filter((v) => v > 0);
      const change = received != null ? received - t : null;
      return `
        <label class="received"><span>Cash received <span class="muted">(optional)</span></span>${moneyInput({ value: received, label: 'Cash received', placeholder: naira(t).slice(1), extra: 'id="received"' })}</label>
        <div class="quickcash">${quickCash.map((v) => `<button type="button" class="chip" data-cash="${v}">${v === t ? 'Exact' : naira(v)}</button>`).join('')}</div>
        <p class="change ${change == null ? '' : change < 0 ? 'bad-text' : 'ok-text'}" id="change">${change == null ? '' : change < 0 ? `${naira(-change)} more needed` : `Change: ${naira(change)}`}</p>`;
    }
    if (payment === 'split') {
      const paid = Object.values(split).reduce((a, v) => a + (v || 0), 0);
      return `
        <div class="splits">${Object.entries(PAY).map(([k, n]) => `<label class="splitrow"><span>${n}</span>${moneyInput({ value: split[k], label: `${n} part`, placeholder: '0', extra: `data-split="${k}"` })}</label>`).join('')}</div>
        <p class="change ${Math.abs(paid - t) < 0.01 ? 'ok-text' : 'bad-text'}" id="change">${Math.abs(paid - t) < 0.01 ? 'Adds up to the total' : paid < t ? `${naira(t - paid)} still to pay` : `${naira(paid - t)} too much`}</p>`;
    }
    return '';
  };

  const draw = () => {
    document.getElementById('basket').innerHTML = basket.map((b, i) => {
      const p = byId.get(b.product_id);
      return `<li class="line" data-i="${i}">
        <div class="line-top"><strong>${esc(p.name)}</strong><button type="button" class="link small" data-act="remove" aria-label="Remove ${esc(p.name)}">Remove</button></div>
        <div class="line-row">
          <div class="stepper" role="group" aria-label="Quantity of ${esc(p.name)}">
            <button type="button" data-act="minus" aria-label="One less">−</button>
            <input type="number" inputmode="numeric" min="1" step="1" value="${b.qty}" data-act="qty" aria-label="Quantity">
            <button type="button" data-act="plus" aria-label="One more">+</button>
          </div>
          <label class="price">₦${moneyInput({ value: b.unit_price, label: `Price each for ${p.name}`, placeholder: 'Price', extra: 'data-act="price"' })}</label>
        </div>
        <span class="muted small">Price: ${range(p)}</span>
        <div class="warns">${warnings(b)}</div>
      </li>`;
    }).join('');
    totals();
  };
  const totals = () => {
    const n = itemsN(), t = total();
    document.getElementById('cart').classList.toggle('is-empty', !basket.length);
    document.getElementById('save').disabled = !basket.length;
    document.getElementById('hold').disabled = !basket.length;
    document.getElementById('total').textContent = naira(t);
    document.getElementById('count').textContent = `${n} item${n === 1 ? '' : 's'}`;
    const bar = document.getElementById('paybar');
    bar.hidden = !basket.length;
    bar.querySelector('.pb-what').textContent = `${n} item${n === 1 ? '' : 's'} · ${naira(t)}`;
    document.body.classList.toggle('has-paybar', !!basket.length);
    document.getElementById('paybox').innerHTML = payBox();
  };
  const refreshLine = (i) => {
    app.querySelector(`.line[data-i="${i}"] .warns`).innerHTML = warnings(basket[i]);
    totals();
  };

  show(`
    <main class="page till pos">
      <header class="pos-bar">
        <a class="pos-exit" href="${exitTo}" aria-label="Exit Sell">${ICON.back}<span>Exit</span></a>
        ${logoUrl(me.shop_logo || me.companies.logo_path) ? `<img class="biz-logo pos-logo" src="${esc(logoUrl(me.shop_logo || me.companies.logo_path))}" alt="" onerror="this.remove()">` : ''}
        <div class="pos-title"><h1>Sell</h1><span class="muted small">${esc(shopName || me.companies.name)} · ${esc(firstName(me.full_name))}</span></div>
        <div class="pos-actions">
          ${held.length ? `<button type="button" class="chip" id="heldbtn" aria-expanded="false">${ICON.hold} Held (${held.length})</button>` : ''}
          ${manages ? '<button type="button" class="chip" id="closetill">Close till</button>' : ''}
        </div>
      </header>
      <div class="till-grid">
      <section class="till-products" aria-label="Products">
        <div class="searchrow">
          <input id="q" type="search" placeholder="Search or scan a barcode" aria-label="Search product, code or scan a barcode" autocomplete="off" enterkeyhint="go">
          <button type="button" class="scanbtn" id="scan" aria-label="Scan barcodes with the camera">${ICON.scan}<span>Scan</span></button>
        </div>
        <p class="keys" aria-hidden="true"><kbd>Enter</kbd> add · <kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>F6</kbd> Cash · <kbd>F7</kbd> Transfer · <kbd>F8</kbd> POS card · <kbd>F9</kbd> Complete sale · <kbd>Esc</kbd> clear</p>
        <section id="heldlist" class="card heldlist" hidden aria-label="Held sales">
          <h2>Held sales</h2>
          <ul class="board">${held.map((h) => `<li class="brow"><span class="grow"><strong>${esc(h.name)}</strong><span class="muted small">${h.basket.reduce((t, b) => t + b.qty, 0)} items · ${naira(h.basket.reduce((t, b) => t + b.qty * (b.unit_price || 0), 0))} · ${fmtTime(new Date(h.at).toISOString(), me.companies.timezone)}</span></span>
            <button type="button" class="primary small-btn" data-resume="${h.id}">Resume</button><button type="button" class="link small" data-drop="${h.id}" aria-label="Delete held sale ${esc(h.name)}">Delete</button></li>`).join('')}</ul>
        </section>
        <div id="pending">${await pendingList(me)}</div>
        ${quickList.length ? `<div class="quickpicks" aria-label="Best sellers">${quickList.map((p) => `<button type="button" class="qp" data-id="${p.id}"><strong>${esc(p.name)}</strong><span>${p.price != null ? naira(p.price) : '–'}</span></button>`).join('')}</div>` : ''}
        ${cats.length ? `<div class="chips cats" role="group" aria-label="Category"><button type="button" class="chip on" data-cat="" aria-pressed="true">All</button>${cats.map((c) => `<button type="button" class="chip" data-cat="${esc(c)}" aria-pressed="false">${esc(c)}</button>`).join('')}</div>` : ''}
        ${products.length ? `<ul class="list picks" id="picks">${products.map((p) => `
          <li data-cat="${esc(p.category || '')}"><button type="button" class="card row pick" data-id="${p.id}" data-name="${esc((p.name + ' ' + (p.code || '')).toLowerCase())}">
            <span class="grow"><strong>${esc(p.name)}</strong><br><span class="muted small">${stockText(p.id)}${p.code ? ` · ${esc(p.code)}` : ''}</span></span>
            <span class="pick-price">${p.price != null ? naira(p.price) : '–'}<span class="add" aria-hidden="true">+</span></span>
          </button></li>`).join('')}</ul>`
          : `<p class="muted center empty">No products yet. ${manages ? '<a href="#/product/new">Add a product</a> or scan one to add it.' : 'Ask your manager to add them.'}</p>`}
        <p class="waiting" id="waiting" role="status"></p>
      </section>
      <aside class="till-sale" id="salepanel" aria-label="This sale">
        <div class="sheet-head"><strong>This sale</strong><button type="button" class="link" id="sheetclose">Back to products</button></div>
        <section id="sendbox" class="card sendbox stack" aria-live="polite" hidden></section>
        <section id="cart" class="card cart is-empty" aria-labelledby="cart-h">
          <h2 id="cart-h">This sale · <span id="count"></span></h2>
          <p class="cart-empty muted">Scan a barcode, or search and tap a product to add it.</p>
          <ul class="lines" id="basket"></ul>
          <div class="cart-total"><span>Total</span><b id="total"></b></div>
          <details class="cust"${customer.name || customer.phone ? ' open' : ''}><summary>Customer <span class="muted">(optional)</span></summary>
            <div class="pair"><label>Name<input id="cname" value="${esc(customer.name)}" autocomplete="off" maxlength="80" placeholder="e.g. Mama Ngozi"></label>
            <label>WhatsApp number<input id="cphone2" type="tel" inputmode="tel" value="${esc(customer.phone)}" autocomplete="off" placeholder="0803 123 4567"></label></div>
            <span class="hint muted">The number is used only to send the receipt on WhatsApp.</span>
          </details>
          <fieldset class="pay"><legend>Paid by</legend>
            ${Object.entries({ ...PAY, split: 'Split' }).map(([v, t]) => `<label><input type="radio" name="pay" value="${v}"${payment === v ? ' checked' : ''}><span>${t}</span></label>`).join('')}
          </fieldset>
          <div id="paybox"></div>
          <p class="error" id="err" role="alert"></p>
          <button class="primary" id="save">Complete sale</button>
          <div class="cart-more"><button type="button" class="link" id="hold">${ICON.hold} Hold sale</button><button type="button" class="link" id="clear">Clear this sale</button></div>
        </section>
      </aside>
      </div>
      <button type="button" class="paybar" id="paybar" hidden aria-controls="salepanel"><span class="pb-what"></span><span class="pb-go">Pay</span></button>
    </main>`);
  draw();   // no Sign out here: full screen; Exit leads back to the screens that have it
  const main = app.querySelector('main.pos');
  const openSheet = (on) => { main.classList.toggle('sale-open', on); document.body.classList.toggle('sheet-open', on); document.getElementById('paybar').setAttribute('aria-expanded', String(on)); if (on) document.getElementById('salepanel').scrollTop = 0; };
  document.getElementById('paybar').onclick = () => openSheet(true);
  document.getElementById('sheetclose').onclick = () => openSheet(false);

  const refreshPending = async () => { const el = document.getElementById('pending'); if (el) el.innerHTML = await pendingList(me); };
  const setWaiting = (n) => { const el = document.getElementById('waiting'); if (el) el.textContent = waitingText(n); refreshPending().catch(report); };
  sync.count().then(setWaiting);
  const cleanups = [sync.onChange(setWaiting), () => document.body.classList.remove('has-paybar', 'sheet-open')];
  onLeave(() => cleanups.forEach((f) => f()));
  document.getElementById('pending').addEventListener('click', (e) => {
    const a = e.target.closest('a[data-token]');
    if (a) setTimeout(() => { dropReceipt(a.dataset.token); refreshPending().catch(report); }, 300);
  });
  if (justSold) {
    const sale = justSold;
    justSold = null;
    document.getElementById('cart').hidden = true;
    openSheet(true);
    receiptPanel(me, sale, () => { openSheet(false); again(); }).catch(report);
  } else {
    askOpeningCash(me, shopId).catch(report);
  }

  // Payment method, cash received, split parts, customer.
  app.querySelectorAll('input[name=pay]').forEach((x) => x.addEventListener('change', () => { payment = x.value; totals(); }));
  const paybox = document.getElementById('paybox');
  paybox.addEventListener('input', (e) => {
    if (e.target.id === 'received') { received = parseMoney(e.target.value); const ch = document.getElementById('change'); const c = received == null ? null : received - total();
      ch.className = `change ${c == null ? '' : c < 0 ? 'bad-text' : 'ok-text'}`; ch.textContent = c == null ? '' : c < 0 ? `${naira(-c)} more needed` : `Change: ${naira(c)}`; }
    if (e.target.dataset.split) { split[e.target.dataset.split] = parseMoney(e.target.value); const paid = Object.values(split).reduce((a, v) => a + (v || 0), 0), t = total(), ch = document.getElementById('change');
      ch.className = `change ${Math.abs(paid - t) < 0.01 ? 'ok-text' : 'bad-text'}`; ch.textContent = Math.abs(paid - t) < 0.01 ? 'Adds up to the total' : paid < t ? `${naira(t - paid)} still to pay` : `${naira(paid - t)} too much`; }
  });
  paybox.addEventListener('click', (e) => { const b = e.target.closest('[data-cash]'); if (b) { received = Number(b.dataset.cash); totals(); } });
  document.getElementById('cname').addEventListener('input', (e) => { customer.name = e.target.value; });
  document.getElementById('cphone2').addEventListener('input', (e) => { customer.phone = e.target.value; });

  // Search, categories, quick picks, and adding.
  const q = document.getElementById('q');
  let cat = '';
  const visiblePicks = () => [...app.querySelectorAll('#picks li:not([hidden]) .pick')];
  const filter = () => {
    const t = q.value.trim().toLowerCase();
    app.querySelectorAll('#picks li').forEach((li) => { li.hidden = (t && !li.firstElementChild.dataset.name.includes(t)) || (cat && li.dataset.cat !== cat); });
    app.querySelector('.pick.hl')?.classList.remove('hl');
  };
  q.addEventListener('input', filter);
  app.querySelector('.cats')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    cat = b.dataset.cat;
    app.querySelectorAll('.cats .chip').forEach((c) => { c.classList.toggle('on', c === b); c.setAttribute('aria-pressed', String(c === b)); });
    filter();
  });
  const add = (id, quiet) => {
    const p = byId.get(id);
    const have = basket.find((b) => b.product_id === p.id);
    if (have) have.qty++; else basket.push({ product_id: p.id, qty: 1, unit_price: p.price });
    keep(); draw();
    if (!quiet) toast(`${p.name} added`);
    if (q.value) { q.value = ''; filter(); }
    return p;
  };
  app.querySelector('#picks')?.addEventListener('click', (e) => { const btn = e.target.closest('.pick'); if (btn) add(btn.dataset.id); });
  app.querySelector('.quickpicks')?.addEventListener('click', (e) => { const btn = e.target.closest('.qp'); if (btn) add(btn.dataset.id); });
  const findCode = (t) => products.find((p) => p.code && p.code.trim().toLowerCase() === t) || products.find((p) => p.name.trim().toLowerCase() === t);
  // Enter in the search box adds a product. A USB or Bluetooth barcode scanner "types" the code and
  // presses Enter, so a scan adds the product straight away.
  q.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const t = q.value.trim().toLowerCase();
    if (!t) return;
    const shown = visiblePicks();
    const pick = findCode(t)?.id || app.querySelector('.pick.hl')?.dataset.id || (shown.length === 1 ? shown[0].dataset.id : null);
    if (pick) return add(pick);
    toast(shown.length ? 'More than one match: choose one (↑ ↓ then Enter, or tap it)' : `No product with the code or name "${q.value.trim()}"`);
    q.select();
  });

  // Camera scanning: every scan adds the item (beep and buzz); an unknown barcode can be added on the spot.
  document.getElementById('scan').onclick = async () => {
    const { openScanner } = await import('./scanner.js');
    await openScanner({
      onCode: async (code) => {
        const p = findCode(code.toLowerCase());
        if (p) { add(p.id, true); return { ok: true, label: `${p.name} added · ${itemsN()} item${itemsN() === 1 ? '' : 's'} · ${naira(total())}` }; }
        if (!manages) return { ok: false, message: `${code} isn't in the price list. Ask your manager to add it.` };
        const made = await quickAdd(me, code);
        if (!made) return { ok: false, message: `${code} not added.` };
        products.push(made); byId.set(made.id, made);
        add(made.id, true);
        return { ok: true, label: `${made.name} added to the price list and this sale` };
      },
    });
  };

  // Held sales: park this one, serve someone else, come back to it.
  document.getElementById('hold').onclick = async () => {
    const name = await ask('Hold this sale. Who is it for?', { input: customer.name || `Customer ${held.length + 1}`, ok: 'Hold sale' });
    if (!name) return;
    heldSave([...heldAll(), { id: uuid(), shop: shopId, name, basket, customer, payment, at: Date.now() }]);
    basket = []; customer = { name: '', phone: '' }; payment = 'cash'; received = null; split = { cash: null, transfer: null, card: null }; keep();
    toast(`Held: ${name}`);
    again();
  };
  document.getElementById('heldbtn')?.addEventListener('click', (e) => {
    const list = document.getElementById('heldlist');
    list.hidden = !list.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!list.hidden));
  });
  document.getElementById('heldlist').addEventListener('click', async (e) => {
    const resume = e.target.closest('[data-resume]'), drop = e.target.closest('[data-drop]');
    if (drop && await ask('Delete this held sale?', { ok: 'Delete', danger: true })) { heldSave(heldAll().filter((h) => h.id !== drop.dataset.drop)); again(); }
    if (!resume) return;
    const h = heldAll().find((x) => x.id === resume.dataset.resume);
    if (!h) return;
    let rest = heldAll().filter((x) => x.id !== h.id);
    if (basket.length) {   // the sale on screen is held first, so nothing is lost
      rest = [...rest, { id: uuid(), shop: shopId, name: customer.name || `Customer ${rest.length + 1}`, basket, customer, payment, at: Date.now() }];
    }
    heldSave(rest);
    basket = h.basket; customer = h.customer || { name: '', phone: '' }; payment = h.payment || 'cash'; keep();
    toast(`Back to ${h.name}`);
    again();
  });

  // Close the till (managers and owners).
  document.getElementById('closetill')?.addEventListener('click', () => closeTill(me, shopId, shopName, again));

  // Keyboard shortcuts for tablets and computers (downloaded only on bigger screens).
  if (matchMedia('(min-width: 768px)').matches) {
    import('./till-keys.js').then((k) => cleanups.push(k.attach({
      q, visiblePicks,
      pay: (v) => { const r = app.querySelector(`input[name=pay][value=${v}]`); if (r) { r.checked = true; payment = v; totals(); } },
      complete: () => { const b = document.getElementById('save'); if (b && !b.disabled && !document.getElementById('cart').hidden) b.click(); },
      next: () => document.getElementById('next')?.click(),
    }))).catch(report);
    if (!justSold) q.focus();
  }
  const lines = document.getElementById('basket');
  lines.addEventListener('click', (e) => {
    const act = e.target.dataset.act, li = e.target.closest('.line');
    if (!li || !['minus', 'plus', 'remove'].includes(act)) return;
    const i = Number(li.dataset.i), b = basket[i];
    if (act === 'remove' || (act === 'minus' && b.qty <= 1)) basket.splice(i, 1);
    else b.qty += act === 'plus' ? 1 : -1;
    keep(); draw();
  });
  lines.addEventListener('input', (e) => {
    const act = e.target.dataset.act, li = e.target.closest('.line');
    if (!li) return;
    const i = Number(li.dataset.i), v = e.target.value;
    if (act === 'qty') basket[i].qty = Math.max(1, Math.floor(Number(v) || 1));
    if (act === 'price') basket[i].unit_price = parseMoney(v);
    keep(); refreshLine(i);
  });
  document.getElementById('clear').onclick = async () => {
    if (await ask('Clear this sale?', { ok: 'Clear sale', danger: true })) { basket = []; customer = { name: '', phone: '' }; received = null; keep(); draw(); openSheet(false); }
  };

  const save = document.getElementById('save'), err = document.getElementById('err');
  save.onclick = async () => {
    err.textContent = '';
    if (!basket.length) return;
    const noPrice = basket.find((b) => b.unit_price == null || !(b.unit_price >= 0));
    if (noPrice) { err.textContent = `Type the price for ${byId.get(noPrice.product_id).name}.`; return; }
    if (staffRule) {
      const bad = basket.find((b) => { const p = byId.get(b.product_id); return (p.price != null && b.unit_price > p.price) || (!belowOk && p.lowest_price != null && b.unit_price < p.lowest_price); });
      if (bad) { const p = byId.get(bad.product_id); err.textContent = `${p.name}: the price must be between ${naira(p.lowest_price ?? 0)} and ${naira(p.price)}.`; return; }
    }
    const sum = total();
    let payments = null;
    if (payment === 'split') {
      payments = Object.entries(split).filter(([, v]) => v > 0).map(([method, amount]) => ({ method, amount }));
      const paid = payments.reduce((a, x) => a + x.amount, 0);
      if (payments.length < 2) { err.textContent = 'A split payment needs two or more parts (e.g. cash and transfer).'; return; }
      if (Math.abs(paid - sum) > 0.01) { err.textContent = `The parts add up to ${naira(paid)}, not ${naira(sum)}.`; return; }
    }
    if (payment === 'cash' && received != null && received < sum) { err.textContent = `Cash received is ${naira(sum - received)} short.`; return; }
    const high = basket.find((b) => { const p = byId.get(b.product_id); return p.price != null && b.unit_price > p.price; });
    if (high && !(await ask(`${byId.get(high.product_id).name}: ${naira(high.unit_price)} is above the selling price (${naira(byId.get(high.product_id).price)}). Save anyway?`, { ok: 'Save anyway' }))) return;
    save.disabled = true;
    try {
      const rec = {
        type: 'sale', id: uuid(), member_id: me.id, company_id: me.company_id, branch_id: shopId,
        happened_at: api.serverNow().toISOString(), total: sum, payment, receipt_token: makeToken(),
        items: basket.map((b) => ({ product_id: b.product_id, name: byId.get(b.product_id).name, qty: b.qty, unit_price: b.unit_price })),
      };
      if (payments) rec.payments = payments;
      if (customer.name.trim()) rec.customer_name = customer.name.trim();
      await sync.add(rec);
      justSold = { id: rec.id, token: rec.receipt_token, total: sum, payment: rec.payment, phone: customer.phone, change: payment === 'cash' && received != null ? received - sum : null };
      basket = []; payment = 'cash'; received = null; split = { cash: null, transfer: null, card: null }; customer = { name: '', phone: '' }; keep();
      save.textContent = 'Saving…';
      await sync.flush();   // with signal the sale is sent now, so the receipt can go straight away
      again();
    } catch (x) { err.textContent = friendly(x); save.disabled = false; }
  };
}

// "Add this product?" for a barcode that isn't in the price list (managers and owners).
function quickAdd(me, code) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'dlg';
    d.innerHTML = `
      <form method="dialog" class="stack">
        <p class="dlg-msg">Add this product?</p>
        <p class="muted small dlg-hint">Barcode ${esc(code)} isn't in your price list yet.</p>
        <label>Product name<input name="name" required maxlength="120" autocomplete="off" placeholder="e.g. Milo 400g"></label>
        <label>Selling price (₦)${moneyInput({ name: 'price', placeholder: '2,500' })}</label>
        <p class="error" role="alert"></p>
        <div class="dlg-btns"><button type="button" class="secondary" value="cancel">Not now</button><button type="submit" class="primary">Add and sell</button></div>
      </form>`;
    document.body.append(d);
    const done = (v) => { d.remove(); resolve(v); };
    d.querySelector('[value=cancel]').onclick = () => d.close();
    d.addEventListener('close', () => { if (d.isConnected) done(null); });
    d.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target), price = parseMoney(f.get('price'));
      const out = d.querySelector('.error');
      if (price == null) { out.textContent = 'Type the selling price.'; return; }
      try {
        const p = await api.insert('products', { company_id: me.company_id, name: String(f.get('name')).trim(), code, price });
        api.clearCache();
        d.close();
        done(p);
      } catch (x) { out.textContent = x.code === '23505' ? 'A product with this name or code already exists.' : friendly(x); }
    });
    d.showModal();
    d.querySelector('input').focus();
  });
}

// Close the till: expected cash (opening + cash taken) vs the cash counted. Managers and owners.
async function closeTill(me, shopId, shopName, back) {
  let st;
  try { st = await api.rpc('till_status', { p_branch: shopId }); } catch (x) { return toast(x.status === 0 ? 'Closing the till needs signal.' : friendly(x)); }
  show(`
    <main class="page narrow">
      <button class="link back" id="back">${ICON.back}Back to Sell</button>
      <h1>Close the till</h1>
      <p class="muted">${esc(shopName)} · ${fmtTime(api.serverNow().toISOString(), me.companies.timezone)}</p>
      <div class="card">
        <ul class="offices">
          <li><span>Cash at the start</span><span>${naira(st.opening_cash || 0)}${st.opened_by ? ` <span class="muted small">· ${esc(properName(st.opened_by))}</span>` : ''}</span></li>
          <li><span>Cash taken today</span><span>${naira(st.cash_sales || 0)}</span></li>
          <li class="total"><span>Cash expected in the drawer</span><span>${naira(st.expected_cash || 0)}</span></li>
        </ul>
      </div>
      ${st.closed ? `<div class="banner ${st.difference < 0 ? 'bad-banner' : 'tip'}">Closed by ${esc(properName(st.closed_by))}: counted ${naira(st.counted_cash)}${Number(st.difference) ? ` (${st.difference < 0 ? `${naira(-st.difference)} short` : `${naira(st.difference)} over`})` : ', exactly right'}. You can count again to correct it.</div>` : ''}
      <form class="stack">
        <label>Cash counted in the drawer (₦)${moneyInput({ name: 'counted', placeholder: fmtMoney(st.expected_cash || 0) })}</label>
        <p class="change" id="diff" aria-live="polite"></p>
        <label><span>Note <span class="muted">(optional)</span></span><input name="note" maxlength="300" placeholder="e.g. ₦500 given to the cleaner"></label>
        <p class="error" role="alert"></p>
        <button type="submit" class="primary">Close the till</button>
      </form>
    </main>`, async ({ counted, note }) => {
    const c = parseMoney(counted);
    if (c == null) throw new Say('Type the cash you counted.');
    const r = await api.rpc('close_till', { p_branch: shopId, p_counted: c, p_note: note });
    toast(Number(r.difference) === 0 ? 'Till closed: exactly right' : `Till closed: ${r.difference < 0 ? `${naira(-r.difference)} short` : `${naira(r.difference)} over`}`);
    back();
  });
  document.getElementById('back').onclick = back;
  app.querySelector('[name=counted]').addEventListener('input', (e) => {
    const c = parseMoney(e.target.value), out = document.getElementById('diff');
    if (c == null) { out.textContent = ''; return; }
    const d = c - Number(st.expected_cash || 0);
    out.className = `change ${d < 0 ? 'bad-text' : d > 0 ? 'late' : 'ok-text'}`;
    out.textContent = d === 0 ? 'Exactly right' : d < 0 ? `${naira(-d)} short` : `${naira(d)} over`;
  });
}

// ── My sales today ──────────────────────────────────────────
const FLAG = { below_lowest: 'Below lowest price', out_of_stock: 'Sold when out of stock', clock_changed: 'Phone clock was changed' };

export async function mySales(me) {
  const tz = me.companies.timezone;
  const day = localDate(api.serverNow(), tz);
  const [sent, waiting] = await Promise.all([
    api.cached('mysales', () => api.select('sales', `select=id,happened_at,total,flags,payment_method,receipt_token,receipt_code,cancelled_at,cancelled_by_name,cancel_reason,mistake_note,sale_items(product_name,qty,unit_price,line)&member_id=eq.${me.id}&local_date=eq.${day}&order=happened_at.desc`)).catch(quiet),
    outbox.all(),
  ]);
  const mine = waiting.filter((w) => w.type === 'sale' && w.member_id === me.id && !sent.some((s) => s.id === w.id))
    .map((w) => ({ id: w.id, happened_at: w.happened_at, total: w.total, flags: [], waiting: true, payment_method: w.payment, receipt_token: w.receipt_token, sale_items: w.items.map((i) => ({ product_name: i.name, qty: i.qty, unit_price: i.unit_price })) }));
  const all = [...mine, ...sent].sort((a, b) => b.happened_at.localeCompare(a.happened_at));
  const live = all.filter((s) => !s.cancelled_at);
  const sum = live.reduce((t, s) => t + Number(s.total), 0);
  const items = (s) => [...s.sale_items].sort((a, b) => (a.line ?? 0) - (b.line ?? 0)).map((i) => `${i.qty} × ${esc(i.product_name)} @ ${naira(i.unit_price)}`).join('<br>');
  show(`
    <main class="page narrow has-tabs">
      ${header(me, 'My sales')}
      <div class="card hero"><div><p class="muted">Today</p><p class="big-line"><b>${naira(sum)}</b> · ${live.length} sale${live.length === 1 ? '' : 's'}</p></div></div>
      ${all.length ? `<ul class="list">${all.map((s) => `
        <li class="card stack sale${s.cancelled_at ? ' cancelled' : ''}" data-id="${s.id}">
          <div class="row"><strong>${fmtTime(s.happened_at, tz)}${s.receipt_code ? ` <span class="muted small">${esc(s.receipt_code)}</span>` : ''}</strong><b>${naira(s.total)}</b></div>
          <span class="muted small">${items(s)}</span>
          ${s.waiting ? '<span class="pill wait">Waiting to send</span>' : ''}
          ${s.flags.map((f) => `<span class="pill warn">${FLAG[f] || f}</span>`).join(' ')}
          ${s.cancelled_at ? `<span class="pill bad">Cancelled by ${esc(properName(s.cancelled_by_name))}: ${esc(s.cancel_reason)}</span>`
            : s.mistake_note ? `<span class="pill info">Mistake reported: ${esc(s.mistake_note)}</span>`
            : s.waiting ? '' : '<button class="link small mistake">Report a mistake</button>'}
          ${s.receipt_token && !s.cancelled_at ? `<button class="link small resend" data-token="${esc(s.receipt_token)}" data-total="${s.total}" data-pay="${esc(s.payment_method || 'cash')}">Send receipt</button>` : ''}
        </li>`).join('')}</ul>` : '<p class="muted center empty">No sales yet today.</p>'}
    </main>
    ${tabBar('mysales')}`);
  wireSignOut(safeToSignOut);
  app.querySelectorAll('.resend').forEach((btn) => {
    btn.onclick = () => {
      justSold = { id: btn.closest('.sale').dataset.id, token: btn.dataset.token, total: Number(btn.dataset.total), payment: btn.dataset.pay };
      location.hash = '#/sell';
    };
  });
  app.querySelectorAll('.mistake').forEach((btn) => {
    btn.onclick = async () => {
      const note = await ask('What went wrong? Your manager will see this and can fix the sale.', { input: '', placeholder: 'e.g. Sugar was 3, not 4', ok: 'Send to manager' });
      if (!note || !note.trim()) return;
      btn.disabled = true;
      try {
        await api.rpc('report_sale_mistake', { p_sale: btn.closest('.sale').dataset.id, p_note: note.trim() });
        toast('Sent to your manager');
        mySales(me).catch(report);
      } catch (x) { btn.disabled = false; toast(x.status === 0 ? 'No signal. Try again when you have signal.' : friendly(x)); }
    };
  });
}
