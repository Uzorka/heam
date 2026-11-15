// Things a phone or computer does differently inside a packaged app (Tauri on Windows/Mac,
// Capacitor on iOS/Android). Everything that touches them goes through these few functions,
// so a native version can be swapped in later in one place. Camera: camera.js. Location: gps.js.
import { CONFIG } from './config.js';

// Running inside a packaged app? (Capacitor and Tauri add these; a packaged build also sets PINGA_ENV.)
export const packaged = () => !!(globalThis.Capacitor || globalThis.__TAURI_INTERNALS__ || globalThis.__TAURI__ || globalThis.PINGA_ENV)
  || !/^https?:$/.test(location.protocol);

// The public web address for links people open elsewhere (receipts, invites). Inside a packaged app
// the page address isn't a real web address (e.g. https://localhost in Capacitor), so the configured one is used.
export const publicBase = () => (packaged() ? CONFIG.site : location.origin + location.pathname.replace(/[^/]*$/, ''));

// Opens a link outside the app (WhatsApp, Paystack). Native: the system browser / app.
export function openExternal(url) { window.open(url, '_blank', 'noopener'); }

// Copies text. Returns false if the phone wouldn't allow it (then show the text to copy by hand).
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// Saves a file the app made (Excel, receipt picture). Native: a "Save as" dialog or the share sheet.
export function saveFile(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// A short beep and a buzz when a barcode is scanned. Native: system sound and haptics.
let audio = null;
export function beep() {
  try {
    audio = audio || new (globalThis.AudioContext || globalThis.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 1500; g.gain.value = 0.08;
    o.connect(g); g.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + 0.09);
  } catch { /* no sound: fine */ }
}
export function vibrate(ms = 60) { try { navigator.vibrate?.(ms); } catch { /* no buzz: fine */ } }

// Print / Save as PDF. Native: the system print dialog.
export function printPage() { window.print(); }
