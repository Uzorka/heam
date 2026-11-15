// Shrinks a logo before upload: at most 512 px on its longest side and under 200 KB,
// so it stays light on cheap phones, receipts and emails. PNG keeps transparency;
// a photo-like logo that is still too big becomes a JPEG on white.
export const MAX_SIDE = 512;
export const MAX_BYTES = 200 * 1024;

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

function draw(img, side, white) {
  const scale = Math.min(1, side / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * scale));
  c.height = Math.max(1, Math.round(img.height * scale));
  const g = c.getContext('2d');
  if (white) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// Does the picture have see-through parts? (Then it stays PNG, which keeps them.)
function hasTransparency(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 16) if (d[i] < 250) return true;
  return false;
}

// Returns { blob, width, height, type }. Tries to keep the full 512 px first.
export async function shrinkLogo(file) {
  if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error('not-an-image');
  let img;
  try { img = await createImageBitmap(file); } catch { throw new Error('not-an-image'); }
  const full = draw(img, MAX_SIDE, false);
  const clear = file.type === 'image/png' && hasTransparency(full);
  const tries = clear
    ? [[MAX_SIDE, 'image/png'], [384, 'image/png'], [256, 'image/png'], [MAX_SIDE, 'image/jpeg', 0.85], [MAX_SIDE, 'image/jpeg', 0.6]]
    : [[MAX_SIDE, 'image/png'], [MAX_SIDE, 'image/jpeg', 0.85], [MAX_SIDE, 'image/jpeg', 0.7], [384, 'image/jpeg', 0.7], [256, 'image/jpeg', 0.6]];
  for (const [side, type, q] of tries) {
    const c = draw(img, side, type === 'image/jpeg');
    const blob = await toBlob(c, type, q);
    if (blob && blob.size <= MAX_BYTES) return { blob, width: c.width, height: c.height, type };
  }
  throw new Error('too-big');
}
