// Printing a receipt with the device's own print window (the person picks their printer there).
// One layout for 58 mm and 80 mm thermal rolls and for A4: black and white, no backgrounds, the business logo on top.
// Used by the till, the sales list and the receipt page (r.html). No app screen code here.
import { when, naira, PAY, properFirst } from './receipt-lines.js';
import { printPage } from './device.js';

export const PAPER = { 58: '58 mm roll', 80: '80 mm roll', a4: 'A4 paper' };

// Paper width and margins. Thermal printers print about 48 mm on 58 mm paper, 72 mm on 80 mm paper.
const PAGE = {
  58: { page: '58mm auto', margin: '0', width: '48mm', font: '9pt', big: '12pt', logo: '14mm' },
  80: { page: '80mm auto', margin: '0', width: '72mm', font: '10pt', big: '14pt', logo: '18mm' },
  a4: { page: 'A4', margin: '15mm', width: '120mm', font: '11pt', big: '16pt', logo: '24mm' },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const css = (p) => `
@page { size: ${p.page}; margin: ${p.margin}; }
@media screen { #print-area { display: none; } }
@media print {
  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
  body > *:not(#print-area) { display: none !important; }
  #print-area { display: block; width: ${p.width}; margin: 0 auto; padding: 3mm 0 6mm; color: #000; background: #fff;
    font: ${p.font}/1.35 Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  #print-area * { color: #000 !important; background: transparent !important; box-shadow: none !important; }
  #print-area .c { text-align: center; }
  #print-area img { display: block; margin: 0 auto 2mm; max-height: ${p.logo}; max-width: 70%; object-fit: contain; filter: grayscale(1) contrast(1.4); }
  #print-area .biz { font-size: ${p.big}; font-weight: 700; margin: 0; }
  #print-area p { margin: 0; }
  #print-area .rule { border-top: 1px dashed #000; margin: 2mm 0; }
  #print-area .row { display: flex; justify-content: space-between; gap: 2mm; }
  #print-area .row span:last-child { text-align: right; white-space: nowrap; }
  #print-area .name { font-weight: 700; margin-top: 1mm; }
  #print-area .total { font-size: ${p.big}; font-weight: 700; }
  #print-area .flag { border: 1.5px solid #000; text-align: center; font-weight: 700; padding: 1mm; margin: 0 0 2mm; letter-spacing: .1em; }
  #print-area .strike { text-decoration: line-through; }
  #print-area .small { font-size: 0.85em; }
}`;

// The receipt as print HTML. r: the receipt (as the receipt link has it). reprint: printed again later.
export function receiptHtml(r, { reprint = false, logo = '' } = {}) {
  const t = when(r);
  const parts = Array.isArray(r.payments) && r.payments.length > 1
    ? r.payments.map((x) => `<div class="row"><span>  ${esc(PAY[x.method] || x.method)}</span><span>${naira(x.amount)}</span></div>`).join('') : '';
  return `
    ${r.cancelled ? '<p class="flag">CANCELLED</p>' : ''}
    ${reprint ? '<p class="flag">REPRINT</p>' : ''}
    <div class="c">
      ${logo ? `<img src="${esc(logo)}" alt="">` : ''}
      <p class="biz">${esc(r.business)}</p>
      ${r.shop ? `<p>${esc(r.shop)}</p>` : ''}
      ${r.address ? `<p class="small">${esc(r.address)}</p>` : ''}
      ${r.phone ? `<p class="small">${esc(r.phone)}</p>` : ''}
    </div>
    <div class="rule"></div>
    <div class="row"><span>Receipt</span><span><b>${esc(r.number || 'Number on the receipt link')}</b></span></div>
    <div class="row"><span>${esc(t.date)}</span><span>${esc(t.time)}</span></div>
    ${r.served_by ? `<div class="row"><span>Served by</span><span>${esc(properFirst(r.served_by))}</span></div>` : ''}
    ${r.customer ? `<div class="row"><span>Customer</span><span>${esc(r.customer)}</span></div>` : ''}
    <div class="rule"></div>
    ${r.items.map((i) => `<p class="name">${esc(i.name)}</p><div class="row"><span>  ${i.qty} × ${naira(i.price)}</span><span>${naira(i.qty * i.price)}</span></div>`).join('')}
    <div class="rule"></div>
    ${Number(r.discount) ? `<div class="row"><span>Discount</span><span>−${naira(r.discount)}</span></div>` : ''}
    <div class="row total"><span>Total</span><span class="${r.cancelled ? 'strike' : ''}">${naira(r.total)}</span></div>
    <div class="row"><span>Paid by</span><span>${esc(r.payment === 'split' ? 'Split' : PAY[r.payment] || r.payment || 'Cash')}</span></div>
    ${parts}
    <div class="rule"></div>
    ${r.note ? `<p class="c">${esc(r.note)}</p>` : ''}
    <p class="c small">Receipt by Pinga</p>`;
}

// Opens the print window for this receipt. paper: '58' | '80' | 'a4' (the shop's setting; 80 mm if unknown).
export async function printReceipt(r, { paper = '80', reprint = false, logo = '' } = {}) {
  const p = PAGE[paper] || PAGE[80];
  document.getElementById('print-area')?.remove();
  document.getElementById('print-css')?.remove();
  const style = document.createElement('style');
  style.id = 'print-css';
  style.textContent = css(p);
  const area = document.createElement('div');
  area.id = 'print-area';
  area.innerHTML = receiptHtml(r, { reprint, logo });
  document.head.append(style);
  document.body.append(area);
  // Wait for the logo, so it is on the paper (but never block printing on a slow connection).
  const img = area.querySelector('img');
  if (img && !img.complete) await new Promise((ok) => { img.onload = img.onerror = ok; setTimeout(ok, 2500); });
  const tidy = () => { area.remove(); style.remove(); removeEventListener('afterprint', tidy); };
  addEventListener('afterprint', tidy);
  printPage();
}
