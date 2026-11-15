// Evening summary email to each company's owner. Runs every hour (Supabase schedule);
// sends once a day per company after 7 pm local time. Plain JS: runs on Supabase (Deno) and in Node tests.

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
export const keyHeaders = (key) => (key.startsWith('sb_') ? { apikey: key } : { apikey: key, authorization: `Bearer ${key}` });

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const naira = (n) => '₦' + Math.round(Number(n)).toLocaleString('en-NG');
const count = (n, one, many = one + 's') => `${Number(n).toLocaleString('en-NG')} ${n === 1 ? one : many}`;
const list = (names, max = 6) => (names.length > max ? `${names.slice(0, max).join(', ')} and ${names.length - max} more` : names.join(', '));
const shortDay = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-NG', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);

// Brand (the same as the app).
const C = { mango: '#FF8A1F', ink: '#14213D', cream: '#FFF8EE', muted: '#5B6478', line: '#F0E6D6', red: '#D93B3B', amber: '#E8A317', green: '#1E7B45' };
const FONT = "'Nunito',-apple-system,'Segoe UI',Roboto,Arial,sans-serif";

// What the email says, worked out once; the HTML and plain-text versions are built from it.
export function summaryParts(c) {
  const sh = c.shops && c.shops.shops.length ? c.shops : null;
  const inNow = c.present + c.late.length;
  const attention = [];   // [colour, text]: red = act now, amber = check
  const add = (level, text) => attention.push([level, text]);
  if (sh) {
    if (sh.mistakes) add('red', `${count(sh.mistakes, 'mistake')} reported by staff`);
    for (const x of sh.below_lowest) add('amber', `${x.product} sold at ${naira(x.price)}, below the lowest price${x.lowest != null ? ` of ${naira(x.lowest)}` : ''} (${x.seller}${sh.shops.length > 1 ? `, ${x.shop}` : ''})`);
    if (sh.out_of_stock_sales) add('amber', `${count(sh.out_of_stock_sales, 'sale')} made while out of stock`);
    if (sh.cancelled) add('amber', `${count(sh.cancelled, 'sale')} cancelled`);
    const out = sh.low_stock.filter((x) => x.qty <= 0);
    if (out.length) add('red', `Out of stock: ${list(out.map((x) => x.product + (sh.shops.length > 1 ? ` (${x.shop})` : '')), 4)}`);
    for (const x of sh.expiring) {
      const d = daysBetween(c.day, x.expires_on);
      if (d < 0) add('red', `${x.product} expired on ${shortDay(x.expires_on)}${sh.shops.length > 1 ? ` (${x.shop})` : ''}`);
      else if (d <= 14) add('amber', `${x.product} expires ${d === 0 ? 'today' : `in ${count(d, 'day')}`}${sh.shops.length > 1 ? ` (${x.shop})` : ''}`);
    }
  }
  for (const x of c.face_mismatches || []) add('red', `${x.name}'s face didn't match (${x.what})`);
  if (c.absent.length) add('red', `${count(c.absent.length, 'person', 'people')} not in`);
  if (c.late.length) add('amber', `${count(c.late.length, 'person', 'people')} late`);
  if (c.visits_planned && c.below_target.length) add('amber', `${count(c.below_target.length, 'sales rep')} below their visit target`);
  if (c.to_review) add('amber', `${count(c.to_review, 'check-in')} flagged for review`);
  // Red first.
  attention.sort((a, b) => (a[0] === b[0] ? 0 : a[0] === 'red' ? -1 : 1));

  const low = sh ? sh.low_stock.filter((x) => x.qty > 0).map((x) => `${x.product}: ${count(x.qty, 'left', 'left')}${sh.shops.length > 1 ? ` (${x.shop})` : ''}`) : [];
  const later = sh ? sh.expiring.filter((x) => daysBetween(c.day, x.expires_on) > 14)
    .map((x) => `${x.product}: expires ${shortDay(x.expires_on)}${sh.shops.length > 1 ? ` (${x.shop})` : ''}`) : [];
  return {
    sh, inNow, attention,
    shops: sh ? sh.shops.map((x) => [x.name, `${naira(x.total)} · ${count(x.sales, 'sale')}`]) : [],
    best: sh ? sh.best.slice(0, 3).map((x) => `${x.name} — ${Number(x.qty).toLocaleString('en-NG')} sold`) : [],
    stock: [...low, ...later],
    attendance: {
      line: [`${inNow} in`, c.late.length ? `${c.late.length} late` : '', c.absent.length ? `${c.absent.length} not in` : '', c.away ? `${c.away} on leave or off` : ''].filter(Boolean).join(' · '),
      late: c.late.map((x) => `${x.name} (${x.minutes} min)`),
      absent: c.absent,
      visits: c.visits_planned ? `Store visits: ${c.visits_done} of ${c.visits_planned} done` : '',
    },
    subject: [c.company, sh ? naira(sh.total) : '', `${inNow} of ${c.people} in`, attention.length ? `${attention.length} to check` : ''].filter(Boolean).join(' · '),
  };
}

