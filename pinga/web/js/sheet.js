// Reads a stock list from Excel (.xlsx) or CSV, without a 400 KB library.
// Excel files are zip files of XML; the browser unzips them (DecompressionStream).
// Then works out which column is which from the header row, and checks every row.

const dec = new TextDecoder();

// ── CSV ─────────────────────────────────────────────────────
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  // Excel in some regions saves with semicolons.
  const firstLine = text.slice(0, text.indexOf('\n') >>> 0);
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ── XLSX ────────────────────────────────────────────────────
async function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let end = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('not a zip');
  const count = dv.getUint16(end + 10, true);
  let p = dv.getUint32(end + 16, true);
  const files = new Map();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad zip');
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    files.set(name, { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return async (name) => {
    const f = files.get(name);
    if (!f) return null;
    const start = f.local + 30 + dv.getUint16(f.local + 26, true) + dv.getUint16(f.local + 28, true);
    const raw = u8.subarray(start, start + f.size);
    if (f.method === 0) return dec.decode(raw);
    if (f.method !== 8) throw new Error('unsupported zip');
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return dec.decode(await new Response(stream).arrayBuffer());
  };
}

const unxml = (s) => s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (m, e) => (
  { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[e.toLowerCase()]
  ?? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))));
const texts = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join('');
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

// Returns the first sheet as rows of cell values (strings or numbers).
export async function readXlsx(buf) {
  const get = await unzip(buf);
  const shared = [];
  const ss = await get('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(texts(m[1]));
  // The first sheet in the workbook's order.
  let path = 'xl/worksheets/sheet1.xml';
  const wb = await get('xl/workbook.xml'), rels = await get('xl/_rels/workbook.xml.rels');
  const rid = wb && /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb)?.[1];
  const target = rid && rels && new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1]
    || rid && rels && new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1];
  if (target) path = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
  const sheet = await get(path);
  if (!sheet) throw new Error('no sheet');
  const rows = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row = [];
    for (const cm of (rm[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], body = cm[2] || '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const t = /\bt="([^"]+)"/.exec(attrs)?.[1] || 'n';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let val = '';
      if (t === 's') val = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') val = texts(body);
      else if (t === 'str' || t === 'e') val = v != null ? unxml(v) : '';
      else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
      else val = v != null && v !== '' ? Number(v) : '';
      row[ref ? colIndex(ref) : row.length] = val;
    }
    rows.push(Array.from(row, (x) => x ?? ''));
  }
  return rows;
}

// ── Columns and checks ──────────────────────────────────────
// Header words people actually use, for each column we need.
const COLUMNS = {
  name: /^(product|product name|item|item name|name|description|goods)$/,
  code: /^(code|product code|item code|sku|barcode|id|ref|reference)$/,
  qty: /^(qty|quantity|stock|count|units|in stock|quantity in stock|stock count|amount|no|number|pcs|pieces)$/,
  price: /^(price|selling price|sell price|unit price|retail price|sp|price \(?₦\)?|selling price \(?₦\)?|price \(?ngn\)?|selling price \(?ngn\)?)$/,
  lowest_price: /^(lowest price|lowest allowed price|minimum price|min price|lowest|floor price|lowest price \(?₦\)?|lowest allowed price \(?₦\)?|minimum price \(?₦\)?)$/,
  expires_on: /^(expiry|expiry date|expires|expires on|exp|exp date|best before|use by)$/,
  low_stock_at: /^(alert at|alert when stock is at or below|low stock|low stock alert|reorder level|reorder at|minimum stock|min stock)$/,
};
const norm = (h) => String(h ?? '').toLowerCase().replace(/\s+/g, ' ').replace(/[:*.]/g, '').trim();

export const TEMPLATE_HEADER = ['Product name', 'Code', 'Quantity', 'Selling price (₦)', 'Lowest allowed price (₦)', 'Expiry date', 'Alert when stock is at or below'];

