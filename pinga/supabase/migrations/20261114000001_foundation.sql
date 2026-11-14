-- Pinga · Step 1 · Foundation
-- Companies, people and roles, branches, stores, store assignments.
-- Every row belongs to a company. Row-level security (RLS) makes sure a
-- signed-in person only ever sees rows of the company they belong to.

-- ───────────────────────────── Types ─────────────────────────────

create type public.member_role as enum ('owner', 'admin', 'staff', 'rep');

-- ───────────────────────────── Tables ────────────────────────────

create table public.companies (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (length(btrim(name)) between 2 and 120),
  timezone           text not null default 'Africa/Lagos',
  work_starts        time not null default '08:00',
  work_ends          time not null default '17:00',
  late_after_minutes smallint not null default 15 check (late_after_minutes between 0 and 240),
  work_days          smallint[] not null default '{1,2,3,4,5}',      -- ISO days, 1 = Monday
  has_attendance     boolean not null default true,
  has_field          boolean not null default true,
  -- Billing (managed by the platform, never editable by the company itself)
  status             text not null default 'trial'
                       check (status in ('trial', 'active', 'past_due', 'cancelled')),
  trial_ends_at      timestamptz not null default now() + interval '14 days',
  created_at         timestamptz not null default now(),
  check (work_ends > work_starts),
  check (work_days <@ '{1,2,3,4,5,6,7}'::smallint[])
);

create table public.branches (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 120),
  address    text,
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  radius_m   integer not null default 100 check (radius_m between 20 and 2000),
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, name)
);

create table public.stores (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 120),
  address    text,
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  radius_m   integer not null default 100 check (radius_m between 20 and 2000),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);

create table public.members (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  user_id            uuid references auth.users (id) on delete set null,
  full_name          text not null check (length(btrim(full_name)) between 1 and 120),
  phone              text check (phone ~ '^\+[1-9][0-9]{7,14}$'),            -- international format, e.g. +2348031234567
  role               public.member_role not null,
  branch_id          uuid,                                                    -- home office, for office staff
  daily_visit_target smallint check (daily_visit_target between 0 and 50),   -- for sales reps
  hourly_rate_naira  numeric(10, 2) check (hourly_rate_naira >= 0),           -- optional, for "cost of lost time"
  active             boolean not null default true,
  invite_token       text unique default replace(gen_random_uuid()::text, '-', ''),
  invite_expires_at  timestamptz default now() + interval '7 days',
  joined_at          timestamptz,
  created_at         timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, phone),
  unique (company_id, user_id),
  -- A person's home branch must belong to the same company.
  foreign key (company_id, branch_id) references public.branches (company_id, id) on delete set null (branch_id),
  -- Invited people sign in with phone + PIN, so they need a phone number.
  check (role = 'owner' or phone is not null)
);

create table public.store_assignments (
  company_id uuid not null references public.companies (id) on delete cascade,
  member_id  uuid not null,
  store_id   uuid not null,
  created_at timestamptz not null default now(),
  primary key (member_id, store_id),
  -- Both sides must belong to the same company: enforced by the database.
  foreign key (company_id, member_id) references public.members (company_id, id) on delete cascade,
  foreign key (company_id, store_id)  references public.stores  (company_id, id) on delete cascade
);

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create index on public.members (user_id) where user_id is not null;
create index on public.branches (company_id);
create index on public.stores (company_id);
create index on public.store_assignments (company_id);
create index on public.store_assignments (store_id);

-- ─────────────────────── Helper functions ────────────────────────
-- Kept in a private schema so they are not callable through the public API.

create schema if not exists private;

-- Staff sign in with phone + PIN. Behind the scenes each phone maps to a
-- login address that is never emailed. Must match PHONE_LOGIN_DOMAIN in web/js/phone.js.
create function private.phone_login_email(p_phone text) returns text
language sql immutable as $$
  select ltrim(p_phone, '+') || '@phone.usepinga.com'
$$;

create function private.my_role(p_company uuid) returns public.member_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.members m
  where m.company_id = p_company and m.user_id = auth.uid() and m.active
$$;

