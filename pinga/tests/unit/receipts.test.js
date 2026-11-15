import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiptLines, when } from '../../web/js/receipt-lines.js';

// receipts.js reads localStorage/location only when called; give Node simple stand-ins.
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { makeToken, receiptUrl, whatsappHref, receiptMessage, queueReceipt, pendingReceipts, dropReceipt } = await import('../../web/js/receipts.js');

const r = {
  business: 'Mama Put Stores', shop: 'Yaba shop', address: '12 Herbert Macaulay Way', phone: '0803 000 0001',
  number: 'YAB-000123', at: '2026-11-15T13:05:00Z', timezone: 'Africa/Lagos', served_by: 'Kemi',
  items: [{ name: 'Peak Milk 400g', qty: 2, price: 2400 }, { name: 'Indomie Chicken 70g', qty: 4, price: 250 }],
  discount: 200, total: 5800, payment: 'transfer', note: 'Thank you! Come again.', cancelled: false,
};

test('receipt lines: shop, number, date and time (Lagos), staff, items, discount, total, payment, note', () => {
  const lines = receiptLines(r);
  const text = lines.map((l) => (l.rule ? '---' : l.text ?? `${l.left} | ${l.right}`)).join('\n');
  assert.equal(text, [
    'Mama Put Stores', 'Yaba shop', '12 Herbert Macaulay Way', '0803 000 0001', '---',
    'Receipt | YAB-000123', `${when(r).date} | 2:05 pm`, 'Served by | Kemi', '---',
    'Peak Milk 400g', '  2 × ₦2,400 | ₦4,800', 'Indomie Chicken 70g', '  4 × ₦250 | ₦1,000', '---',
    'Discount | −₦200', 'Total | ₦5,800', 'Paid by | Transfer', '---', 'Thank you! Come again.', 'Receipt by Pinga',
  ].join('\n'));
});

test('a cancelled receipt says CANCELLED at the top and strikes the total', () => {
  const lines = receiptLines({ ...r, cancelled: true });
  assert.ok(lines.some((l) => l.text === 'CANCELLED' && l.red));
  assert.equal(lines.find((l) => l.left === 'Total').strike, true);
});

test('receipt links are long and random, and work in a web address', () => {
  const a = makeToken(), b = makeToken();
  assert.match(a, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(a, b);
  assert.equal(receiptUrl(a, 'https://pinga.elvisuzorka.com/'), `https://pinga.elvisuzorka.com/r.html#${a}`);
});

test('WhatsApp: the customer\'s number opens their chat; without it WhatsApp asks who to send to', () => {
  const text = receiptMessage({ business: 'Mama Put Stores', shop: 'Yaba shop', number: 'YAB-000123', total: 5800, url: 'https://x/r.html#t' });
  assert.equal(text, 'Thank you for shopping at Mama Put Stores (Yaba shop). Your receipt YAB-000123 for ₦5,800: https://x/r.html#t');
  assert.match(whatsappHref('0803 123 4567', text), /^https:\/\/wa\.me\/2348031234567\?text=Thank%20you/);
  assert.match(whatsappHref('', text), /^https:\/\/wa\.me\/\?text=/);
});

test('receipts asked for with no signal wait on the phone until sent', () => {
  queueReceipt({ token: 't1', sale_id: 's1', member_id: 'me', total: 100, phone: '' });
  queueReceipt({ token: 't2', sale_id: 's2', member_id: 'someone-else', total: 200 });
  assert.deepEqual(pendingReceipts('me').map((x) => x.token), ['t1']);
  dropReceipt('t1');
  assert.deepEqual(pendingReceipts('me'), []);
});
