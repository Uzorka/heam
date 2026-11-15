// Export the attendance register for a period: real Excel (.xlsx), or a clean page to save as PDF.
import { saveFile, printPage } from './device.js';
import * as api from './api.js';
import { show, esc, Say, wireSignOut, app, ROLE, fmtTime, fmtDay, localDate, backLink, dateField } from './ui.js';
import { xlsxParts, XLSX_TYPE } from './xlsx.js';

const STATUS = { present: 'Present', late: 'Late', absent: 'Absent', none: 'No check-in', leave: 'Leave', off: 'Off' };

export function exportScreen(me) {
  const tz = me.companies.timezone;
  const today = localDate(api.serverNow(), tz);
  const monthStart = today.slice(0, 8) + '01';
  show(`
    <main class="page narrow">
      ${backLink('#/setup', 'Setup')}
      <h1>Export register</h1>
      <p class="muted">Everyone's status for each day: present, late, absent, leave or off, with times and visits.</p>
      <form class="stack">
        <div class="pair">
          ${dateField({ name: 'from', value: monthStart, max: today, label: 'From' })}
          ${dateField({ name: 'to', value: today, max: today, label: 'To' })}
        </div>
        <p class="error" role="alert"></p>
        <button type="submit" class="primary" name="how" value="xlsx">Download Excel file</button>
        <button type="button" class="secondary" id="pdf">Print or save as PDF</button>
      </form>
    </main>
    <div class="print-only" id="print"></div>`, async (v) => run(me, v.from, v.to, 'xlsx'));
  wireSignOutIfPresent();
  document.getElementById('pdf').onclick = async () => {
    const form = app.querySelector('form');
    const out = form.querySelector('.error');
    out.textContent = '';
    try { await run(me, form.from.value, form.to.value, 'pdf'); } catch (x) { out.textContent = x.message; }
  };
}

function wireSignOutIfPresent() { if (document.getElementById('signout')) wireSignOut(); }

async function run(me, from, to, how) {
  if (!from || !to || from > to) throw new Say('Choose a start date before the end date.');
  const tz = me.companies.timezone;
  const rows = await api.rpc('register', { p_from: from, p_to: to });
  if (!rows.length) throw new Say('Nobody to show for these dates.');
  const head = ['Date', 'Name', 'Role', 'Status', 'Set by manager', 'In', 'Out', 'Late (min)', 'Visits', 'Visit target', 'To check'];
  const body = rows.map((r) => [
    r.day, r.full_name, ROLE[r.role], STATUS[r.status] || r.status, r.set_by_manager ? 'Yes' : '',
    r.first_in ? fmtTime(r.first_in, tz) : '', r.last_out ? fmtTime(r.last_out, tz) : '',
    r.late_minutes || '', r.role === 'rep' ? r.visits : '', r.role === 'rep' ? r.visit_target : '', r.to_review || '',
  ]);
  const title = `${me.companies.name} register ${from} to ${to}`;

  if (how === 'xlsx') {
    saveFile(new Blob(xlsxParts('Register', [head, ...body], [12, 24, 13, 13, 14, 10, 10, 10, 8, 11, 9]), { type: XLSX_TYPE }), `${title.replace(/[^\w-]+/g, '-')}.xlsx`);
    return;
  }
  // PDF: a clean printable page; the phone or computer's own "Save as PDF" does the rest.
  document.getElementById('print').innerHTML = `
    <h1>${esc(me.companies.name)}: attendance register</h1>
    <p>${esc(fmtDay(from + 'T12:00:00Z', tz))} to ${esc(fmtDay(to + 'T12:00:00Z', tz))}</p>
    <table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  printPage();
}

