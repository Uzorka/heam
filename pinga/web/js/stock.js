// Stock (Storefront and Both): products and prices, stock per shop, Excel/CSV imports, the import log.
// Owners see every shop; managers see the shops the owner gave them.
import { saveFile } from './device.js';
import { ask } from './dialog.js';
import * as api from './api.js';
import { show, go, esc, Say, friendly, toast, header, wireSignOut, app, backLink, fmtTime, fmtDay, localDate, chev, dateField, fmtDate, moneyInput, parseMoney } from './ui.js';
import { xlsxParts, XLSX_TYPE } from './xlsx.js';
import { readFile, readStockList, TEMPLATE_HEADER } from './sheet.js';

let shopId = null;       // the shop being looked at (kept while moving between Stock screens)
let pending = null;      // a checked file waiting for "Import"

export const naira = (n) => (n == null ? '' : '₦' + Number(n).toLocaleString('en-NG', { maximumFractionDigits: 2 }));
const plural = (n, w, ws = w + 's') => `${Number(n).toLocaleString('en-NG')} ${n === 1 ? w : ws}`;

// The shops this person can manage.
async function myShops(me) {
  const all = await api.select('branches', `select=id,name,kind&company_id=eq.${me.company_id}&order=name`);
  const shops = all.filter((b) => b.kind === 'shop');   // offices never sell or keep stock
  if (me.role === 'owner') return shops;
  const mine = new Set((await api.select('manager_shops', `select=branch_id&manager_id=eq.${me.id}`)).map((x) => x.branch_id));
  return shops.filter((b) => mine.has(b.id));
}

function pickShop(shops, want) {
  const s = shops.find((b) => b.id === want) || shops.find((b) => b.id === shopId) || shops[0];
  shopId = s?.id || null;
  return s;
}

const noShops = (me, tabs) => show(`
  <main class="page">
    ${header(me, 'Stock')}
    ${tabs('Stock')}
    <div class="card stack center">
      ${me.role === 'owner'
        ? `<p><strong>Add your first shop</strong></p><p class="muted">Stock is kept per shop.</p><a class="primary button" href="#/office/new">Add shop</a>`
        : '<p><strong>No shops yet</strong></p><p class="muted">Ask the owner to give you a shop (Team → your name → Shops they look after).</p>'}
    </div>
  </main>`);

const ALERT = { out: ['Out of stock', 'bad'], low: ['Low', 'wait'], expiring: ['Expires soon', 'wait'], expired: ['Expired', 'bad'] };