// The evening email: mobile-friendly HTML in the Pinga brand, plus a plain-text copy.
export function formatSummary(c, appUrl) {
  const day = new Date(c.day + 'T12:00:00Z').toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const x = summaryParts(c);
  const base = appUrl ? appUrl.replace(/#.*$/, '').replace(/\/?$/, '/') : '';

  // ── Plain text ──
  const t = [`${c.company} · ${day}`, ''];
  t.push([x.sh ? `${naira(x.sh.total)} sales` : '', `${x.inNow} of ${c.people} in`].filter(Boolean).join('   ·   '), '');
  if (x.attention.length) t.push('NEEDS YOUR ATTENTION', ...x.attention.map(([lv, s]) => `${lv === 'red' ? '●' : '○'} ${s}`), '');
  else t.push('All good today 🎉', '');
  if (x.shops.length) t.push('SALES BY SHOP', ...x.shops.map(([a, b]) => `${a}: ${b}`), '');
  if (x.best.length) t.push('BEST SELLERS', ...x.best, '');
  if (x.stock.length) t.push('STOCK', ...x.stock, '');
  t.push('ATTENDANCE', x.attendance.line);
  if (x.attendance.late.length) t.push(`Late: ${list(x.attendance.late)}`);
  if (x.attendance.absent.length) t.push(`Not in: ${list(x.attendance.absent)}`);
  if (x.attendance.visits) t.push(x.attendance.visits);
  t.push('', appUrl ? `Open Pinga: ${appUrl}` : '', '', 'You can turn this email off in Pinga under Setup.');
  const text = t.join('\n');

  // ── HTML (tables and inline styles: what email apps understand) ──
  const card = (title, body) => `
<tr><td style="padding:0 16px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;border:1px solid ${C.line}">
    <tr><td style="padding:16px 18px">
      ${title ? `<div style="font-size:13px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:${C.muted};margin:0 0 10px">${esc(title)}</div>` : ''}
      ${body}
    </td></tr></table></td></tr>`;
  const rows = (items, fn) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items.map((it, i) => `<tr>${fn(it, i)}</tr>`).join('')}</table>`;
  const cell = (i) => `padding:8px 0;${i ? `border-top:1px solid ${C.line};` : ''}font-size:15px;color:${C.ink}`;
  const dot = (lv) => `<span style="display:inline-block;width:10px;height:10px;border-radius:5px;background:${lv === 'red' ? C.red : C.amber};margin-right:10px;vertical-align:middle"></span>`;
  // Each big number in its own tile, side by side.
  const big = (num, label, first) => `<td width="50%" style="vertical-align:top;padding:0 ${first ? '5px' : '0'} 0 ${first ? '0' : '5px'}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream};border-radius:12px"><tr><td style="padding:12px 14px">
      <div style="font-size:26px;line-height:1.15;font-weight:800;color:${C.ink};white-space:nowrap">${esc(num)}</div>
      <div style="font-size:14px;color:${C.muted};font-weight:700">${esc(label)}</div></td></tr></table></td>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(x.subject)}</title></head>
<body style="margin:0;padding:0;background:${C.cream}">
<div style="display:none;max-height:0;overflow:hidden">${esc(x.attention.length ? `${x.attention.length} to check: ${x.attention[0][1]}` : 'All good today')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream}"><tr><td align="center" style="padding:20px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:${FONT};color:${C.ink}">
<tr><td style="padding:0 18px 14px">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    ${base ? `<td style="padding-right:8px;vertical-align:middle"><img src="${esc(base)}icons/icon-192.png" width="28" height="28" alt="" style="display:block;border-radius:7px"></td>` : ''}
    <td style="vertical-align:middle;font-size:22px;font-weight:800;color:${C.ink}">Pinga</td></tr></table>
  <div style="margin-top:10px;font-size:15px;color:${C.muted};font-weight:700">${esc(c.company)} · ${esc(day)}</div>
