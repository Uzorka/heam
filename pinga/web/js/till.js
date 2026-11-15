// Shop staff: record sales (works with no signal) and see today's sales.
// The price list and the shop's stock are kept on the phone; each sale waits in the outbox until sent.
import { ask } from './dialog.js';
import { copyText } from './device.js';
import * as api from './api.js';
import { sync, outbox, uuid, safeToSignOut, waitingText } from './queue.js';
import { report } from './report.js';
import { show, esc, toast, header, wireSignOut, onLeave, app, fmtTime, localDate, friendly, moneyInput, parseMoney, properName } from './ui.js';
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
const loadProducts = (me) => api.cached('products', () => api.select('products',
  `select=id,name,code,price,lowest_price&company_id=eq.${me.company_id}&active=is.true&order=name`)).catch(quiet);
const loadStock = (me) => api.cached('shopstock', () => api.select('stock', `select=product_id,qty&branch_id=eq.${me.branch_id}`)).catch(quiet);

// The basket survives the app being closed (e.g. a call comes in mid-sale).
let basket = [];
try { basket = JSON.parse(sessionStorage.getItem(BASKET)) || []; } catch { /* empty */ }
const keep = () => { try { sessionStorage.setItem(BASKET, JSON.stringify(basket)); } catch { /* fine */ } };

const PAY = { cash: 'Cash', transfer: 'Transfer', card: 'POS card' };
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
    <p class="muted">Paid by ${PAY[sale.payment] || 'Cash'}</p>
    <label><span>Customer's WhatsApp number <span class="muted">(optional)</span></span><input id="cphone" type="tel" inputmode="tel" placeholder="0803 123 4567" autocomplete="off"></label>
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

