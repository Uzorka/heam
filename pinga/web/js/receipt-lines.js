// A receipt as plain lines: the one layout used for the picture ("Save as image") today and,
// later, for printing on a Bluetooth thermal printer (each line maps to a printer command).
// No screen code here.

export const PAY = { cash: 'Cash', transfer: 'Transfer', card: 'POS card' };
export const naira = (n) => '₦' + Number(n).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const properFirst = (n) => { const f = String(n || '').trim(); return f.charAt(0).toUpperCase() + f.slice(1); };

export function when(r) {
  const d = new Date(r.at);
  const opts = { timeZone: r.timezone || 'Africa/Lagos' };
  return {
    date: d.toLocaleDateString('en-NG', { ...opts, day: 'numeric', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('en-NG', { ...opts, hour: 'numeric', minute: '2-digit', hour12: true }),
  };
}

// Each line: { text } or { left, right }, with optional bold, big, center, rule (a divider), gap.
export function receiptLines(r) {
  const t = when(r);
  const lines = [
    { text: r.business, bold: true, big: true, center: true },
    r.shop ? { text: r.shop, center: true } : null,
    r.address ? { text: r.address, center: true, small: true } : null,
    r.phone ? { text: r.phone, center: true, small: true } : null,
    { rule: true },
    r.cancelled ? { text: 'CANCELLED', bold: true, big: true, center: true, red: true } : null,
    { left: 'Receipt', right: r.number, bold: true },
    { left: t.date, right: t.time },
    { left: 'Served by', right: properFirst(r.served_by) },
    { rule: true },
  ];
  for (const i of r.items) {
    lines.push({ text: i.name, bold: true });
    lines.push({ left: `  ${i.qty} × ${naira(i.price)}`, right: naira(i.qty * i.price) });
  }
  lines.push({ rule: true });
  if (Number(r.discount)) lines.push({ left: 'Discount', right: '−' + naira(r.discount) });
  lines.push({ left: 'Total', right: naira(r.total), bold: true, big: true, strike: r.cancelled });
  lines.push({ left: 'Paid by', right: PAY[r.payment] || r.payment });
  lines.push({ rule: true });
  if (r.note) lines.push({ text: r.note, center: true });
  lines.push({ text: 'Receipt by Pinga', center: true, small: true });
  return lines.filter(Boolean);
}
