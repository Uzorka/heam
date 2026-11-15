// Pinga landing page: links into the app, and the latest prices (set in one place, in the database).
(() => {
  const live = /(^|\.)usepinga\.com$/.test(location.hostname) || location.hostname === 'pinga.com.ng';
  const SB = live
    ? { url: 'https://ltizbbzhfmexwezjdszs.supabase.co', key: 'sb_publishable_E0iS1qxWtgJBuG4NoBpZyQ_-tIQmcXO' }
    : { url: 'https://zgwgszomktveikhecmiz.supabase.co', key: 'sb_publishable_cp82R2d3yddf5HUTlvEmxg_JqrgGF5b' };
  // On usepinga.com the app lives at app.usepinga.com; on staging it's one folder up from this page.
  const app = live ? 'https://app.usepinga.com/' : new URL('../', location.href).href;
  document.querySelectorAll('[data-app]').forEach((a) => { a.href = app + '#/' + a.dataset.app; });
  document.getElementById('year').textContent = new Date().getFullYear();

  const COUNTS = ['starter.staff', 'starter.locations', 'business.shop_staff'];   // numbers of people or places, not money
  const naira = (n) => '₦' + Number(n).toLocaleString('en-NG');
  fetch(SB.url + '/rest/v1/rpc/plans', { method: 'POST', headers: { apikey: SB.key, 'content-type': 'application/json' }, body: '{}' })
    .then((r) => (r.ok ? r.json() : null))
    .then((p) => {
      if (!p || !p.starter) return;   // keep the prices printed on the page
      document.querySelectorAll('[data-p]').forEach((el) => {
        const v = el.dataset.p.split('.').reduce((o, k) => (o == null ? o : o[k]), p);
        if (v == null) return;
        el.textContent = COUNTS.includes(el.dataset.p) ? v : naira(v);
      });
      if (p.trial_days) {
        const words = p.trial_days === 30 ? 'First month' : `First ${p.trial_days} days`;
        // Capitalised where the page has it capitalised ("First month free"), not in a sentence ("Your first month").
        document.querySelectorAll('[data-trial]').forEach((el) => { el.textContent = /^[A-Z]/.test(el.textContent) ? words : words.toLowerCase(); });
      }
    })
    .catch(() => { /* offline: the printed prices stay */ });
})();
