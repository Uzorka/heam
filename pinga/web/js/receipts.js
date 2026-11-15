// Receipt links for shop staff: made on the phone (so a sale has its link even with no signal),
// shared on WhatsApp or copied. Receipts asked for while offline wait here and are offered again
// as soon as their sale has reached the server.
import { normalizePhone } from './phone.js';
import { publicBase } from './device.js';

const PENDING = 'pinga.receipts';

// 24 random bytes → 32 URL-safe characters. Unguessable.
export function makeToken() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_');
}

// The receipt page sits next to the app: …/r.html#<token> (the part after # is never sent to the server).
export const receiptUrl = (token, base = publicBase()) => `${base}r.html#${token}`;

export const naira = (n) => '₦' + Number(n).toLocaleString('en-NG', { maximumFractionDigits: 2 });

export function receiptMessage({ business, shop, number, total, url }) {
  return `Thank you for shopping at ${business}${shop ? ` (${shop})` : ''}. Your receipt${number ? ` ${number}` : ''} for ${naira(total)}: ${url}`;
}

// wa.me with the customer's number if given (opens their chat), otherwise WhatsApp asks who to send to.
export function whatsappHref(phone, text) {
  const p = phone ? normalizePhone(phone) : null;
  return `https://wa.me/${p ? p.slice(1) : ''}?text=${encodeURIComponent(text)}`;
}

// ── Receipts waiting for signal ─────────────────────────────
const read = () => { try { return JSON.parse(localStorage.getItem(PENDING)) || []; } catch { return []; } };
const write = (list) => { try { localStorage.setItem(PENDING, JSON.stringify(list)); } catch { /* full or private */ } };
export const pendingReceipts = (memberId) => read().filter((r) => r.member_id === memberId);
export function queueReceipt(r) { write([...read().filter((x) => x.token !== r.token), r]); }
export function dropReceipt(token) { write(read().filter((x) => x.token !== token)); }
