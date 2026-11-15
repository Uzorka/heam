-- Pinga · Shops on the dashboard, in the evening email, and in billing (Part D of the Storefront module)

-- ── Billing per shop (prices still in ONE table: public.billing_prices) ──
-- PLACEHOLDER prices: ₦5,000 per shop a month, including up to 3 shop staff; ₦1,000 a month per extra.
-- A shop is billed once at least one of its staff has joined. Owners and managers stay free.
alter table public.billing_prices drop constraint billing_prices_module_check;
alter table public.billing_prices add constraint billing_prices_module_check
  check (module in ('attendance', 'field', 'shop', 'shop_extra_staff'));
alter table public.billing_prices add column included_staff integer not null default 0 check (included_staff >= 0);
insert into public.billing_prices (module, naira_per_seat, included_staff) values ('shop', 5000, 3), ('shop_extra_staff', 1000, 0);

alter table public.billing_invoices add column shop_seats integer not null default 0, add column shop_extra_staff integer not null default 0;

create or replace function private.billing_quote(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_co     public.companies;
  v_att    integer; v_field integer; v_shop integer; v_incl integer; v_extra_p integer;
  v_office integer; v_reps integer; v_loose integer;
  v_shops  integer; v_shop_staff integer; v_extra integer;
  v_people integer; v_gross bigint; v_pct numeric; v_tier integer;
begin
  select * into v_co from public.companies where id = p_company;
  select max(naira_per_seat) filter (where module = 'attendance'), max(naira_per_seat) filter (where module = 'field'),
         max(naira_per_seat) filter (where module = 'shop'), max(included_staff) filter (where module = 'shop'),
         max(naira_per_seat) filter (where module = 'shop_extra_staff')
    into v_att, v_field, v_shop, v_incl, v_extra_p from public.billing_prices;

  -- Joined, active people, and whether each works in a shop.
  with p as (
    select m.role, m.branch_id, (m.branch_id is not null and private.branch_is_shop(m.branch_id)) as in_shop
    from public.members m where m.company_id = p_company and m.active and m.joined_at is not null and m.role in ('staff', 'rep')
  ), per_shop as (select branch_id, count(*) as n from p where role = 'staff' and in_shop group by branch_id)
  select
    case when v_co.business_type = 'storefront' or not v_co.has_attendance then 0 else (select count(*) from p where role = 'staff' and not in_shop) end,
    case when v_co.business_type = 'storefront' or not v_co.has_field then 0 else (select count(*) from p where role = 'rep') end,
    case when v_co.business_type = 'storefront' then (select count(*) from p where role = 'staff' and not in_shop) else 0 end,   -- staff not in a shop yet
    (select count(*) from per_shop), (select coalesce(sum(n), 0) from per_shop), (select coalesce(sum(greatest(n - v_incl, 0)), 0) from per_shop)
  into v_office, v_reps, v_loose, v_shops, v_shop_staff, v_extra;

  v_people := v_office + v_reps + v_shop_staff + v_loose;
  v_gross := v_office * v_att + v_reps * v_field + v_shops * v_shop + (v_extra + v_loose) * v_extra_p;
  select coalesce(max(percent_off) filter (where min_people <= v_people), 0), max(min_people) filter (where min_people <= v_people)
    into v_pct, v_tier from public.billing_discounts;

  return jsonb_build_object(
    'staff_seats', v_office, 'rep_seats', v_reps, 'staff_price', v_att, 'rep_price', v_field,
    'shop_seats', v_shops, 'shop_price', v_shop, 'shop_included_staff', v_incl, 'shop_staff', v_shop_staff,
    'shop_extra_staff', v_extra, 'loose_staff', v_loose, 'extra_staff_price', v_extra_p,
    'gross_kobo', v_gross * 100,
    'discount_percent', v_pct, 'discount_min_people', v_tier,
    'amount_kobo', round(v_gross * (100 - v_pct) / 100) * 100);
end $$;

-- ── A day in the shops: sales, best sellers, discounts, stock alerts ──
-- Owners: every shop. Managers: their shops. Server jobs (evening email): every shop.
create function private.shops_day(p_company uuid, p_day date) returns jsonb
language sql stable security definer set search_path = '' as $$
  with co as (select timezone from public.companies where id = p_company),
  today as (select (now() at time zone (select timezone from co))::date as d),
  shops as (
    select b.id, b.name from public.branches b
    where b.company_id = p_company and private.branch_is_shop(b.id)
      and (auth.uid() is null or private.can_manage_shop(b.id))
  ),
  s as (select x.* from public.sales x join shops on shops.id = x.branch_id where x.local_date = p_day),
  live as (select * from s where cancelled_at is null),
  items as (select i.*, live.branch_id, live.seller_name from public.sale_items i join live on live.id = i.sale_id),
  alerts as (
    select st.branch_id, p.name, st.qty, st.expires_on,
      case when st.expires_on is not null and st.qty > 0 and st.expires_on < (select d from today) then 'expired'
           when st.expires_on is not null and st.qty > 0 and st.expires_on <= (select d from today) + 30 then 'expiring'
           when st.qty <= 0 then 'out' else 'low' end as kind
    from public.stock st join shops on shops.id = st.branch_id join public.products p on p.id = st.product_id and p.active
    where st.qty <= p.low_stock_at or (st.expires_on is not null and st.qty > 0 and st.expires_on <= (select d from today) + 30)
  )
  select jsonb_build_object(
    'total', (select coalesce(sum(total), 0) from live),
    'sales', (select count(*) from live),
    'discount', (select coalesce(sum(discount), 0) from live),
    'cancelled', (select count(*) from s where cancelled_at is not null),
    'mistakes', (select count(*) from live where mistake_at is not null),
    'out_of_stock_sales', (select count(*) from live where 'out_of_stock' = any (flags)),
    'shops', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', shops.id, 'name', shops.name,
        'total', (select coalesce(sum(total), 0) from live where branch_id = shops.id),
        'sales', (select count(*) from live where branch_id = shops.id),
        'to_check', (select count(*) from live where branch_id = shops.id and (flags <> '{}' or mistake_at is not null)),
        'low', (select count(*) from alerts where branch_id = shops.id and kind = 'low'),
        'out', (select count(*) from alerts where branch_id = shops.id and kind = 'out'),
        'expiring', (select count(*) from alerts where branch_id = shops.id and kind in ('expiring', 'expired'))
      ) order by shops.name), '[]') from shops),
    'best', (select coalesce(jsonb_agg(b order by b.qty desc, b.name), '[]') from (
        select product_name as name, sum(qty) as qty, sum(qty * unit_price) as total from items
        group by product_name order by sum(qty) desc, product_name limit 5) b),
    'below_lowest', (select coalesce(jsonb_agg(jsonb_build_object('product', i.product_name, 'price', i.unit_price, 'lowest', i.lowest_price,
        'seller', i.seller_name, 'shop', (select name from shops where id = i.branch_id)) order by i.product_name), '[]')
        from items i where 'below_lowest' = any (i.flags)),
    'low_stock', (select coalesce(jsonb_agg(jsonb_build_object('product', a.name, 'shop', (select name from shops where id = a.branch_id), 'qty', a.qty)
        order by a.qty, a.name), '[]') from alerts a where a.kind in ('low', 'out')),
    'expiring', (select coalesce(jsonb_agg(jsonb_build_object('product', a.name, 'shop', (select name from shops where id = a.branch_id), 'expires_on', a.expires_on)
        order by a.expires_on, a.name), '[]') from alerts a where a.kind in ('expiring', 'expired'))
  )
