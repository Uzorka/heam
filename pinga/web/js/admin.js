// Owner and manager screens: team, invites, offices, stores, store assignments, working hours.
import * as api from './api.js';
import { normalizePhone, displayPhone } from './phone.js';
import { watchBest, parseLatLng } from './gps.js';
import { ICON } from './icons.js';
import { publicBase, copyText } from './device.js';
import { ask } from './dialog.js';
import { show, go, esc, Say, friendly, toast, header, wireSignOut, onLeave, reloadMe, app, ROLE, fmtTime, fmtDay, fmtDistance, flagLabel, backLink, chev, firstName, feats, BUSINESS, logoUrl, setNav, setSell, moneyInput, parseMoney, properName } from './ui.js';

let banner = '';
let flags = null;   // what's switched on (payments, face check); loaded once per visit
// A reminder for owners and managers when the trial is ending or payment is due. Staff never see it.
function billingBanner(me) {
  const c = me.companies;
  const owner = me.role === 'owner';
  if (c.status === 'past_due') {
    return owner ? '<a class="banner bad-banner" href="#/billing">Payment due. Your team can still clock in. Pay now ›</a>'
      : '<p class="banner bad-banner">Payment due. Please ask the owner to pay so Pinga keeps running.</p>';
  }
  const left = Math.ceil((new Date(c.trial_ends_at) - Date.now()) / 864e5);
  if (c.status === 'trial' && left <= 3 && owner && flags?.payments) {
    return `<a class="banner" href="#/billing">Your free trial ends ${left <= 0 ? 'today' : `in ${left} day${left === 1 ? '' : 's'}`}. Set up payment ›</a>`;
  }
  return '';
}

const NAV_FIELD = [['#/overview', 'Overview', 'overview'], ['#/today', 'Today', 'today'], ['#/team', 'Team', 'team'], ['#/setup', 'Setup', 'setup']];
const NAV_SHOP = [['#/overview', 'Overview', 'overview'], ['#/today', 'Today', 'today'], ['#/sell', 'Sell', 'shop'], ['#/stock', 'Stock', 'stock'], ['#/team', 'Team', 'team'], ['#/setup', 'Setup', 'setup']];
let NAV = NAV_FIELD;
let F = feats(null);   // what this business type uses (set on every visit)
// One nav: bottom tab bar on phones, side rail on tablets, sidebar (with the business name) on desktops.
let ME = null;
const navHtml = (on) => {
  const src = logoUrl(ME?.companies.logo_path);
  return `
  <nav class="tabbar manager appnav" aria-label="Sections">
    <div class="nav-brand">${src ? `<img src="${esc(src)}" alt="" onerror="this.remove()">` : ''}<span>${esc(ME?.companies.name || '')}</span></div>
    ${NAV.map(([h, t, i]) => `<a href="${h}"${t === on ? ' class="on" aria-current="page"' : ''}>${ICON[i]}<span>${t}</span></a>`).join('')}
  </nav>`;
};
// What this person may do. In a business with shops, managers have limited rights (the database enforces
// every one of these; the app only hides what would be refused). Field sales: as before.
const can = (me) => {
  const owner = me.role === 'owner', limited = F.shop && !owner;
  return { owner, limited, settings: !limited, shops: !limited, export: !limited,
    staff: !limited || me.can_manage_staff, costs: owner || (F.shop && me.can_see_costs), del: owner || (F.shop && me.can_delete_products) };
};
const myShopIds = async (me) => new Set((await api.select('manager_shops', `select=branch_id&manager_id=eq.${me.id}`)).map((x) => x.branch_id));
export const rights = can;

// Which section a sub-screen belongs to (highlighted in the side nav on tablets and desktops).
const SECTION = { person: 'Team', invite: 'Team', day: 'Today', product: 'Stock', import: 'Stock', imports: 'Stock', sales: 'Stock', sale: 'Stock' };
// Main screens: the nav shows on every size. Returns the billing banner (if any) for the top of the page.
const tabs = (on) => { setNav(''); return `${banner}${navHtml(on)}`; };

export async function adminRoute(me, name, arg) {
  if (!flags) flags = await api.rpc('app_flags').catch(() => ({}));
  banner = billingBanner(me);
  F = feats(me);
  ME = me;
  NAV = F.shop ? NAV_SHOP : NAV_FIELD;
  setSell(F.shop ? '#/sell' : null);
  PLACE.office = officeKind(F);
  // A new owner goes through the setup wizard first (full screen, no menu). Any other screen still opens.
  if (name === 'welcome' && me.role === 'owner') { setNav(''); return import('./welcome.js').then((m) => m.welcome(me, arg)); }
  if (me.role === 'owner' && !me.companies.setup_done && ['', 'overview'].includes(name)) return go('#/welcome/' + Math.max(3, me.companies.setup_step || 3));
  setNav(navHtml(SECTION[name] || 'Setup'));   // sub-screens keep the side nav on bigger screens
  // Features this business type doesn't use are not reachable.
  if (!F.visits && ['stores', 'store', 'assign'].includes(name)) return go('#/setup');
  // Business settings and exports are the owner's in a business with shops.
  if (can(me).limited && ['hours', 'export', 'business', 'brand', 'billing', 'face'].includes(name)) return go('#/setup');
  if (!can(me).staff && name === 'invite') return go('#/team');
  if (!can(me).shops && name === 'office' && arg === 'new') return go('#/offices');
  // Starter: no Excel import or export (the database refuses them too).
  if (F.starter && ['import', 'export'].includes(name)) return go(name === 'import' ? '#/stock' : '#/setup');
  // Sell (full screen) for owners and managers: choose the shop if there is more than one.
  if (F.shop && name === 'sell') return sellFor(me, arg);
  if (F.shop && ['stock', 'product', 'import', 'imports', 'sales', 'sale'].includes(name)) {
    const st = await import('./stock.js');
    if (name === 'sales') return st.shopSales(me, arg);
    if (name === 'sale') return st.saleDetail(me, arg);
    if (name === 'stock') return st.stockList(me, arg, tabs);
    if (name === 'product') return st.productForm(me, arg, tabs);
    if (name === 'import') return st.importScreen(me, tabs);
    return st.importLog(me);
  }
  if (name === 'business') return businessType(me);
  if (name === 'brand') return brand(me);
  if (name === 'billing') return import('./billing.js').then((m) => m.billing(me, arg));
  if (name === 'invite') return invite(me);
  if (name === 'person') return person(me, arg);
  if (name === 'offices') return places(me, PLACE.office);
  if (name === 'office') return placeForm(me, PLACE.office, arg);
  if (name === 'stores') return places(me, PLACE.store);
  if (name === 'store') return placeForm(me, PLACE.store, arg);
  if (name === 'assign') return assign(me, arg);
  if (name === 'team') return team(me);
  if (name === 'hours') return hours(me);
  if (name === 'setup') return setup(me);
  if (name === 'face') return faceSettings(me);
  if (name === 'export') return import('./export.js').then((m) => m.exportScreen(me));
  if (name === 'today' || name === 'day') return import('./today.js').then((m) => m.today(me, arg, tabs));
  if (name === 'overview' || me.role === 'owner') return import('./overview.js').then((m) => m.overview(me, tabs));
  return import('./today.js').then((m) => m.today(me, '', tabs));
}

