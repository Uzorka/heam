// Catches every unexpected error, shows a calm message, and reports it to Sentry
// (when a Sentry address is set in config.js). No Sentry library: one small request.
import { CONFIG } from './config.js';

const id = () => Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

export function report(error, extra = {}) {
  console.error(error);
  const m = /^https:\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(CONFIG.sentryDsn || '');
  if (!m) return;
  const [, key, host, project] = m;
  const eventId = id();
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    environment: CONFIG.env,
    release: CONFIG.release,
    // Never send the part after "#": it can contain invite links or login details.
    request: { url: location.origin + location.pathname, headers: { 'User-Agent': navigator.userAgent } },
    exception: { values: [{ type: error?.name || 'Error', value: String(error?.message || error) }] },
    extra: { ...extra, stack: String(error?.stack || '').slice(0, 4000) },
  };
  const body = [JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: 'event' }), JSON.stringify(event)].join('\n');
  fetch(`https://${host}/api/${project}/envelope/?sentry_key=${key}&sentry_version=7`, {
    method: 'POST', body, keepalive: true,
  }).catch(() => {});
}

export function catchAll(showMessage) {
  addEventListener('error', (e) => { report(e.error || e.message); showMessage(); });
  addEventListener('unhandledrejection', (e) => { report(e.reason); showMessage(); });
}
