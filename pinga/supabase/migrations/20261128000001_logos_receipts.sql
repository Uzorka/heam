-- Pinga · Business logo and receipts
-- Logos: a public storage bucket (receipts and emails show them without signing in). The owner uploads;
--   the app shrinks the picture first (about 512 px, under 200 KB). One for the business, optionally one per shop.
-- Receipts: every sale gets a receipt number in order per shop (e.g. YAB-000123), never reused, and an
--   unguessable link made on the phone (so it exists even with no signal). Anyone with the link can see
--   that one receipt, nothing else. Every sale also records how it was paid: cash, transfer or POS card.

-- ── Logos ───────────────────────────────────────────────────
alter table public.companies add column logo_path text, add column receipt_note text not null default 'Thank you for shopping with us!'
  check (length(receipt_note) <= 200);
alter table public.companies add constraint companies_logo_path check (logo_path is null or logo_path like id::text || '/%');
grant update (logo_path, receipt_note) on public.companies to authenticated;

alter table public.branches add column logo_path text, add column phone text check (phone is null or length(phone) <= 30);
alter table public.branches add constraint branches_logo_path check (logo_path is null or logo_path like company_id::text || '/%');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 262144, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;

-- Owners write into their own company's folder: <company>/<file>.
create function private.logo_owner(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role = 'owner'
                 and p_name like m.company_id::text || '/%' and p_name not like '%..%')
$$;
grant execute on function private.logo_owner(text) to authenticated;
create policy "owners upload logos" on storage.objects for insert to authenticated with check (bucket_id = 'logos' and private.logo_owner(name));
create policy "owners see their logos" on storage.objects for select to authenticated using (bucket_id = 'logos' and private.logo_owner(name));
create policy "owners remove logos" on storage.objects for delete to authenticated using (bucket_id = 'logos' and private.logo_owner(name));

-- Only the owner changes the logos and the receipt note (managers can still edit hours etc.).
create function private.company_branding_owner() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and (new.logo_path is distinct from old.logo_path or new.receipt_note is distinct from old.receipt_note)
     and private.my_role(new.id) is distinct from 'owner' then
    raise exception 'Only the owner can change the logo and receipt note' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger company_branding_owner before update on public.companies for each row execute function private.company_branding_owner();

create function private.branch_logo_owner() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and new.logo_path is distinct from (case when tg_op = 'UPDATE' then old.logo_path end)
     and private.my_role(new.company_id) is distinct from 'owner' then
    raise exception 'Only the owner can change a shop logo' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger branch_logo_owner before insert or update on public.branches for each row execute function private.branch_logo_owner();