// ── Sell, for owners and managers ──
async function sellFor(me, shopArg) {
  const { myShops } = await import('./stock.js');
  const shops = await myShops(me);
  const shop = shops.find((b) => b.id === shopArg) || (shops.length === 1 ? shops[0] : null);
  if (shop) return (await import('./till.js')).sell(me, { shopId: shop.id, shopName: shop.name, exitTo: '#/overview' });
  show(`
    <main class="page narrow">
      ${header(me, 'Sell')}
      ${tabs('Sell')}
      ${shops.length ? `<p class="muted">Which shop are you selling in?</p>
        <ul class="list">${shops.map((b) => `<li><a class="card row" href="#/sell/${b.id}"><span><strong>${esc(b.name)}</strong></span>${chev}</a></li>`).join('')}</ul>`
        : `<div class="card stack center"><p><strong>No shops yet</strong></p>${me.role === 'owner' ? '<a class="primary button" href="#/office/new">Add a shop</a>' : '<p class="muted">Ask the owner to give you a shop.</p>'}</div>`}
    </main>`);
  wireSignOut();
}

// ── Team ────────────────────────────────────────────────────

async function team(me) {
  const [people, assigned] = await Promise.all([
    api.select('members', `select=id,full_name,phone,role,joined_at,daily_visit_target&company_id=eq.${me.company_id}&active=is.true&order=full_name`),
    F.visits ? api.select('store_assignments', `select=member_id&company_id=eq.${me.company_id}`) : [],
  ]);
  const storesOf = (id) => assigned.filter((a) => a.member_id === id).length;
  const repLine = (p) => { const n = storesOf(p.id); return n ? `${n} store${n === 1 ? '' : 's'} · ${p.daily_visit_target ?? 4} visits a day` : '<span class="late">No stores assigned yet</span>'; };
  show(`
    <main class="page">
      ${header(me, 'Team')}
      ${tabs('Team')}
      ${can(me).staff ? '<a class="primary button" href="#/invite">Invite someone</a>' : ''}
      <div class="tablewrap"><table class="rtable">
        <thead><tr><th>Name</th><th class="d">Role</th><th class="d">Phone</th>${F.visits ? '<th class="d">Stores</th>' : ''}<th class="num">Status</th></tr></thead>
        <tbody>${people.map((p) => `
          <tr data-href="#/person/${p.id}">
            <td class="main"><a href="#/person/${p.id}"><strong>${esc(properName(p.full_name))}</strong></a>
              <span class="sub muted">${ROLE[p.role]}${p.phone ? ' · ' + esc(displayPhone(p.phone)) : ''}</span>
              ${p.role === 'rep' ? `<span class="sub muted small">${repLine(p)}</span>` : ''}</td>
            <td class="d">${ROLE[p.role]}</td>
            <td class="d">${p.phone ? esc(displayPhone(p.phone)) : '<span class="muted">Signs in with email</span>'}</td>
            ${F.visits ? `<td class="d">${p.role === 'rep' ? repLine(p) : '<span class="muted">–</span>'}</td>` : ''}
            <td class="end">${p.joined_at ? '<span class="pill ok">Joined</span>' : '<span class="pill wait">Not joined</span>'}</td>
          </tr>`).join('')}</tbody></table></div>
    </main>`);
  wireSignOut();
}

// Who can be invited depends on the business type.
function inviteRoles() {
  if (F.starter) return [['staff', F.type === 'storefront' ? 'Shop staff' : 'Staff', 'Clocks in at work. Managers and sales reps come with the Business plan.']];
  if (F.type === 'storefront') return [['staff', 'Shop staff', 'Clocks in at their shop'], ['admin', 'Manager', 'Looks after one or more shops']];
  if (F.type === 'both') return [['staff', 'Staff', 'Clocks in at an office or shop'], ['rep', 'Sales rep', 'Visits stores'], ['admin', 'Manager', 'Manages the team']];
  return [['staff', 'Office staff', 'Clocks in at the office'], ['rep', 'Sales rep', 'Visits stores'], ['admin', 'Manager', 'Manages the team']];
}

// Where staff work: "Shop" in a Storefront, "Office or shop" in Both, "Home office" in Field sales.
const workplaceLabel = () => (F.type === 'storefront' ? 'Shop' : F.type === 'both' ? 'Works at' : 'Home office');

async function invite(me) {
  // Managers in a business with shops invite shop staff only, into their own shops.
  const roles = inviteRoles().filter(([v]) => !(can(me).limited && v === 'admin'));
  let places = F.shop ? await api.select('branches', `select=id,name,kind&company_id=eq.${me.company_id}&order=name`) : [];
  if (can(me).limited) { const mine = await myShopIds(me); places = places.filter((b) => mine.has(b.id)); }
  const placeName = (b) => esc(b.name) + (F.type === 'both' || b.kind === 'office' && F.shop ? (b.kind === 'shop' ? ' (shop)' : ' (office)') : '');
  show(`
    <main class="page narrow">
      ${backLink('#/team', 'Team')}
      <h1>Invite someone</h1>
      <form class="stack">
        <label>Full name<input name="full_name" autocomplete="off" required></label>
        <label>Phone number<input name="phone" type="tel" placeholder="0803 123 4567" required></label>
        <fieldset class="choices"><legend>Role</legend>
          ${roles.map(([v, t, d], i) => `<label class="choice"><input type="radio" name="role" value="${v}"${i ? '' : ' checked'}><span><strong>${t}</strong><br><span class="muted">${d}</span></span></label>`).join('')}
        </fieldset>
        ${F.shop ? `<label id="where">${workplaceLabel()}<select name="branch"><option value="">${places.length ? 'Choose later' : 'Add a shop in Setup first'}</option>${places.map((b) => `<option value="${b.id}">${placeName(b)}</option>`).join('')}</select>
          <span class="hint muted">${F.type === 'storefront' ? 'Staff see and sell only in their shop.' : 'Shop staff see and sell only in their shop.'}</span></label>` : ''}
        <p class="error" role="alert"></p>
        <button type="submit" class="primary">Create invite</button>
      </form>
    </main>`, async ({ full_name, phone, role, branch }) => {
    const p = normalizePhone(phone);
    if (!p) throw new Say('Enter a valid phone number, like 0803 123 4567.');
    let row;
    const fields = { company_id: me.company_id, full_name: full_name.trim(), phone: p, role };
    if (role === 'staff' && branch) fields.branch_id = branch;
    try { row = await api.insert('members', fields); } catch (x) {
      if (x.code === '23505') throw new Say('Someone with this phone number is already in your team.');
      throw x;
    }
    go('#/person/' + row.id);
  });
  // The shop question is only for staff.
  const where = document.getElementById('where');
  if (where) {
    const sync = () => { where.hidden = app.querySelector('input[name=role]:checked')?.value !== 'staff'; };
    app.querySelectorAll('input[name=role]').forEach((r) => r.addEventListener('change', sync));
    sync();
  }
}

