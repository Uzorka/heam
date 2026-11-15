// The setup wizard for new owners: one step per screen, saved as they go.
//   1 Business type · 2 Business details · 3 Shops or offices · 4 Products (shops only) · 5 Invite staff · 6 Done
// Steps 1 and 2 happen before the business exists (kept on this phone), then the business is created.
// Loaded only by owners who are setting up (not part of the staff app).
import * as api from './api.js';
import { normalizePhone, displayPhone } from './phone.js';
import { watchBest, parseLatLng } from './gps.js';
import { show, go, esc, Say, toast, friendly, app, reloadMe, onLeave, moneyInput, parseMoney, properName, firstName, fmtMoney } from './ui.js';
import { publicBase, openExternal } from './device.js';
import { wordmark, happyPin, ICON } from './icons.js';
import { pending, setPending, PENDING } from './signup.js';

const TYPES = {
  storefront: { title: 'Shop / Storefront', eg: 'Supermarkets, pharmacies, boutiques, phone and provision shops', does: 'Sell, stock, receipts and staff attendance' },
  field: { title: 'Field sales', eg: 'Distributors, FMCG and pharma reps, merchandisers', does: 'Reps check in at stores with GPS and a photo; office staff clock in' },
  both: { title: 'Both', eg: 'Shops, plus a sales team on the road', does: 'Everything: shops, offices and sales reps' },
};
const ICONS = {
  storefront: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 20h32v20H8z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M6 20l4-10h28l4 10" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M20 40V29h8v11" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
  field: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 42s13-12.4 13-22a13 13 0 0 0-26 0c0 9.6 13 22 13 22z" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="24" cy="20" r="5" fill="currentColor"/></svg>',
  both: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M4 26h22v16H4z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M3 26l3-7h18l3 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M35 34s9-8.4 9-15a9 9 0 0 0-18 0c0 6.6 9 15 9 15z" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="35" cy="19" r="3" fill="currentColor"/></svg>',
};

const shopType = (t) => t !== 'field';
// The steps this business goes through (Field sales has no products step).
const stepsFor = (type) => [1, 2, 3, ...(shopType(type) ? [4] : []), 5, 6];
const placeWord = (type) => (type === 'storefront' ? 'shop' : type === 'field' ? 'office' : 'shop or office');

let logoReady = null;   // the shrunk logo picked on step 2, uploaded once the business exists

export async function welcome(me, arg) {
  const co = me?.companies;
  const type = co?.business_type || pending().type || 'storefront';
  const steps = stepsFor(type);
  let step = parseInt(arg, 10) || (co ? Math.max(3, co.setup_step || 3) : 1);
  if (!me && step > 2) step = 2;            // no business yet: type and details first
  if (me && me.role !== 'owner') return go('#/');
  if (!steps.includes(step)) step = steps.find((s) => s > step) || 6;
  const idx = steps.indexOf(step);
  const ctx = { me, co, type, step, steps, next: steps[idx + 1], back: steps[idx - 1] };
  const screen = { 1: stepType, 2: stepDetails, 3: stepPlaces, 4: stepProducts, 5: stepInvite, 6: stepDone }[step];
  return screen(ctx);
}

// The frame around every step: progress bar, step number, Back / Skip / Next.
function frame(ctx, { title, lead = '', body, next = 'Next', skip = false, form = true }) {
  const n = ctx.steps.indexOf(ctx.step) + 1, of = ctx.steps.length;
  const pct = Math.round((100 * n) / of);
  const nav = `
    <div class="wiz-actions">
      ${ctx.back ? `<a class="secondary button" href="#/welcome/${ctx.back}">Back</a>` : '<span></span>'}
      ${skip ? `<button type="button" class="link skip" id="skip">Skip for now</button>` : ''}
      ${next ? `<button type="submit" class="primary">${next}</button>` : ''}
    </div>`;
  return `
    <main class="page narrow wizard">
      <div class="brand">${wordmark()}</div>
      <div class="wiz-progress" role="progressbar" aria-valuemin="1" aria-valuemax="${of}" aria-valuenow="${n}" aria-label="Setup progress">
        <span style="width:${pct}%"></span></div>
      <p class="wiz-step muted">Step ${n} of ${of}</p>
      <h1>${title}</h1>
      ${lead ? `<p class="muted">${lead}</p>` : ''}
      ${form ? `<form class="stack" novalidate>${body}<p class="error" role="alert"></p>${nav}</form>` : `${body}${nav}`}
    </main>`;
}

