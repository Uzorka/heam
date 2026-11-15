// Maps (Leaflet, from our own site, loaded only when a map is shown). Tiles: OpenStreetMap.
let leaflet = null;
export function loadLeaflet() {
  if (!leaflet) {
    leaflet = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'vendor/leaflet/leaflet.css';
      document.head.append(css);
      const js = document.createElement('script');
      js.src = 'vendor/leaflet/leaflet.js';
      js.onload = () => resolve(window.L);
      js.onerror = () => { leaflet = null; reject(new Error('map-load-failed')); };
      document.head.append(js);
    });
  }
  return leaflet;
}

export const LAGOS = { lat: 6.5244, lng: 3.3792 };

// A map with one pin the owner drags (or taps the map) to where the place is.
// onMove({ lat, lng }) on every change. Returns { set(pos, zoom), remove() }.
export async function pinPicker(el, start, onMove) {
  const L = await loadLeaflet();
  const at = start || LAGOS;
  const map = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false, tap: true }).setView([at.lat, at.lng], start ? 17 : 11);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
  const icon = L.divIcon({ className: 'map-pin', html: '<span></span>', iconSize: [32, 42], iconAnchor: [16, 40] });
  const pin = L.marker([at.lat, at.lng], { draggable: true, icon, keyboard: true, title: 'Drag to the place', alt: 'Location pin' }).addTo(map);
  const moved = () => { const p = pin.getLatLng(); onMove({ lat: p.lat, lng: p.lng }); };
  pin.on('dragend', moved);
  map.on('click', (e) => { pin.setLatLng(e.latlng); moved(); });
  return {
    set(pos, zoom = 17) { pin.setLatLng([pos.lat, pos.lng]); map.setView([pos.lat, pos.lng], zoom); },
    remove() { map.remove(); },
  };
}