// Loads private photos into <img data-photo="path"> once the screen is shown.
function loadPhotos() {
  const urls = [];
  onLeave(() => urls.forEach((u) => URL.revokeObjectURL(u)));
  app.querySelectorAll('img[data-photo]').forEach(async (img) => {
    try {
      const url = URL.createObjectURL(await api.download('photos', img.dataset.photo));
      urls.push(url);
      img.src = url;
    } catch { const ph = document.createElement('span'); ph.className = img.className; ph.title = 'Photo not available'; img.replaceWith(ph); }
  });
}

async function person(me, id) {
  const tz = me.companies.timezone;
  const mid = encodeURIComponent(id);
  const [[p], records] = await Promise.all([
    api.select('members', `select=id,full_name,phone,role,joined_at,invite_token,reference_photo_path,daily_visit_target,branch_id,can_see_costs,can_manage_staff,can_delete_products&id=eq.${mid}`),
    api.select('attendance', `select=id,kind,happened_at,late_minutes,distance_m,photo_path,flags,face_similarity&member_id=eq.${mid}&order=happened_at.desc&limit=10`),
  ]);
  if (!p) return go('#/team');
  const isRep = p.role === 'rep', isStaff = p.role === 'staff', seesPay = me.role === 'owner' && (isRep || isStaff);
  // Owners choose which shops a manager looks after.
  const pickShops = F.shop && p.role === 'admin' && me.role === 'owner';
  const [offices, pay, myShops] = await Promise.all([
    isStaff || pickShops ? api.select('branches', `select=id,name,kind&company_id=eq.${me.company_id}&order=name`) : [],
    seesPay ? api.select('pay_rates', `select=monthly_naira&member_id=eq.${mid}`) : [],
    pickShops ? api.select('manager_shops', `select=branch_id&manager_id=eq.${mid}`) : [],
  ]);
  const shops = offices.filter((b) => b.kind === 'shop');
  const placeName = (b) => esc(b.name) + (F.type === 'both' ? (b.kind === 'shop' ? ' (shop)' : ' (office)') : '');
  // Can I change this person? (Managers in a business with shops: with the "shop staff" right, their shops' staff only.)
  const c = can(me);
  const mine = c.limited ? await myShopIds(me) : null;
  const mayManage = p.role !== 'owner' && p.id !== me.id && (!c.limited || (c.staff && !['admin', 'owner'].includes(p.role) && (!p.branch_id || mine.has(p.branch_id))));
  const choosable = c.limited ? offices.filter((o) => mine.has(o.id)) : offices;
  const monthly = pay[0]?.monthly_naira;
  const [assigned, visits, stores] = isRep ? await Promise.all([
    api.select('store_assignments', `select=store_id&member_id=eq.${mid}`),
    api.select('visits', `select=id,store_id,happened_at,distance_m,selfie_path,shelf_photo_path,note,flags,face_similarity&member_id=eq.${mid}&order=happened_at.desc&limit=10`),
    api.select('stores', `select=id,name&company_id=eq.${me.company_id}`),
  ]) : [[], [], []];
  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const visitRow = (v) => `
      <li class="card row record">
        ${v.selfie_path ? `<img class="thumb" data-photo="${esc(v.selfie_path)}" alt="Selfie at the store">` : '<span class="thumb"></span>'}
        <span class="grow"><strong>${esc(storeName.get(v.store_id) || 'Store')}</strong><br>
          <span class="muted">${fmtDay(v.happened_at, tz)} · ${fmtTime(v.happened_at, tz)}</span>
          ${v.note ? `<br><span class="note">“${esc(v.note)}”</span>` : ''}
          ${v.flags.length ? '<br>' + v.flags.map((f) => `<span class="pill warn">${esc(flagLabel(f, 'store'))}${f === 'outside_radius' && v.distance_m != null ? ` (${fmtDistance(v.distance_m)})` : ''}${f === 'face_mismatch' && v.face_similarity != null ? ` (${Math.round(v.face_similarity)}% alike)` : ''}</span>`).join(' ') : ''}</span>
        ${v.shelf_photo_path ? `<img class="thumb" data-photo="${esc(v.shelf_photo_path)}" alt="Shelf photo">` : ''}
      </li>`;
  const details = (isRep || isStaff) && mayManage ? `
      <h2 class="section">Details</h2>
      <div class="card stack">
        <form class="stack details">
          ${isRep ? `<label>Visits per day<input name="target" type="number" min="0" max="50" value="${p.daily_visit_target ?? 4}" required></label>` : ''}
          ${isStaff ? `<label>${workplaceLabel()}<select name="branch"><option value="">Not set</option>${choosable.map((o) => `<option value="${o.id}"${o.id === p.branch_id ? ' selected' : ''}>${placeName(o)}</option>`).join('')}</select>
            <span class="hint muted">${F.shop ? 'Their shop decides which manager sees them.' : "Used on the owner's dashboard when they haven't clocked in yet."}</span></label>` : ''}
          ${seesPay ? `<label><span>Monthly pay (₦) <span class="muted">(optional)</span></span>${moneyInput({ name: 'pay', value: monthly, placeholder: 'e.g. 150,000' })}
            <span class="hint muted">Only you (the owner) can see this. Used to show the cost of lost time.</span></label>` : ''}
          <p class="error" role="alert"></p>
          <button type="submit" class="secondary">Save</button>
        </form>
        ${isRep ? `<a class="row link-row" href="#/assign/${p.id}"><span>Assigned stores</span><span><b>${assigned.length}</b> ${chev}</span></a>` : ''}
      </div>
      ${visits.length ? `<h2 class="section">Recent visits</h2><ul class="list">${visits.map(visitRow).join('')}</ul>` : ''}` : isStaff && !mayManage && p.branch_id ? `<p class="muted">${workplaceLabel()}: ${esc(offices.find((o) => o.id === p.branch_id)?.name || '')}</p>` : '';
  // The owner switches a manager's optional rights on or off (a business with shops).
  const RIGHTS = [['can_see_costs', 'See cost prices and profit', 'Cost price on each product, stock value at cost, and profit on sales.'],
    ['can_manage_staff', 'Invite and remove shop staff', 'Only for the shops they look after. They can never add or remove managers.'],
    ['can_delete_products', 'Delete products', 'Permanently, and only products that were never sold. Without this they can still "Stop selling" a product.']];
  const rightsCard = pickShops ? `
      <h2 class="section">Rights</h2>
      <div class="card">
        <p class="muted">Every manager can: add, edit and import products; adjust stock; set prices; cancel sales with a reason; see their shops' sales, stock and attendance; mark attendance; close the till.</p>
        <ul class="switches">${RIGHTS.map(([k, t, d]) => `
          <li><span><strong>${t}</strong><br><span class="muted small">${d}</span></span>
            <label class="switch"><input type="checkbox" data-right="${k}"${p[k] ? ' checked' : ''} aria-label="${t}"><span></span></label></li>`).join('')}</ul>
        <p class="muted small">Managers can never see billing, add or remove shops, change business settings, or export all your data.</p>
      </div>` : '';
  const removeBtn = mayManage && p.role !== 'owner' ? `<button class="link block danger-link" id="remove">Remove ${esc(firstName(p.full_name))} from the team</button>` : '';
  const shopsCard = pickShops ? `
      <h2 class="section">Shops they look after</h2>
      <form class="card stack shops">
        ${shops.length ? `<fieldset class="choices"><legend class="sr">Shops</legend>${shops.map((b) => `<label class="choice"><input type="checkbox" name="shop" value="${b.id}"${myShops.some((m) => m.branch_id === b.id) ? ' checked' : ''}><span><strong>${esc(b.name)}</strong></span></label>`).join('')}</fieldset>`
          : '<p class="muted">No shops yet. <a href="#/offices">Add a shop</a> first.</p>'}
        <p class="hint muted">${esc(firstName(p.full_name))} will see only the staff of these shops. Leave all unticked and they see staff who aren't in any shop yet.</p>
        ${shops.length ? '<p class="error" role="alert"></p><button type="submit" class="secondary">Save shops</button>' : ''}
      </form>` : '';
  const first = firstName(p.full_name);
  const share = (token) => {
    const link = `${publicBase()}#/join/${token}`;
    const text = `Hi ${first}, ${me.companies.name} uses Pinga${isRep ? ' for store visits' : ' for attendance'}. Open this link to set your PIN: ${link}`;
    return `
      <div class="card stack">
        <p>Send ${esc(first)} this link. It works for 7 days.</p>
        <input readonly value="${esc(link)}" id="link" aria-label="Invite link">
        <a class="primary button" href="https://wa.me/${p.phone.slice(1)}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Send on WhatsApp</a>
        <button class="secondary" id="copy">Copy link</button>
      </div>`;
  };
  const row = (r) => {
    const late = r.kind === 'in' && r.late_minutes > 0 ? ` · <span class="late">${r.late_minutes} min late</span>` : '';
    const flags = r.flags.map((f) => `<span class="pill warn">${esc(flagLabel(f, 'office'))}${f === 'outside_radius' && r.distance_m != null ? ` (${fmtDistance(r.distance_m)})` : ''}${f === 'face_mismatch' && r.face_similarity != null ? ` (${Math.round(r.face_similarity)}% alike)` : ''}</span>`).join(' ');
    return `
      <li class="card row record">
        ${r.photo_path ? `<img class="thumb" data-photo="${esc(r.photo_path)}" alt="Photo at ${r.kind === 'in' ? 'clock-in' : 'clock-out'}">` : '<span class="thumb"></span>'}
        <span class="grow"><strong>${r.kind === 'in' ? 'In' : 'Out'} ${fmtTime(r.happened_at, tz)}</strong>${late}<br>
          <span class="muted">${fmtDay(r.happened_at, tz)}</span>${flags ? '<br>' + flags : ''}</span>
      </li>`;
  };
  show(`
    <main class="page narrow">
      ${backLink('#/team', 'Team')}
      <div class="person">
        ${p.reference_photo_path ? `<img class="face" data-photo="${esc(p.reference_photo_path)}" alt="Reference photo">` : ''}
        <div><h1>${esc(properName(p.full_name))}</h1>
        <p class="muted">${ROLE[p.role]}${p.phone ? ' · ' + esc(displayPhone(p.phone)) : ''}</p></div>
      </div>
      <div id="share">
        ${p.role === 'owner' ? '<p>Owners sign in with their email.</p>'
          : p.invite_token ? share(p.invite_token)
          : `<p>${esc(first)} has joined.</p>${mayManage ? '<button class="secondary" id="reset">Forgot PIN? Create a new PIN link</button>' : ''}`}
        ${(isRep || isStaff) && p.reference_photo_path ? '<button class="link block" id="retake">Ask for a new reference photo</button>' : ''}
        ${(isRep || isStaff) && p.joined_at && !p.reference_photo_path ? `<p class="muted small">${esc(first)} will be asked for a reference photo next time they open Pinga.</p>` : ''}
      </div>
      ${details}
      ${shopsCard}
      ${rightsCard}
      ${records.length ? `<h2 class="section">Recent clock-ins</h2><ul class="list">${records.map(row).join('')}</ul>` : ''}
      ${removeBtn}
    </main>`, (isRep || isStaff) && mayManage ? async ({ target, branch, pay: newPay }) => {
    const changes = isRep ? { daily_visit_target: Number(target) } : { branch_id: branch || null };
    await api.update('members', `id=eq.${p.id}`, changes);
    if (seesPay) {
      const pay = parseMoney(newPay);
      if (pay === null) await api.remove('pay_rates', `member_id=eq.${p.id}`);
      else await api.upsert('pay_rates', { member_id: p.id, company_id: me.company_id, monthly_naira: Math.round(pay) });
    }
    toast(isRep ? `Target saved: ${Number(target)} visits a day` : 'Saved');
  } : undefined);
  loadPhotos();
  app.querySelectorAll('[data-right]').forEach((sw) => {
    sw.onchange = async () => {
      try {
        await api.update('members', `id=eq.${p.id}`, { [sw.dataset.right]: sw.checked });
        toast(`${sw.checked ? 'On' : 'Off'}: ${RIGHTS.find(([k]) => k === sw.dataset.right)[1]}`);
      } catch (x) { sw.checked = !sw.checked; toast(friendly(x)); }
    };
  });
  const rm = document.getElementById('remove');
  if (rm) {
    rm.onclick = async () => {
      if (!(await ask(`Remove ${first} from the team? They won't be able to sign in. Their past clock-ins and sales are kept.`, { ok: 'Remove', danger: true }))) return;
      try { await api.update('members', `id=eq.${p.id}`, { active: false }); toast(`${first} removed`); go('#/team'); } catch (x) { toast(friendly(x)); }
    };
  }
  const shopForm = app.querySelector('form.shops');
  if (shopForm && shops.length) {
    shopForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = shopForm.querySelector('button'), out = shopForm.querySelector('.error');
      btn.disabled = true; out.textContent = '';
      try {
        const want = new Set(new FormData(shopForm).getAll('shop'));
        const had = new Set(myShops.map((m) => m.branch_id));
        const add = [...want].filter((b) => !had.has(b)).map((b) => ({ company_id: me.company_id, manager_id: p.id, branch_id: b }));
        const drop = [...had].filter((b) => !want.has(b));
        if (drop.length) await api.remove('manager_shops', `manager_id=eq.${p.id}&branch_id=in.(${drop.join(',')})`);
        if (add.length) await api.insertRows('manager_shops', add);
        myShops.splice(0, myShops.length, ...[...want].map((b) => ({ branch_id: b })));
        toast(want.size ? `${first} looks after ${want.size} shop${want.size === 1 ? '' : 's'}` : 'Saved');
      } catch (x) { out.textContent = friendly(x); } finally { btn.disabled = false; }
    });
  }
  const wireCopy = () => {
    const btn = document.getElementById('copy');
    if (!btn) return;
    btn.onclick = async () => {
      const input = document.getElementById('link');
      if (await copyText(input.value)) btn.textContent = 'Copied';
      else { input.select(); btn.textContent = 'Selected: copy it now'; }
    };
  };
  wireCopy();
  const retake = document.getElementById('retake');
  if (retake) {
    retake.onclick = async () => {
      if (!(await ask(`Ask ${first} to take a new reference photo? Their current one will be replaced.`, { ok: 'Ask for a new photo' }))) return;
      retake.disabled = true;
      try {
        await api.rpc('clear_reference_photo', { p_member: p.id });
        toast(`${first} will be asked for a new photo next time they open Pinga`);
        person(me, id);
      } catch (x) { retake.disabled = false; toast(friendly(x)); }
    };
  }
  const reset = document.getElementById('reset');
  if (reset) {
    reset.onclick = async () => {
      reset.disabled = true;
      try {
        document.getElementById('share').innerHTML = share(await api.rpc('renew_invite', { p_member: p.id }));
        wireCopy();
      } catch (x) { reset.disabled = false; toast(friendly(x)); }
    };
  }
}