// Saves the step reached on the server (the business exists), then shows it.
async function goStep(ctx, step, done = false) {
  if (ctx.me) await api.rpc('save_setup', { p_step: step, p_done: done }).catch(() => {});
  reloadMe();
  go('#/welcome/' + step);
}
function wireSkip(ctx) {
  const s = app.querySelector('#skip');
  if (s) s.onclick = () => goStep(ctx, ctx.next);
}

// ── 1. Business type ──
function stepType(ctx) {
  const p = pending();
  const chosen = ctx.co?.business_type || p.type || '';
  const plan = ctx.co?.plan || p.plan || 'starter';
  show(frame(ctx, {
    title: 'What kind of business?',
    lead: 'Pinga shows only what you need. You can change this later.',
    body: `
      <fieldset class="type-cards"><legend class="sr">Business type</legend>
        ${Object.entries(TYPES).map(([v, t]) => `
          <label class="type-card"><input type="radio" name="type" value="${v}"${v === chosen ? ' checked' : ''} required>
            <span class="tc-icon">${ICONS[v]}</span>
            <span class="tc-text"><strong>${t.title}</strong><span class="tc-eg">${t.eg}</span><span class="tc-does">${t.does}</span></span>
            <span class="tc-tick">${ICON.checkSmall}</span></label>`).join('')}
      </fieldset>
      <p class="banner tip" id="plan-note" hidden>Field sales comes with the Business plan. We'll start you on Business, still free for the first month.</p>`,
  }), async ({ type }) => {
    if (!type) throw new Say('Choose one to continue.');
    if (ctx.co) {
      if (type !== ctx.co.business_type) {
        await api.rpc('set_business_type', { p_type: type });
        if (type !== 'storefront' && ctx.co.plan === 'starter') await api.rpc('set_plan', { p_plan: 'business' });
      }
      return goStep(ctx, 2);
    }
    setPending({ type, plan: type !== 'storefront' && plan === 'starter' ? 'business' : plan });
    go('#/welcome/2');
  });
  const note = app.querySelector('#plan-note');
  const sync = () => { note.hidden = !(plan === 'starter' && ['field', 'both'].includes(app.querySelector('input[name=type]:checked')?.value)); };
  app.querySelectorAll('input[name=type]').forEach((r) => r.addEventListener('change', sync));
  sync();
}

// ── 2. Business details ──
function stepDetails(ctx) {
  const p = pending();
  const co = ctx.co || {};
  if (!ctx.co && !p.type) return go('#/welcome/1');
  show(frame(ctx, {
    title: 'Your business',
    lead: 'This goes on receipts and the evening email.',
    body: `
      <label>Business name<input name="business" value="${esc(co.name || p.business || '')}" autocomplete="organization" placeholder="e.g. Mama Put Stores" required></label>
      <div class="logo-field"><span class="label">Logo <span class="muted">(optional)</span></span>
        <div class="logo-row"><span class="logo-box">${logoReady ? `<img src="${URL.createObjectURL(logoReady.blob)}" alt="Your logo">` : '<span class="muted small">No logo</span>'}</span>
          <label class="secondary button file">Choose picture<input type="file" accept="image/png,image/jpeg" class="logo-file"></label></div>
        <p class="hint muted logo-status">PNG or JPG. We make it small for you.</p></div>
      <label><span>Business phone <span class="muted">(optional)</span></span><input name="bphone" type="tel" value="${esc(co.phone || p.bphone || (p.phone ? displayPhone(p.phone) : ''))}" placeholder="0803 123 4567" maxlength="30"></label>
      <label><span>Address <span class="muted">(optional)</span></span><input name="address" value="${esc(co.address || p.address || '')}" maxlength="200" placeholder="e.g. 12 Herbert Macaulay Way, Yaba"></label>`,
  }), async ({ business, bphone, address }) => {
    if (!business.trim()) throw new Say('Please enter the business name.');
    const details = { phone: bphone.trim() || null, address: address.trim() || null };
    let companyId = ctx.me?.company_id;
    if (!companyId) {
      setPending({ business: business.trim(), bphone: details.phone, address: details.address });   // the owner's own phone stays in .phone
      const q = pending();
      companyId = await api.rpc('create_company', { p_name: business.trim(), p_owner_name: properName(q.name || 'Owner'), p_type: q.type, p_plan: q.plan || 'starter', p_phone: q.phone || null });
    } else {
      details.name = business.trim();
    }
    if (logoReady) {
      const path = `${companyId}/logo-${Date.now().toString(36)}.${logoReady.type === 'image/png' ? 'png' : 'jpg'}`;
      await api.upload('logos', path, logoReady.blob);
      details.logo_path = path;
      logoReady = null;
    }
    await api.update('companies', `id=eq.${companyId}`, details);
    try { localStorage.removeItem(PENDING); } catch { /* fine */ }
    await api.rpc('save_setup', { p_step: 3, p_done: false }).catch(() => {});
    reloadMe();
    go('#/welcome/3');
  });
  const input = app.querySelector('.logo-file');
  input.addEventListener('change', async () => {
    const status = app.querySelector('.logo-status'), box = app.querySelector('.logo-box');
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    status.textContent = 'Making it smaller…';
    try {
      const { shrinkLogo } = await import('./image.js');
      logoReady = await shrinkLogo(file);
      box.innerHTML = `<img src="${URL.createObjectURL(logoReady.blob)}" alt="Your logo">`;
      status.textContent = 'Ready. It will be saved when you tap Next.';
    } catch (x) {
      logoReady = null;
      status.textContent = x.message === 'not-an-image' ? 'Please choose a PNG or JPG picture.' : 'That picture is too detailed. Try a simpler version of the logo.';
    }
  });
}

