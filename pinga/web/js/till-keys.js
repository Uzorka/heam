// Keyboard for the till on tablets and computers (loaded only on bigger screens).
//   ↑ ↓      choose a product in the search results (Enter adds it)
//   F2 or /  jump to the search box
//   F6 F7 F8 paid by Cash / Transfer / POS card
//   F9 or Ctrl+Enter (⌘+Enter on Mac)  complete the sale
//   Esc      clear the search; after a sale, start the next one
// Function keys work inside Tauri and in browsers; they never type anything into a box.
export function attach({ q, visiblePicks, pay, complete, next }) {
  const move = (step) => {
    const list = visiblePicks();
    if (!list.length) return;
    const at = list.findIndex((b) => b.classList.contains('hl'));
    list[at]?.classList.remove('hl');
    const to = list[Math.max(0, Math.min(list.length - 1, at + step))];
    to.classList.add('hl');
    to.scrollIntoView({ block: 'nearest' });
  };
  const onSearch = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
  };
  const typing = (el) => el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['radio', 'checkbox', 'button'].includes(el.type)));
  const onKey = (e) => {
    if (document.querySelector('dialog[open]')) return;   // a question is open: it has the keyboard
    const k = e.key;
    if (k === 'F2' || (k === '/' && !typing(document.activeElement))) { e.preventDefault(); q.focus(); q.select(); return; }
    if (k === 'F6' || k === 'F7' || k === 'F8') { e.preventDefault(); pay({ F6: 'cash', F7: 'transfer', F8: 'card' }[k]); return; }
    if (k === 'F9' || (k === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); complete(); return; }
    if (k === 'Escape') {
      if (document.getElementById('next')) { e.preventDefault(); next(); return; }
      if (q.value) { e.preventDefault(); q.value = ''; q.dispatchEvent(new Event('input')); q.focus(); }
    }
  };
  q.addEventListener('keydown', onSearch);
  document.addEventListener('keydown', onKey);
  return () => { q.removeEventListener('keydown', onSearch); document.removeEventListener('keydown', onKey); };
}
