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
        <p class="muted">${left === 4 ? 'Four quick steps and your team is on Pinga.' : left ? `${left} of 4 steps left.` : 'All done.'}</p></div></div>
      <ol class="checklist">
        ${steps.map((s, i) => {
          // Empty circle until a step is really done; a filled tick only when it is.
          const tick = `<span class="tick">${s.done ? ICON.checkSmall : ''}</span>`;
          const text = `<span class="text"><span class="title">${esc(s.label)}</span><span class="desc">${esc(s.hint)}</span></span>`;
          if (s.done) return `<li class="done">${tick}${text}<span class="sr">Done</span></li>`;
          // Only the next step to do is a link.
          if (i === next && s.href) return `<li class="next"><a href="${s.href}">${tick}${text}<span class="go">${ICON.chevron}</span></a></li>`;
          return `<li class="${i === next ? 'next' : 'later'}">${tick}${text}</li>`;
        }).join('')}
      </ol>
    </section>`;
}