// ── The stock list for one shop ─────────────────────────────
export async function stockList(me, arg, tabs) {
  const shops = await myShops(me);
  if (!shops.length) { noShops(me, tabs); return wireSignOut(); }
  const shop = pickShop(shops, arg);
  const tz = me.companies.timezone;
  const today = localDate(new Date(), tz);
  const [products, stock, alerts, sold] = await Promise.all([
    api.select('products', `select=id,name,code,price,lowest_price,low_stock_at&company_id=eq.${me.company_id}&active=is.true&order=name`),
    api.select('stock', `select=product_id,qty,expires_on&branch_id=eq.${shop.id}`),
    api.rpc('stock_alerts', { p_branch: shop.id }),
    api.rpc('shop_sales_summary', { p_branch: shop.id, p_day: today }),
  ]);
  const inShop = new Map(stock.map((s) => [s.product_id, s]));
  const alertOf = new Map(alerts.map((a) => [a.product_id, a.alert]));
  const units = stock.reduce((t, s) => t + Math.max(0, s.qty), 0);
  const value = stock.reduce((t, s) => { const p = products.find((x) => x.id === s.product_id); return t + Math.max(0, s.qty) * (p?.price || 0); }, 0);
  const byKind = (k) => alerts.filter((a) => a.alert === k).length;
  const row = (p) => {
    const s = inShop.get(p.id), al = alertOf.get(p.id);
    const qty = s ? s.qty : null;
    const price = p.price != null ? naira(p.price) : '<span class="late">No price yet</span>';
    const exp = s?.expires_on ? fmtDate(s.expires_on) : '';
    // A table row on tablets and desktops; a card on phones (the .sub line shows what the hidden columns hold).
    return `<tr data-href="#/product/${p.id}" data-name="${esc((p.name + ' ' + (p.code || '')).toLowerCase())}">
      <td class="main"><a href="#/product/${p.id}"><strong>${esc(p.name)}</strong></a>
        <span class="sub muted">${price}${p.code ? ' · ' + esc(p.code) : ''}${exp ? ` · Exp ${exp}` : ''}</span></td>
      <td class="d">${esc(p.code || '')}</td>
      <td class="d num">${price}</td>
      <td class="d num">${p.lowest_price != null ? naira(p.lowest_price) : '<span class="muted">–</span>'}</td>
      <td class="d">${exp || '<span class="muted">–</span>'}</td>
      <td class="end qty"><b>${qty == null ? '–' : qty.toLocaleString('en-NG')}</b>${al ? `<span class="pill ${ALERT[al][1]}">${ALERT[al][0]}</span>` : ''}</td>
    </tr>`;
  };
  show(`
    <main class="page">
      ${header(me, 'Stock')}
      ${tabs('Stock')}
      ${shops.length > 1 ? `<nav class="chips" aria-label="Shop">${shops.map((b) => `<a class="chip${b.id === shop.id ? ' on' : ''}" href="#/stock/${b.id}"${b.id === shop.id ? ' aria-current="page"' : ''}>${esc(b.name)}</a>`).join('')}</nav>` : `<p class="muted">${esc(shop.name)}</p>`}
      <a class="card row salescard" href="#/sales/${shop.id}">
        <span class="grow"><span class="muted">Sales today</span><br><b class="big">${naira(sold?.total || 0)}</b> · ${plural(sold?.sales || 0, 'sale')}
          ${sold?.mistakes ? `<br><span class="pill info">${plural(sold.mistakes, 'mistake')} reported</span>` : ''}${sold?.flagged ? ` <span class="pill warn">${sold.flagged} to check</span>` : ''}</span>${chev}</a>
      <div class="btn-pair">
        <a class="primary button" href="#/import">Import stock</a>
        <a class="secondary button" href="#/product/new">Add product</a>
      </div>
      ${products.length ? `
      <section class="card block" aria-labelledby="st-h">
        <h2 id="st-h" class="sr">Summary</h2>
        <p class="big-line"><b>${plural(units, 'item')}</b> in stock${value ? ` · worth ${naira(value)}` : ''}</p>
        ${alerts.length ? `<p class="alerts">${[['out', 'out of stock'], ['low', 'running low'], ['expiring', 'expire within 30 days'], ['expired', 'expired']]
          .filter(([k]) => byKind(k)).map(([k, t]) => `<span class="pill ${ALERT[k][1]}">${byKind(k)} ${t}</span>`).join(' ')}</p>` : '<p class="muted">Nothing low or expiring.</p>'}
      </section>
      <input id="q" type="search" placeholder="Search product or code" aria-label="Search product or code"${products.length > 8 ? '' : ' hidden'}>
      ${alerts.length ? '<label class="selall"><input type="checkbox" id="only"> <span>Only show low, out or expiring</span></label>' : ''}
      <div class="tablewrap"><table class="rtable" id="plist">
        <thead><tr><th>Product</th><th class="d">Code</th><th class="d num">Price</th><th class="d num">Lowest price</th><th class="d">Expires</th><th class="num">In stock</th></tr></thead>
        <tbody>${products.map(row).join('')}</tbody></table></div>`
      : `<div class="card stack center"><p><strong>No products yet</strong></p>
          <p class="muted">Import your stock list from Excel or a CSV file (download the template if you don't have one), or add products one by one.</p></div>`}
      <p class="center"><a href="#/imports">Import history</a></p>
    </main>`);
  wireSignOut();
  const q = document.getElementById('q'), only = document.getElementById('only');
  const filter = () => {
    const t = (q?.value || '').trim().toLowerCase();
    app.querySelectorAll('#plist tbody tr').forEach((tr) => {
      tr.hidden = (t && !tr.dataset.name.includes(t)) || (only?.checked && !tr.querySelector('.pill'));
    });
  };
  q?.addEventListener('input', filter);
  only?.addEventListener('change', filter);
}

// ── One product: details, price, and stock in the current shop ──
export async function productForm(me, id, tabs) {
  const isNew = id === 'new';
  const shops = await myShops(me);
  const shop = pickShop(shops);
  const tz = me.companies.timezone;
  const [found, stockRow, changes] = await Promise.all([
    isNew ? [{ low_stock_at: 5 }] : api.select('products', `select=*&id=eq.${encodeURIComponent(id)}`),
    !isNew && shop ? api.select('stock', `select=qty,expires_on&branch_id=eq.${shop.id}&product_id=eq.${encodeURIComponent(id)}`) : [],
    !isNew && shop ? api.select('stock_changes', `select=change,qty_after,reason,note,by_name,created_at&branch_id=eq.${shop.id}&product_id=eq.${encodeURIComponent(id)}&order=id.desc&limit=10`) : [],
  ]);
  const p = found[0];
  if (!p) return go('#/stock');
  const s = stockRow[0];
  const WHY = { count: 'Stock count', delivery: 'Delivery', correction: 'Corrected', sale: 'Sale', sale_cancelled: 'Sale cancelled' };
  show(`
    <main class="page narrow">
      ${backLink('#/stock', 'Stock')}
      <h1>${isNew ? 'Add product' : esc(p.name)}</h1>
      <form class="stack">
        <label>Product name<input name="name" value="${esc(p.name)}" placeholder="e.g. Peak Milk 400g" required maxlength="120"></label>
        <label><span>Code <span class="muted">(optional)</span></span><input name="code" value="${esc(p.code)}" placeholder="Your own code or SKU" maxlength="60"></label>
        <div class="pair">
          <label>Selling price (₦)${moneyInput({ name: 'price', value: p.price, placeholder: '2,500' })}</label>
          <label>Lowest price (₦)${moneyInput({ name: 'lowest', value: p.lowest_price, placeholder: '2,300' })}</label>
        </div>
        <p class="hint muted">Lowest price is optional. Staff can sell at any price between the two (customers haggle). Below the lowest price is allowed but flagged for you.</p>
        <label>Alert when a shop has this many or fewer<input name="alert" type="number" min="0" step="1" inputmode="numeric" value="${p.low_stock_at}" required></label>
        ${shop ? `
        <h2 class="section">In ${esc(shop.name)}</h2>
        <div class="pair">
          <label>Quantity<input name="qty" type="number" min="0" step="1" inputmode="numeric" value="${s ? s.qty : ''}" placeholder="${isNew ? 'e.g. 24' : '0'}"></label>
          ${dateField({ name: 'expires', value: s?.expires_on || '', label: 'Expiry date', empty: 'No expiry date' })}
        </div>
        ${isNew ? '' : '<label><span>Reason for a change <span class="muted">(optional)</span></span><input name="note" placeholder="e.g. 2 tins damaged" maxlength="200"></label>'}` : ''}
        <p class="error" role="alert"></p>
        <button type="submit" class="primary">Save</button>
      </form>
      ${changes.length ? `<h2 class="section">Recent changes in ${esc(shop.name)}</h2>
        <ul class="list">${changes.map((c) => `<li class="card row"><span class="grow"><strong>${WHY[c.reason] || c.reason}</strong> <span class="muted">by ${esc(c.by_name)}</span><br>
          <span class="muted small">${fmtDay(c.created_at, tz)} · ${fmtTime(c.created_at, tz)}${c.note ? ` · “${esc(c.note)}”` : ''}</span></span>
          <span class="qty"><b class="${c.change < 0 ? 'late' : 'ok-text'}">${c.change > 0 ? '+' : ''}${c.change}</b><span class="muted small">now ${c.qty_after}</span></span></li>`).join('')}</ul>` : ''}
      ${isNew ? '' : '<button class="link block" id="hide">Stop selling this product</button>'}
    </main>`, async ({ name, code, price, lowest, alert, qty, expires, note }) => {
    const pr = parseMoney(price), lo = parseMoney(lowest);
    if ((price.trim() && pr === null) || (lowest.trim() && lo === null)) throw new Say('Prices should be numbers, like 2,500.');
    if (lo != null && pr == null) throw new Say('Add the selling price too.');
    if (lo != null && lo > pr) throw new Say('The lowest price must be the same as or below the selling price.');
    const row = { name: name.trim(), code: code.trim() || null, price: pr, lowest_price: lo, low_stock_at: Number(alert) };
    let saved = p;
    try {
      if (isNew) saved = await api.insert('products', { company_id: me.company_id, ...row });
      else await api.update('products', `id=eq.${p.id}`, row);
    } catch (x) {
      if (x.code === '23505') throw new Say(/code/.test(x.message) ? 'Another product already has this code.' : 'You already have a product with this name.');
      throw x;
    }
    const qtyChanged = shop && qty !== '' && (!s || Number(qty) !== s.qty);
    const expChanged = shop && (expires || '') !== (s?.expires_on || '');
    if (qtyChanged || (expChanged && expires)) {
      await api.rpc('set_stock', { p_branch: shop.id, p_product: saved.id, p_qty: qty === '' ? s?.qty ?? 0 : Number(qty), p_expires_on: expires || null, p_note: note || null });
    }
    if (expChanged && !expires && s) await api.rpc('clear_expiry', { p_branch: shop.id, p_product: saved.id });
    toast(isNew ? `${row.name} added` : 'Saved');
    go('#/stock/' + (shop?.id || ''));
  });
  const hide = document.getElementById('hide');
  if (hide) {
    hide.onclick = async () => {
      if (!(await ask(`Stop selling ${p.name}? It disappears from the stock list and the till. Its history is kept.`, { ok: 'Stop selling', danger: true }))) return;
      try { await api.update('products', `id=eq.${p.id}`, { active: false }); toast(`${p.name} hidden`); go('#/stock'); } catch (x) { toast(friendly(x)); }
    };
  }
}

// ── Import from Excel or CSV ────────────────────────────────
export function downloadTemplate() {
  const rows = [TEMPLATE_HEADER,
    ['Peak Milk 400g', 'PM400', 24, 2500, 2300, '01/03/2027', 6],
    ['Indomie Chicken 70g', '', 120, 250, 220, '', 30]];
  saveFile(new Blob(xlsxParts('Stock', rows, [28, 10, 10, 16, 22, 12, 30]), { type: XLSX_TYPE }), 'Pinga-stock-template.xlsx');
}

export async function importScreen(me, tabs) {
  const shops = await myShops(me);
  if (!shops.length) { noShops(me, tabs); return wireSignOut(); }
  const shop = pickShop(shops);
  pending = null;
  show(`
    <main class="page narrow">
      ${backLink('#/stock', 'Stock')}
      <h1>Import stock</h1>
      <form class="stack">
        ${shops.length > 1 ? `<label>Shop<select name="shop">${shops.map((b) => `<option value="${b.id}"${b.id === shop.id ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>`
          : `<input type="hidden" name="shop" value="${shop.id}"><p class="muted">Into <strong>${esc(shop.name)}</strong></p>`}
        <fieldset class="choices"><legend>What is this file?</legend>
          <label class="choice"><input type="radio" name="kind" value="count"><span><strong>This is a stock count</strong><br><span class="muted">The numbers in the file replace what's recorded. Products not in the file stay as they are.</span></span></label>
          <label class="choice"><input type="radio" name="kind" value="delivery"><span><strong>This is a delivery</strong><br><span class="muted">The numbers in the file are added to what's in the shop.</span></span></label>
        </fieldset>
        <label>Excel or CSV file<input name="file" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"></label>
        <p class="hint muted">Columns: product name and quantity. Optional: code, selling price, lowest price, expiry date, alert level. Your own column names usually work.</p>
        <p class="error" role="alert"></p>
        <button type="submit" class="primary">Check the file</button>
      </form>
      <button class="secondary" id="tpl">Download the template</button>
    </main>`, async ({ shop: sid, kind, file }) => {
    if (!kind) throw new Say('Choose "stock count" or "delivery".');
    if (!file || !file.size) throw new Say('Choose a file.');
    if (file.size > 5e6) throw new Say('That file is too big. Up to 5 MB, please.');
    let rows;
    try { rows = await readFile(file); } catch (x) {
      if (x.message === 'old-excel') throw new Say('This is an old Excel file (.xls). In Excel, choose File → Save As → Excel Workbook (.xlsx), then try again.');
      throw new Say("Can't read this file. Save it as Excel (.xlsx) or CSV and try again.");
    }
    const list = readStockList(rows);
    if (list.missing.length) throw new Say(`Can't find the ${list.missing.join(' and ')} column${list.missing.length > 1 ? 's' : ''}. Put the column names in the first row (see the template).`);
    if (!list.items.length) throw new Say(list.problems.length ? `No rows can be imported. ${list.problems.slice(0, 3).join(' ')}` : 'The file has no products.');
    if (list.items.length > 5000) throw new Say('Up to 5,000 products per file, please. Split it into smaller files.');
    pending = { shop: shops.find((b) => b.id === sid) || shop, kind, fileName: file.name, ...list };
    shopId = pending.shop.id;
    await preview(me);
  });
  document.getElementById('tpl').onclick = downloadTemplate;
}

async function preview(me) {
  const x = pending;
  const [products, stock] = await Promise.all([
    api.select('products', `select=id,name,code&company_id=eq.${me.company_id}`),
    api.select('stock', `select=product_id,qty&branch_id=eq.${x.shop.id}`),
  ]);
  const byCode = new Map(products.filter((p) => p.code).map((p) => [p.code.trim().toLowerCase(), p]));
  const byName = new Map(products.map((p) => [p.name.trim().toLowerCase(), p]));
  const qtyOf = new Map(stock.map((s) => [s.product_id, s.qty]));
  const find = (i) => (i.code && byCode.get(i.code.toLowerCase())) || (i.name && byName.get(i.name.toLowerCase()));
  const fresh = x.items.filter((i) => !find(i)).length;
  const units = x.items.reduce((t, i) => t + i.qty, 0);
  const count = x.kind === 'count';
  const line = (i) => {
    const p = find(i), was = p ? qtyOf.get(p.id) ?? 0 : 0;
    const after = count ? i.qty : was + i.qty;
    return `<li class="brow"><span class="grow"><span><strong>${esc(i.name || p?.name || i.code)}</strong>${p ? '' : ' <span class="pill info">New</span>'}</span>
      <span class="muted small">${i.price != null ? naira(i.price) : ''}${i.expires_on ? ` · Exp ${fmtDate(i.expires_on)}` : ''}</span></span>
      <span class="qty"><b>${after.toLocaleString('en-NG')}</b><span class="muted small">${count ? `was ${was}` : `${was} + ${i.qty}`}</span></span></li>`;
  };
  show(`
    <main class="page narrow">
      <button class="link back" id="again">Choose another file</button>
      <h1>Check before importing</h1>
      <div class="card stack">
        <p><strong>${esc(x.fileName)}</strong> → ${esc(x.shop.name)}<br>
          <span class="muted">${count ? 'Stock count: these numbers replace what is recorded.' : 'Delivery: these numbers are added.'}</span></p>
        <p class="big-line"><b>${plural(x.items.length, 'product')}</b> · ${plural(units, 'item')}${fresh ? ` · ${fresh} new` : ''}</p>
      </div>
      ${x.problems.length ? `<div class="banner warn" role="alert"><strong>${plural(x.problems.length, 'row')} can't be imported and will be skipped:</strong>
        <ul class="problems">${x.problems.slice(0, 20).map((t) => `<li>${esc(t)}</li>`).join('')}${x.problems.length > 20 ? `<li>…and ${x.problems.length - 20} more</li>` : ''}</ul>
        <span class="small">Fix them in the file and import again, or carry on without them.</span></div>` : ''}
      <ul class="board">${x.items.slice(0, 50).map(line).join('')}</ul>
      ${x.items.length > 50 ? `<p class="muted center small">…and ${x.items.length - 50} more</p>` : ''}
      <form class="stack">
        <p class="error" role="alert"></p>
        <button type="submit" class="primary">${count ? `Save the count for ${plural(x.items.length, 'product')}` : `Add ${plural(units, 'item')} to ${esc(x.shop.name)}`}</button>
      </form>
    </main>`, async () => {
    const r = await api.rpc('import_stock', { p_branch: x.shop.id, p_kind: x.kind, p_file_name: x.fileName, p_rows: x.items });
    pending = null;
    toast(`Imported ${plural(r.rows, 'product')}${r.new_products ? ` (${r.new_products} new)` : ''}`);
    go('#/stock/' + x.shop.id);
  });
  document.getElementById('again').onclick = () => go('#/import');
}

// ── Every import, newest first ──────────────────────────────
export async function importLog(me) {
  const tz = me.companies.timezone;
  const [list, shops] = await Promise.all([
    api.select('stock_imports', `select=kind,file_name,rows,new_products,units,by_name,created_at,branch_id&company_id=eq.${me.company_id}&order=created_at.desc&limit=100`),
    api.select('branches', `select=id,name&company_id=eq.${me.company_id}`),
  ]);
  const shopName = new Map(shops.map((b) => [b.id, b.name]));
  show(`
    <main class="page narrow">
      ${backLink('#/stock', 'Stock')}
      <h1>Import history</h1>
      ${list.length ? `<ul class="list">${list.map((i) => `
        <li class="card row"><span class="grow"><strong>${i.kind === 'count' ? 'Stock count' : 'Delivery'}</strong> · ${esc(shopName.get(i.branch_id) || '')}<br>
          <span class="muted">${esc(i.file_name)}</span><br>
          <span class="muted small">${fmtDay(i.created_at, tz)} · ${fmtTime(i.created_at, tz)} · ${esc(i.by_name)}</span></span>
          <span class="qty"><b>${plural(i.rows, 'product')}</b><span class="muted small">${plural(i.units, 'item')}${i.new_products ? ` · ${i.new_products} new` : ''}</span></span></li>`).join('')}</ul>`
        : '<p class="muted center empty">No imports yet.</p>'}
    </main>`);
}


// ── Sales (owners and the shop's managers) ──────────────────
const PAYM = { cash: 'Cash', transfer: 'Transfer', card: 'POS card' };
const SALE_FLAG = { below_lowest: 'Below lowest price', out_of_stock: 'Sold when out of stock', clock_changed: 'Phone clock was changed' };
let salesDay = null;

export async function shopSales(me, arg) {
  const shops = await myShops(me);
  const shop = pickShop(shops, arg);
  if (!shop) return go('#/stock');
  const tz = me.companies.timezone;
  const today = localDate(new Date(), tz);
  const day = salesDay || today;
  const [sum, list] = await Promise.all([
    api.rpc('shop_sales_summary', { p_branch: shop.id, p_day: day }),
    api.select('sales', `select=id,happened_at,seller_name,total,discount,flags,payment_method,receipt_code,cancelled_at,cancelled_by_name,mistake_note,sale_items(product_name,qty,line)&branch_id=eq.${shop.id}&local_date=eq.${day}&order=happened_at.desc`),
  ]);
  const first = list.filter((x) => !x.cancelled_at && (x.mistake_note || x.flags.length));
  const items = (x) => [...x.sale_items].sort((a, b) => a.line - b.line).map((i) => `${i.qty} × ${esc(i.product_name)}`).join(', ');
  const pills = (x) => (x.cancelled_at ? `<span class="pill bad">Cancelled${x.cancelled_by_name ? ` by ${esc(x.cancelled_by_name)}` : ''}</span>`
    : `${x.mistake_note ? '<span class="pill info">Mistake reported</span> ' : ''}${x.flags.map((f) => `<span class="pill warn">${SALE_FLAG[f] || f}</span>`).join(' ')}`);
  const row = (x) => `
    <tr class="sale${x.cancelled_at ? ' cancelled' : ''}" data-href="#/sale/${x.id}">
      <td class="main"><a href="#/sale/${x.id}"><strong>${fmtTime(x.happened_at, tz)}</strong></a>
        <span class="sub muted small">${esc(x.seller_name)} · ${PAYM[x.payment_method] || 'Cash'}</span>
        <span class="sub muted small">${items(x)}</span><span class="sub">${pills(x)}</span>
        <span class="sub tab muted small">${esc(x.receipt_code || '')} · ${esc(x.seller_name)}</span><span class="sub tab">${pills(x)}</span></td>
      <td class="d dx">${esc(x.receipt_code || '')}</td>
      <td class="d dx">${esc(x.seller_name)}</td>
      <td class="d wrap">${items(x)}</td>
      <td class="d">${PAYM[x.payment_method] || 'Cash'}</td>
      <td class="d dx wrap">${pills(x)}</td>
      <td class="end qty"><b>${naira(x.total)}</b>${Number(x.discount) ? `<span class="muted small">−${naira(x.discount)}</span>` : ''}</td>
    </tr>`;
  const table = (rows) => `<div class="tablewrap"><table class="rtable sales">
    <thead><tr><th>Time</th><th class="d dx">Receipt</th><th class="d dx">Sold by</th><th class="d">Items</th><th class="d">Paid by</th><th class="d dx">To check</th><th class="num">Total</th></tr></thead>
    <tbody>${rows.map(row).join('')}</tbody></table></div>`;
  show(`
    <main class="page">
      ${backLink('#/stock/' + shop.id, 'Stock')}
      <h1>Sales · ${esc(shop.name)}</h1>
      <div class="dayrow">${dateField({ id: 'day', value: day, max: today, label: 'Date', hideLabel: true })}</div>
      <div class="card block">
        <p class="big-line"><b>${naira(sum?.total || 0)}</b> · ${plural(sum?.sales || 0, 'sale')}</p>
        <p class="muted">${Number(sum?.discount) ? `Discounts given: ${naira(sum.discount)}` : 'No discounts'}${sum?.cancelled ? ` · ${sum.cancelled} cancelled` : ''}</p>
        ${(() => { const live = list.filter((s) => !s.cancelled_at); const by = (k) => live.filter((s) => (s.payment_method || 'cash') === k).reduce((t, s) => t + Number(s.total), 0);
          const used = Object.entries(PAYM).filter(([k]) => by(k)); return used.length ? `<p class="methods">${used.map(([k, t]) => `<span><span class="muted">${t}</span> <b>${naira(by(k))}</b></span>`).join('')}</p>` : ''; })()}
      </div>
      ${first.length ? `<h2 class="section">To check (${first.length})</h2>${table(first)}<h2 class="section">All sales</h2>` : ''}
      ${list.length ? table(list) : '<p class="muted center empty">No sales on this day.</p>'}
    </main>`);
  document.getElementById('day').onchange = (e) => { salesDay = e.target.value || null; shopSales(me, shop.id); };
}

export async function saleDetail(me, id) {
  const tz = me.companies.timezone;
  const [x] = await api.select('sales', `select=*,sale_items(*)&id=eq.${encodeURIComponent(id)}`);
  if (!x) return go('#/stock');
  const lines = [...x.sale_items].sort((a, b) => a.line - b.line);
  show(`
    <main class="page narrow">
      ${backLink('#/sales/' + x.branch_id, 'Sales')}
      <h1>${naira(x.total)}</h1>
      <p class="muted">${esc(x.receipt_code)} · ${fmtDay(x.happened_at, tz)} · ${fmtTime(x.happened_at, tz)} · sold by ${esc(x.seller_name)} · ${PAYM[x.payment_method] || 'Cash'}</p>
      <p><a href="r.html#${esc(x.receipt_token)}" target="_blank" rel="noopener">Open the receipt</a></p>
      ${x.flags.includes('clock_changed') ? '<p class="banner">The phone clock was changed: the time may not be right.</p>' : ''}
      <ul class="board">${lines.map((i) => `
        <li class="brow"><span class="grow"><strong>${i.qty} × ${esc(i.product_name)}</strong>
          <span class="muted small">${naira(i.unit_price)} each${i.list_price != null && Number(i.unit_price) !== Number(i.list_price) ? ` (price list: ${naira(i.list_price)}${i.lowest_price != null ? `, lowest ${naira(i.lowest_price)}` : ''})` : ''}</span>
          ${i.flags.map((f) => `<span class="pill warn">${SALE_FLAG[f] || f}${f === 'out_of_stock' ? ` (${Math.max(0, i.stock_before ?? 0)} in stock)` : ''}</span>`).join(' ')}</span>
          <span class="qty"><b>${naira(i.qty * i.unit_price)}</b></span></li>`).join('')}</ul>
      ${x.mistake_note ? `<div class="banner tip"><strong>${esc(x.seller_name)} reported a mistake:</strong> “${esc(x.mistake_note)}”<br><span class="small">${fmtTime(x.mistake_at, tz)}. If the sale is wrong, cancel it and ask them to record it again.</span></div>` : ''}
      ${x.cancelled_at ? `<div class="banner bad-banner">Cancelled by ${esc(x.cancelled_by_name)}, ${fmtDay(x.cancelled_at, tz)} ${fmtTime(x.cancelled_at, tz)}: “${esc(x.cancel_reason)}”. The stock went back.</div>`
        : `<form class="stack">
            <label>Reason for cancelling<input name="reason" placeholder="e.g. wrong quantity, customer returned it" maxlength="300"></label>
            <p class="error" role="alert"></p>
            <button type="submit" class="danger">Cancel this sale</button>
            <p class="hint muted">The products go back into stock. Who cancelled it and why are kept.</p>
          </form>`}
    </main>`, async ({ reason }) => {
    if (!reason.trim()) throw new Say('Please say why the sale is cancelled.');
    await api.rpc('cancel_sale', { p_sale: x.id, p_reason: reason.trim() });
    toast('Sale cancelled · stock put back');
    saleDetail(me, id);
  });
}
