-- Pinga · Roles and permissions for businesses with shops (Storefront and Both)
-- Every rule is enforced here, in the database, not just by hiding buttons in the app.
--
-- SHOP STAFF: sell (between the lowest allowed price and the selling price), clock in/out, see their own
--   sales today, report a mistake. They read product names, prices and their own shop's stock; nothing else.
--   Owner setting (default on): clocked in before selling.
-- MANAGERS (only the shops the owner gave them): products, prices, imports, stock, cancel sales, their shops'
--   sales/stock/attendance, mark attendance, close the till. Not: billing, adding or removing shops,
--   managers, business settings or type, other shops, deleting products, exporting all the business's data.
--   Optional rights the owner switches on per manager: cost prices and profit; shop staff; deleting products.
-- OWNERS: everything.
-- Field sales businesses keep working exactly as before.

-- ── Owner settings for the till ──
alter table public.companies
  add column sell_requires_clock_in boolean not null default true,
  add column staff_below_lowest boolean not null default false;   -- off: staff can't go below the lowest price
grant update (sell_requires_clock_in, staff_below_lowest, summary_email) on public.companies to authenticated;

-- In a business with shops only the owner changes business settings (hours, settings, logo...).
drop policy "admins update own company" on public.companies;
create policy "admins update own company" on public.companies for update to authenticated
  using (private.is_admin(id) and (not private.company_has(id, 'shop') or private.my_role(id) = 'owner'))
  with check (private.is_admin(id) and (not private.company_has(id, 'shop') or private.my_role(id) = 'owner'));

-- ── Optional rights per manager (switched on by the owner) ──
alter table public.members
  add column can_see_costs boolean not null default false,
  add column can_manage_staff boolean not null default false,
  add column can_delete_products boolean not null default false;
grant update (can_see_costs, can_manage_staff, can_delete_products) on public.members to authenticated;

create function private.manager_rights_owner_only() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null
     and (new.can_see_costs, new.can_manage_staff, new.can_delete_products) is distinct from (old.can_see_costs, old.can_manage_staff, old.can_delete_products)
     and private.my_role(new.company_id) is distinct from 'owner' then
    raise exception 'Only the owner can change a manager''s rights' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger manager_rights_owner_only before update on public.members for each row execute function private.manager_rights_owner_only();

-- Has the signed-in person this right in this business? Owners always; managers if switched on.
create function private.my_right(p_company uuid, p_right text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.role = 'owner' or (m.role = 'admin' and case p_right
      when 'costs' then m.can_see_costs when 'staff' then m.can_manage_staff when 'delete' then m.can_delete_products else false end)
    from public.members m where m.company_id = p_company and m.user_id = auth.uid() and m.active limit 1), false)
$$;
grant execute on function private.my_right(uuid, text) to authenticated;

