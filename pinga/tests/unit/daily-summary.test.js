import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, formatSummary } from '../../supabase/functions/daily-summary/handler.js';

const content = {
  company: 'CHF Heron', day: '2026-11-13', to: ['owner@chfheron.com'], people: 12, present: 8,
  late: [{ name: 'Sade Bello', minutes: 40 }, { name: 'Tunde Ade', minutes: 18 }], absent: ['Kemi Obi'], away: 1,
  visits_done: 9, visits_planned: 12, below_target: [{ name: 'Remi Okafor', visits: 1, target: 4 }], to_review: 2,
};

test('the email gives the day at a glance', () => {
  const { subject, text, html } = formatSummary(content, 'https://staging.elvisuzorka.com');
  assert.equal(subject, 'CHF Heron · Fri, 13 Nov: 8 of 12 present, 2 late');
  assert.match(text, /8 of 12 present, 2 late, 1 not in, 1 on leave or off\./);
  assert.match(text, /Late: Sade Bello \(40 min\), Tunde Ade \(18 min\)\./);
  assert.match(text, /Not in: Kemi Obi\./);
  assert.match(text, /Store visits: 9 of 12 done\./);
  assert.match(text, /Below target: Remi Okafor \(1 of 4\)\./);
  assert.match(text, /2 check-ins flagged for review\./);
  assert.match(html, /Open Pinga/);
  assert.ok(!/Face didn't match/.test(text), 'no face line when there are no mismatches');
});

test('face mismatches are listed in the email', () => {
  const { text } = formatSummary({ ...content, face_mismatches: [{ name: 'Sade Bello', what: 'clock-in' }, { name: 'Remi Okafor', what: 'visit to Shoprite Ikeja' }] });
  assert.match(text, /Face didn't match: Sade Bello \(clock-in\), Remi Okafor \(visit to Shoprite Ikeja\)\. Please check the photos\./);
});

test('names are made safe in the email, and long lists are shortened', () => {
  const many = Array.from({ length: 9 }, (_, i) => `Person <b>${i}</b>`);
  const { html, text } = formatSummary({ ...content, absent: many, late: [], below_target: [], to_review: 0, visits_planned: 0 });
  assert.ok(!html.includes('<b>0</b>'), 'no raw HTML from names');
  assert.match(text, /and 3 more\./);
  assert.ok(!/Store visits/.test(text), 'no visits line for an office-only company');
});

function fake({ keyOk = true, due = [{ company_id: 'c1', day: '2026-11-13' }], c = content, resend = 200 } = {}) {
  const calls = [];
  const fetchFn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, headers: init.headers });
    const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
    if (url.endsWith('/summary_key_ok')) return ok(keyOk);
    if (url.endsWith('/summaries_due')) return ok(due);
    if (url.endsWith('/summary_content')) return ok(c);
    if (url.endsWith('/summary_logged')) return ok(null);
    if (url === 'https://api.resend.com/emails') return new Response('{"id":"e1"}', { status: resend });
    throw new Error('unexpected ' + url);
  };
  return { calls, fetchFn };
}
const env = { url: 'https://p.supabase.co', key: 'sb_secret_x', resendKey: 're_test', appUrl: 'https://staging.elvisuzorka.com' };
const req = (key = 'k') => new Request('https://fn', { method: 'POST', headers: { 'x-summary-key': key } });

test('sends one email per company that is due, then logs it', async () => {
  const f = fake();
  const res = await handle(req(), env, f.fetchFn);
  assert.deepEqual(await res.json(), { sent: 1, failed: 0, skipped: 0 });
  const mail = f.calls.find((c) => c.url === 'https://api.resend.com/emails');
  assert.deepEqual(mail.body.to, ['owner@chfheron.com']);
  assert.equal(mail.headers.authorization, 'Bearer re_test');
  assert.equal(mail.body.from, 'Pinga <onboarding@resend.dev>');
  const log = f.calls.find((c) => c.url.endsWith('/summary_logged'));
  assert.equal(log.body.p_ok, true);
});

test('refuses callers without the schedule key', async () => {
  const f = fake({ keyOk: false });
  assert.equal((await handle(req('guess'), env, f.fetchFn)).status, 401);
  assert.equal((await handle(new Request('https://fn', { method: 'POST' }), env, f.fetchFn)).status, 401);
  assert.ok(!f.calls.some((c) => c.url.includes('resend')));
});

test('does nothing (and logs nothing) until the email key is set up', async () => {
  const f = fake();
  const res = await handle(req(), { ...env, resendKey: undefined }, f.fetchFn);
  assert.match((await res.json()).skipped, /not set up/);
  assert.ok(!f.calls.some((c) => c.url.endsWith('/summary_logged')), 'will try again once set up');
});

test('a failed send is logged as failed; a company with no owner email is skipped', async () => {
  const f = fake({ resend: 422 });
  assert.deepEqual(await (await handle(req(), env, f.fetchFn)).json(), { sent: 0, failed: 1, skipped: 0 });
  assert.equal(f.calls.find((c) => c.url.endsWith('/summary_logged')).body.p_ok, false);
  const g = fake({ c: { ...content, to: [] } });
  assert.deepEqual(await (await handle(req(), env, g.fetchFn)).json(), { sent: 0, failed: 0, skipped: 1 });
  assert.match(g.calls.find((c) => c.url.endsWith('/summary_logged')).body.p_detail, /no owner email/);
});