// ── 3. Shops or offices, with a pin on the map ──
async function stepPlaces(ctx) {
  const word = placeWord(ctx.type);
  const places = await api.select('branches', `select=id,name,kind,lat,lng&company_id=eq.${ctx.me.company_id}&order=created_at`);
  const starter = ctx.co.plan === 'starter';
  const adding = !places.length || location.hash.endsWith('?add');
  const Word = word[0].toUpperCase() + word.slice(1);
  show(frame(ctx, {
    title: places.length ? `Your ${ctx.type === 'storefront' ? 'shops' : ctx.type === 'field' ? 'offices' : 'shops and offices'}` : `Add your ${word}`,
    lead: ctx.type === 'field' ? 'Where your office staff clock in.' : 'Where your staff clock in and sell.',
    skip: !places.length,
    body: `
      ${places.length ? `<ul class="list wiz-list">${places.map((b) => `<li class="card row"><span class="tick on">${ICON.checkSmall}</span><span><strong>${esc(b.name)}</strong>${ctx.type === 'both' ? ` <span class="pill">${b.kind === 'shop' ? 'Shop' : 'Office'}</span>` : ''}</span></li>`).join('')}</ul>` : ''}
      ${adding ? `
        <label>${Word} name<input name="name" placeholder="${ctx.type === 'field' ? 'e.g. Head office' : 'e.g. Yaba shop'}" required></label>
        ${ctx.type === 'both' ? `<fieldset class="choices inline"><legend>This is</legend>
          <label class="choice"><input type="radio" name="kind" value="shop" checked><span><strong>A shop</strong></span></label>
          <label class="choice"><input type="radio" name="kind" value="office"><span><strong>An office</strong></span></label></fieldset>` : ''}
        <div class="map-field"><span class="label">Where is it?</span>
          <div class="pick-map" id="map" aria-label="Map. Drag the pin, or tap the map, to the ${word}."></div>
          <button type="button" class="secondary" id="here">${ICON.pin || ''}Use my current location</button>
          <p class="hint muted" id="where-hint">Standing in the ${word}? Tap the button. Or drag the pin to it.</p>
          <input type="hidden" name="where" id="where"></div>`
      : starter ? '<p class="muted small">Starter includes 1 shop or office. Move to Business in Setup → Billing to add more.</p>'
        : `<a class="link" href="#/welcome/3?add">+ Add another ${word}</a>`}`,
  }), async ({ name, where, kind }) => {
    if (!adding) return goStep(ctx, ctx.next);
    if (!name.trim()) throw new Say(`Please give the ${word} a name.`);
    const pos = parseLatLng(where || '');
    if (!pos) throw new Say(`Show us where the ${word} is: tap "Use my current location" or drag the pin.`);
    const row = { company_id: ctx.me.company_id, name: name.trim(), lat: pos.lat, lng: pos.lng, radius_m: 100 };
    if (ctx.type === 'both') row.kind = kind === 'office' ? 'office' : 'shop';
    if (ctx.type === 'storefront') row.kind = 'shop';
    try { await api.insert('branches', row); } catch (x) {
      if (x.code === '23505') throw new Say(`You already have a ${word} with this name.`);
      throw x;
    }
    toast(`${Word} saved`);
    await goStep(ctx, ctx.next);
  });
  wireSkip(ctx);
  if (!adding) return;
  // The map: drag the pin, tap the map, or use GPS. Without the map (no signal), GPS still works.
  const whereEl = app.querySelector('#where'), hint = app.querySelector('#where-hint');
  const setWhere = (p, how) => {
    whereEl.value = `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
    hint.textContent = how;
    app.querySelector('form .error').textContent = '';   // the place is set: the "show us where" message goes
  };
  let picker = null;
  import('./map.js').then(({ pinPicker }) => pinPicker(app.querySelector('#map'), null, (p) => setWhere(p, 'Pin placed. Drag it again if it\'s not quite right.')))
    .then((pk) => { picker = pk; onLeave(() => pk.remove()); })
    .catch(() => { app.querySelector('#map').innerHTML = '<p class="muted small center">The map needs a signal. You can still use your current location.</p>'; });
  const btn = app.querySelector('#here');
  btn.onclick = () => {
    btn.disabled = true;
    btn.textContent = 'Finding your location…';
    const stop = watchBest((p) => {
      setWhere(p, `Found you (within ${Math.round(p.accuracy)} m). Drag the pin if it's not quite right.`);
      picker?.set(p);
      btn.textContent = 'Use my current location';
      btn.disabled = false;
    }, () => { btn.disabled = false; btn.textContent = 'Use my current location'; toast('Could not get your location. Turn on Location and allow it for this site.'); },
    { goodM: 20, maxMs: 30000 });
    onLeave(() => { stop(); picker?.remove(); });
  };
}

