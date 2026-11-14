// "Get started" checklist for new companies: shown instead of a wall of zeros.
import { esc } from './ui.js';
import { ICON, happyPin } from './icons.js';

// p = setup_progress(): { offices, stores, people, first_check_in }
export const setupDone = (p) => !!(p && p.offices && p.stores && p.people > 0 && p.first_check_in);

export function checklist(p) {
  const steps = [
    { done: p.offices, label: 'Add an office or branch', hint: 'Where office staff clock in', href: '#/office/new' },
    { done: p.stores, label: 'Add your stores', hint: 'Where sales reps check in', href: '#/store/new' },
    { done: p.people > 0, label: 'Invite your staff', hint: 'They get a link on WhatsApp', href: '#/invite' },
    { done: p.first_check_in, label: 'First clock-in', hint: 'Ask someone to clock in or check in at a store', href: null },
  ];
  const next = steps.findIndex((s) => !s.done);
  const left = steps.filter((s) => !s.done).length;
  return `
    <section class="card block getstarted" aria-labelledby="gs-h">
      <div class="head">${happyPin(64)}<div><h2 id="gs-h">Get started</h2>
        <p class="muted">${left === 4 ? 'Four quick steps and your team is on Pinga.' : `${left} of 4 steps left.`}</p></div></div>
      <ol class="checklist">
        ${steps.map((s, i) => {
          const inner = `<span class="tick">${ICON.checkSmall}</span><span class="label">${esc(s.label)}<small>${esc(s.hint)}</small></span>`;
          const cls = s.done ? 'done' : i === next ? 'next' : '';
          return `<li class="${cls}">${s.href && !s.done ? `<a href="${s.href}">${inner}</a>` : `<span class="static">${inner}</span>`}${s.done ? '<span class="sr"> (done)</span>' : ''}</li>`;
        }).join('')}
      </ol>
    </section>`;
}
