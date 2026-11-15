-- Pinga · Fixes from the owner's review
-- 1. Offices never appear in sales, stock or the till: a location is a shop only if it is marked as one,
--    whatever the business type. New locations in a Storefront business are shops unless marked otherwise.
-- 2. "Get started" also knows about sales (a shop that is selling has started).

-- New locations: shop in a Storefront business, office otherwise, unless the app says which.
alter table public.branches alter column kind drop default;
create function private.default_branch_kind() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind is null then
    new.kind := case when (select business_type from public.companies where id = new.company_id) = 'storefront' then 'shop' else 'office' end;
  end if;
  return new;
end $$;
create trigger default_branch_kind before insert on public.branches for each row execute function private.default_branch_kind();

-- Storefront businesses whose locations were all created before shops existed: those locations are their shops.
update public.branches b set kind = 'shop'
from public.companies c
where c.id = b.company_id and c.business_type = 'storefront' and b.kind = 'office'
  and not exists (select 1 from public.branches x where x.company_id = b.company_id and x.kind = 'shop');

create or replace function private.branch_is_shop(p_branch uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.business_type <> 'field' and b.kind = 'shop'
    from public.branches b join public.companies c on c.id = b.company_id where b.id = p_branch), false)
$$;

create or replace function public.setup_progress() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me public.members := private.my_admin_membership();
  c uuid := v_me.company_id;
begin
  return jsonb_build_object(
    'offices', exists (select 1 from public.branches where company_id = c),
    'stores', exists (select 1 from public.stores where company_id = c),
    'people', (select count(*) from public.members where company_id = c and active and role in ('staff', 'rep')),
    'first_check_in', exists (select 1 from public.attendance where company_id = c)
                   or exists (select 1 from public.visits where company_id = c),
    'first_sale', exists (select 1 from public.sales where company_id = c));
end $$;