$$;

create function public.shops_overview(p_day date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me public.members := private.my_admin_membership();
begin
  if not private.company_has(v_me.company_id, 'shop') then return null; end if;
  return private.shops_day(v_me.company_id, p_day);
end $$;
revoke all on function public.shops_overview(date) from public, anon, authenticated;
grant execute on function public.shops_overview(date) to authenticated;

-- The evening email gets the shops' day too (Storefront and Both).
create or replace function public.summary_content(p_company uuid, p_day date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  select jsonb_build_object(
    'company', (select name from public.companies where id = p_company),
    'day', p_day,
    'to', (select coalesce(jsonb_agg(u.email), '[]') from public.members m join auth.users u on u.id = m.user_id
           where m.company_id = p_company and m.role = 'owner' and m.active and u.email not like '%@phone.usepinga.com'),
    'people', count(*),
    'present', count(*) filter (where status = 'present'),
    'late', coalesce(jsonb_agg(jsonb_build_object('name', full_name, 'minutes', late_minutes) order by late_minutes desc) filter (where status = 'late'), '[]'),
    'absent', coalesce(jsonb_agg(full_name order by full_name) filter (where status in ('absent', 'none')), '[]'),
    'away', count(*) filter (where status in ('leave', 'off')),
    'visits_done', coalesce(sum(least(visits, visit_target)) filter (where role = 'rep'), 0),
    'visits_planned', coalesce(sum(visit_target) filter (where role = 'rep' and status not in ('leave', 'off')), 0),
    'below_target', coalesce(jsonb_agg(jsonb_build_object('name', full_name, 'visits', visits, 'target', visit_target) order by full_name)
                       filter (where role = 'rep' and visits < visit_target and status not in ('leave', 'off')), '[]'),
    'to_review', coalesce(sum(to_review), 0))
  into v from private.board(p_company, p_day);

  v := v || jsonb_build_object('face_mismatches', (
    select coalesce(jsonb_agg(jsonb_build_object('name', x.full_name, 'what', x.what) order by x.happened_at), '[]')
    from (
      select m.full_name, case a.kind when 'in' then 'clock-in' else 'clock-out' end as what, a.happened_at
      from public.attendance a join public.members m on m.id = a.member_id
      where a.company_id = p_company and a.local_date = p_day and a.face_status = 'mismatch'
      union all
      select m.full_name, 'visit to ' || s.name, y.happened_at
      from public.visits y join public.members m on m.id = y.member_id join public.stores s on s.id = y.store_id
      where y.company_id = p_company and y.local_date = p_day and y.face_status = 'mismatch'
    ) x));
  if private.company_has(p_company, 'shop') then
    v := v || jsonb_build_object('shops', private.shops_day(p_company, p_day));
  end if;
  return v;
end $$;
