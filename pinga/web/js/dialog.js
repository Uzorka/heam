// Pinga's own dialog box, used instead of the browser's confirm() and prompt():
// those look different everywhere and can be missing inside packaged apps (Tauri, Capacitor).
// Esc or Cancel closes it; focus goes back where it was.
import { esc } from './ui.js';

// ask('Clear this sale?') → true/false.  ask('What went wrong?', { input: '' }) → text or null.
export function ask(message, { ok = 'OK', cancel = 'Cancel', danger = false, input = null, placeholder = '' } = {}) {
  return new Promise((resolve) => {
    const back = document.activeElement;
    const d = document.createElement('dialog');
    d.className = 'dlg';
    d.setAttribute('aria-label', message);
    d.innerHTML = `
      <form method="dialog" class="stack">
        <p class="dlg-msg">${esc(message)}</p>
        ${input !== null ? `<input name="answer" value="${esc(input)}" placeholder="${esc(placeholder)}" autocomplete="off" maxlength="300">` : ''}
        <div class="dlg-btns">
          <button type="button" class="secondary" value="cancel">${esc(cancel)}</button>
          <button type="submit" class="${danger ? 'danger' : 'primary'}" value="ok">${esc(ok)}</button>
        </div>
      </form>`;
    document.body.append(d);
    let answer = input !== null ? null : false;
    const done = () => { d.remove(); if (back && back.focus) back.focus(); resolve(answer); };
    d.querySelector('[value=cancel]').onclick = () => d.close();
    d.querySelector('form').addEventListener('submit', () => {
      answer = input !== null ? d.querySelector('input').value.trim() || null : true;
    });
    d.addEventListener('close', done);
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    (d.querySelector('input') || d.querySelector('[type=submit]')).focus();
  });
}
