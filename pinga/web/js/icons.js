// Pinga's logo, the happy pin, and one consistent set of thick, rounded line icons.
// Inline SVG: nothing extra to download.

const line = (d, size = 24) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICON = {
  overview: line('<rect x="3.5" y="3.5" width="7" height="7" rx="2.2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2.2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2.2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2.2"/>'),
  today: line('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4M9.2 15.2l2 2 3.8-3.9"/>'),
  team: line('<circle cx="9" cy="8.5" r="3.4"/><path d="M3.2 20c0-3.3 2.6-5.9 5.8-5.9s5.8 2.6 5.8 5.9"/><circle cx="17.2" cy="9.4" r="2.4"/><path d="M16.8 14.3c2.4.4 4.1 2.6 4.1 5.2"/>'),
  setup: line('<path d="M4 7h9.5M18.5 7H20M4 17h3.5M12.5 17H20"/><circle cx="16" cy="7" r="2.4"/><circle cx="10" cy="17" r="2.4"/>'),
  history: line('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  store: line('<path d="M4 9.5 5.6 4.5h12.8L20 9.5M5 9.5V20h14V9.5M4 9.5h16M10 20v-5h4v5"/>'),
  check: line('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  checkSmall: line('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 16),
  chevron: line('<path d="M9.5 5.5 16 12l-6.5 6.5"/>', 18),
  back: line('<path d="M14.5 5.5 8 12l6.5 6.5"/>', 18),
  pin: line('<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>', 18),
  stock: line('<path d="M3.5 7.6 12 3.2l8.5 4.4v8.8L12 20.8l-8.5-4.4z"/><path d="M3.5 7.6 12 12l8.5-4.4M12 12v8.8"/>'),
  shop: line('<path d="M4 10v9.5h16V10M3 10l1.8-5.5h14.4L21 10M3 10c0 1.4 1.1 2.5 2.5 2.5S8 11.4 8 10c0 1.4 1.1 2.5 2.5 2.5S13 11.4 13 10c0 1.4 1.1 2.5 2.5 2.5S18 11.4 18 10M9.5 19.5V15h5v4.5"/>'),
  clock: line('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', 22),
};

// The logo: a map pin with a check mark cut out of the centre.
const PIN = 'M24 3C14.6 3 7 10.5 7 19.8c0 12.4 14.2 23.6 15.5 24.6a2.4 2.4 0 0 0 3 0C26.8 43.4 41 32.2 41 19.8 41 10.5 33.4 3 24 3Z';
export const logo = (size = 28) => `<svg class="logo" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true">
  <defs><mask id="pinga-cut"><rect width="48" height="48" fill="#fff"/><path d="M16 20.5l5.6 5.6L32.5 15" fill="none" stroke="#000" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round"/></mask></defs>
  <path d="${PIN}" fill="var(--mango, #FF8A1F)" mask="url(#pinga-cut)"/></svg>`;

export const wordmark = (size = 30) => `<span class="wordmark">${logo(size)}<span>Pinga</span></span>`;

// A small happy pin for empty states and "everyone's in".
export const happyPin = (size = 88) => `<svg class="happy" width="${size}" height="${size}" viewBox="0 0 96 96" aria-hidden="true">
  <ellipse cx="48" cy="88" rx="18" ry="4" fill="var(--ink, #14213D)" opacity=".08"/>
  <path d="M48 8C30 8 16 22 16 39.5c0 22.5 26 42.5 29 44.7a5 5 0 0 0 6 0C54 82 80 62 80 39.5 80 22 66 8 48 8Z" fill="var(--mango, #FF8A1F)"/>
  <circle cx="48" cy="39" r="21" fill="#fff"/>
  <circle cx="40.5" cy="35.5" r="3" fill="var(--ink, #14213D)"/><circle cx="55.5" cy="35.5" r="3" fill="var(--ink, #14213D)"/>
  <path d="M39.5 44.5c4.8 5 12.2 5 17 0" fill="none" stroke="var(--ink, #14213D)" stroke-width="3.4" stroke-linecap="round"/>
  <circle cx="34" cy="43" r="2.6" fill="var(--mango, #FF8A1F)" opacity=".35"/><circle cx="62" cy="43" r="2.6" fill="var(--mango, #FF8A1F)" opacity=".35"/></svg>`;