// ── Offices and stores ──────────────────────────────────────

// "Offices" in a Field sales business, "Shops" in a Storefront, both in a Both.
function officeKind(f) {
  if (f.type === 'storefront') {
    return { ...PLACE_OFFICE, plural: 'Shops', one: 'shop', empty: 'Add your shop so your staff can clock in there.', example: 'e.g. Yaba shop',
      areaHint: 'Staff must be this close to clock in without a flag. 100 m suits most shops.',
      hint: 'Stand in the shop and tap the button below, or paste the numbers from Google Maps.', kind: 'shop' };
  }
  if (f.type === 'both') {
    return { ...PLACE_OFFICE, plural: 'Offices and shops', one: 'location', empty: 'Add your offices and shops so staff can clock in there.',
      example: 'e.g. Yaba shop', hint: 'Stand there and tap the button below, or paste the numbers from Google Maps.', kind: 'choose' };
  }
  return { ...PLACE_OFFICE, kind: 'office' };
}

const PLACE = {
  office: {
    table: 'branches', plural: 'Offices', one: 'office', path: 'office', back: '#/offices',
    empty: 'Add your office so staff can clock in there.', example: 'e.g. Yaba office',
    area: 'Clock-in area', areaHint: 'Staff must be this close to clock in without a flag. 100 m suits most offices.',
    needsLocation: true, hint: 'Stand in the office and tap the button below, or paste the numbers from Google Maps.',
  },
  get store() { return PLACE_STORE; },
};
const PLACE_OFFICE = PLACE.office;
const PLACE_STORE = {
    table: 'stores', plural: 'Stores', one: 'store', path: 'store', back: '#/stores',
    empty: 'Add the stores your sales reps visit, then assign them on each rep\'s page.', example: 'e.g. Shoprite Ikeja',
    area: 'Check-in area', areaHint: 'Reps must be this close to check in without a flag. 100 m suits most stores.',
    needsLocation: false, hint: 'Optional. Leave empty and the first visit with good GPS will save it. Or stand in the store and tap the button below, or paste from Google Maps.',
};

