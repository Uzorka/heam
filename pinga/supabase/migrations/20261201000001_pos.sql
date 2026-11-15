-- Pinga · The Sell (POS) upgrade
-- Categories for quick filtering; split payments (e.g. part cash, part transfer); an optional customer name;
-- the shop's best sellers as quick picks; and opening and closing the till each day
-- (expected cash vs counted cash, the difference flagged to the owner).

-- ── Categories ──
alter table public.products add column category text check (category is null or length(trim(category)) between 1 and 40);
grant insert (category), update (category) on public.products to authenticated;

-- ── Split payments and the customer's name ──
alter table public.sales add column payments jsonb, add column customer_name text;
alter table public.sales drop constraint sales_payment_method_check;
alter table public.sales add constraint sales_payment_method_check check (payment_method in ('cash', 'transfer', 'card', 'split'));
update public.sales set payments = jsonb_build_array(jsonb_build_object('method', payment_method, 'amount', total)) where payments is null;

-- The newest version takes the payment parts and the customer's name (both optional, so older phones still work).
drop function public.record_sale(uuid, uuid, timestamptz, jsonb, timestamptz, text, text);
create function public.record_sale(p_id uuid, p_branch uuid, p_happened_at timestamptz, p_items jsonb, p_device_now timestamptz,
  p_payment text, p_receipt_token text, p_payments jsonb default null, p_customer_name text default null)
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
  if coalesce(p_payment, 'cash') not in ('cash', 'transfer', 'card', 'split') then raise exception 'Payment must be cash, transfer, POS card or split' using errcode = '22023'; end if;
  if p_payment = 'split' and (jsonb_typeof(p_payments) is distinct from 'array' or jsonb_array_length(p_payments) < 2
      or exists (select 1 from jsonb_array_elements(p_payments) x where x->>'method' not in ('cash', 'transfer', 'card') or (x->>'amount')::numeric <= 0)) then
    raise exception 'A split payment needs two or more parts, each cash, transfer or POS card' using errcode = '22023';
  end if;
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

  -- How it was paid: one method, or the parts of a split payment (which must add up to the total).
  if p_payment = 'split' and abs((select sum((x->>'amount')::numeric) from jsonb_array_elements(p_payments) x) - v_total) > 0.01 then
    raise exception 'The parts of a split payment must add up to the total' using errcode = '22023';
  end if;
  update public.sales set total = v_total, discount = v_disc, flags = v_all,
    payments = case when p_payment = 'split'
      then (select jsonb_agg(jsonb_build_object('method', x->>'method', 'amount', round((x->>'amount')::numeric, 2))) from jsonb_array_elements(p_payments) x)
      else jsonb_build_array(jsonb_build_object('method', coalesce(p_payment, 'cash'), 'amount', v_total)) end,
    customer_name = nullif(left(trim(coalesce(p_customer_name, '')), 80), '')
  where id = p_id returning * into v_row;
  return v_row;
end $$;



