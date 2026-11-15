-- Pinga · Plans, sign-up and the setup wizard (Part C)
--
-- Plans: Starter and Business (Premium, with AI cameras, is "coming soon" and not sold yet).
--   Starter:  one flat price for 1 shop or office and up to 5 staff. Sell, stock, receipts,
--             attendance and the evening email. No managers, sales reps, stores or Excel import/export.
--   Business: per shop (staff included), per extra shop staff, per office staff, per sales rep.
--             Many shops, managers, field sales, Excel import/export.
-- Rule: nobody ever pays more on Business than they would on Starter for the same set-up.
-- PLACEHOLDER prices, all in ONE place: public.billing_prices (and the trial length in public.billing_settings).

-- ── Prices ──
alter table public.billing_prices drop constraint billing_prices_module_check;
alter table public.billing_prices add constraint billing_prices_module_check
  check (module in ('attendance', 'field', 'shop', 'shop_extra_staff', 'starter'));
alter table public.billing_prices add column max_locations integer check (max_locations > 0);   -- null: no limit
insert into public.billing_prices (module, naira_per_seat, included_staff, max_locations) values ('starter', 5000, 5, 1);
update public.billing_prices set included_staff = 5 where module = 'shop';   -- same as Starter, so moving up never costs more
grant select on public.billing_prices to anon;
create policy "anyone reads prices" on public.billing_prices for select to anon using (true);

-- One row of settings. The free trial length can be changed here without touching the app.
create table public.billing_settings (
  id         boolean primary key default true check (id),
  trial_days integer not null default 30 check (trial_days between 0 and 365)
);
insert into public.billing_settings default values;
alter table public.billing_settings enable row level security;
revoke all on public.billing_settings from anon, authenticated;

-- ── Companies: plan, contact details, wizard progress ──
alter table public.companies
  add column plan text not null default 'business' check (plan in ('starter', 'business')),
  add column phone text check (length(phone) <= 30),
  add column address text check (length(address) <= 200),
  add column setup_step integer not null default 0 check (setup_step between 0 and 6),
  add column setup_done boolean not null default true;   -- existing businesses are set up; new ones start the wizard
grant update (phone, address) on public.companies to authenticated;

-- Every new business gets the trial length from the settings.
create function private.trial_end() returns timestamptz
language sql stable security definer set search_path = '' as $$
  select now() + make_interval(days => coalesce((select trial_days from public.billing_settings), 30))
$$;
alter table public.companies alter column trial_ends_at set default private.trial_end();

-- Store visits (and so sales reps and stores) are Business only.
create or replace function private.company_has(p_company uuid, p_feature text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select case p_feature
      when 'visits' then business_type in ('field', 'both') and plan <> 'starter'
      when 'shop' then business_type in ('storefront', 'both') end
    from public.companies where id = p_company), false)
$$;

create function private.plan_of(p_company uuid) returns text
language sql stable security definer set search_path = '' as $$ select plan from public.companies where id = p_company $$;
grant execute on function private.plan_of(uuid) to authenticated;

-- ── Starter limits, checked by the database whichever way the change arrives ──
create function private.starter_people() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_max integer;
begin
  if private.plan_of(new.company_id) <> 'starter' or not new.active then return new; end if;
  if new.role = 'admin' then raise exception 'Managers come with the Business plan. Move to Business in Setup → Billing.' using errcode = 'P0001'; end if;
  if new.role = 'rep' then raise exception 'Sales reps come with the Business plan. Move to Business in Setup → Billing.' using errcode = 'P0001'; end if;
  if new.role = 'staff' and (tg_op = 'INSERT' or not old.active or old.role <> 'staff') then
    select included_staff into v_max from public.billing_prices where module = 'starter';
    if (select count(*) from public.members where company_id = new.company_id and active and role = 'staff' and id <> new.id) >= v_max then
      raise exception 'Starter includes up to % staff. Move to Business in Setup → Billing to add more.', v_max using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger starter_people before insert or update of role, active on public.members for each row execute function private.starter_people();