// ── 4. Products (shops only) ──
async function stepProducts(ctx) {
  const [products, shops] = await Promise.all([
    api.select('products', `select=id,name,price&company_id=eq.${ctx.me.company_id}&order=created_at.desc&limit=50`),
    api.select('branches', `select=id,name,kind&company_id=eq.${ctx.me.company_id}&order=created_at`),
  ]);
  const shop = shops.find((b) => b.kind === 'shop');
  const excel = ctx.co.plan !== 'starter';
  const byHand = location.hash.endsWith('?hand') || products.length > 0;
  show(frame(ctx, {
    title: 'Your products',
    lead: 'What you sell, with the price. You can add more any time in Stock.',
    skip: !products.length,
    next: products.length ? 'Next' : false,
    form: false,
    body: `
      ${byHand ? '' : `
      <div class="pick-cards">
        ${excel ? '<a class="pick-card" href="#/import" id="excel"><strong>Import from Excel</strong><span class="muted">Many products at once, from a spreadsheet</span></a>'
          : '<div class="pick-card off" aria-disabled="true"><strong>Import from Excel</strong><span class="muted">Comes with the Business plan</span></div>'}
        <a class="pick-card" href="#/welcome/4?hand"><strong>Add a few by hand</strong><span class="muted">Name, price and how many you have</span></a>
      </div>`}
      ${byHand ? `
      <form class="card stack add-product" novalidate>
        <label>Product name<input name="name" placeholder="e.g. Peak Milk 400g" required></label>
        <div class="row2">
          <label>Price (₦)${moneyInput({ name: 'price', placeholder: '2,500' })}</label>
          ${shop ? '<label>In stock<input name="qty" type="number" min="0" step="1" inputmode="numeric" placeholder="0"></label>' : ''}
        </div>
        <p class="error" role="alert"></p>
        <button type="submit" class="secondary">Add product</button>
      </form>
      ${products.length ? `<ul class="list wiz-list">${products.map((x) => `<li class="card row"><span class="tick on">${ICON.checkSmall}</span><span><strong>${esc(x.name)}</strong></span><span class="end">₦${fmtMoney(x.price)}</span></li>`).join('')}</ul>` : ''}` : ''}`,
  }));
  wireSkip(ctx);
  app.querySelector('.wiz-actions .primary')?.addEventListener('click', () => goStep(ctx, ctx.next));
  // Leaving for the Excel import: come back to this step afterwards.
  app.querySelector('#excel')?.addEventListener('click', () => api.rpc('save_setup', { p_step: 4, p_done: false }).catch(() => {}));
  const form = app.querySelector('.add-product');
  if (!form) return;
  form.querySelector('input').focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = form.querySelector('.error'), btn = form.querySelector('button');
    out.textContent = '';
    const v = Object.fromEntries(new FormData(form));
    const price = parseMoney(v.price);
    try {
      if (!v.name.trim()) throw new Say('Please enter the product name.');
      if (price === null || price <= 0) throw new Say('Please enter the price, like 2,500.');
      btn.disabled = true;
      const p = await api.insert('products', { company_id: ctx.me.company_id, name: v.name.trim(), price });
      const qty = Number(v.qty) || 0;
      if (shop && qty > 0) await api.rpc('set_stock', { p_branch: shop.id, p_product: p.id, p_qty: qty, p_expires_on: null, p_note: 'Added during setup' });
      toast(`${p.name} added`);
      go(location.hash.endsWith('?hand') ? location.hash : '#/welcome/4?hand');
    } catch (x) {
      out.textContent = x.code === '23505' ? 'You already have a product with this name.' : friendly(x);
    } finally { btn.disabled = false; }
  });
}

