// Manager's Today page: everyone's day at a glance, filters, and bulk Present / Absent / Leave / Off.
// Same flow as the CHF Heron tracker's admin page. Pick a past date to fix it.
import * as api from './api.js';
import { show, go, esc, toast, header, wireSignOut, friendly, app, ROLE, fmtTime, fmtDay, localDate } from './ui.js';
import { happyPin } from './icons.js';
import { checklist } from './getstarted.js';

const FILTERS = [
  ['all', 'All'], ['none', 'No check-in'], ['late', 'Late'], ['absent', 'Absent'], ['present', 'Present'], ['away', 'Leave or off'],
];
// "Not in" (from the Overview tile) = no check-in or absent. Shown as a chip only while it is chosen.
const NOT_IN = ['notin', 'Not in'];
const matches = (f, r) => f === 'all'
  || (f === 'away' ? r.status === 'leave' || r.status === 'off'
    : f === 'notin' ? r.status === 'none' || r.status === 'absent'
      : r.status === f);
const WORD = { present: 'Present', absent: 'Absent', leave: 'On leave', off: 'Off' };
let FILTER = 'all';

function statusPill(r) {
  const p = {
    present: '<span class="pill ok">Present</span>',
    late: `<span class="pill wait">Late${r.late_minutes ? ` · ${r.late_minutes} min` : ''}</span>`,
    absent: '<span class="pill bad">Absent</span>',
    none: '<span class="pill">No check-in</span>',
    leave: '<span class="pill info">Leave</span>',
    off: '<span class="pill">Off</span>',
  }[r.status];
  return p + (r.set_by_manager ? '<span class="tiny muted by">set by manager</span>' : '');
}

function detail(r, tz) {
  if (r.role === 'rep') return `${ROLE.rep} · ${r.visits} of ${r.visit_target} visits`;
  const parts = [ROLE.staff];
  if (r.first_in) parts.push(`In ${fmtTime(r.first_in, tz)}`);
  if (r.last_out) parts.push(`Out ${fmtTime(r.last_out, tz)}`);
  return parts.join(' · ');
}

