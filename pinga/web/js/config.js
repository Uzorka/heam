// Which Supabase project to talk to. The publishable (anon) key is safe to ship:
// it only identifies the project; row-level security protects the data.
//
// Safety rule: the app uses LIVE only on the live web addresses below.
// Everything else (localhost, staging addresses, previews) uses STAGING.

const LIVE_HOSTS = ['app.usepinga.com', 'app.pinga.com.ng'];

const PROJECTS = {
  staging: { url: '', key: '', sentryDsn: '' },
  live: { url: '', key: '', sentryDsn: '' },
};

const host = typeof location === 'undefined' ? '' : location.hostname;
const env = LIVE_HOSTS.includes(host) ? 'live' : 'staging';

export const CONFIG = { env, release: '0.2.0', ...PROJECTS[env] };