// What the phone thinks is left: the last copy from the server minus sales still waiting to send.
async function leftInShop(me) {
  const [stock, waiting] = await Promise.all([loadStock(me), outbox.all()]);
  const left = new Map(stock.map((s) => [s.product_id, s.qty]));
  for (const w of waiting) if (w.type === 'sale' && w.member_id === me.id) for (const i of w.items) left.set(i.product_id, (left.get(i.product_id) ?? 0) - i.qty);
  return left;
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

export async function sell(me) {
  // The owner's till rules for shop staff (the server enforces them too).
  const staffRule = me.role === 'staff';
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
  const [products, left] = await Promise.all([loadProducts(me), leftInShop(me)]);
  const byId = new Map(products.map((p) => [p.id, p]));
  basket = basket.filter((b) => byId.has(b.product_id));
  const stockText = (id) => { const n = left.get(id); return n == null ? 'Not counted' : n <= 0 ? 'Out of stock' : `${n} left`; };

  const warnings = (b) => {
    const p = byId.get(b.product_id), out = [];
    const n = left.get(b.product_id) ?? 0;
    if (b.qty > n) out.push(`<span class="warn-line">${n <= 0 ? 'Out of stock' : `Only ${n} in stock`}. You can still sell; your manager will see it.</span>`);
    if (p.lowest_price != null && b.unit_price < p.lowest_price) out.push(staffRule && !belowOk
      ? `<span class="warn-line bad-text">Can't go below ${naira(p.lowest_price)} (the lowest price).</span>`
      : `<span class="warn-line">Below the lowest price (${naira(p.lowest_price)}). Your manager will see it.</span>`);
    if (staffRule && p.price != null && b.unit_price > p.price) out.push(`<span class="warn-line bad-text">Can't go above ${naira(p.price)} (the selling price).</span>`);
    return out.join('');
  };
  const range = (p) => (p.price == null ? 'No price set: type the price'
    : p.lowest_price != null && p.lowest_price < p.price ? `${naira(p.lowest_price)} – ${naira(p.price)}` : naira(p.price));
  const total = () => basket.reduce((t, b) => t + b.qty * (b.unit_price || 0), 0);

  const draw = () => {
    const list = document.getElementById('basket');
    list.innerHTML = basket.map((b, i) => {
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
    document.getElementById('cart').classList.toggle('is-empty', !basket.length);
    document.getElementById('save').disabled = !basket.length;
    document.getElementById('total').textContent = naira(total());
    { const n = basket.reduce((t, b) => t + b.qty, 0); document.getElementById('count').textContent = `${n} item${n === 1 ? '' : 's'}`; }
  };
  const refreshLine = (i) => {
    const li = app.querySelector(`.line[data-i="${i}"]`);
    li.querySelector('.warns').innerHTML = warnings(basket[i]);
    document.getElementById('total').textContent = naira(total());
    { const n = basket.reduce((t, b) => t + b.qty, 0); document.getElementById('count').textContent = `${n} item${n === 1 ? '' : 's'}`; }
  };

  // Phones: the sale on top, products underneath. Tablets and desktops: products left, the sale right.
  show(`
    <main class="page till has-tabs">
      ${header(me, 'Sell')}
      <div class="till-grid">
      <section class="till-products" aria-label="Products">
        <input id="q" type="search" placeholder="Search or scan a barcode" aria-label="Search product, code or scan a barcode" autocomplete="off" enterkeyhint="go">
        <p class="keys" aria-hidden="true"><kbd>Enter</kbd> add · <kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>F6</kbd> Cash · <kbd>F7</kbd> Transfer · <kbd>F8</kbd> POS card · <kbd>F9</kbd> Complete sale · <kbd>Esc</kbd> clear</p>
        <div id="pending">${await pendingList(me)}</div>
        ${products.length ? `<ul class="list picks" id="picks">${products.map((p) => `
          <li><button type="button" class="card row pick" data-id="${p.id}" data-name="${esc((p.name + ' ' + (p.code || '')).toLowerCase())}">
            <span class="grow"><strong>${esc(p.name)}</strong><br><span class="muted small">${stockText(p.id)}${p.code ? ` · ${esc(p.code)}` : ''}</span></span>
            <span class="pick-price">${p.price != null ? naira(p.price) : '–'}<span class="add" aria-hidden="true">+</span></span>
          </button></li>`).join('')}</ul>`
          : '<p class="muted center empty">No products yet. Ask your manager to add them.</p>'}
        <p class="waiting" id="waiting" role="status"></p>
      </section>
      <aside class="till-sale" aria-label="This sale">
      <section id="sendbox" class="card sendbox stack" aria-live="polite" hidden></section>
      <section id="cart" class="card cart is-empty" aria-labelledby="cart-h">
        <h2 id="cart-h">This sale · <span id="count"></span></h2>
        <p class="cart-empty muted">Scan a barcode, or search and tap a product to add it.</p>
        <ul class="lines" id="basket"></ul>
        <div class="cart-total"><span>Total</span><b id="total"></b></div>
        <fieldset class="pay"><legend>Paid by</legend>
          ${Object.entries(PAY).map(([v, t]) => `<label><input type="radio" name="pay" value="${v}"${payment === v ? ' checked' : ''}><span>${t}</span></label>`).join('')}
        </fieldset>
        <p class="error" id="err" role="alert"></p>
        <button class="primary" id="save">Complete sale</button>
        <button class="link block" id="clear">Clear this sale</button>
      </section>
      </aside>
      </div>
    </main>
    ${tabBar('sell')}`);
  wireSignOut(safeToSignOut);
  draw();
  const refreshPending = async () => { const el = document.getElementById('pending'); if (el) el.innerHTML = await pendingList(me); };
  const setWaiting = (n) => { const el = document.getElementById('waiting'); if (el) el.textContent = waitingText(n); refreshPending().catch(report); };
  sync.count().then(setWaiting);
  const cleanups = [sync.onChange(setWaiting)];
  onLeave(() => cleanups.forEach((f) => f()));
  document.getElementById('pending').addEventListener('click', (e) => {
    const a = e.target.closest('a[data-token]');
    if (a) setTimeout(() => { dropReceipt(a.dataset.token); refreshPending().catch(report); }, 300);
  });
  app.querySelectorAll('input[name=pay]').forEach((x) => x.addEventListener('change', () => { payment = x.value; }));
  if (justSold) {
    const sale = justSold;
    justSold = null;
    document.getElementById('cart').hidden = true;
    receiptPanel(me, sale, () => sell(me).catch(report)).catch(report);
  }

  const q = document.getElementById('q');
  const visiblePicks = () => [...app.querySelectorAll('#picks li:not([hidden]) .pick')];
  q.addEventListener('input', () => {
    const t = q.value.trim().toLowerCase();
    app.querySelectorAll('#picks li').forEach((li) => { li.hidden = t && !li.firstElementChild.dataset.name.includes(t); });
    app.querySelector('.pick.hl')?.classList.remove('hl');
  });
  const add = (id) => {
    const p = byId.get(id);
    const have = basket.find((b) => b.product_id === p.id);
    if (have) have.qty++; else basket.push({ product_id: p.id, qty: 1, unit_price: p.price });
    keep(); draw();
    toast(`${p.name} added`);
    if (q.value) { q.value = ''; q.dispatchEvent(new Event('input')); }
  };
  app.querySelector('#picks')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.pick');
    if (btn) add(btn.dataset.id);
  });
  // Enter in the search box adds a product. A USB or Bluetooth barcode scanner "types" the code and
  // presses Enter, so a scan adds the product straight away. Exact code (or name) first, then the
  // highlighted or only match.
  q.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const t = q.value.trim().toLowerCase();
    if (!t) return;
    const exact = products.find((p) => p.code && p.code.trim().toLowerCase() === t) || products.find((p) => p.name.trim().toLowerCase() === t);
    const shown = visiblePicks();
    const pick = exact?.id || app.querySelector('.pick.hl')?.dataset.id || (shown.length === 1 ? shown[0].dataset.id : null);
    if (pick) return add(pick);
    toast(shown.length ? 'More than one match: choose one (↑ ↓ then Enter, or tap it)' : `No product with the code or name "${q.value.trim()}"`);
    q.select();
  });
  // Keyboard shortcuts for tablets and computers (downloaded only on bigger screens).
  if (matchMedia('(min-width: 768px)').matches) {
    import('./till-keys.js').then((k) => cleanups.push(k.attach({
      q, visiblePicks,
      pay: (v) => { const r = app.querySelector(`input[name=pay][value=${v}]`); if (r) { r.checked = true; payment = v; r.dispatchEvent(new Event('change')); } },
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
  document.getElementById('clear').onclick = async () => { if (await ask('Clear this sale?', { ok: 'Clear sale', danger: true })) { basket = []; keep(); draw(); } };

  const save = document.getElementById('save'), err = document.getElementById('err');
  save.onclick = async () => {
    err.textContent = '';
    const noPrice = basket.find((b) => b.unit_price == null || !(b.unit_price >= 0));
    if (!basket.length) return;
    if (noPrice) { err.textContent = `Type the price for ${byId.get(noPrice.product_id).name}.`; return; }
    // Shop staff sell between the lowest and the selling price (the owner's rule; the server checks too).
    if (staffRule) {
      const bad = basket.find((b) => { const p = byId.get(b.product_id); return (p.price != null && b.unit_price > p.price) || (!belowOk && p.lowest_price != null && b.unit_price < p.lowest_price); });
      if (bad) { const p = byId.get(bad.product_id); err.textContent = `${p.name}: the price must be between ${naira(p.lowest_price ?? 0)} and ${naira(p.price)}.`; return; }
    }
    // Above the selling price is unusual (often a typing slip, e.g. 25000 for 2500): check first.
    const high = basket.find((b) => { const p = byId.get(b.product_id); return p.price != null && b.unit_price > p.price; });
    if (high && !(await ask(`${byId.get(high.product_id).name}: ${naira(high.unit_price)} is above the selling price (${naira(byId.get(high.product_id).price)}). Save anyway?`, { ok: 'Save anyway' }))) return;
    save.disabled = true;
    try {
      const sum = total();
      const rec = {
        type: 'sale', id: uuid(), member_id: me.id, company_id: me.company_id, branch_id: me.branch_id,
        happened_at: api.serverNow().toISOString(), total: sum, payment, receipt_token: makeToken(),
        items: basket.map((b) => ({ product_id: b.product_id, name: byId.get(b.product_id).name, qty: b.qty, unit_price: b.unit_price })),
      };
      await sync.add(rec);
      basket = []; keep(); payment = 'cash';
      justSold = { id: rec.id, token: rec.receipt_token, total: sum, payment: rec.payment };
      save.textContent = 'Saving…';
      await sync.flush();   // with signal the sale is sent now, so the receipt can go straight away
      sell(me).catch(report);
    } catch (x) { err.textContent = friendly(x); save.disabled = false; }
  };
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