// Excel stores dates as days since 1899-12-30.
const fromSerial = (n) => new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5).toISOString().slice(0, 10);
function toDate(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return v > 20000 && v < 80000 ? fromSerial(v) : undefined;
  const s = String(v).trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);          // 01/03/2027 = 1 March (Nigeria: day first)
  if (m) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[\s-]([a-z]{3})[a-z]*[\s-](\d{2,4})$/i.exec(s);    // 1 Mar 2027
  if (m) { const mon = 'janfebmaraprmayjunjulaugsepoctnovdec'.indexOf(m[2].toLowerCase()) / 3 + 1; if (mon) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], mon, +m[1]); }
  m = /^([a-z]{3})[a-z]*[\s-](\d{4})$/i.exec(s);                    // Mar 2027 → end of month
  if (m) { const mon = 'janfebmaraprmayjunjulaugsepoctnovdec'.indexOf(m[1].toLowerCase()) / 3 + 1; if (mon) return valid(+m[2], mon, new Date(Date.UTC(+m[2], mon, 0)).getUTCDate()); }
  return undefined;
}
function valid(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : undefined;
}
// "₦2,500", "2500.00", "N2,500" → 2500. Blank → null. Not a number → undefined.
function toNumber(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[₦,\s]|^ngn|^n(?=\d)/gi, '');
  if (s === '' || s === '-') return null;
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : undefined;
}

// rows: from parseCSV/readXlsx. Returns { items, problems, missing } where problems are plain-English lines.
export function readStockList(rows) {
  const headAt = rows.findIndex((r) => r.some((c) => Object.values(COLUMNS).some((re) => re.test(norm(c)))));
  if (headAt < 0) return { items: [], problems: [], missing: ['Product name', 'Quantity'] };
  const head = rows[headAt].map(norm);
  const at = {};
  for (const [k, re] of Object.entries(COLUMNS)) { const i = head.findIndex((h) => re.test(h)); if (i >= 0) at[k] = i; }
  const missing = [];
  if (at.name == null && at.code == null) missing.push('Product name');
  if (at.qty == null) missing.push('Quantity');
  if (missing.length) return { items: [], problems: [], missing };
  const items = [], problems = [];
  const seen = new Map();
  rows.slice(headAt + 1).forEach((r, i) => {
    const line = headAt + i + 2;   // the row number people see in Excel
    const get = (k) => (at[k] == null ? '' : r[at[k]] ?? '');
    const name = String(get('name')).trim(), code = String(get('code')).trim();
    if (!name && !code && r.every((c) => String(c).trim() === '')) return;   // blank row
    const say = (msg) => problems.push(`Row ${line}${name ? ` (${name})` : ''}: ${msg}`);
    if (!name && !code) return say('no product name');
    const qty = toNumber(get('qty')), price = toNumber(get('price')), low = toNumber(get('lowest_price')), alert = toNumber(get('low_stock_at'));
    const exp = toDate(get('expires_on'));
    if (qty === null) return say('no quantity');
    if (qty === undefined || qty < 0 || !Number.isInteger(qty)) return say(`quantity "${get('qty')}" should be a whole number, 0 or more`);
    if (price === undefined || price < 0) return say(`selling price "${get('price')}" is not a number`);
    if (low === undefined || low < 0) return say(`lowest price "${get('lowest_price')}" is not a number`);
    if (low != null && price != null && low > price) return say(`lowest price (₦${low.toLocaleString('en-NG')}) is above the selling price (₦${price.toLocaleString('en-NG')})`);
    if (alert === undefined || (alert !== null && (alert < 0 || !Number.isInteger(alert)))) return say(`alert level "${get('low_stock_at')}" should be a whole number`);
    if (exp === undefined) return say(`expiry date "${get('expires_on')}" isn't a date. Use 31/03/2027`);
    const key = (code || name).toLowerCase();
    if (seen.has(key)) return say(`also on row ${seen.get(key)}. Put each product on one row`);
    seen.set(key, line);
    const item = { name: name || null, code: code || null, qty };
    if (price != null) item.price = price;
    if (low != null) item.lowest_price = low;
    if (exp) item.expires_on = exp;
    if (alert != null) item.low_stock_at = alert;
    items.push(item);
  });
  return { items, problems, missing };
}

export async function readFile(file) {
  const isCsv = /\.(csv|txt)$/i.test(file.name) || /csv|text\/plain/.test(file.type);
  if (isCsv) return parseCSV(await file.text());
  if (/\.xls$/i.test(file.name)) throw new Error('old-excel');
  return readXlsx(await file.arrayBuffer());
}
