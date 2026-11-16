// The two Supabase projects (both in eu-west-1, Ireland). Publishable keys are safe to commit.
// Keep in step with web/js/config.js (a unit test checks this).
// MAIL_DOMAIN: the one place to set where Pinga's emails come from (no-reply@ for sign-up codes, summary@ for the
// evening email). It must be verified in Resend. Temporary until usepinga.com is bought: then change it here and deploy.
export const MAIL_DOMAIN = 'pinga.elvisuzorka.com';
export const CONFIG_FOR = {
  staging: { ref: 'zgwgszomktveikhecmiz', key: 'sb_publishable_cp82R2d3yddf5HUTlvEmxg_JqrgGF5b', site: 'https://staging.elvisuzorka.com', hostinger: 'staging.elvisuzorka.com' },
  live: { ref: 'ltizbbzhfmexwezjdszs', key: 'sb_publishable_E0iS1qxWtgJBuG4NoBpZyQ_-tIQmcXO', site: 'https://pinga.elvisuzorka.com', hostinger: 'pinga.elvisuzorka.com' },
};