</td></tr>
${card('', `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  ${x.sh ? big(naira(x.sh.total), 'sales', true) : ''}
  ${big(`${x.inNow} of ${c.people}`, 'in', !x.sh)}
  ${!x.sh && x.attendance.visits ? big(`${c.visits_done} of ${c.visits_planned}`, 'store visits', false) : ''}
</tr></table>`).replace('background:#ffffff;', `background:#ffffff;border-top:4px solid ${C.mango};`)}
${x.attention.length
    ? card('Needs your attention', rows(x.attention, ([lv, s], i) => `<td style="${cell(i)}">${dot(lv)}${esc(s)}</td>`))
    : card('', `<div style="font-size:17px;font-weight:800;color:${C.green}">All good today 🎉</div>`)}
${x.shops.length ? card('Sales by shop', rows(x.shops, ([a, b], i) => `<td style="${cell(i)}">${esc(a)}</td><td align="right" style="${cell(i)};font-weight:800;white-space:nowrap">${esc(b)}</td>`)) : ''}
${x.best.length ? card('Best sellers', rows(x.best, (s, i) => `<td style="${cell(i)}">${esc(s)}</td>`)) : ''}
${x.stock.length ? card('Stock', rows(x.stock, (s, i) => `<td style="${cell(i)}">${esc(s)}</td>`)) : ''}
${card('Attendance', `<div style="font-size:16px;font-weight:800;margin:0 0 6px">${esc(x.attendance.line)}</div>
  ${x.attendance.late.length ? `<div style="font-size:15px;margin:4px 0"><span style="color:${C.muted}">Late:</span> ${esc(list(x.attendance.late))}</div>` : ''}
  ${x.attendance.absent.length ? `<div style="font-size:15px;margin:4px 0"><span style="color:${C.muted}">Not in:</span> ${esc(list(x.attendance.absent))}</div>` : ''}
  ${x.attendance.visits ? `<div style="font-size:15px;margin:4px 0">${esc(x.attendance.visits)}</div>` : ''}`)}
${appUrl ? `<tr><td align="center" style="padding:8px 16px 6px">
  <a href="${esc(appUrl)}" style="display:block;background:${C.mango};color:${C.ink};font-size:18px;font-weight:800;text-decoration:none;padding:16px 20px;border-radius:14px;text-align:center">Open Pinga</a></td></tr>` : ''}
<tr><td align="center" style="padding:10px 16px 0;font-size:12px;color:${C.muted}">You can turn this email off in Pinga under Setup.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: x.subject, text, html };
}

export async function handle(req, env, fetchFn = fetch) {
  const h = { ...keyHeaders(env.key), 'content-type': 'application/json' };
  const rpc = async (fn, args = {}) => {
    const r = await fetchFn(`${env.url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: h, body: JSON.stringify(args) });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${fn}: ${r.status} ${JSON.stringify(data)}`);
    return data;
  };

  const key = req.headers.get('x-summary-key') || '';
  if (!key || !(await rpc('summary_key_ok', { p_key: key }))) return json(401, { error: 'Not allowed' });
  if (!env.resendKey) return json(200, { skipped: 'Email is not set up yet (RESEND_API_KEY).' });

  const due = await rpc('summaries_due');
  const result = { sent: 0, failed: 0, skipped: 0 };
  for (const { company_id, day } of due) {
    try {
      const c = await rpc('summary_content', { p_company: company_id, p_day: day });
      if (!c.to.length || (!c.people && !(c.shops && c.shops.sales))) {
        await rpc('summary_logged', { p_company: company_id, p_day: day, p_ok: false, p_detail: !c.to.length ? 'no owner email' : 'nobody to report on' });
        result.skipped++;
        continue;
      }
      const { subject, text, html } = formatSummary(c, env.appUrl);
      const r = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.resendKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: env.from || 'Pinga <onboarding@resend.dev>', to: c.to, subject, text, html }),
      });
      const detail = await r.text();
      await rpc('summary_logged', { p_company: company_id, p_day: day, p_ok: r.ok, p_detail: detail });
      if (r.ok) result.sent++; else result.failed++;
    } catch (e) {
      result.failed++;
      await rpc('summary_logged', { p_company: company_id, p_day: day, p_ok: false, p_detail: String(e.message || e) }).catch(() => {});
    }
  }
  return json(200, result);
}
