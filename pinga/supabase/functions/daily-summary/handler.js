// Evening summary email to each company's owner. Runs every hour (Supabase schedule);
// sends once a day per company after 7 pm local time. Plain JS: runs on Supabase (Deno) and in Node tests.

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
export const keyHeaders = (key) => (key.startsWith('sb_') ? { apikey: key } : { apikey: key, authorization: `Bearer ${key}` });

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const list = (names, max = 6) => (names.length > max ? `${names.slice(0, max).join(', ')} and ${names.length - max} more` : names.join(', '));

// The words of the email. Short: the owner should get the day in a glance.
export function formatSummary(c, appUrl) {
  const day = new Date(c.day + 'T12:00:00Z').toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const lines = [];
  lines.push(`${c.present} of ${c.people} present${c.late.length ? `, ${c.late.length} late` : ''}${c.absent.length ? `, ${c.absent.length} not in` : ''}${c.away ? `, ${c.away} on leave or off` : ''}.`);
  if (c.late.length) lines.push(`Late: ${list(c.late.map((x) => `${x.name} (${x.minutes} min)`))}.`);
  if (c.absent.length) lines.push(`Not in: ${list(c.absent)}.`);
  if (c.visits_planned) {
    lines.push(`Store visits: ${c.visits_done} of ${c.visits_planned} done.`);
    if (c.below_target.length) lines.push(`Below target: ${list(c.below_target.map((x) => `${x.name} (${x.visits} of ${x.target})`))}.`);
  }
  const faces = c.face_mismatches || [];
  if (faces.length) lines.push(`Face didn't match: ${list(faces.map((x) => `${x.name} (${x.what})`))}. Please check the photos.`);
  if (c.to_review) lines.push(`${plural(c.to_review, 'check-in')} flagged for review.`);
  const subject = `${c.company} · ${day}: ${c.present} of ${c.people} present${c.late.length ? `, ${c.late.length} late` : ''}`;
  const text = [`${c.company}, ${day}`, '', ...lines, '', appUrl ? `Open Pinga: ${appUrl}` : '', '', 'You can turn this email off in Pinga under Setup.'].join('\n');
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:16px;line-height:1.5;color:#1d1d1f;max-width:520px">
<p style="color:#6e6e73;margin:0 0 4px">${esc(c.company)} · ${esc(day)}</p>
${lines.map((l, i) => `<p style="margin:0 0 10px${i === 0 ? ';font-size:20px;font-weight:600' : ''}">${esc(l)}</p>`).join('')}
${appUrl ? `<p style="margin:18px 0"><a href="${esc(appUrl)}" style="background:#0b7a5c;color:#fff;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:600">Open Pinga</a></p>` : ''}
<p style="color:#6e6e73;font-size:13px">You can turn this email off in Pinga under Setup.</p></div>`;
  return { subject, text, html };
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
      if (!c.to.length || !c.people) {
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