// ── 5. Invite staff (link sent on WhatsApp) ──
async function stepInvite(ctx) {
  const [team, shops] = await Promise.all([
    api.select('members', `select=id,full_name,phone,role,joined_at&company_id=eq.${ctx.me.company_id}&role=neq.owner&active=is.true&order=created_at`),
    api.select('branches', `select=id,name,kind&company_id=eq.${ctx.me.company_id}&order=created_at`),
  ]);
  const starter = ctx.co.plan === 'starter';
  const workplaces = ctx.type === 'field' ? [] : shops;
  show(frame(ctx, {
    title: 'Invite your staff',
    lead: 'Each person gets a link on WhatsApp to set their PIN. They sign in with their phone number.',
    skip: !team.length,
    next: team.length ? 'Next' : false,
    form: false,
    body: `
      <form class="card stack add-person" novalidate>
        <label>Full name<input name="full_name" autocomplete="off" placeholder="e.g. Kemi Adebayo" required></label>
        <label>Phone number<input name="phone" type="tel" placeholder="0803 123 4567" required></label>
        ${workplaces.length > 1 ? `<label>Works at<select name="branch">${workplaces.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></label>` : ''}
        <p class="error" role="alert"></p>
        <button type="submit" class="primary wa">Send invite on WhatsApp</button>
        ${starter ? '<p class="hint muted">Starter includes up to 5 staff.</p>' : ''}
      </form>
      ${team.length ? `<ul class="list wiz-list">${team.map((x) => `<li class="card row"><span class="tick on">${ICON.checkSmall}</span><span><strong>${esc(properName(x.full_name))}</strong><br><span class="muted small">${x.phone ? esc(displayPhone(x.phone)) : ''} · ${x.joined_at ? 'Joined' : 'Invite sent'}</span></span></li>`).join('')}</ul>` : ''}`,
  }));
  wireSkip(ctx);
  app.querySelector('.wiz-actions .primary')?.addEventListener('click', () => goStep(ctx, ctx.next));
  const form = app.querySelector('.add-person');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = form.querySelector('.error'), btn = form.querySelector('button[type=submit]');
    out.textContent = '';
    const v = Object.fromEntries(new FormData(form));
    try {
      if (!v.full_name.trim()) throw new Say('Please enter their name.');
      const phone = normalizePhone(v.phone);
      if (!phone) throw new Say('Enter a valid phone number, like 0803 123 4567.');
      btn.disabled = true;
      const fields = { company_id: ctx.me.company_id, full_name: properName(v.full_name.trim()), phone, role: 'staff' };
      const branch = v.branch || (workplaces.length === 1 ? workplaces[0].id : null);
      if (branch) fields.branch_id = branch;
      let row;
      try { row = await api.insert('members', fields); } catch (x) {
        if (x.code === '23505') throw new Say('Someone with this phone number is already in your team.');
        throw x;
      }
      const link = `${publicBase()}#/join/${row.invite_token}`;
      const text = `Hi ${firstName(row.full_name)}, ${ctx.co.name} uses Pinga${ctx.type === 'field' ? ' for attendance' : ' for attendance and sales'}. Open this link to set your PIN: ${link}`;
      openExternal(`https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(text)}`);
      toast(`Invite for ${firstName(row.full_name)} ready on WhatsApp`);
      go('#/welcome/5');
    } catch (x) { out.textContent = friendly(x); } finally { btn.disabled = false; }
  });
}

// ── 6. Done ──
async function stepDone(ctx) {
  await api.rpc('save_setup', { p_step: 6, p_done: true }).catch(() => {});
  reloadMe();
  const sells = shopType(ctx.type);
  show(frame(ctx, {
    title: "You're ready",
    lead: sells ? 'Start selling now. Your staff can clock in and sell from their phones.' : 'Your team can clock in now. You\'ll see everyone on Today.',
    form: false,
    next: false,
    body: `
      <div class="wiz-done center">${happyPin(120)}</div>
      <div class="wiz-go">
        ${sells ? `<a class="primary button big" href="#/sell">${ICON.shop}Open Sell</a>` : ''}
        <a class="${sells ? 'secondary' : 'primary'} button big" href="#/today">${ICON.today}See Today</a>
      </div>
      <p class="muted small center">Everything you set up can be changed in Setup.</p>`,
  }));
}
