// Scanning barcodes with the phone's camera (loaded only when someone taps Scan).
// Continuous: every barcode found calls onCode; the camera stays open until closed.
// Uses the phone's built-in barcode reader where there is one (Chrome on Android); otherwise loads a
// small reader we host ourselves (vendor/barcode, ~1 MB once, then kept on the phone by the service worker).
import { startCamera } from './camera.js';
import { beep, vibrate } from './device.js';
import { esc } from './ui.js';
import { ICON } from './icons.js';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];
let fallback = null;

async function detector() {
  if ('BarcodeDetector' in globalThis) {
    try {
      const have = await globalThis.BarcodeDetector.getSupportedFormats();
      if (have.includes('ean_13')) return new globalThis.BarcodeDetector({ formats: FORMATS.filter((f) => have.includes(f)) });
    } catch { /* use the fallback */ }
  }
  if (!fallback) {
    fallback = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/barcode/barcode-detector.js';
      s.onload = () => {
        const lib = globalThis.BarcodeDetectionAPI;
        // Our own copy of the reader, never a public CDN.
        lib.prepareZXingModule({ overrides: { locateFile: (file) => new URL('vendor/barcode/' + file, location.href).href }, fireImmediately: true });
        resolve(lib.BarcodeDetector);
      };
      s.onerror = () => { fallback = null; reject(new Error('scanner-load-failed')); };
      document.head.append(s);
    });
  }
  return new (await fallback)({ formats: FORMATS });
}

// Opens the scanner over the screen. onCode(code) returns { ok: true, label } when it added something,
// or { ok: false, message } (then scanning pauses until the person taps "Keep scanning").
// Returns close().
export async function openScanner({ onCode, onClose }) {
  const box = document.createElement('div');
  box.className = 'scanner';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Scan barcodes');
  box.innerHTML = `
    <video playsinline muted></video>
    <div class="scan-frame" aria-hidden="true"></div>
    <div class="scan-top"><span>Point the camera at a barcode</span><button class="scan-close" type="button">Done</button></div>
    <p class="scan-msg" role="status" aria-live="polite">Starting the camera…</p>`;
  document.body.append(box);
  const video = box.querySelector('video'), msg = box.querySelector('.scan-msg');
  let stopCam = null, timer = null, paused = false, last = '', lastAt = 0, closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    stopCam?.();
    box.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  box.querySelector('.scan-close').onclick = close;

  try {
    const [stop, reader] = await Promise.all([startCamera(video, 'environment', 1280), detector()]);
    stopCam = stop;
    if (closed) { stop(); return close; }
    msg.textContent = 'Ready. Each scan adds the item.';
    const tick = async () => {
      if (closed) return;
      if (!paused && video.readyState >= 2) {
        try {
          const found = await reader.detect(video);
          const code = found[0]?.rawValue?.trim();
          // The same barcode held in view is added once, not every frame.
          if (code && (code !== last || Date.now() - lastAt > 2000)) {
            last = code; lastAt = Date.now();
            const r = await onCode(code);
            if (r.ok) { beep(); vibrate(); msg.innerHTML = `${ICON.checkSmall} ${esc(r.label)}`; }
            else {
              vibrate(200);
              paused = true;
              msg.innerHTML = `${esc(r.message)} <button type="button" class="scan-again">Keep scanning</button>`;
              msg.querySelector('.scan-again').onclick = () => { paused = false; last = ''; msg.textContent = 'Ready. Each scan adds the item.'; };
            }
          }
        } catch { /* a frame that couldn't be read: try the next one */ }
      }
      timer = setTimeout(tick, 220);
    };
    tick();
  } catch (x) {
    msg.textContent = x.message === 'scanner-load-failed'
      ? "Couldn't load the scanner. Check your signal and try again, or type the code."
      : 'Pinga needs your camera to scan. Allow the camera for this site, then try again.';
  }
  return close;
}

