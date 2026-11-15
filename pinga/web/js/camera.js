// Front camera inside the page (opening the phone's camera app can make low-memory
// phones close the browser). Captures one small photo, at most 50 KB.

const MAX_BYTES = 50 * 1024;

// facing: 'user' (selfie) or 'environment' (back camera, e.g. shelf photos).
// size: the picture wanted (barcode scanning asks for more detail).
export async function startCamera(video, facing = 'user', size = 640) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('no-camera');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: facing, width: { ideal: size }, height: { ideal: size } }, audio: false,
  });
  video.srcObject = stream;
  await video.play().catch(() => {});
  return () => { stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
}

const toBlob = (canvas, q) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));

// Square crop from the centre, lowering quality until it fits.
// Selfies: 320 × 320, at most 50 KB. Shelf photos: pass a larger size and limit.
export async function capture(video, size = 320, maxBytes = MAX_BYTES) {
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) throw new Error('camera-not-ready');
  const s = Math.min(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d').drawImage(video, (w - s) / 2, (h - s) / 2, s, s, 0, 0, size, size);
  for (const q of [0.7, 0.55, 0.4, 0.3]) {
    const blob = await toBlob(canvas, q);
    if (blob && blob.size <= maxBytes) return blob;
  }
  throw new Error('photo-too-large');
}