create function private.is_member(p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.my_role(p_company) is not null
$$;

create function private.is_admin(p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role(p_company) in ('owner', 'admin'), false)
$$;

create function private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

create function private.my_member_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select id from public.members where user_id = auth.uid() and active
$$;

-- A company must always keep at least one active owner.
create function private.keep_an_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'owner' and old.active
     and (new.role <> 'owner' or not new.active)
     and not exists (
       select 1 from public.members
       where company_id = old.company_id and role = 'owner' and active and id <> old.id
     ) then
    raise exception 'A company must keep at least one owner' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger keep_an_owner before update on public.members
  for each row execute function private.keep_an_owner();

-- ───────────────────────── Access rules ──────────────────────────

alter table public.companies         enable row level security;
alter table public.branches          enable row level security;
alter table public.stores            enable row level security;
alter table public.members           enable row level security;
alter table public.store_assignments enable row level security;
alter table public.platform_admins   enable row level security;

-- Start from nothing, then grant only what is needed.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function
  private.my_role(uuid), private.is_member(uuid), private.is_admin(uuid),
  private.is_platform_admin(), private.my_member_ids()
  to authenticated;

-- Companies: members can read their own company; owners and admins can change
-- working hours and modules, but never billing fields.
grant select on public.companies to authenticated;
grant update (name, timezone, work_starts, work_ends, late_after_minutes, work_days, has_attendance, has_field)
  on public.companies to authenticated;

create policy "members read own company" on public.companies for select to authenticated
  using (private.is_member(id) or private.is_platform_admin());
create policy "admins update own company" on public.companies for update to authenticated
  using (private.is_admin(id)) with check (private.is_admin(id));

-- Branches: everyone in the company can read them (needed to clock in);
-- only owners and admins can change them.
grant select, insert, update, delete on public.branches to authenticated;
create policy "members read branches" on public.branches for select to authenticated
  using (private.is_member(company_id) or private.is_platform_admin());
create policy "admins insert branches" on public.branches for insert to authenticated
  with check (private.is_admin(company_id));
create policy "admins update branches" on public.branches for update to authenticated
  using (private.is_admin(company_id)) with check (private.is_admin(company_id));
create policy "admins delete branches" on public.branches for delete to authenticated
  using (private.is_admin(company_id));

-- Stores: admins see all; a sales rep sees only the stores assigned to them.
grant select, insert, update, delete on public.stores to authenticated;
create policy "read stores" on public.stores for select to authenticated
  using (
    private.is_admin(company_id) or private.is_platform_admin()
    or exists (select 1 from public.store_assignments a
               where a.store_id = stores.id and a.member_id in (select private.my_member_ids()))
  );
create policy "admins insert stores" on public.stores for insert to authenticated
  with check (private.is_admin(company_id));
create policy "admins update stores" on public.stores for update to authenticated
  using (private.is_admin(company_id)) with check (private.is_admin(company_id));
create policy "admins delete stores" on public.stores for delete to authenticated
  using (private.is_admin(company_id));

-- Members: you can read yourself; owners and admins read everyone in their company.
-- Admins can add and edit people, but only an owner can create or change an owner.
-- Nobody can link a login to a person directly (that only happens via an invite).
-- People are deactivated, never deleted, so their history stays.
grant select on public.members to authenticated;
grant insert (company_id, full_name, phone, role, branch_id, daily_visit_target, hourly_rate_naira)
  on public.members to authenticated;
grant update (full_name, phone, role, branch_id, daily_visit_target, hourly_rate_naira, active)
  on public.members to authenticated;

create policy "read members" on public.members for select to authenticated
  using (user_id = auth.uid() or private.is_admin(company_id) or private.is_platform_admin());
create policy "admins add members" on public.members for insert to authenticated
  with check (
    private.is_admin(company_id)
    and (role <> 'owner' or private.my_role(company_id) = 'owner')
  );
create policy "admins edit members" on public.members for update to authenticated
  using (private.is_admin(company_id) and (role <> 'owner' or private.my_role(company_id) = 'owner'))
  with check (private.is_admin(company_id) and (role <> 'owner' or private.my_role(company_id) = 'owner'));

-- Store assignments: admins manage them; reps read their own.
grant select, insert, delete on public.store_assignments to authenticated;
create policy "read assignments" on public.store_assignments for select to authenticated
  using (private.is_admin(company_id) or member_id in (select private.my_member_ids()));
create policy "admins add assignments" on public.store_assignments for insert to authenticated
  with check (private.is_admin(company_id));
create policy "admins remove assignments" on public.store_assignments for delete to authenticated
  using (private.is_admin(company_id));

-- platform_admins: no policies, so nobody can read or change it through the API.

-- ───────────────────── Actions (API functions) ───────────────────

-- A signed-in person creates a company and becomes its owner.
create function public.create_company(p_name text, p_owner_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  if auth.uid() is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;
  if (select count(*) from public.members where user_id = auth.uid() and role = 'owner') >= 5 then
    raise exception 'You already own the maximum number of companies' using errcode = 'P0001';
  end if;

  insert into public.companies (name) values (btrim(p_name)) returning id into v_company;
  insert into public.members (company_id, user_id, full_name, role, invite_token, invite_expires_at, joined_at)
  values (v_company, auth.uid(), btrim(p_owner_name), 'owner', null, null, now());
  return v_company;
end $$;

-- Owners and admins create a fresh "set your PIN" link (also used to reset a forgotten PIN).
create function public.renew_invite(p_member uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_member public.members;
  v_token  text := replace(gen_random_uuid()::text, '-', '');
begin
  select * into v_member from public.members where id = p_member;
  if v_member.id is null or not private.is_admin(v_member.company_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_member.role = 'owner' then
    raise exception 'Owners sign in with email' using errcode = 'P0001';
  end if;
  update public.members set invite_token = v_token, invite_expires_at = now() + interval '7 days'
  where id = p_member;
  return v_token;
end $$;

-- What the invite page shows before a PIN is chosen. Works without signing in,
-- and reveals only the first name and the company name.
create function public.invite_preview(p_token text) returns table (first_name text, company_name text)
language sql stable security definer set search_path = '' as $$
  select split_part(m.full_name, ' ', 1), c.name
  from public.members m join public.companies c on c.id = m.company_id
  where m.invite_token = p_token and m.invite_expires_at > now() and m.active
$$;

-- Used only by the server-side "accept invite" function (service role).
-- Says whether the invite can be used, which login it maps to, and whether
-- that login already exists (a returning person resetting their PIN).
create function public.invite_prepare(p_token text)
returns table (ok boolean, reason text, login_email text, existing_user uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_member public.members;
  v_email  text;
  v_user   uuid;
begin
  select * into v_member from public.members
  where invite_token = p_token and invite_expires_at > now() and active;
  if v_member.id is null then
    return query select false, 'This link has expired. Ask your manager for a new one.', null::text, null::uuid;
    return;
  end if;

  v_email := private.phone_login_email(v_member.phone);
  select u.id into v_user from auth.users u where u.email = v_email;

  -- One phone number belongs to one company. This stops a manager in one
  -- company from resetting the PIN of someone who works at another.
  if v_user is not null and exists (
       select 1 from public.members
       where user_id = v_user and company_id <> v_member.company_id and active) then
    return query select false, 'This phone number is already used by another company on Pinga.', null::text, null::uuid;
    return;
  end if;

  return query select true, null::text, v_email, v_user;
end $$;

create function public.invite_complete(p_token text, p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_member public.members;
begin
  select * into v_member from public.members
  where invite_token = p_token and invite_expires_at > now() and active
  for update;
  if v_member.id is null then
    raise exception 'This link has expired' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users where id = p_user
                 and email = private.phone_login_email(v_member.phone)) then
    raise exception 'Login does not match this invite' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.members
             where user_id = p_user and company_id <> v_member.company_id and active) then
    raise exception 'This phone number is already used by another company on Pinga.' using errcode = 'P0001';
  end if;

  update public.members
  set user_id = p_user, joined_at = coalesce(joined_at, now()), invite_token = null, invite_expires_at = null
  where id = v_member.id;
  return v_member.id;
end $$;

revoke all on function public.create_company(text, text), public.renew_invite(uuid),
  public.invite_preview(text), public.invite_prepare(text), public.invite_complete(text, uuid)
  from public, anon, authenticated;
grant execute on function public.create_company(text, text), public.renew_invite(uuid) to authenticated;
grant execute on function public.invite_preview(text) to anon, authenticated;
grant execute on function public.invite_prepare(text), public.invite_complete(text, uuid) to service_role;
