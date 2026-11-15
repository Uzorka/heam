// Which Supabase project to talk to. The publishable (anon) key is safe to ship:
// it only identifies the project; row-level security protects the data.
//
// Safety rule: the app uses LIVE only on the live web addresses below.
// Everything else (localhost, staging addresses, previews) uses STAGING.

const LIVE_HOSTS = ['pinga.elvisuzorka.com', 'app.usepinga.com', 'app.pinga.com.ng'];   // pilot address first

const PROJECTS = {
  staging: { url: 'https://zgwgszomktveikhecmiz.supabase.co', key: 'sb_publishable_cp82R2d3yddf5HUTlvEmxg_JqrgGF5b', sentryDsn: '' },
  live: { url: 'https://ltizbbzhfmexwezjdszs.supabase.co', key: 'sb_publishable_E0iS1qxWtgJBuG4NoBpZyQ_-tIQmcXO', sentryDsn: '' },
};

const host = typeof location === 'undefined' ? '' : location.hostname;
const env = LIVE_HOSTS.includes(host) ? 'live' : 'staging';

export const CONFIG = { env, release: '0.2.0', ...PROJECTS[env] };
