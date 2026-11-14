// The one outbox for this phone (clock-ins and store visits), and when to send it.
import * as api from './api.js';
import { outbox } from './outbox.js';
import { createSync } from './sync.js';
import { report } from './report.js';
import { toast } from './ui.js';

let current = null;
export const setMember = (me) => { current = me; };
export const sync = createSync({ store: outbox, api, report, memberId: () => current?.id });
export { outbox };

// Send whenever the chance comes: app opened, signal back, every minute while open.
addEventListener('online', () => sync.flush());
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync.flush(); });
setInterval(() => sync.flush(), 60000);

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

// Signing out with unsent records would lose them.
export const safeToSignOut = async () => {
  if (!(await sync.count())) return true;
  toast("Some check-ins haven't been sent yet. Connect to the internet first.");
  return false;
};

export const waitingText = (n) => (n ? `${n} waiting to send · will send when you have signal` : '');