-- ── Receipt numbers, per shop ───────────────────────────────
-- Kept where nobody can edit them (no grants): only record_sale moves them on.
create table private.receipt_counters (
  branch_id  uuid primary key references public.branches (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  prefix     text not null,
  last_no    bigint not null default 0,
  unique (company_id, prefix)
);

-- "Yaba shop" → YAB; a second "Yaba ..." in the same business → YAB2.
create function private.new_receipt_prefix(p_company uuid, p_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_base text := upper(left(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9]', '', 'g'), 3));
  v_try  text;
  n      integer := 1;
begin
  if length(v_base) < 2 then v_base := 'SHP'; end if;
  v_try := v_base;
  while exists (select 1 from private.receipt_counters where company_id = p_company and prefix = v_try) loop
    n := n + 1;
    v_try := v_base || n;
  end loop;
  return v_try;
end $$;

-- 24 random bytes (from two random UUIDs) → 32 characters for the link.
create function private.new_token() returns text language sql volatile set search_path = '' as $$
  select translate(encode(substring(decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex') from 1 for 24), 'base64'), '+/', '-_')
$$;

alter table public.sales
  add column payment_method text not null default 'cash' check (payment_method in ('cash', 'transfer', 'card')),
  add column receipt_token text,
  add column receipt_no bigint,
  add column receipt_code text;

-- Existing shops and sales get their numbers now (oldest sale first).
insert into private.receipt_counters (branch_id, company_id, prefix)
select b.id, b.company_id, 'TMP' || row_number() over () from public.branches b;
do $$
declare r record;
begin
  for r in select c.branch_id, c.company_id, b.name from private.receipt_counters c join public.branches b on b.id = c.branch_id order by b.created_at loop
    update private.receipt_counters set prefix = private.new_receipt_prefix(r.company_id, r.name) where branch_id = r.branch_id;
  end loop;
end $$;
with numbered as (
  select s.id, row_number() over (partition by s.branch_id order by s.happened_at, s.id) as n from public.sales s
)
update public.sales s set receipt_no = numbered.n, receipt_token = private.new_token(),
  receipt_code = (select prefix from private.receipt_counters c where c.branch_id = s.branch_id) || '-' || lpad(numbered.n::text, 6, '0')
from numbered where numbered.id = s.id;
update private.receipt_counters c set last_no = coalesce((select max(receipt_no) from public.sales s where s.branch_id = c.branch_id), 0);

alter table public.sales alter column receipt_token set not null, alter column receipt_no set not null, alter column receipt_code set not null;
create unique index sales_receipt_token on public.sales (receipt_token);
create unique index sales_receipt_no on public.sales (branch_id, receipt_no);

-- New shops get a prefix straight away.
create function private.add_receipt_counter() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.receipt_counters (branch_id, company_id, prefix)
  values (new.id, new.company_id, private.new_receipt_prefix(new.company_id, new.name)) on conflict do nothing;
  return new;
end $$;
create trigger add_receipt_counter after insert on public.branches for each row execute function private.add_receipt_counter();

-- ── Recording a sale, now with payment method and the receipt link ──
create function public.record_sale(p_id uuid, p_branch uuid, p_happened_at timestamptz, p_items jsonb, p_device_now timestamptz,
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


-- The app from before this update (sales still waiting on a phone) keeps working: cash, link made here.
create or replace function public.record_sale(p_id uuid, p_branch uuid, p_happened_at timestamptz, p_items jsonb, p_device_now timestamptz)
returns public.sales language sql security definer set search_path = '' as $$
  select public.record_sale(p_id, p_branch, p_happened_at, p_items, p_device_now, 'cash', null)
$$;
revoke all on function public.record_sale(uuid, uuid, timestamptz, jsonb, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.record_sale(uuid, uuid, timestamptz, jsonb, timestamptz, text, text) to authenticated;

-- ── The receipt, for anyone with the link (no sign-in) ──────
create function public.receipt(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when p_token !~ '^[A-Za-z0-9_-]{20,64}$' then null else (
    select jsonb_build_object(
      'business', c.name,
      'logo_path', coalesce(b.logo_path, c.logo_path),
      'shop', b.name, 'address', b.address, 'phone', b.phone,
      'number', s.receipt_code,
      'at', s.happened_at, 'timezone', c.timezone,
      'served_by', split_part(s.seller_name, ' ', 1),
      'items', (select jsonb_agg(jsonb_build_object('name', i.product_name, 'qty', i.qty, 'price', i.unit_price,
                 'list_price', i.list_price) order by i.line) from public.sale_items i where i.sale_id = s.id),
      'discount', s.discount, 'total', s.total,
      'payment', s.payment_method,
      'note', c.receipt_note,
      'cancelled', s.cancelled_at is not null)
    from public.sales s join public.branches b on b.id = s.branch_id join public.companies c on c.id = s.company_id
    where s.receipt_token = p_token) end
$$;
revoke all on function public.receipt(text) from public;
grant execute on function public.receipt(text) to anon, authenticated;

-- ── Totals per payment method (dashboard and evening email) ──
create or replace function private.shops_day_methods(p_company uuid, p_day date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'cash', coalesce(sum(total) filter (where payment_method = 'cash'), 0),
    'transfer', coalesce(sum(total) filter (where payment_method = 'transfer'), 0),
    'card', coalesce(sum(total) filter (where payment_method = 'card'), 0))
  from public.sales s
  where s.company_id = p_company and s.local_date = p_day and s.cancelled_at is null
    and private.branch_is_shop(s.branch_id) and (auth.uid() is null or private.can_manage_shop(s.branch_id))
$$;

create or replace function public.shops_overview(p_day date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me public.members := private.my_admin_membership();
begin
  if not private.company_has(v_me.company_id, 'shop') then return null; end if;
  return private.shops_day(v_me.company_id, p_day) || jsonb_build_object('by_method', private.shops_day_methods(v_me.company_id, p_day));
end $$;

-- The evening email: the business logo, and totals per payment method.
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
  v := v || jsonb_build_object('logo_path', (select logo_path from public.companies where id = p_company));
  if private.company_has(p_company, 'shop') then
    v := v || jsonb_build_object('shops', private.shops_day(p_company, p_day) || jsonb_build_object('by_method', private.shops_day_methods(p_company, p_day)));
  end if;
  return v;
end $$;
