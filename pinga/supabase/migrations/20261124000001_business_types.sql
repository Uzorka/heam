-- Pinga · Business types (Part A of the Storefront module)
-- Each company is Field sales, Storefront or Both. The type decides which features exist:
--   visits (stores, reps, store visits): field, both
--   shop (shops, stock, sales):          storefront, both
-- Changing type only hides features; nothing is deleted. Existing companies are Field sales.
-- Managers can be given shops: they then see only the staff of those shops
-- (plus everyone not tied to a shop). Owners see everything.

alter table public.companies add column business_type text not null default 'field'
  check (business_type in ('field', 'storefront', 'both'));

-- In a Both company, each location is an office or a shop. (Field: all offices. Storefront: all shops.)
alter table public.branches add column kind text not null default 'office' check (kind in ('office', 'shop'));
grant insert (kind), update (kind) on public.branches to authenticated;

create function private.company_has(p_company uuid, p_feature text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select case p_feature
      when 'visits' then business_type in ('field', 'both')
      when 'shop' then business_type in ('storefront', 'both') end
    from public.companies where id = p_company), false)
$$;

create function private.branch_is_shop(p_branch uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select case c.business_type when 'storefront' then true when 'both' then b.kind = 'shop' else false end
    from public.branches b join public.companies c on c.id = b.company_id where b.id = p_branch), false)
$$;

-- Which managers look after which shops (set by the owner).
create table public.manager_shops (
  company_id uuid not null references public.companies (id) on delete cascade,
  manager_id uuid not null,
  branch_id  uuid not null,
  primary key (manager_id, branch_id),
  foreign key (company_id, manager_id) references public.members (company_id, id) on delete cascade,
  foreign key (company_id, branch_id) references public.branches (company_id, id) on delete cascade
);
alter table public.manager_shops enable row level security;
revoke all on public.manager_shops from anon, authenticated;
grant select, insert, delete on public.manager_shops to authenticated;
create policy "owners and the manager read" on public.manager_shops for select to authenticated
  using (private.my_role(company_id) = 'owner' or manager_id in (select private.my_member_ids()));
create policy "owners assign shops" on public.manager_shops for insert to authenticated
  with check (private.my_role(company_id) = 'owner'
    and exists (select 1 from public.members m where m.id = manager_id and m.role = 'admin')
    and private.branch_is_shop(branch_id));
create policy "owners unassign shops" on public.manager_shops for delete to authenticated
  using (private.my_role(company_id) = 'owner');

