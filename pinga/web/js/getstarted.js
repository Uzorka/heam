// "Get started" checklist for new companies: shown instead of a wall of zeros.
import { esc } from './ui.js';
import { ICON, happyPin } from './icons.js';

// p = setup_progress(): { offices, stores, people, first_check_in }
// type: the business type. A Storefront business has shops and no stores to visit.
const stepsFor = (p, type = 'field') => [
  type === 'storefront'
    ? { done: p.offices, label: 'Add your shop', hint: 'Where your staff clock in and sell', href: '#/office/new' }
    : { done: p.offices, label: type === 'both' ? 'Add an office or shop' : 'Add an office or branch', hint: 'Where staff clock in', href: '#/office/new' },
  type === 'storefront' ? null : { done: p.stores, label: 'Add your stores', hint: 'Where sales reps check in', href: '#/store/new' },
  { done: p.people > 0, label: type === 'storefront' ? 'Invite your shop staff' : 'Invite your staff', hint: 'They get a link on WhatsApp', href: '#/invite' },
  { done: p.first_check_in, label: 'First clock-in', hint: type === 'storefront' ? 'Ask someone to clock in at the shop' : 'Ask someone to clock in or check in at a store', href: null },
].filter(Boolean);

export const setupDone = (p, type) => !!p && stepsFor(p, type).every((s) => s.done);

const WORDS = ['', 'One', 'Two', 'Three', 'Four'];

export function checklist(p, type) {
  const steps = stepsFor(p, type);
  const next = steps.findIndex((s) => !s.done);
  const left = steps.filter((s) => !s.done).length;
  return `
    <section class="card block getstarted" aria-labelledby="gs-h">
      <div class="head">${happyPin(64)}<div><h2 id="gs-h">Get started</h2>
        <p class="muted">${left === steps.length ? `${WORDS[steps.length]} quick steps and your team is on Pinga.` : left ? `${left} of ${steps.length} steps left.` : 'All done.'}</p></div></div>
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