const whereText = (k, b) => (k.table !== 'stores' ? `${k.area} ${b.radius_m} m`
  : b.lat == null ? 'No location yet · first visit will save it'
  : b.location_source === 'first_visit' ? 'Location from first visit · please check' : `${k.area} ${b.radius_m} m`);

async function places(me, k) {
  const isStores = k.table === 'stores';
  const cols = isStores ? 'id,name,address,radius_m,lat,location_source' : 'id,name,address,radius_m,kind';
  const [list, assigned, reps] = await Promise.all([
    api.select(k.table, `select=${cols}&company_id=eq.${me.company_id}&order=name`),
    isStores ? api.select('store_assignments', `select=store_id,member_id&company_id=eq.${me.company_id}`) : [],
    isStores ? api.select('members', `select=id,full_name&company_id=eq.${me.company_id}&role=eq.rep&active=is.true&order=full_name`) : [],
  ]);
  const repName = new Map(reps.map((x) => [x.id, firstName(x.full_name)]));
  const coveredBy = (sid) => assigned.filter((a) => a.store_id === sid && repName.has(a.member_id)).map((a) => repName.get(a.member_id));
  const unassigned = isStores ? list.filter((b) => !coveredBy(b.id).length).length : 0;
  show(`
    <main class="page">
      ${header(me, k.plural)}
      ${tabs('Setup')}
      ${backLink('#/setup', 'Setup')}
      ${k.table === 'branches' && !can(me).shops ? '' : k.table === 'branches' && F.starter && list.length ? '<p class="banner tip">Starter includes 1 shop or office. <a href="#/billing">Move to Business</a> to add more.</p>' : `<a class="primary button" href="#/${k.path}/new">Add ${k.one}</a>`}
      ${isStores && list.length && !reps.length ? '<p class="banner tip">Invite a sales rep (Team → Invite someone), then tap a store to choose who visits it.</p>' : ''}
      ${isStores && reps.length && unassigned ? `<p class="banner tip">${unassigned} store${unassigned === 1 ? " isn't" : "s aren't"} assigned to a sales rep yet. Tap a store to choose who visits it.</p>` : ''}
      ${list.length ? '' : `<p class="muted center empty">${k.empty}</p>`}
      <ul class="list">
        ${list.map((b) => `
          <li><a class="card row" href="#/${k.path}/${b.id}">
            <span><strong>${esc(b.name)}</strong>${k.kind === 'choose' || (k.kind === 'shop' && b.kind === 'office') ? ` <span class="pill">${b.kind === 'shop' ? 'Shop' : 'Office (no sales)'}</span>` : ''}<br><span class="muted">${b.address ? esc(b.address) + ' · ' : ''}${whereText(k, b)}</span>
              ${isStores ? `<br>${coveredBy(b.id).length ? `<span class="small">Visited by ${esc(coveredBy(b.id).join(', '))}</span>` : '<span class="pill wait">Not assigned yet</span>'}` : ''}</span>
            ${chev}
          </a></li>`).join('')}
      </ul>
    </main>`);
  wireSignOut();
}