revoke all on function public.record_sale(uuid, uuid, timestamptz, jsonb, timestamptz, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_sale(uuid, uuid, timestamptz, jsonb, timestamptz, text, text, jsonb, text) to authenticated;

-- Totals per payment method count each part of a split payment.
create or replace function private.shops_day_methods(p_company uuid, p_day date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'cash', coalesce(sum((x->>'amount')::numeric) filter (where x->>'method' = 'cash'), 0),
    'transfer', coalesce(sum((x->>'amount')::numeric) filter (where x->>'method' = 'transfer'), 0),
    'card', coalesce(sum((x->>'amount')::numeric) filter (where x->>'method' = 'card'), 0))
  from public.sales s cross join lateral jsonb_array_elements(s.payments) x
  where s.company_id = p_company and s.local_date = p_day and s.cancelled_at is null
    and private.branch_is_shop(s.branch_id) and (auth.uid() is null or private.can_manage_shop(s.branch_id))
$$;

-- The receipt shows the parts of a split payment.
create or replace function public.receipt(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when p_token !~ '^[A-Za-z0-9_-]{20,64}$' then null else (
    select jsonb_build_object(
      'business', c.name,
      'logo_path', coalesce(b.logo_path, c.logo_path),
      'shop', b.name, 'address', b.address, 'phone', b.phone,
      'number', s.receipt_code,
      'at', s.happened_at, 'timezone', c.timezone,
      'served_by', split_part(s.seller_name, ' ', 1),
      'customer', s.customer_name,
      'items', (select jsonb_agg(jsonb_build_object('name', i.product_name, 'qty', i.qty, 'price', i.unit_price,
                 'list_price', i.list_price) order by i.line) from public.sale_items i where i.sale_id = s.id),
      'discount', s.discount, 'total', s.total,
      'payment', s.payment_method, 'payments', s.payments,
      'note', c.receipt_note,
      'cancelled', s.cancelled_at is not null)
    from public.sales s join public.branches b on b.id = s.branch_id join public.companies c on c.id = s.company_id
    where s.receipt_token = p_token) end
$$;

-- ── Quick picks: the shop's best sellers over the last 30 days (anyone who sells there) ──
create function public.shop_quick_picks(p_branch uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select i.product_id from public.sale_items i join public.sales s on s.id = i.sale_id
  join public.products p on p.id = i.product_id and p.active
  where s.branch_id = p_branch and s.cancelled_at is null and s.local_date >= current_date - 30
    and private.can_see_shop(p_branch)
  group by i.product_id order by sum(i.qty) desc limit 8
$$;
revoke all on function public.shop_quick_picks(uuid) from public, anon, authenticated;
grant execute on function public.shop_quick_picks(uuid) to authenticated;

-- ── Opening and closing the till ──
create table public.till_days (
  company_id     uuid not null references public.companies (id) on delete cascade,
  branch_id      uuid not null,
  day            date not null,
  opening_cash   numeric(14, 2) not null default 0 check (opening_cash >= 0),
  opened_by_name text not null,
  opened_at      timestamptz not null default now(),
  counted_cash   numeric(14, 2) check (counted_cash >= 0),
  expected_cash  numeric(14, 2),
  difference     numeric(14, 2),                      -- counted − expected: below 0 = short, above 0 = over
  closed_by_name text,
  closed_at      timestamptz,
  close_note     text,
  primary key (branch_id, day),
  foreign key (company_id, branch_id) references public.branches (company_id, id) on delete cascade
);
alter table public.till_days enable row level security;
revoke all on public.till_days from anon, authenticated;
grant select on public.till_days to authenticated;
create policy "managers read tills" on public.till_days for select to authenticated using (private.can_manage_shop(branch_id));

create function private.seller_in(p_branch uuid) returns public.members
language plpgsql stable security definer set search_path = '' as $$
declare v public.members;
begin
  select m.* into v from public.members m join public.branches b on b.company_id = m.company_id
  where b.id = p_branch and m.user_id = auth.uid() and m.active limit 1;
  if v.id is null or not private.branch_is_shop(p_branch)
     or not (private.can_manage_shop(p_branch) or (v.role = 'staff' and v.branch_id = p_branch)) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return v;
end $$;

create function private.till_cash(p_branch uuid, p_day date) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum((x->>'amount')::numeric), 0) from public.sales s cross join lateral jsonb_array_elements(s.payments) x
  where s.branch_id = p_branch and s.local_date = p_day and s.cancelled_at is null and x->>'method' = 'cash'
$$;

-- Open the till for today with the cash in the drawer (anyone who sells in the shop; the first one counts).
create function public.open_till(p_branch uuid, p_opening numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me  public.members := private.seller_in(p_branch);
  v_day date := (now() at time zone (select timezone from public.companies where id = v_me.company_id))::date;
begin
  if p_opening is null or p_opening < 0 or p_opening > 100000000 then raise exception 'Opening cash must be 0 or more' using errcode = '22023'; end if;
  insert into public.till_days (company_id, branch_id, day, opening_cash, opened_by_name)
  values (v_me.company_id, p_branch, v_day, round(p_opening, 2), v_me.full_name) on conflict do nothing;
end $$;

-- Is the till open today? Shop staff see only open/closed; managers and owners see the cash.
create function public.till_status(p_branch uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me  public.members := private.seller_in(p_branch);
  v_day date := (now() at time zone (select timezone from public.companies where id = v_me.company_id))::date;
  t     public.till_days;
begin
  select * into t from public.till_days where branch_id = p_branch and day = v_day;
  if not private.can_manage_shop(p_branch) then
    return jsonb_build_object('day', v_day, 'opened', t.branch_id is not null, 'closed', t.closed_at is not null);
  end if;
  return jsonb_build_object('day', v_day, 'opened', t.branch_id is not null, 'closed', t.closed_at is not null,
    'opening_cash', t.opening_cash, 'opened_by', t.opened_by_name, 'cash_sales', private.till_cash(p_branch, v_day),
    'expected_cash', coalesce(t.opening_cash, 0) + private.till_cash(p_branch, v_day),
    'counted_cash', t.counted_cash, 'difference', t.difference, 'closed_by', t.closed_by_name, 'closed_at', t.closed_at);
end $$;

-- Close the till: managers and owners count the cash; the difference is kept and flagged to the owner.
create function public.close_till(p_branch uuid, p_counted numeric, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me  public.members := private.shop_manager(p_branch);
  v_day date := (now() at time zone (select timezone from public.companies where id = v_me.company_id))::date;
  v_exp numeric;
begin
  if p_counted is null or p_counted < 0 or p_counted > 100000000 then raise exception 'Counted cash must be 0 or more' using errcode = '22023'; end if;
  insert into public.till_days (company_id, branch_id, day, opening_cash, opened_by_name)
  values (v_me.company_id, p_branch, v_day, 0, v_me.full_name) on conflict do nothing;
  select opening_cash + private.till_cash(p_branch, v_day) into v_exp from public.till_days where branch_id = p_branch and day = v_day;
  update public.till_days set counted_cash = round(p_counted, 2), expected_cash = v_exp, difference = round(p_counted, 2) - v_exp,
    closed_by_name = v_me.full_name, closed_at = now(), close_note = nullif(left(trim(coalesce(p_note, '')), 300), '')
  where branch_id = p_branch and day = v_day;
  return public.till_status(p_branch);
end $$;

revoke all on function public.open_till(uuid, numeric), public.till_status(uuid), public.close_till(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.open_till(uuid, numeric), public.till_status(uuid), public.close_till(uuid, numeric, text) to authenticated;

-- The shops' day (dashboard and evening email) now includes each till's close.
alter function private.shops_day(uuid, date) rename to shops_day_base;
create function private.shops_day(p_company uuid, p_day date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.shops_day_base(p_company, p_day) || jsonb_build_object('tills', (
    select coalesce(jsonb_agg(jsonb_build_object('shop', b.name, 'expected', t.expected_cash, 'counted', t.counted_cash,
      'difference', t.difference, 'closed', t.closed_at is not null, 'closed_by', t.closed_by_name) order by b.name), '[]')
    from public.till_days t join public.branches b on b.id = t.branch_id
    where t.company_id = p_company and t.day = p_day and (auth.uid() is null or private.can_manage_shop(t.branch_id))))
$$;