create function private.starter_locations() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_max integer;
begin
  if private.plan_of(new.company_id) <> 'starter' then return new; end if;
  select max_locations into v_max from public.billing_prices where module = 'starter';
  if (select count(*) from public.branches where company_id = new.company_id) >= v_max then
    raise exception 'Starter includes % shop or office. Move to Business in Setup → Billing to add more.', v_max using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger starter_locations before insert on public.branches for each row execute function private.starter_locations();

create function private.business_only() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.plan_of(new.company_id) = 'starter' then
    raise exception '% come with the Business plan. Move to Business in Setup → Billing.', tg_argv[0] using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger business_only before insert on public.stores for each row execute function private.business_only('Stores and store visits');
create trigger business_only before insert on public.stock_imports for each row execute function private.business_only('Excel stock imports');

-- Exporting the register: Business only (and, with shops, the owner only).
create or replace function public.register(p_from date, p_to date)
returns table (
  day date, member_id uuid, full_name text, role public.member_role, status text, set_by_manager boolean,
  first_in timestamptz, last_out timestamptz, late_minutes integer, visits integer, visit_target integer, to_review integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me public.members := private.my_admin_membership();
  v_today date;
  d date;
begin
  if private.plan_of(v_me.company_id) = 'starter' then raise exception 'Excel export comes with the Business plan' using errcode = 'P0001'; end if;
  if not private.can_export(v_me.company_id) then raise exception 'Only the owner can export the register' using errcode = '42501'; end if;
  select (now() at time zone timezone)::date into v_today from public.companies where id = v_me.company_id;
  if p_to > v_today then p_to := v_today; end if;
  if p_from > p_to or p_to - p_from > 92 then
    raise exception 'Choose a period of up to 3 months, not in the future' using errcode = 'P0001';
  end if;
  for d in select generate_series(p_from, p_to, interval '1 day')::date loop
    return query select d, b.member_id, b.full_name, b.role, b.status, b.set_by_manager, b.first_in, b.last_out,
      b.late_minutes, b.visits, b.visit_target, b.to_review from private.board(v_me.company_id, d) b;
  end loop;
end $$;

-- ── What a business pays ──
-- Business: as before. Starter: one flat price once someone has joined.
-- A Business set-up that would fit Starter (1 location, up to the Starter staff, no sales reps) never costs more than Starter.
create or replace function private.billing_quote(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_co     public.companies;
  v_att    integer; v_field integer; v_shop integer; v_incl integer; v_extra_p integer;
  v_start  integer; v_start_staff integer; v_start_loc integer;
  v_office integer; v_reps integer; v_loose integer;
  v_shops  integer; v_shop_staff integer; v_extra integer;
  v_people integer; v_gross bigint; v_pct numeric; v_tier integer; v_amount bigint;
  v_locs   integer; v_fits boolean; v_capped boolean := false;
begin
  select * into v_co from public.companies where id = p_company;
  select max(naira_per_seat) filter (where module = 'attendance'), max(naira_per_seat) filter (where module = 'field'),
         max(naira_per_seat) filter (where module = 'shop'), max(included_staff) filter (where module = 'shop'),
         max(naira_per_seat) filter (where module = 'shop_extra_staff'),
         max(naira_per_seat) filter (where module = 'starter'), max(included_staff) filter (where module = 'starter'),
         max(max_locations) filter (where module = 'starter')
    into v_att, v_field, v_shop, v_incl, v_extra_p, v_start, v_start_staff, v_start_loc from public.billing_prices;

  -- Joined, active people, and whether each works in a shop.
  with p as (
    select m.role, m.branch_id, (m.branch_id is not null and private.branch_is_shop(m.branch_id)) as in_shop
    from public.members m where m.company_id = p_company and m.active and m.joined_at is not null and m.role in ('staff', 'rep')
  ), per_shop as (select branch_id, count(*) as n from p where role = 'staff' and in_shop group by branch_id)
  select
    case when v_co.business_type = 'storefront' or not v_co.has_attendance then 0 else (select count(*) from p where role = 'staff' and not in_shop) end,
    case when v_co.business_type = 'storefront' or not v_co.has_field then 0 else (select count(*) from p where role = 'rep') end,
    case when v_co.business_type = 'storefront' then (select count(*) from p where role = 'staff' and not in_shop) else 0 end,
    (select count(*) from per_shop), (select coalesce(sum(n), 0) from per_shop), (select coalesce(sum(greatest(n - v_incl, 0)), 0) from per_shop)
  into v_office, v_reps, v_loose, v_shops, v_shop_staff, v_extra;

  v_people := v_office + v_reps + v_shop_staff + v_loose;
  select count(*) into v_locs from public.branches where company_id = p_company;
  v_fits := v_locs <= v_start_loc and v_people <= v_start_staff and v_reps = 0;

  if v_co.plan = 'starter' then
    return jsonb_build_object('plan', 'starter', 'people', v_people, 'starter_price', v_start, 'starter_staff', v_start_staff,
      'starter_locations', v_start_loc, 'gross_kobo', case when v_people > 0 then v_start * 100 else 0 end,
      'discount_percent', 0, 'discount_min_people', null, 'capped', false,
      'staff_seats', 0, 'rep_seats', 0, 'shop_seats', 0, 'shop_extra_staff', 0, 'loose_staff', 0,
      'amount_kobo', case when v_people > 0 then v_start * 100 else 0 end);
  end if;

  v_gross := v_office * v_att + v_reps * v_field + v_shops * v_shop + (v_extra + v_loose) * v_extra_p;
  select coalesce(max(percent_off) filter (where min_people <= v_people), 0), max(min_people) filter (where min_people <= v_people)
    into v_pct, v_tier from public.billing_discounts;
  v_amount := round(v_gross * (100 - v_pct) / 100);
  if v_fits and v_people > 0 and v_amount > v_start then v_amount := v_start; v_capped := true; end if;

  return jsonb_build_object(
    'plan', 'business', 'people', v_people,
    'staff_seats', v_office, 'rep_seats', v_reps, 'staff_price', v_att, 'rep_price', v_field,
    'shop_seats', v_shops, 'shop_price', v_shop, 'shop_included_staff', v_incl, 'shop_staff', v_shop_staff,
    'shop_extra_staff', v_extra, 'loose_staff', v_loose, 'extra_staff_price', v_extra_p,
    'starter_price', v_start, 'capped', v_capped,
    'gross_kobo', v_gross * 100,
    'discount_percent', v_pct, 'discount_min_people', v_tier,
    'amount_kobo', v_amount * 100);
end $$;

-- ── The plans, for the landing page (no sign-in) and the billing page ──
create function public.plans() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'trial_days', (select trial_days from public.billing_settings),
    'starter', (select jsonb_build_object('price', naira_per_seat, 'staff', included_staff, 'locations', max_locations) from public.billing_prices where module = 'starter'),
    'business', jsonb_build_object(
      'shop', (select naira_per_seat from public.billing_prices where module = 'shop'),
      'shop_staff', (select included_staff from public.billing_prices where module = 'shop'),
      'extra_staff', (select naira_per_seat from public.billing_prices where module = 'shop_extra_staff'),
      'office_staff', (select naira_per_seat from public.billing_prices where module = 'attendance'),
      'rep', (select naira_per_seat from public.billing_prices where module = 'field')),
    'discounts', (select coalesce(jsonb_agg(jsonb_build_object('min_people', min_people, 'percent_off', percent_off) order by min_people), '[]') from public.billing_discounts))
$$;
revoke all on function public.plans() from public;
grant execute on function public.plans() to anon, authenticated;

-- Why a business can't move down to Starter right now (empty: it can).
create function private.starter_blockers(p_company uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  with lim as (select included_staff, max_locations from public.billing_prices where module = 'starter'),
  m as (select role, count(*) n from public.members where company_id = p_company and active group by role)
  select array_remove(array[
    case when (select count(*) from public.branches where company_id = p_company) > (select max_locations from lim)
      then format('more than %s shop or office', (select max_locations from lim)) end,
    case when coalesce((select n from m where role = 'staff'), 0) > (select included_staff from lim)
      then format('more than %s staff', (select included_staff from lim)) end,
    case when exists (select 1 from m where role = 'admin') then 'managers' end,
    case when exists (select 1 from m where role = 'rep') then 'sales reps' end], null)
$$;

-- The owner moves between plans. Down to Starter only when the business fits it.
create function public.set_plan(p_plan text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members := private.my_admin_membership();
  v_why text[];
begin
  if v_me.role <> 'owner' then raise exception 'Only the owner can change the plan' using errcode = '42501'; end if;
  if p_plan not in ('starter', 'business') then raise exception 'Choose Starter or Business' using errcode = '22023'; end if;
  if p_plan = 'starter' then
    v_why := private.starter_blockers(v_me.company_id);
    if cardinality(v_why) > 0 then
      raise exception 'Starter doesn''t fit yet: you have %.', array_to_string(v_why, ', ') using errcode = 'P0001';
    end if;
  end if;
  update public.companies set plan = p_plan where id = v_me.company_id;
end $$;

-- ── Sign-up: business, type, plan, phone (wizard steps 1 and 2) ──
create function public.create_company(p_name text, p_owner_name text, p_type text, p_plan text, p_phone text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  if p_plan not in ('starter', 'business') then raise exception 'Choose Starter or Business' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'Please enter the business name' using errcode = '22023'; end if;
  v_company := public.create_company(p_name, p_owner_name, p_type);
  update public.companies set plan = p_plan, phone = nullif(btrim(p_phone), ''), setup_done = false, setup_step = 3 where id = v_company;
  if btrim(p_phone) ~ '^\+[0-9]{8,15}$' then   -- the owner's own number, when the app sends it in full (+234...)
    update public.members set phone = btrim(p_phone) where company_id = v_company and role = 'owner';
  end if;
  return v_company;
end $$;

-- The wizard saves where the owner got to, so they can come back to it.
create function public.save_setup(p_step integer, p_done boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members := private.my_admin_membership();
begin
  if v_me.role <> 'owner' then raise exception 'Only the owner sets up the business' using errcode = '42501'; end if;
  if p_step not between 1 and 6 then raise exception 'Unknown step' using errcode = '22023'; end if;
  update public.companies set setup_step = p_step, setup_done = setup_done or p_done where id = v_me.company_id;
end $$;

revoke all on function public.create_company(text, text, text, text, text), public.save_setup(integer, boolean), public.set_plan(text)
  from public, anon, authenticated;
grant execute on function public.create_company(text, text, text, text, text), public.save_setup(integer, boolean), public.set_plan(text)
  to authenticated;
revoke all on function private.starter_blockers(uuid) from public, anon, authenticated;

-- The billing page also shows the plan, and whether the business could move down to Starter.
create or replace function public.billing_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me    public.members := private.my_admin_membership();
  v_co    public.companies;
  v_today date;
begin
  if v_me.role <> 'owner' then raise exception 'Only the owner can see billing' using errcode = '42501'; end if;
  select * into v_co from public.companies where id = v_me.company_id;
  v_today := (now() at time zone v_co.timezone)::date;
  return jsonb_build_object(
    'status', v_co.status,
    'plan', v_co.plan,
    'plans', public.plans(),
    'starter_blockers', to_jsonb(private.starter_blockers(v_co.id)),
    'trial_ends', (v_co.trial_ends_at at time zone v_co.timezone)::date,
    'trial_days_left', greatest(0, (v_co.trial_ends_at at time zone v_co.timezone)::date - v_today),
    'paid_until', v_co.paid_until,
    'quote', private.billing_quote(v_co.id),
    'card', (select jsonb_build_object('label', label, 'expires', expires) from private.billing_cards where company_id = v_co.id),
    'invoices', (select coalesce(jsonb_agg(jsonb_build_object('reference', reference, 'period_start', period_start, 'period_end', period_end,
        'amount_kobo', amount_kobo, 'status', status, 'paid_at', paid_at, 'staff_seats', staff_seats, 'rep_seats', rep_seats) order by created_at desc), '[]')
      from (select * from public.billing_invoices where company_id = v_co.id order by created_at desc limit 12) i));
end $$;