export async function today(me, arg, tabs) {
  const tz = me.companies.timezone;
  const now = localDate(api.serverNow(), tz);
  // #/today/late (from an Overview tile) opens today filtered; #/day/2026-11-09 opens a past date.
  if ([...FILTERS, NOT_IN].some(([k]) => k === arg)) FILTER = arg;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(arg) && arg <= now ? arg : now;
  const isToday = day === now;
  const rows = await api.rpc('day_board', { p_day: day });
  // Nobody to show yet: the "Get started" checklist instead of empty filters.
  const progress = rows.length ? null : await api.rpc('setup_progress').catch(() => null);
  const filters = FILTER === 'notin' ? [FILTERS[0], NOT_IN, ...FILTERS.slice(1)] : FILTERS;
  const allIn = isToday && rows.length > 0 && !rows.some((r) => ['none', 'absent', 'late'].includes(r.status));
  const count = (f) => rows.filter((r) => matches(f, r)).length;
  const sel = new Set();

  show(`
    <main class="page has-bulk">
      ${header(me, isToday ? 'Today' : fmtDay(day + 'T12:00:00Z', tz))}
      ${tabs('Today')}
      ${rows.length ? `
      <div class="dayrow">
        <label class="sr" for="day">Date</label>
        <input type="date" id="day" value="${day}" max="${now}">
        ${isToday ? '<span class="muted small">Pick a past date to fix it</span>' : '<a href="#/today" class="small">Back to today</a>'}
      </div>
      <div class="chips" role="group" aria-label="Show">
        ${filters.map(([k, t]) => { const c = count(k); return `<button type="button" class="chip${FILTER === k ? ' on' : ''}${c ? '' : ' zero'}" data-f="${k}" aria-pressed="${FILTER === k}">${t} <b>${c}</b></button>`; }).join('')}
      </div>
      ${allIn ? `<div class="happy-state">${happyPin(44)}<p>Everyone's in today.</p></div>` : ''}
      <input id="q" type="search" placeholder="Search name" aria-label="Search name"${rows.length > 8 ? '' : ' hidden'}>
      <label class="selall"><input type="checkbox" id="all"> <span>Select all shown</span></label>`
      : progress ? checklist(progress) : '<p class="empty muted center">No office staff or sales reps yet. <a href="#/invite">Invite someone</a>.</p>'}
      <ul class="board" id="list"${rows.length ? '' : ' hidden'}></ul>
    </main>
    <div class="bulkbar" id="bulk" hidden>
      <div class="bulk-top"><b id="bn"></b><button type="button" class="link" id="bx">Deselect</button></div>
      <div class="bulk-btns">
        <button type="button" data-b="present">Present</button>
        <button type="button" data-b="absent">Absent</button>
        <button type="button" data-b="leave">Leave</button>
        <button type="button" data-b="off">Off</button>
        <button type="button" data-b="clear" class="ghost" title="Remove the status a manager set">Clear</button>
      </div>
    </div>`);
  wireSignOut();
  if (!rows.length) return;   // nothing to filter or select yet

  let shown = [];
  const refresh = () => {
    const n = sel.size;
    document.getElementById('bulk').hidden = !n;
    document.getElementById('bn').textContent = `${n} selected`;
    const all = document.getElementById('all');
    if (all) {
      const k = shown.filter((r) => sel.has(r.member_id)).length;
      all.checked = shown.length > 0 && k === shown.length;
      all.indeterminate = k > 0 && k < shown.length;
    }
    app.querySelectorAll('[data-row]').forEach((li) => li.classList.toggle('sel', sel.has(li.dataset.row)));
  };
  const draw = () => {
    const q = document.getElementById('q').value.toLowerCase();
    shown = rows.filter((r) => matches(FILTER, r) && (!q || r.full_name.toLowerCase().includes(q)));
    document.getElementById('list').innerHTML = shown.map((r) => `
      <li class="brow" data-row="${r.member_id}">
        <label class="ck"><input type="checkbox" data-ck="${r.member_id}" aria-label="Select ${esc(r.full_name)}"${sel.has(r.member_id) ? ' checked' : ''}></label>
        <a class="grow" href="#/person/${r.member_id}"><b>${esc(r.full_name)}</b><span class="tiny muted">${detail(r, tz)}</span></a>
        <span class="right">${statusPill(r)}${r.to_review ? `<span class="pill warn">${r.to_review} to check</span>` : ''}</span>
      </li>`).join('') || '<li class="empty muted center">Nobody here.</li>';
    app.querySelectorAll('[data-ck]').forEach((c) => {
      c.onchange = () => { if (c.checked) sel.add(c.dataset.ck); else sel.delete(c.dataset.ck); refresh(); };
    });
    refresh();
  };
  draw();

  document.getElementById('q').oninput = draw;
  document.getElementById('day').onchange = (e) => go(e.target.value && e.target.value !== now ? '#/day/' + e.target.value : '#/today');
  app.querySelectorAll('[data-f]').forEach((b) => {
    b.onclick = () => {
      FILTER = b.dataset.f;
      app.querySelectorAll('[data-f]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
      draw();
    };
  });
  const all = document.getElementById('all');
  if (all) all.onchange = () => { shown.forEach((r) => (all.checked ? sel.add(r.member_id) : sel.delete(r.member_id))); draw(); };
  document.getElementById('bx').onclick = () => { sel.clear(); draw(); };

  const dayText = isToday ? 'today' : fmtDay(day + 'T12:00:00Z', tz);
  app.parentElement.querySelectorAll('[data-b]').forEach((b) => {
    b.onclick = async () => {
      const st = b.dataset.b;
      let ids = [...sel];
      if (st === 'clear') {
        ids = ids.filter((id) => rows.find((r) => r.member_id === id)?.set_by_manager);
        if (!ids.length) return toast('Nothing to clear. Clear only removes statuses a manager set.');
      }
      const n = ids.length;
      const who = `${n} ${n > 1 ? 'people' : 'person'}`;
      if (n > 1 && !confirm(st === 'clear'
        ? `Remove the status you set for ${who} on ${dayText}? Their clock-ins and visits are not changed.`
        : `Mark ${who} as ${WORD[st]} on ${dayText}?`)) return;
      const btns = app.parentElement.querySelectorAll('[data-b]');
      btns.forEach((x) => { x.disabled = true; });
      try {
        await api.rpc('set_day_status', { p_members: ids, p_day: day, p_status: st === 'clear' ? null : st });
        toast(st === 'clear' ? `Cleared ${who}` : `${who} marked ${WORD[st]}`);
        today(me, arg, tabs);
      } catch (x) {
        btns.forEach((y) => { y.disabled = false; });
        toast(friendly(x));
      }
    };
  });
}
