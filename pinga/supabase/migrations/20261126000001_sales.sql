-- Pinga · Sales at the till (Part C of the Storefront module)
-- Shop staff record sales on their phone, with or without signal. Each sale has an id made on
-- the phone, so sending it twice never counts it twice. Stock goes down as each sale arrives.
-- Rules (the owner's answers):
--   price: anything is allowed; below the product's lowest allowed price is flagged for the manager.
--   out of stock: allowed and flagged.
--   mistakes: managers and owners cancel (stock goes back), with who, when and why kept;
--             staff can't cancel but can "report a mistake" for the manager to look at.

create table public.sales (
  id             uuid primary key,                        -- made on the phone
  company_id     uuid not null references public.companies (id) on delete cascade,
  branch_id      uuid not null,
  member_id      uuid references public.members (id) on delete set null,
  seller_name    text not null,
  happened_at    timestamptz not null,
  local_date     date not null,
  received_at    timestamptz not null default now(),
  total          numeric(14, 2) not null,
  discount       numeric(14, 2) not null default 0,         -- below the selling price, in naira
  flags          text[] not null default '{}',              -- below_lowest, out_of_stock, clock_changed
  cancelled_at   timestamptz,
  cancelled_by   uuid references public.members (id) on delete set null,
  cancelled_by_name text,
  cancel_reason  text,
  mistake_note   text,                                      -- "Report a mistake" from the seller
  mistake_at     timestamptz,
  foreign key (company_id, branch_id) references public.branches (company_id, id) on delete cascade,
  check ((cancelled_at is null) = (cancel_reason is null))
);
create index sales_shop_day on public.sales (branch_id, local_date);
create index sales_company_day on public.sales (company_id, local_date);

create table public.sale_items (
  sale_id      uuid not null references public.sales (id) on delete cascade,
  line         smallint not null,
  product_id   uuid not null references public.products (id) on delete restrict,
  product_name text not null,                               -- as it was at the time of the sale
  qty          integer not null check (qty > 0 and qty <= 100000),
  unit_price   numeric(12, 2) not null check (unit_price >= 0),
  list_price   numeric(12, 2),                              -- the selling price at the time
  lowest_price numeric(12, 2),                              -- the lowest allowed price at the time
  stock_before integer,
  flags        text[] not null default '{}',
  primary key (sale_id, line)
);

alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
revoke all on public.sales, public.sale_items from anon, authenticated;
grant select on public.sales, public.sale_items to authenticated;
-- Sellers see their own sales; owners and the shop's managers see the shop's.
create policy "seller and managers read sales" on public.sales for select to authenticated
  using (member_id in (select private.my_member_ids()) or private.can_manage_shop(branch_id));
create policy "seller and managers read items" on public.sale_items for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id));   -- the policy above applies inside

-- Record a sale (from the phone's outbox). Safe to send again.
-- p_items: [{ "product_id", "qty", "unit_price" }]
create function public.record_sale(p_id uuid, p_branch uuid, p_happened_at timestamptz, p_items jsonb, p_device_now timestamptz)
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
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'A sale needs at least one product' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 100 then raise exception 'Up to 100 products per sale' using errcode = '22023'; end if;

  select * into v_co from public.companies where id = v_me.company_id;
  v_at := least(p_happened_at, now());                      -- never in the future
  if p_device_now is null or abs(extract(epoch from now() - p_device_now)) > 300 then v_all := v_all || 'clock_changed'::text; end if;

  insert into public.sales (id, company_id, branch_id, member_id, seller_name, happened_at, local_date, total)
  values (p_id, v_me.company_id, p_branch, v_me.id, v_me.full_name, v_at, (v_at at time zone v_co.timezone)::date, 0);

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

-- Cancel a sale (owners and the shop's managers). Stock goes back. Who, when and why are kept.
create function public.cancel_sale(p_sale uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_sale public.sales;
  v_me   public.members;
  i      public.sale_items;
begin
  select * into v_sale from public.sales where id = p_sale for update;
  if v_sale.id is null then raise exception 'Not allowed' using errcode = '42501'; end if;
  v_me := private.shop_manager(v_sale.branch_id);           -- refuses anyone who doesn't manage this shop
  if nullif(trim(p_reason), '') is null then raise exception 'Please say why the sale is cancelled' using errcode = '22023'; end if;
  if v_sale.cancelled_at is not null then raise exception 'This sale is already cancelled' using errcode = 'P0001'; end if;
  update public.sales set cancelled_at = now(), cancelled_by = v_me.id, cancelled_by_name = v_me.full_name,
    cancel_reason = left(trim(p_reason), 300) where id = p_sale;
  for i in select * from public.sale_items where sale_id = p_sale loop
    perform private.stock_apply(v_me, v_sale.branch_id, i.product_id, i.qty, true, null, 'sale_cancelled', null, left(trim(p_reason), 300));
  end loop;
end $$;

-- The seller reports a mistake in their own sale; the manager decides what to do.
create function public.report_sale_mistake(p_sale uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if nullif(trim(p_note), '') is null then raise exception 'Please say what went wrong' using errcode = '22023'; end if;
  update public.sales set mistake_note = left(trim(p_note), 300), mistake_at = now()
  where id = p_sale and member_id in (select private.my_member_ids()) and cancelled_at is null;
  if not found then raise exception 'Not allowed' using errcode = '42501'; end if;
end $$;

-- A shop's day in one call (manager's Sales screen; Part D's dashboard and email build on it).
create function public.shop_sales_summary(p_branch uuid, p_day date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is not null and not private.can_manage_shop(p_branch) then null else jsonb_build_object(
    'sales', count(*) filter (where cancelled_at is null),
    'total', coalesce(sum(total) filter (where cancelled_at is null), 0),
    'discount', coalesce(sum(discount) filter (where cancelled_at is null), 0),
    'cancelled', count(*) filter (where cancelled_at is not null),
    'flagged', count(*) filter (where cancelled_at is null and flags <> '{}'),
    'mistakes', count(*) filter (where cancelled_at is null and mistake_at is not null)) end
  from public.sales where branch_id = p_branch and local_date = p_day
$$;

revoke all on function public.record_sale(uuid, uuid, timestamptz, jsonb, timestamptz), public.cancel_sale(uuid, text),
  public.report_sale_mistake(uuid, text), public.shop_sales_summary(uuid, date) from public, anon, authenticated;
grant execute on function public.record_sale(uuid, uuid, timestamptz, jsonb, timestamptz), public.cancel_sale(uuid, text),
  public.report_sale_mistake(uuid, text), public.shop_sales_summary(uuid, date) to authenticated;
grant execute on function public.shop_sales_summary(uuid, date) to service_role;
