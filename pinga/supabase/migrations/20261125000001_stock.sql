-- Pinga · Products and stock (Part B of the Storefront module)
-- Products belong to the company (one price list). Stock is kept per shop.
-- Every change to stock is logged (who, when, why). Imports from Excel/CSV are either
-- a stock count (the file's numbers replace what's recorded) or a delivery (they're added).
-- Who can do what:
--   owners: every shop.  managers: the shops the owner gave them.  shop staff: read their own shop.
-- Stock only changes through the functions below, never by editing the tables directly.

-- ── Who may look at / manage a shop ─────────────────────────
create function private.can_manage_shop(p_branch uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.branch_is_shop(p_branch) and exists (
    select 1 from public.branches b join public.members m on m.company_id = b.company_id
    where b.id = p_branch and m.user_id = auth.uid() and m.active
      and (m.role = 'owner' or (m.role = 'admin' and exists (
        select 1 from public.manager_shops ms where ms.manager_id = m.id and ms.branch_id = p_branch))))
$$;

create function private.can_see_shop(p_branch uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_manage_shop(p_branch) or (private.branch_is_shop(p_branch) and exists (
    select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role = 'staff' and m.branch_id = p_branch))
$$;
grant execute on function private.can_manage_shop(uuid), private.can_see_shop(uuid) to authenticated;

-- ── Products (the company's price list) ─────────────────────
create table public.products (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 120),
  code         text check (code is null or length(trim(code)) between 1 and 60),   -- the shop's own code / SKU (optional)
  price        numeric(12, 2) check (price is null or price >= 0),                -- selling price in naira
  lowest_price numeric(12, 2) check (lowest_price is null or lowest_price >= 0),   -- lowest allowed price (optional)
  low_stock_at integer not null default 5 check (low_stock_at >= 0),             -- alert when a shop has this many or fewer
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (company_id, id),
  check (lowest_price is null or price is null or lowest_price <= price)
);
create unique index products_name on public.products (company_id, lower(trim(name)));
create unique index products_code on public.products (company_id, lower(trim(code))) where code is not null;

alter table public.products enable row level security;
revoke all on public.products from anon, authenticated;
grant select on public.products to authenticated;
grant insert (id, company_id, name, code, price, lowest_price, low_stock_at) on public.products to authenticated;
grant update (name, code, price, lowest_price, low_stock_at, active) on public.products to authenticated;
-- Everyone in a business that sells can read the price list (shop staff need it at the till).
create policy "members read products" on public.products for select to authenticated
  using (private.is_member(company_id) and private.company_has(company_id, 'shop'));
-- Owners and managers set products and prices.
create policy "admins add products" on public.products for insert to authenticated
  with check (private.is_admin(company_id) and private.company_has(company_id, 'shop'));
create policy "admins edit products" on public.products for update to authenticated
  using (private.is_admin(company_id)) with check (private.is_admin(company_id));

-- ── Stock per shop ──────────────────────────────────────────
create table public.stock (
  company_id uuid not null references public.companies (id) on delete cascade,
  branch_id  uuid not null,
  product_id uuid not null,
  qty        integer not null default 0,              -- can go below 0 (sold while out of stock: flagged in Part C)
  expires_on date,                                    -- earliest expiry date in this shop (optional)
  updated_at timestamptz not null default now(),
  primary key (branch_id, product_id),
  foreign key (company_id, branch_id) references public.branches (company_id, id) on delete cascade,
  foreign key (company_id, product_id) references public.products (company_id, id) on delete cascade
);
alter table public.stock enable row level security;
revoke all on public.stock from anon, authenticated;
grant select on public.stock to authenticated;
create policy "shop people read stock" on public.stock for select to authenticated using (private.can_see_shop(branch_id));

-- ── Imports (a log of every file) ───────────────────────────
create table public.stock_imports (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  branch_id   uuid not null,
  kind        text not null check (kind in ('count', 'delivery')),
  file_name   text not null,
  rows        integer not null,
  new_products integer not null,
  units       integer not null,                       -- total quantity in the file
  member_id   uuid references public.members (id) on delete set null,
  by_name     text not null,
  created_at  timestamptz not null default now(),
  foreign key (company_id, branch_id) references public.branches (company_id, id) on delete cascade
);
alter table public.stock_imports enable row level security;
revoke all on public.stock_imports from anon, authenticated;
grant select on public.stock_imports to authenticated;
create policy "managers read imports" on public.stock_imports for select to authenticated using (private.can_manage_shop(branch_id));

-- ── Every stock change (count, delivery, correction; sales in Part C) ──
create table public.stock_changes (
  id         bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  branch_id  uuid not null,
  product_id uuid not null,
  change     integer not null,
  qty_after  integer not null,
  reason     text not null check (reason in ('count', 'delivery', 'correction', 'sale', 'sale_cancelled')),
  import_id  uuid references public.stock_imports (id) on delete set null,
  note       text,
  member_id  uuid references public.members (id) on delete set null,
  by_name    text not null,
  created_at timestamptz not null default now(),
  foreign key (company_id, branch_id) references public.branches (company_id, id) on delete cascade,
  foreign key (company_id, product_id) references public.products (company_id, id) on delete cascade
);
create index stock_changes_shop on public.stock_changes (branch_id, created_at desc);
alter table public.stock_changes enable row level security;
revoke all on public.stock_changes from anon, authenticated;
grant select on public.stock_changes to authenticated;
create policy "managers read changes" on public.stock_changes for select to authenticated using (private.can_manage_shop(branch_id));

-- Sets or adds stock for one product in one shop and logs it. Internal: callers check permission.
create function private.stock_apply(p_me public.members, p_branch uuid, p_product uuid, p_qty integer, p_add boolean,
  p_expires date, p_reason text, p_import uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old  public.stock;
  v_new  integer;
  v_exp  date;
begin
  select * into v_old from public.stock where branch_id = p_branch and product_id = p_product for update;
  v_new := case when p_add then coalesce(v_old.qty, 0) + p_qty else p_qty end;
  -- A delivery keeps the earliest expiry date still in the shop; a count or correction sets it (blank keeps it).
  v_exp := case
    when p_expires is null then v_old.expires_on
    when p_add and coalesce(v_old.qty, 0) > 0 and v_old.expires_on is not null then least(v_old.expires_on, p_expires)
    else p_expires end;
  insert into public.stock (company_id, branch_id, product_id, qty, expires_on, updated_at)
  values (p_me.company_id, p_branch, p_product, v_new, v_exp, now())
  on conflict (branch_id, product_id) do update set qty = excluded.qty, expires_on = excluded.expires_on, updated_at = now();
  if v_new is distinct from v_old.qty or v_old.qty is null then
    insert into public.stock_changes (company_id, branch_id, product_id, change, qty_after, reason, import_id, note, member_id, by_name)
    values (p_me.company_id, p_branch, p_product, v_new - coalesce(v_old.qty, 0), v_new, p_reason, p_import, p_note, p_me.id, p_me.full_name);
  end if;
end $$;

create function private.shop_manager(p_branch uuid) returns public.members
language plpgsql stable security definer set search_path = '' as $$
declare v public.members;
begin
  if not private.can_manage_shop(p_branch) then raise exception 'Not allowed' using errcode = '42501'; end if;
  select m.* into v from public.members m join public.branches b on b.company_id = m.company_id
  where b.id = p_branch and m.user_id = auth.uid() and m.active limit 1;
  return v;
end $$;

-- Import a file into one shop.
-- p_rows: [{ "name", "code", "qty", "price", "lowest_price", "expires_on", "low_stock_at" }]
-- Products are matched by code (if given), otherwise by name. New names become new products.
-- A stock count replaces the quantity of every product in the file (others are left as they are);
-- a delivery adds to it. Prices and alert levels in the file update the product.
create function public.import_stock(p_branch uuid, p_kind text, p_file_name text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me     public.members := private.shop_manager(p_branch);
  v_import uuid := gen_random_uuid();
  r        jsonb;
  v_prod   public.products;
  v_name   text; v_code text; v_qty integer; v_price numeric; v_low numeric; v_exp date; v_alert integer;
  v_new    integer := 0;
  v_units  integer := 0;
  v_seen   uuid[] := '{}';
begin
  if p_kind not in ('count', 'delivery') then raise exception 'Choose stock count or delivery' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'The file has no products' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'Up to 5,000 products per file, please' using errcode = '22023'; end if;

  insert into public.stock_imports (id, company_id, branch_id, kind, file_name, rows, new_products, units, member_id, by_name)
  values (v_import, v_me.company_id, p_branch, p_kind, left(coalesce(nullif(trim(p_file_name), ''), 'file'), 200),
    jsonb_array_length(p_rows), 0, 0, v_me.id, v_me.full_name);

  for r in select * from jsonb_array_elements(p_rows) loop
    v_name  := nullif(trim(r->>'name'), '');
    v_code  := nullif(trim(r->>'code'), '');
    v_qty   := (r->>'qty')::integer;
    v_price := nullif(r->>'price', '')::numeric;
    v_low   := nullif(r->>'lowest_price', '')::numeric;
    v_exp   := nullif(r->>'expires_on', '')::date;
    v_alert := nullif(r->>'low_stock_at', '')::integer;
    if v_name is null and v_code is null then raise exception 'Every row needs a product name' using errcode = '22023'; end if;
    if v_qty is null or v_qty < 0 then raise exception 'Quantity for "%" must be 0 or more', coalesce(v_name, v_code) using errcode = '22023'; end if;
    if v_qty > 1000000 then raise exception 'Quantity for "%" is too large', coalesce(v_name, v_code) using errcode = '22023'; end if;

    v_prod := null;
    if v_code is not null then
      select * into v_prod from public.products where company_id = v_me.company_id and lower(trim(code)) = lower(v_code);
    end if;
    if v_prod.id is null and v_name is not null then
      select * into v_prod from public.products where company_id = v_me.company_id and lower(trim(name)) = lower(v_name);
    end if;
    if v_prod.id is null then
      if v_name is null then raise exception 'No product has the code "%". Add its name to create it.', v_code using errcode = '22023'; end if;
      insert into public.products (company_id, name, code, price, lowest_price, low_stock_at)
      values (v_me.company_id, v_name, v_code, v_price, case when v_low <= v_price or v_price is null then v_low end, coalesce(v_alert, 5))
      returning * into v_prod;
      v_new := v_new + 1;
    else
      update public.products set
        price = coalesce(v_price, price),
        -- a lowest price above the selling price makes no sense: drop it
        lowest_price = case when coalesce(v_low, lowest_price) <= coalesce(v_price, price) or coalesce(v_price, price) is null
                            then coalesce(v_low, lowest_price) end,
        low_stock_at = coalesce(v_alert, low_stock_at),
        code = coalesce(code, v_code),
        active = true
      where id = v_prod.id;
    end if;
    if v_prod.id = any (v_seen) then
      raise exception '"%" is in the file twice. Put it on one row.', v_prod.name using errcode = '22023';
    end if;
    v_seen := v_seen || v_prod.id;
    perform private.stock_apply(v_me, p_branch, v_prod.id, v_qty, p_kind = 'delivery', v_exp, p_kind, v_import, null);
    v_units := v_units + v_qty;
  end loop;

  update public.stock_imports set new_products = v_new, units = v_units where id = v_import;
  return jsonb_build_object('import_id', v_import, 'rows', jsonb_array_length(p_rows), 'new_products', v_new, 'units', v_units);
end $$;

-- Correct one product's stock in one shop (e.g. after counting a shelf). Logged with an optional note.
create function public.set_stock(p_branch uuid, p_product uuid, p_qty integer, p_expires_on date, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members := private.shop_manager(p_branch);
begin
  if p_qty is null or p_qty < 0 or p_qty > 1000000 then raise exception 'Quantity must be 0 or more' using errcode = '22023'; end if;
  if not exists (select 1 from public.products where id = p_product and company_id = v_me.company_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  perform private.stock_apply(v_me, p_branch, p_product, p_qty, false, p_expires_on, 'correction', null, nullif(trim(p_note), ''));
end $$;

-- A blank expiry date above keeps the old one; this removes it.

create function public.clear_expiry(p_branch uuid, p_product uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.shop_manager(p_branch);
  update public.stock set expires_on = null, updated_at = now() where branch_id = p_branch and product_id = p_product;
end $$;

-- Low stock and expiring soon (within 30 days, or already expired), for the shops the caller manages.
create function public.stock_alerts(p_branch uuid default null) returns table (
  branch_id uuid, shop text, product_id uuid, product text, qty integer, low_stock_at integer, expires_on date, alert text)
language sql stable security definer set search_path = '' as $$
  select s.branch_id, b.name, p.id, p.name, s.qty, p.low_stock_at, s.expires_on,
    case when s.expires_on is not null and s.qty > 0 and s.expires_on < (now() at time zone c.timezone)::date then 'expired'
         when s.expires_on is not null and s.qty > 0 and s.expires_on <= (now() at time zone c.timezone)::date + 30 then 'expiring'
         when s.qty <= 0 then 'out'
         else 'low' end
  from public.stock s
  join public.products p on p.id = s.product_id and p.active
  join public.branches b on b.id = s.branch_id
  join public.companies c on c.id = s.company_id
  where (p_branch is null or s.branch_id = p_branch)
    and (auth.uid() is null or private.can_manage_shop(s.branch_id))
    and private.branch_is_shop(s.branch_id)
    and (s.qty <= p.low_stock_at
      or (s.expires_on is not null and s.qty > 0 and s.expires_on <= (now() at time zone c.timezone)::date + 30))
  order by case when s.expires_on is not null and s.qty > 0 and s.expires_on <= (now() at time zone c.timezone)::date + 30 then 0 else 1 end,
    s.expires_on nulls last, s.qty, p.name
$$;

revoke all on function public.import_stock(uuid, text, text, jsonb), public.set_stock(uuid, uuid, integer, date, text),
  public.clear_expiry(uuid, uuid), public.stock_alerts(uuid) from public, anon, authenticated;
grant execute on function public.import_stock(uuid, text, text, jsonb), public.set_stock(uuid, uuid, integer, date, text),
  public.clear_expiry(uuid, uuid), public.stock_alerts(uuid) to authenticated;
grant execute on function public.stock_alerts(uuid) to service_role;