-- ── People: in a business with shops, only owners add or change managers; managers need the
--    "shop staff" right to add, change or remove anyone, and only for their own shops. ──
create function private.may_manage_member(p_company uuid, p_role public.member_role, p_branch uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when not private.company_has(p_company, 'shop') then true                       -- Field sales: as before
    when private.my_role(p_company) = 'owner' then true
    when p_role in ('admin', 'owner') then false                                     -- managers never manage managers
    else private.my_right(p_company, 'staff') and (p_branch is null or private.can_manage_shop(p_branch))
  end
$$;
grant execute on function private.may_manage_member(uuid, public.member_role, uuid) to authenticated;

drop policy "admins add members" on public.members;
create policy "admins add members" on public.members for insert to authenticated
  with check (
    private.is_admin(company_id)
    and (role <> 'owner' or private.my_role(company_id) = 'owner')
    and (role <> 'rep' or private.company_has(company_id, 'visits'))
    and private.may_manage_member(company_id, role, branch_id));
drop policy "admins edit members" on public.members;
create policy "admins edit members" on public.members for update to authenticated
  using (private.is_admin(company_id) and private.can_see_member(id) and (role <> 'owner' or private.my_role(company_id) = 'owner')
         and private.may_manage_member(company_id, role, branch_id))
  with check (private.is_admin(company_id) and (role <> 'owner' or private.my_role(company_id) = 'owner')
    and (role <> 'rep' or private.company_has(company_id, 'visits'))
    and private.may_manage_member(company_id, role, branch_id));

-- A new PIN link is "managing" the person too.
create or replace function public.renew_invite(p_member uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_member public.members;
  v_token  text := replace(gen_random_uuid()::text, '-', '');
begin
  select * into v_member from public.members where id = p_member;
  if v_member.id is null or not private.is_admin(v_member.company_id) or not private.can_see_member(p_member)
     or not private.may_manage_member(v_member.company_id, v_member.role, v_member.branch_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_member.role = 'owner' then
    raise exception 'Owners sign in with email' using errcode = 'P0001';
  end if;
  update public.members set invite_token = v_token, invite_expires_at = now() + interval '7 days'
  where id = p_member;
  return v_token;
end $$;

-- ── Shops: only the owner adds or removes them; managers edit only their own. ──
drop policy "admins insert branches" on public.branches;
create policy "admins insert branches" on public.branches for insert to authenticated
  with check (private.is_admin(company_id) and (not private.company_has(company_id, 'shop') or private.my_role(company_id) = 'owner'));
drop policy "admins update branches" on public.branches;
create policy "admins update branches" on public.branches for update to authenticated
  using (private.is_admin(company_id) and (not private.company_has(company_id, 'shop') or private.my_role(company_id) = 'owner' or private.can_manage_shop(id)))
  with check (private.is_admin(company_id) and (not private.company_has(company_id, 'shop') or private.my_role(company_id) = 'owner' or (private.can_manage_shop(id) and kind = 'shop')));
drop policy "admins delete branches" on public.branches;
create policy "admins delete branches" on public.branches for delete to authenticated
  using (private.is_admin(company_id) and (not private.company_has(company_id, 'shop') or private.my_role(company_id) = 'owner'));

-- ── Cost prices: owners, and managers with the "cost prices and profit" right. Never shop staff. ──
create table public.product_costs (
  product_id uuid primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  cost_price numeric(12, 2) not null check (cost_price >= 0),
  updated_at timestamptz not null default now(),
  foreign key (company_id, product_id) references public.products (company_id, id) on delete cascade
);
alter table public.product_costs enable row level security;
revoke all on public.product_costs from anon, authenticated;
grant select, insert, update, delete on public.product_costs to authenticated;
create policy "cost readers" on public.product_costs for select to authenticated using (private.my_right(company_id, 'costs'));
create policy "cost writers add" on public.product_costs for insert to authenticated with check (private.my_right(company_id, 'costs'));
create policy "cost writers edit" on public.product_costs for update to authenticated using (private.my_right(company_id, 'costs')) with check (private.my_right(company_id, 'costs'));
create policy "cost writers remove" on public.product_costs for delete to authenticated using (private.my_right(company_id, 'costs'));

-- When prices last changed (lets a sale made offline before a price change through, flagged).
alter table public.products add column updated_at timestamptz not null default now();
create function private.product_touched() returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.price, new.lowest_price) is distinct from (old.price, old.lowest_price) then new.updated_at := now(); end if;
  return new;
end $$;
create trigger product_touched before update on public.products for each row execute function private.product_touched();

-- Deleting a product for good: owners, or managers with the right; only if it was never sold.
create function public.delete_product(p_product uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_co uuid;
begin
  select company_id into v_co from public.products where id = p_product;
  if v_co is null or not private.my_right(v_co, 'delete') then raise exception 'Not allowed' using errcode = '42501'; end if;
  if exists (select 1 from public.sale_items where product_id = p_product) then
    raise exception 'This product has sales, so it can''t be deleted. Use "Stop selling" to hide it.' using errcode = 'P0001';
  end if;
  delete from public.products where id = p_product;
end $$;
revoke all on function public.delete_product(uuid) from public, anon, authenticated;
grant execute on function public.delete_product(uuid) to authenticated;

-- Profit for a shop's day: only for those who may see cost prices (null for everyone else).
create or replace function public.shop_sales_summary(p_branch uuid, p_day date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is not null and not private.can_manage_shop(p_branch) then null else jsonb_build_object(
    'sales', count(*) filter (where cancelled_at is null),
    'total', coalesce(sum(total) filter (where cancelled_at is null), 0),
    'discount', coalesce(sum(discount) filter (where cancelled_at is null), 0),
    'cancelled', count(*) filter (where cancelled_at is not null),
    'flagged', count(*) filter (where cancelled_at is null and flags <> '{}'),
    'mistakes', count(*) filter (where cancelled_at is null and mistake_at is not null),
    'profit', case when auth.uid() is null or private.my_right((select company_id from public.branches where id = p_branch), 'costs') then (
      select sum(i.qty * (i.unit_price - c.cost_price)) from public.sales s join public.sale_items i on i.sale_id = s.id
        join public.product_costs c on c.product_id = i.product_id
      where s.branch_id = p_branch and s.local_date = p_day and s.cancelled_at is null) end) end
  from public.sales where branch_id = p_branch and local_date = p_day
$$;

-- ── Attendance: managers mark only the people they may see (their shops). ──
create or replace function public.set_day_status(p_members uuid[], p_day date, p_status text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_me    public.members := private.my_admin_membership();
  v_today date;
  v_n     integer;
begin
  select (now() at time zone timezone)::date into v_today from public.companies where id = v_me.company_id;
  if p_day > v_today then raise exception 'You can''t set a status for a future date' using errcode = 'P0001'; end if;
  if p_status is not null and p_status not in ('present', 'absent', 'leave', 'off') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_members) x(id)
             where not exists (select 1 from public.members m where m.id = x.id and m.company_id = v_me.company_id)
                or not private.can_see_member(x.id)) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  if p_status is null then
    delete from public.day_status where member_id = any (p_members) and day = p_day;
  else
    insert into public.day_status (company_id, member_id, day, status, set_by)
    select v_me.company_id, x.id, p_day, p_status, v_me.id from unnest(p_members) x(id)
    on conflict (member_id, day) do update set status = excluded.status, set_by = excluded.set_by, set_at = now();
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ── Exporting all the business's data: owners only, in a business with shops. ──
create or replace function private.can_export(p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not private.company_has(p_company, 'shop') or private.my_role(p_company) = 'owner'
$$;
grant execute on function private.can_export(uuid) to authenticated;

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

-- ── The till: shop staff rules (clocked in; price between the lowest and the selling price) ──
create or replace function public.record_sale(p_id uuid, p_branch uuid, p_happened_at timestamptz, p_items jsonb, p_device_now timestamptz,
  p_payment text, p_receipt_token text)
returns public.sales
language plpgsql security definer set search_path = '' as $$
declare
  v_me    public.members;
  v_co    public.companies;
  v_row   public.sales;
  v_prod  public.products;
  v_stock integer;
  v_at    timestamptz;
  r       jsonb;
  v_line  smallint := 0;
  v_qty   integer;
  v_price numeric;
  v_flags text[];
  v_all   text[] := '{}';
  v_total numeric := 0;
  v_disc  numeric := 0;
  v_no    bigint;
  v_pre   text;
  v_staff boolean;
begin
  select * into v_me from public.members m
  where m.user_id = auth.uid() and m.active and m.company_id = (select company_id from public.branches where id = p_branch)
  limit 1;
  if v_me.id is null then raise exception 'Not allowed' using errcode = '42501'; end if;

  -- Already received (the phone lost signal before hearing back): return it as it is.
  select * into v_row from public.sales where id = p_id;
  if v_row.id is not null then
    if v_row.member_id is distinct from v_me.id then raise exception 'Not allowed' using errcode = '42501'; end if;
    return v_row;
  end if;

  -- Shop staff sell in their own shop; owners and the shop's managers may sell in it too.
  if not private.branch_is_shop(p_branch)
     or not (private.can_manage_shop(p_branch) or (v_me.role = 'staff' and v_me.branch_id = p_branch)) then
    raise exception 'You can only record sales in your own shop' using errcode = '42501';
  end if;
  if coalesce(p_payment, 'cash') not in ('cash', 'transfer', 'card') then raise exception 'Payment must be cash, transfer or POS card' using errcode = '22023'; end if;
  if p_receipt_token is not null and p_receipt_token !~ '^[A-Za-z0-9_-]{20,64}$' then raise exception 'Bad receipt link' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'A sale needs at least one product' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 100 then raise exception 'Up to 100 products per sale' using errcode = '22023'; end if;

  select * into v_co from public.companies where id = v_me.company_id;
  -- Shop staff (not managers or owners) follow the owner's till rules.
  v_staff := v_me.role = 'staff';
  -- Rule: clocked in before selling (owner's setting, on by default). The phone sends a clock-in before
  -- the sales made after it, so an offline clock-in arrives first.
  if v_staff and v_co.sell_requires_clock_in and coalesce((
       select a.kind from public.attendance a
       where a.member_id = v_me.id and a.local_date = (least(p_happened_at, now()) at time zone v_co.timezone)::date
         and a.happened_at <= least(p_happened_at, now()) + interval '5 minutes'
       order by a.happened_at desc limit 1), 'out') <> 'in' then
    raise exception 'Clock in before you sell' using errcode = 'P0001';
  end if;
  v_at := least(p_happened_at, now());                      -- never in the future
  if p_device_now is null or abs(extract(epoch from now() - p_device_now)) > 300 then v_all := v_all || 'clock_changed'::text; end if;

  -- The shop's next receipt number. Numbers are never reused (a cancelled sale keeps its number).
  update private.receipt_counters set last_no = last_no + 1 where branch_id = p_branch returning last_no, prefix into v_no, v_pre;
  if v_no is null then
    insert into private.receipt_counters (branch_id, company_id, prefix, last_no)
    values (p_branch, v_me.company_id, private.new_receipt_prefix(v_me.company_id, (select name from public.branches where id = p_branch)), 1)
    returning last_no, prefix into v_no, v_pre;
  end if;

  insert into public.sales (id, company_id, branch_id, member_id, seller_name, happened_at, local_date, total,
    payment_method, receipt_token, receipt_no, receipt_code)
  values (p_id, v_me.company_id, p_branch, v_me.id, v_me.full_name, v_at, (v_at at time zone v_co.timezone)::date, 0,
    coalesce(p_payment, 'cash'), coalesce(p_receipt_token, private.new_token()), v_no, v_pre || '-' || lpad(v_no::text, 6, '0'));

  for r in select * from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;
    v_qty := (r->>'qty')::integer;
    v_price := (r->>'unit_price')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty > 100000 then raise exception 'Quantity must be 1 or more' using errcode = '22023'; end if;
    if v_price is null or v_price < 0 or v_price > 100000000 then raise exception 'Price must be 0 or more' using errcode = '22023'; end if;
    select * into v_prod from public.products where id = (r->>'product_id')::uuid and company_id = v_me.company_id;
    if v_prod.id is null then raise exception 'Unknown product' using errcode = '22023'; end if;
    select qty into v_stock from public.stock where branch_id = p_branch and product_id = v_prod.id for update;
    v_flags := '{}';
    -- Rule: shop staff sell between the lowest allowed price and the selling price. If the owner changed
    -- the price after this sale was made on the phone (offline), the sale is kept and flagged instead.
    if v_staff and v_prod.updated_at > p_happened_at
       and ((v_prod.lowest_price is not null and v_price < v_prod.lowest_price) or (v_prod.price is not null and v_price > v_prod.price)) then
      v_flags := v_flags || 'price_changed'::text;
    elsif v_staff and v_prod.price is not null and v_price > v_prod.price then
      raise exception 'The price for "%" can''t be above the selling price', v_prod.name using errcode = 'P0001';
    elsif v_staff and not v_co.staff_below_lowest and v_prod.lowest_price is not null and v_price < v_prod.lowest_price then
      raise exception 'The price for "%" can''t be below the lowest allowed price', v_prod.name using errcode = 'P0001';
    end if;
    if v_prod.lowest_price is not null and v_price < v_prod.lowest_price then v_flags := v_flags || 'below_lowest'::text; end if;
    if coalesce(v_stock, 0) < v_qty then v_flags := v_flags || 'out_of_stock'::text; end if;
    insert into public.sale_items (sale_id, line, product_id, product_name, qty, unit_price, list_price, lowest_price, stock_before, flags)
    values (p_id, v_line, v_prod.id, v_prod.name, v_qty, v_price, v_prod.price, v_prod.lowest_price, v_stock, v_flags);
    v_total := v_total + v_qty * v_price;
    if v_prod.price is not null and v_price < v_prod.price then v_disc := v_disc + v_qty * (v_prod.price - v_price); end if;
    v_all := v_all || array(select unnest(v_flags) except select unnest(v_all));
    perform private.stock_apply(v_me, p_branch, v_prod.id, -v_qty, true, null, 'sale', null, null);
  end loop;

  update public.sales set total = v_total, discount = v_disc, flags = v_all where id = p_id returning * into v_row;
  return v_row;
end $$;



-- ── Overview patterns respect a manager's shops ──
create or replace function public.owner_overview(p_day date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me     public.members := private.my_admin_membership();
  v_co     public.companies;
  v_today  date;
  v_month  date;
  v_hours  numeric;                 -- working hours in a day
  v_days_m numeric;                 -- working days in a month (average)
  v_board  jsonb;
  v_offices jsonb;
  v_field  jsonb;
  v_stores jsonb;
  v_late   jsonb;
  v_drop   jsonb;
  v_lost   jsonb := null;
begin
  select * into v_co from public.companies where id = v_me.company_id;
  v_today := (now() at time zone v_co.timezone)::date;
  if p_day > v_today then raise exception 'That date is in the future' using errcode = 'P0001'; end if;
  v_month := date_trunc('month', p_day)::date;
  v_hours := extract(epoch from v_co.work_ends - v_co.work_starts) / 3600;
  v_days_m := cardinality(v_co.work_days) * 52.0 / 12;

  -- Right now
  select jsonb_build_object(
    'people', count(*),
    'present', count(*) filter (where status = 'present'),
    'late', count(*) filter (where status = 'late'),
    'absent', count(*) filter (where status in ('absent', 'none')),
    'away', count(*) filter (where status in ('leave', 'off')),
    'to_review', coalesce(sum(to_review), 0))
  into v_board from private.board(v_me.company_id, p_day);

  select coalesce(jsonb_agg(o order by o->>'name'), '[]') into v_offices from (
    select jsonb_build_object('name', coalesce(office, 'No office set'),
      'present', count(*) filter (where status = 'present'),
      'late', count(*) filter (where status = 'late'),
      'absent', count(*) filter (where status in ('absent', 'none')),
      'away', count(*) filter (where status in ('leave', 'off'))) o
    from private.board(v_me.company_id, p_day) where role = 'staff' group by office) x;

  -- Field visits: planned vs done, per rep
  select jsonb_build_object(
    'planned', coalesce(sum(visit_target) filter (where status not in ('leave', 'off')), 0),
    'done', coalesce(sum(least(visits, visit_target)), 0),
    'reps', coalesce(jsonb_agg(jsonb_build_object('name', full_name, 'visits', visits, 'target', visit_target, 'status', status) order by full_name), '[]'))
  into v_field from private.board(v_me.company_id, p_day) where role = 'rep';

  -- Stores for the map (assigned to someone, with a location), visited that day or not
  select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'lat', s.lat, 'lng', s.lng,
      'visited', exists (select 1 from public.visits v where v.store_id = s.id and v.local_date = p_day))
    order by s.name), '[]')
  into v_stores from public.stores s
  where s.company_id = v_me.company_id and s.active and s.lat is not null
    and exists (select 1 from public.store_assignments a join public.members m on m.id = a.member_id where a.store_id = s.id and m.active);

  -- Patterns: late 3+ times in the last 14 days
  select coalesce(jsonb_agg(jsonb_build_object('name', m.full_name, 'times', x.n) order by x.n desc), '[]') into v_late
  from (select a.member_id, count(distinct a.local_date) n from public.attendance a
        where a.company_id = v_me.company_id and a.late_minutes > 0 and a.local_date between p_day - 13 and p_day
        group by a.member_id having count(distinct a.local_date) >= 3) x
  join public.members m on m.id = x.member_id and m.active and private.can_see_member(m.id);

  -- Patterns: reps whose visits dropped 30%+ (last 7 days vs the 7 before; at least 5 before)
  select coalesce(jsonb_agg(jsonb_build_object('name', m.full_name, 'this_week', x.now_n, 'last_week', x.before_n) order by x.now_n::numeric / x.before_n), '[]')
  into v_drop
  from (select v.member_id,
          count(*) filter (where v.local_date between p_day - 6 and p_day) now_n,
          count(*) filter (where v.local_date between p_day - 13 and p_day - 7) before_n
        from public.visits v where v.company_id = v_me.company_id and v.local_date between p_day - 13 and p_day
        group by v.member_id) x
  join public.members m on m.id = x.member_id and m.active and m.role = 'rep' and private.can_see_member(m.id)
  where x.before_n >= 5 and x.now_n <= x.before_n * 0.7;

  -- Cost of lost time this month (owners only): late minutes + absent days.
  if v_me.role = 'owner' then
    select jsonb_build_object(
      'hours', round(coalesce(sum(lost_h), 0), 1),
      'naira', round(coalesce(sum(lost_h * (p.monthly_naira / nullif(v_days_m * v_hours, 0))), 0)),
      'with_pay', count(distinct p.member_id),
      'people', count(distinct r.member_id))
    into v_lost
    from (
      select b.member_id,
        (case when b.status = 'late' then coalesce(b.late_minutes, 0) / 60.0
              when b.status = 'absent' then v_hours else 0 end) as lost_h
      from generate_series(v_month, p_day, interval '1 day') g(d)
      cross join lateral private.board(v_me.company_id, g.d::date) b
    ) r
    left join public.pay_rates p on p.member_id = r.member_id;
  end if;

  return jsonb_build_object(
    'day', p_day, 'now', v_board, 'offices', v_offices, 'field', v_field, 'stores', v_stores,
    'repeat_late', v_late, 'visits_dropping', v_drop, 'lost', v_lost);
end $$;