async function placeForm(me, k, id) {
  const isNew = id === 'new';
  const isStore = k.table === 'stores';
  const [found, reps, had] = await Promise.all([
    isNew ? [{ radius_m: 100 }] : api.select(k.table, `select=*&id=eq.${encodeURIComponent(id)}`),
    isStore ? api.select('members', `select=id,full_name,phone&company_id=eq.${me.company_id}&role=eq.rep&active=is.true&order=full_name`) : [],
    isStore && !isNew ? api.select('store_assignments', `select=member_id&store_id=eq.${encodeURIComponent(id)}`) : [],
  ]);
  const b = found[0];
  if (!b) return go(k.back);
  // Shops (not offices or stores) have a phone number and, optionally, their own logo for receipts.
  const shopish = k.table === 'branches' && (k.kind === 'shop' || (k.kind === 'choose' && F.shop));
  const hadReps = new Set(had.map((a) => a.member_id));
  show(`
    <main class="page narrow">
      ${backLink(k.back, k.plural)}
      <h1>${isNew ? `Add ${k.one}` : esc(b.name)}</h1>
      <form class="stack">
        <label>Name<input name="name" value="${esc(b.name)}" placeholder="${k.example}" required></label>
        ${k.kind === 'choose' ? `<fieldset class="choices"><legend>Is this an office or a shop?</legend>
          <label class="choice"><input type="radio" name="kind" value="office"${b.kind !== 'shop' ? ' checked' : ''}><span><strong>Office</strong><br><span class="muted">Staff clock in here</span></span></label>
          <label class="choice"><input type="radio" name="kind" value="shop"${b.kind === 'shop' ? ' checked' : ''}><span><strong>Shop</strong><br><span class="muted">Staff clock in and sell here; managers see only their shops</span></span></label>
        </fieldset>` : ''}
        <label><span>Address <span class="muted">(optional)</span></span><input name="address" value="${esc(b.address)}"></label>
        ${shopish ? `<label><span>Shop phone <span class="muted">(optional, shown on receipts)</span></span><input name="phone" type="tel" value="${esc(b.phone)}" placeholder="0803 123 4567" maxlength="30"></label>` : ''}
        ${shopish ? `<label>Receipt printer paper<select name="receipt_paper">${[['80', '80 mm roll (most till printers)'], ['58', '58 mm roll (small printers)'], ['a4', 'A4 paper']].map(([v, t]) => `<option value="${v}"${(b.receipt_paper || '80') === v ? ' selected' : ''}>${t}</option>`).join('')}</select>
          <span class="hint muted">Receipts from this shop print in this size. The printer itself is chosen when printing.</span></label>` : ''}
        ${shopish && me.role === 'owner' ? logoField('Shop logo <span class="muted">(optional)</span>', b.logo_path, 'Only if this shop uses a different logo from the business. Shown on this shop\'s receipts and its staff\'s app.') : ''}
        <label><span>Location${k.needsLocation ? '' : ' <span class="muted">(optional)</span>'}</span><input name="where" id="where" value="${b.lat != null ? `${b.lat}, ${b.lng}` : ''}" placeholder="6.5095, 3.3711" inputmode="decimal"${k.needsLocation ? ' required' : ''}>
          <span class="hint muted">${b.location_source === 'first_visit' ? 'Saved from the first visit. Change it if it looks wrong.' : k.hint}</span></label>
        <button type="button" class="secondary" id="here">Use my current location</button>
        <label>${k.area} (metres)<input name="radius_m" type="number" min="20" max="2000" value="${b.radius_m}" required>
          <span class="hint muted">${k.areaHint}</span></label>
        ${isStore ? `<fieldset class="choices"><legend>Sales reps who visit this store</legend>
          ${reps.length ? reps.map((x) => `<label class="choice"><input type="checkbox" name="rep" value="${x.id}"${hadReps.has(x.id) ? ' checked' : ''}><span><strong>${esc(properName(x.full_name))}</strong>${x.phone ? `<br><span class="muted">${esc(displayPhone(x.phone))}</span>` : ''}</span></label>`).join('')
            : '<p class="muted small">No sales reps yet. Invite one from Team, then come back to choose who visits this store.</p>'}
        </fieldset>` : ''}
        <p class="error" role="alert"></p>
        <button type="submit" class="primary">Save</button>
      </form>
    </main>`, async ({ name, address, where, radius_m, kind, phone, receipt_paper }, form) => {
    const pos = where.trim() ? parseLatLng(where) : null;
    if (where.trim() && !pos) throw new Say('Location should look like 6.5095, 3.3711.');
    if (k.needsLocation && !pos) throw new Say('Please add the location.');
    const row = { name: name.trim(), address: address.trim() || null, lat: pos?.lat ?? null, lng: pos?.lng ?? null, radius_m: Number(radius_m) };
    if (shopish) { row.phone = (phone || '').trim() || null; row.receipt_paper = ['58', '80', 'a4'].includes(receipt_paper) ? receipt_paper : '80'; }
    if (k.kind === 'choose') row.kind = kind === 'shop' ? 'shop' : 'office';
    if (k.kind === 'shop' && isNew) row.kind = 'shop';
    if (k.table === 'stores') {
      const moved = !pos || pos.lat !== b.lat || pos.lng !== b.lng;
      row.location_source = !pos ? null : moved ? 'manager' : b.location_source;
    }
    let saved = b;
    try {
      if (isNew) saved = await api.insert(k.table, { company_id: me.company_id, ...row });
      else await api.update(k.table, `id=eq.${b.id}`, row);
    } catch (x) {
      if (x.code === '23505') throw new Say(`You already have ${/^[aeiou]/.test(k.one) ? 'an' : 'a'} ${k.one} with this name.`);
      throw x;
    }
    if (shopLogo.ready) {
      const path = await saveLogo(me, shopLogo.ready, 'shop');
      await api.update('branches', `id=eq.${saved.id}`, { logo_path: path });
      if (b.logo_path) api.removeFile('logos', b.logo_path).catch(() => {});
    }
    if (isStore) {
      const now = new Set(new FormData(form).getAll('rep'));
      const add = [...now].filter((r) => !hadReps.has(r));
      const drop = [...hadReps].filter((r) => !now.has(r));
      if (add.length) await api.insertRows('store_assignments', add.map((member_id) => ({ company_id: me.company_id, member_id, store_id: saved.id })));
      if (drop.length) await api.remove('store_assignments', `store_id=eq.${saved.id}&member_id=in.(${drop.join(',')})`);
    }
    toast(`${k.one[0].toUpperCase() + k.one.slice(1)} saved`);
    go(k.back);
  });
  const shopLogo = wireLogo(app);
  const btn = document.getElementById('here');
  btn.onclick = () => {
    btn.disabled = true;
    btn.textContent = 'Finding your location…';
    const stop = watchBest((p) => {
      document.getElementById('where').value = `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
      btn.textContent = `Location found (within ${Math.round(p.accuracy)} m)`;
    }, () => { btn.disabled = false; btn.textContent = 'Use my current location'; toast('Could not get your location. Turn on Location and allow it for this site.'); },
    { goodM: 15, maxMs: 30000 });
    onLeave(stop);
  };
}

// ── Which stores a rep covers ───────────────────────────────

async function assign(me, id) {
  const [[p], stores, current] = await Promise.all([
    api.select('members', `select=id,full_name&id=eq.${encodeURIComponent(id)}`),
    api.select('stores', `select=id,name,address&company_id=eq.${me.company_id}&active=is.true&order=name`),
    api.select('store_assignments', `select=store_id&member_id=eq.${encodeURIComponent(id)}`),
  ]);
  if (!p) return go('#/team');
  const first = firstName(p.full_name);
  const had = new Set(current.map((a) => a.store_id));
  show(`
    <main class="page narrow">
      ${backLink(`#/person/${p.id}`, p.full_name)}
      <h1>Stores for ${esc(first)}</h1>
      <p class="muted" id="count"></p>
      ${stores.length ? `<input id="sq" type="search" placeholder="Search stores" aria-label="Search stores"${stores.length > 8 ? '' : ' hidden'}>` : `<p class="empty">No stores yet. <a href="#/store/new">Add a store</a> first.</p>`}
      <form class="stack">
        <fieldset class="choices">
          ${stores.map((s) => `<label class="choice" data-name="${esc(`${s.name} ${s.address || ''}`.toLowerCase())}"><input type="checkbox" name="s" value="${s.id}"${had.has(s.id) ? ' checked' : ''}><span><strong>${esc(s.name)}</strong>${s.address ? `<br><span class="muted">${esc(s.address)}</span>` : ''}</span></label>`).join('')}
        </fieldset>
        <p class="error" role="alert"></p>
        <button type="submit" class="primary"${stores.length ? '' : ' hidden'}>Save</button>
      </form>
    </main>`, async (_, form) => {
    const now = new Set(new FormData(form).getAll('s'));
    const add = [...now].filter((s) => !had.has(s));
    const drop = [...had].filter((s) => !now.has(s));
    if (add.length) await api.insertRows('store_assignments', add.map((store_id) => ({ company_id: me.company_id, member_id: p.id, store_id })));
    if (drop.length) await api.remove('store_assignments', `member_id=eq.${p.id}&store_id=in.(${drop.join(',')})`);
    toast(`${first} now covers ${now.size} store${now.size === 1 ? '' : 's'}`);
    go('#/person/' + p.id);
  });
  const count = () => { document.getElementById('count').textContent = `Tick the stores ${first} covers. ${app.querySelectorAll('input[name=s]:checked').length} selected.`; };
  count();
  app.querySelector('form').addEventListener('change', count);
  const sq = document.getElementById('sq');
  if (sq) sq.oninput = () => app.querySelectorAll('[data-name]').forEach((l) => { l.hidden = !l.dataset.name.includes(sq.value.toLowerCase()); });
}

// ── Setup ───────────────────────────────────────────────────

async function setup(me) {
  const isOwner = me.role === 'owner';
  const c = can(me);
  const [[co], face] = await Promise.all([
    isOwner ? api.select('companies', `select=summary_email,sell_requires_clock_in,staff_below_lowest&id=eq.${me.company_id}`) : [{}],
    api.rpc('face_check_status').catch(() => null),
  ]);
  show(`
    <main class="page">
      ${header(me, 'Setup')}
      ${tabs('Setup')}
      <ul class="list">
        ${isOwner ? `<li><a class="card row" href="#/brand"><span><strong>Logo${F.shop ? ' and receipts' : ''}</strong><br><span class="muted">${me.companies.logo_path ? 'Your logo is on' : 'Add your logo to'} the app${F.shop ? ', receipts' : ''} and the evening email</span></span>${chev}</a></li>` : ''}
        ${isOwner ? `<li><a class="card row" href="#/business"><span><strong>Business type</strong><br><span class="muted">${BUSINESS[F.type].name}</span></span>${chev}</a></li>` : ''}
        <li><a class="card row" href="#/offices"><span><strong>${PLACE.office.plural}</strong><br><span class="muted">${F.type === 'storefront' ? 'Where your staff clock in and sell' : F.type === 'both' ? 'Where staff clock in' : 'Where office staff clock in'}</span></span>${chev}</a></li>
        ${F.visits ? `<li><a class="card row" href="#/stores"><span><strong>Stores</strong><br><span class="muted">Where sales reps check in</span></span>${chev}</a></li>` : ''}
        ${c.settings ? `<li><a class="card row" href="#/hours"><span><strong>Working hours</strong><br><span class="muted">Start, end, grace minutes, work days</span></span>${chev}</a></li>` : ''}
        ${isOwner ? `<li><a class="card row" href="#/billing"><span><strong>Billing</strong><br><span class="muted">${F.starter ? 'Starter plan' : 'Business plan'} · price, payments</span></span>${chev}</a></li>` : ''}
        ${c.export && !F.starter ? `<li><a class="card row" href="#/export"><span><strong>Export register</strong><br><span class="muted">Excel or PDF, for any period</span></span>${chev}</a></li>` : ''}
        ${isOwner && F.shop ? `<li class="card row"><span><strong>Staff must clock in before selling</strong><br><span class="muted">The till stays closed for shop staff until they clock in</span></span>
          <label class="switch"><input type="checkbox" data-co="sell_requires_clock_in"${co.sell_requires_clock_in ? ' checked' : ''} aria-label="Staff must clock in before selling"><span></span></label></li>
        <li class="card row"><span><strong>Staff may sell below the lowest price</strong><br><span class="muted">Off: staff sell only between the lowest and the selling price. On: lower is allowed but flagged for you</span></span>
          <label class="switch"><input type="checkbox" data-co="staff_below_lowest"${co.staff_below_lowest ? ' checked' : ''} aria-label="Staff may sell below the lowest price"><span></span></label></li>` : ''}
        ${face ? `<li><${isOwner ? 'a href="#/face"' : 'div'} class="card row"><span><strong>Face check</strong><br><span class="muted">${face.enabled
          ? `On. Selfies must be ${face.match_percent}% alike to the reference photo.${face.waiting ? ` ${face.waiting} waiting.` : ''}`
          : `Off until the AWS keys are added. Clock-ins work as normal.${face.waiting ? ` ${face.waiting} selfie${face.waiting === 1 ? '' : 's'} will be checked when it's switched on.` : ''}`}</span></span>
          <span class="pill ${face.enabled ? 'ok' : ''}">${face.enabled ? 'On' : 'Off'}</span>${isOwner ? chev : ''}</${isOwner ? 'a' : 'div'}></li>` : ''}
        ${isOwner ? `<li class="card row"><span><strong>Evening summary email</strong><br><span class="muted">A short summary of the day, around 7 pm</span></span>
          <label class="switch"><input type="checkbox" id="summary"${co.summary_email ? ' checked' : ''} aria-label="Evening summary email"><span></span></label></li>` : ''}
      </ul>
    </main>`);
  wireSignOut();
  app.querySelectorAll('[data-co]').forEach((x) => {
    x.onchange = async () => {
      try { await api.update('companies', `id=eq.${me.company_id}`, { [x.dataset.co]: x.checked }); reloadMe(); toast('Saved'); }
      catch (e) { x.checked = !x.checked; toast(friendly(e)); }
    };
  });
  const sw = document.getElementById('summary');
  if (sw) {
    sw.onchange = async () => {
      try {
        await api.update('companies', `id=eq.${me.company_id}`, { summary_email: sw.checked });
        toast(sw.checked ? 'Evening summary on' : 'Evening summary off');
      } catch (x) { sw.checked = !sw.checked; toast(friendly(x)); }
    };
  }
}

// ── Logo and receipts (owner) ───────────────────────────────

const logoField = (label, path, hint) => `
  <div class="logo-field"><span class="label">${label}</span>
    <div class="logo-row"><span class="logo-box">${path ? `<img src="${esc(logoUrl(path))}" alt="Current logo">` : '<span class="muted small">No logo</span>'}</span>
      <label class="secondary button file">${path ? 'Change picture' : 'Choose picture'}<input type="file" accept="image/png,image/jpeg" class="logo-file"></label></div>
    <p class="hint muted logo-status">${hint}</p></div>`;

// Shrinks the chosen picture straight away and shows it; it's uploaded when the form is saved.
function wireLogo(root) {
  const state = { ready: null };
  const input = root.querySelector('.logo-file');
  if (!input) return state;
  input.addEventListener('change', async () => {
    const status = root.querySelector('.logo-status'), box = root.querySelector('.logo-box');
    const file = input.files[0];
    input.value = '';   // the file itself is never sent with the form
    if (!file) return;
    status.textContent = 'Making it smaller…';
    try {
      const { shrinkLogo } = await import('./image.js');
      state.ready = await shrinkLogo(file);
      box.innerHTML = `<img src="${URL.createObjectURL(state.ready.blob)}" alt="New logo">`;
      status.textContent = `Ready: ${state.ready.width} × ${state.ready.height} px, ${Math.max(1, Math.round(state.ready.blob.size / 1024))} KB. Tap Save to use it.`;
    } catch (x) {
      state.ready = null;
      status.textContent = x.message === 'not-an-image' ? 'Please choose a PNG or JPG picture.' : 'That picture is too detailed to make small enough. Try a simpler version of the logo.';
    }
  });
  return state;
}

async function saveLogo(me, ready, name) {
  const path = `${me.company_id}/${name}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.${ready.type === 'image/png' ? 'png' : 'jpg'}`;
  await api.upload('logos', path, ready.blob);
  return path;
}

function brand(me) {
  if (me.role !== 'owner') return go('#/setup');
  const c = me.companies;
  show(`
    <main class="page narrow">
      ${backLink('#/setup', 'Setup')}
      <h1>Logo${F.shop ? ' and receipts' : ''}</h1>
      <form class="stack">
        ${logoField('Business logo', c.logo_path, `PNG or JPG. We make it small (about 512 px, under 200 KB) so it loads fast on any phone. Shown at the top of the app${F.shop ? ', on receipts' : ''} and in the evening email. Without a logo, your business name is shown.`)}
        ${c.logo_path ? '<button type="button" class="link" id="nologo">Remove logo</button>' : ''}
        ${F.shop ? `<label>Thank-you note on receipts<textarea name="note" rows="2" maxlength="200">${esc(c.receipt_note)}</textarea>
          <span class="hint muted">Up to 200 characters. E.g. "Thank you! Goods sold are not returnable after 7 days."</span></label>` : ''}
        <p class="error" role="alert"></p>
        <button type="submit" class="primary">Save</button>
      </form>
      ${F.shop ? '<p class="muted small">A shop can have its own logo on its receipts: open the shop in Setup → Shops.</p>' : ''}
    </main>`, async ({ note }) => {
    const changes = {};
    if (logo.ready) changes.logo_path = await saveLogo(me, logo.ready, 'logo');
    if (F.shop && note !== undefined) changes.receipt_note = note.trim() || 'Thank you for shopping with us!';
    if (Object.keys(changes).length) await api.update('companies', `id=eq.${me.company_id}`, changes);
    if (changes.logo_path && c.logo_path) api.removeFile('logos', c.logo_path).catch(() => {});
    Object.assign(c, changes);
    reloadMe();
    toast('Saved');
    brand(me);
  });
  const logo = wireLogo(app);
  const rm = document.getElementById('nologo');
  if (rm) {
    rm.onclick = async () => {
      if (!(await ask('Remove your logo? Your business name will be shown instead.', { ok: 'Remove logo', danger: true }))) return;
      try {
        await api.update('companies', `id=eq.${me.company_id}`, { logo_path: null });
        api.removeFile('logos', c.logo_path).catch(() => {});
        c.logo_path = null;
        reloadMe();
        toast('Logo removed');
        brand(me);
      } catch (x) { toast(friendly(x)); }
    };
  }
}

// ── Business type (owner) ───────────────────────────────────

function businessType(me) {
  if (me.role !== 'owner') return go('#/setup');
  show(`
    <main class="page narrow">
      ${backLink('#/setup', 'Setup')}
      <h1>Business type</h1>
      <p class="muted">This decides which screens your team sees. Changing it never deletes anything: switch back and it's all still there.</p>
      <form class="stack">
        <fieldset class="choices"><legend>What kind of business?</legend>
          ${Object.entries(BUSINESS).map(([v, b]) => `<label class="choice"><input type="radio" name="type" value="${v}"${v === F.type ? ' checked' : ''}><span><strong>${b.name}</strong><br><span class="muted">${b.blurb}</span></span></label>`).join('')}
        </fieldset>
        <p class="error" role="alert"></p>
        <button type="submit" class="primary">Save</button>
      </form>
    </main>`, async ({ type }) => {
    if (type === F.type) return go('#/setup');
    await api.rpc('set_business_type', { p_type: type });
    reloadMe();
    toast(`Business type: ${BUSINESS[type].name}`);
    go('#/setup');
  });
}

// ── Face check setting (owner) ──────────────────────────────

async function faceSettings(me) {
  if (me.role !== 'owner') return go('#/setup');
  const f = await api.rpc('face_check_status');
  show(`
    <main class="page narrow">
      ${backLink('#/setup', 'Setup')}
      <h1>Face check</h1>
      <p class="muted">Each clock-in and store visit selfie is compared with the person's reference photo. If it isn't alike enough, it is flagged "Face didn't match" for you to look at. Nobody is ever blocked.</p>
      <form class="stack">
        <label>Match needed (%)<input name="pct" type="number" min="50" max="99" step="1" value="${f.match_percent}" required>
          <span class="hint muted">90 suits most phones. If cheap or cracked cameras cause too many false flags, try 80. Lower numbers catch fewer real mismatches.</span></label>
        <p class="error" role="alert"></p>
        <button type="submit" class="primary">Save</button>
      </form>
    </main>`, async ({ pct }) => {
    const n = Number(pct);
    if (!Number.isInteger(n) || n < 50 || n > 99) throw new Say('Choose a whole number from 50 to 99.');
    await api.rpc('set_face_match_percent', { p_percent: n });
    toast(`Saved: selfies must be ${n}% alike`);
    go('#/setup');
  });
}

// ── Working hours ───────────────────────────────────────────

function hours(me) {
  const c = me.companies;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  show(`
    <main class="page">
      ${header(me, 'Working hours')}
      ${tabs('Setup')}
      ${backLink('#/setup', 'Setup')}
      <form class="stack narrow-form">
        <div class="pair">
          <label>Work starts<input name="work_starts" type="time" value="${c.work_starts.slice(0, 5)}" required></label>
          <label>Work ends<input name="work_ends" type="time" value="${c.work_ends.slice(0, 5)}" required></label>
        </div>
        <label>Late after (minutes)<input name="late_after_minutes" type="number" min="0" max="240" value="${c.late_after_minutes}" required>
          <span class="hint muted">With 15, someone clocking in at 8:14 is on time; at 8:20 they are 20 minutes late.</span></label>
        <fieldset class="days"><legend>Work days</legend>
          ${days.map((d, i) => `<label><input type="checkbox" name="d${i + 1}"${c.work_days.includes(i + 1) ? ' checked' : ''}><span>${d}</span></label>`).join('')}
        </fieldset>
        <p class="error" role="alert"></p>
        <button type="submit" class="primary">Save</button>
      </form>
    </main>`, async (v) => {
    const work_days = days.map((_, i) => i + 1).filter((n) => v['d' + n]);
    if (!work_days.length) throw new Say('Choose at least one work day.');
    if (v.work_ends <= v.work_starts) throw new Say('Work must end after it starts.');
    await api.update('companies', `id=eq.${me.company_id}`, {
      work_starts: v.work_starts, work_ends: v.work_ends, late_after_minutes: Number(v.late_after_minutes), work_days,
    });
    toast('Working hours saved');
    reloadMe();
    go('#/hours');
  });
  wireSignOut();
}