-- Can the signed-in person see this member? Owners: yes. Managers: yes, unless the member works
-- in a shop the manager doesn't look after. Server jobs (no signed-in person): yes.
create function private.can_see_member(p_member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with v as (select id, role from public.members where user_id = auth.uid() and active order by created_at limit 1),
       t as (select id, role, branch_id from public.members where id = p_member)
  select case
    when auth.uid() is null then true
    when not exists (select 1 from v) then false
    when (select role from v) <> 'admin' then true
    when (select id from v) = p_member then true
    when not exists (select 1 from t where role = 'staff' and branch_id is not null and private.branch_is_shop(branch_id)) then true
    else exists (select 1 from public.manager_shops ms, v, t where ms.manager_id = v.id and ms.branch_id = t.branch_id)
  end
$$;
grant execute on function private.company_has(uuid, text), private.branch_is_shop(uuid), private.can_see_member(uuid) to authenticated;

-- People: managers see and edit only the people they may see.
drop policy "read members" on public.members;
create policy "read members" on public.members for select to authenticated
  using (user_id = auth.uid() or (private.is_admin(company_id) and private.can_see_member(id)) or private.is_platform_admin());
drop policy "admins add members" on public.members;
create policy "admins add members" on public.members for insert to authenticated
  with check (
    private.is_admin(company_id)
    and (role <> 'owner' or private.my_role(company_id) = 'owner')
    and (role <> 'rep' or private.company_has(company_id, 'visits'))     -- no sales reps in a Storefront business
  );
drop policy "admins edit members" on public.members;
create policy "admins edit members" on public.members for update to authenticated
  using (private.is_admin(company_id) and private.can_see_member(id) and (role <> 'owner' or private.my_role(company_id) = 'owner'))
  with check (private.is_admin(company_id) and (role <> 'owner' or private.my_role(company_id) = 'owner')
    and (role <> 'rep' or private.company_has(company_id, 'visits')));

-- Stores and store assignments exist only where store visits are used.
drop policy "admins insert stores" on public.stores;
create policy "admins insert stores" on public.stores for insert to authenticated
  with check (private.is_admin(company_id) and private.company_has(company_id, 'visits'));
drop policy "admins add assignments" on public.store_assignments;
create policy "admins add assignments" on public.store_assignments for insert to authenticated
  with check (private.is_admin(company_id) and private.company_has(company_id, 'visits'));

-- Store visits are refused in a Storefront business (whichever way they arrive).
create function private.visits_allowed() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not private.company_has(new.company_id, 'visits') then
    raise exception 'Store visits are not used in this business' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger visits_allowed before insert on public.visits for each row execute function private.visits_allowed();

-- A manager can only send a PIN link to people they may see.
create or replace function public.renew_invite(p_member uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_member public.members;
  v_token  text := replace(gen_random_uuid()::text, '-', '');
begin
  select * into v_member from public.members where id = p_member;
  if v_member.id is null or not private.is_admin(v_member.company_id) or not private.can_see_member(p_member) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_member.role = 'owner' then
    raise exception 'Owners sign in with email' using errcode = 'P0001';
  end if;
  update public.members set invite_token = v_token, invite_expires_at = now() + interval '7 days'
  where id = p_member;
  return v_token;
end $$;

-- Sign-up with a business type (the 2-argument version stays for older app versions).
create function public.create_company(p_name text, p_owner_name text, p_type text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  if p_type not in ('field', 'storefront', 'both') then raise exception 'Unknown business type' using errcode = '22023'; end if;
  v_company := public.create_company(p_name, p_owner_name);
  update public.companies set business_type = p_type where id = v_company;
  return v_company;
end $$;

-- The owner can change the type later. Nothing is deleted; features are only hidden.
create function public.set_business_type(p_type text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members := private.my_admin_membership();
begin
  if v_me.role <> 'owner' then raise exception 'Only the owner can change the business type' using errcode = '42501'; end if;
  if p_type not in ('field', 'storefront', 'both') then raise exception 'Unknown business type' using errcode = '22023'; end if;
  update public.companies set business_type = p_type where id = v_me.company_id;
end $$;

revoke all on function public.create_company(text, text, text), public.set_business_type(text) from public, anon, authenticated;
grant execute on function public.create_company(text, text, text), public.set_business_type(text) to authenticated;

-- The day board (Today, Overview, export, evening email) shows managers only the people they may see.
create or replace function private.board(p_company uuid, p_day date)
returns table (
  member_id uuid, full_name text, role public.member_role, status text, set_by_manager boolean,
  first_in timestamptz, last_out timestamptz, late_minutes integer,
  visits integer, visit_target integer, to_review integer, office text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_co      public.companies;
  v_today   date;
  v_workday boolean;
begin
  select * into v_co from public.companies where id = p_company;
  v_today := (now() at time zone v_co.timezone)::date;
  v_workday := extract(isodow from p_day)::smallint = any (v_co.work_days);
  return query
  select m.id, m.full_name, m.role,
    coalesce(ds.status,
      case
        when a.first_in is not null or coalesce(v.n, 0) > 0 then
          case when m.role = 'staff' and a.late > 0 then 'late' else 'present' end
        when not v_workday then 'off'
        when p_day < v_today then 'absent'
        else 'none'
      end),
    ds.status is not null,
    a.first_in, a.last_out, a.late,
    coalesce(v.n, 0)::integer,
    case when m.role = 'rep' then coalesce(m.daily_visit_target, 4)::integer end,
    (coalesce(a.flagged, 0) + coalesce(v.flagged, 0))::integer,
    coalesce(ab.name, hb.name)
  from public.members m
  left join public.day_status ds on ds.member_id = m.id and ds.day = p_day
  left join lateral (
    select min(x.happened_at) filter (where x.kind = 'in') as first_in,
           max(x.happened_at) filter (where x.kind = 'out') as last_out,
           max(x.late_minutes) as late,
           count(*) filter (where x.flags <> '{}') as flagged,
           (array_agg(x.branch_id order by x.happened_at) filter (where x.kind = 'in'))[1] as branch
    from public.attendance x where x.member_id = m.id and x.local_date = p_day
  ) a on true
  left join lateral (
    select count(distinct y.store_id) as n,
           count(*) filter (where y.flags <> '{}' and y.flags <> '{store_located}') as flagged
    from public.visits y where y.member_id = m.id and y.local_date = p_day
  ) v on true
  left join public.branches ab on ab.id = a.branch
  left join public.branches hb on hb.id = m.branch_id
  where m.company_id = p_company and m.active and m.role in ('staff', 'rep')
    and private.can_see_member(m.id)   -- managers: only staff of their own shops (and everyone not tied to a shop)
    and (m.created_at at time zone v_co.timezone)::date <= p_day
  order by m.full_name;
end $$;
