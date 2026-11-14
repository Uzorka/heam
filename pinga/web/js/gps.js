// Location. Works without signal (GPS comes from satellites, not the internet).

export function distanceM(a, b) {
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

export function nearest(places, here) {
  let best = null;
  for (const p of places) {
    const d = distanceM(here, p);
    if (!best || d < best.distance) best = { place: p, distance: d };
  }
  return best;
}

// Watches GPS and reports each better reading. Stops itself once accurate enough or after maxMs.
export function watchBest(onUpdate, onFail, { goodM = 30, maxMs = 30000 } = {}) {
  if (!('geolocation' in navigator)) { onFail('unavailable'); return () => {}; }
  let best = null;
  const stop = () => { navigator.geolocation.clearWatch(id); clearTimeout(timer); };
  const id = navigator.geolocation.watchPosition((p) => {
    const reading = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy * 10) / 10 };
    if (!best || reading.accuracy <= best.accuracy) { best = reading; onUpdate(best); }
    if (best.accuracy <= goodM) stop();
  }, (e) => {
    if (e.code === 1) { stop(); onFail('denied'); } else if (!best && e.code !== 3) onFail('unavailable');
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: maxMs });
  const timer = setTimeout(() => { stop(); if (!best) onFail('timeout'); }, maxMs);
  return stop;
}

// Parses "6.5095, 3.3711" (as copied from Google Maps).
export function parseLatLng(text) {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text || '');
  if (!m) return null;
  const lat = +m[1], lng = +m[2];
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
