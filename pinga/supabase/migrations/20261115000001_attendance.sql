-- Pinga · Step 2 · Office attendance
-- Clock in / clock out with GPS and a selfie. Recorded on the phone first and sent
-- when there is signal; the time saved is the moment of clocking in, not of sending.
-- Suspicious entries are flagged for the manager, never blocked.

alter table public.members add column reference_photo_path text;

create table public.attendance (
  id           uuid primary key,             -- made on the phone, so a re-send never creates a duplicate
  company_id   uuid not null references public.companies (id) on delete cascade,
  member_id    uuid not null,
  branch_id    uuid,                         -- nearest office at the time
  kind         text not null check (kind in ('in', 'out')),
  happened_at  timestamptz not null,         -- when the person tapped the button
  received_at  timestamptz not null default now(),
  local_date   date not null,                -- the company's calendar day
  lat          double precision not null check (lat between -90 and 90),
  lng          double precision not null check (lng between -180 and 180),
  accuracy_m   real,
  distance_m   integer,                      -- from the nearest office
  late_minutes integer,                      -- first clock-in of a work day only; 0 = on time
  photo_path   text,
  flags        text[] not null default '{}', -- reasons for a manager to take a look
  foreign key (company_id, member_id) references public.members (company_id, id),
  foreign key (company_id, branch_id) references public.branches (company_id, id) on delete set null (branch_id)
);
create index on public.attendance (company_id, local_date);
create index on public.attendance (member_id, happened_at desc);

-- Straight-line distance in metres between two GPS points.
create function private.distance_m(lat1 float8, lng1 float8, lat2 float8, lng2 float8) returns float8
language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- ───────────────────────── Access rules ──────────────────────────

alter table public.attendance enable row level security;
revoke all on public.attendance from anon, authenticated;
grant select on public.attendance to authenticated;  -- written only through record_attendance()
create policy "read attendance" on public.attendance for select to authenticated
  using (member_id in (select private.my_member_ids()) or private.is_admin(company_id));

-- ─────────────────────────── Actions ─────────────────────────────

-- The server's clock, so phones with a wrong clock still record the right time.
create function public.server_now() returns timestamptz language sql stable as $$ select now() $$;

create function public.record_attendance(
  p_id uuid, p_kind text, p_happened_at timestamptz,
  p_lat float8, p_lng float8, p_accuracy real,
  p_photo_path text, p_device_now timestamptz
) returns public.attendance
language plpgsql security definer set search_path = '' as $$
declare
  v_me     public.members;
  v_co     public.companies;
  v_row    public.attendance;
  v_prev   public.attendance;
  v_branch uuid;
  v_radius integer;
  v_dist   float8;
  v_local  timestamp;
  v_late   integer;
  v_flags  text[] := '{}';
  v_secs   float8;
begin
  select * into v_me from public.members where user_id = auth.uid() and active order by created_at limit 1;
  if v_me.id is null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  -- Sent twice (e.g. signal dropped mid-send)? Return what was already saved.
  select * into v_row from public.attendance where id = p_id;
  if found then
    if v_row.member_id <> v_me.id then raise exception 'Not allowed' using errcode = '42501'; end if;
    return v_row;
  end if;

  if p_kind not in ('in', 'out') then raise exception 'Unknown kind' using errcode = '22023'; end if;
  if p_photo_path is not null and p_photo_path not like v_me.company_id || '/' || v_me.id || '/%' then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select * into v_co from public.companies where id = v_me.company_id;
  v_local := p_happened_at at time zone v_co.timezone;

  -- Nearest office.
  select b.id, b.radius_m, private.distance_m(p_lat, p_lng, b.lat, b.lng)
    into v_branch, v_radius, v_dist
  from public.branches b where b.company_id = v_me.company_id
  order by 3 limit 1;

  if v_branch is null then
    v_flags := v_flags || 'no_office'::text;
  elsif v_dist > v_radius + least(coalesce(p_accuracy, 0), 50) then
    v_flags := v_flags || 'outside_radius'::text;
  end if;
  if p_accuracy is null or p_accuracy > 100 then v_flags := v_flags || 'weak_gps'::text; end if;
  if p_photo_path is null then v_flags := v_flags || 'no_photo'::text; end if;
  -- Phone clock moved since the app last checked the time.
  if p_device_now is null or abs(extract(epoch from now() - p_device_now)) > 300 then
    v_flags := v_flags || 'clock_changed'::text;
  end if;

  -- Compare with this person's previous record.
  select * into v_prev from public.attendance
  where member_id = v_me.id and happened_at <= p_happened_at
  order by happened_at desc limit 1;
  if p_accuracy is not null and p_accuracy < 1 then
    v_flags := v_flags || 'suspicious_gps'::text;              -- real GPS is never perfect
  elsif v_prev.id is not null and v_prev.lat = p_lat and v_prev.lng = p_lng then
    v_flags := v_flags || 'suspicious_gps'::text;              -- real GPS never repeats exactly
  end if;
  if v_prev.id is not null then
    v_secs := greatest(extract(epoch from p_happened_at - v_prev.happened_at), 1);
    if private.distance_m(p_lat, p_lng, v_prev.lat, v_prev.lng) > 1000
       and private.distance_m(p_lat, p_lng, v_prev.lat, v_prev.lng) / v_secs > 50 then
      v_flags := v_flags || 'impossible_speed'::text;          -- faster than 180 km/h
    end if;
  end if;

  -- Lateness: first clock-in on a work day, after the grace period.
  if p_kind = 'in'
     and extract(isodow from v_local)::smallint = any (v_co.work_days)
     and not exists (select 1 from public.attendance
                     where member_id = v_me.id and kind = 'in' and local_date = v_local::date) then
    v_late := floor(extract(epoch from v_local::time - v_co.work_starts) / 60);
    v_late := case when v_late > v_co.late_after_minutes then v_late else 0 end;
  end if;

  insert into public.attendance
    (id, company_id, member_id, branch_id, kind, happened_at, local_date,
     lat, lng, accuracy_m, distance_m, late_minutes, photo_path, flags)
  values
    (p_id, v_me.company_id, v_me.id, v_branch, p_kind, p_happened_at, v_local::date,
     p_lat, p_lng, p_accuracy, round(v_dist), v_late, p_photo_path, v_flags)
  returning * into v_row;
  return v_row;
end $$;

-- The one reference selfie taken when joining. Set once; a manager can clear it later.
create function public.set_reference_photo(p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members;
begin
  select * into v_me from public.members where user_id = auth.uid() and active order by created_at limit 1;
  if v_me.id is null or p_path not like v_me.company_id || '/' || v_me.id || '/%' then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_me.reference_photo_path is not null then
    raise exception 'Your reference photo is already saved' using errcode = 'P0001';
  end if;
  update public.members set reference_photo_path = p_path where id = v_me.id;
end $$;

revoke all on function public.server_now(), public.record_attendance(uuid, text, timestamptz, float8, float8, real, text, timestamptz),
  public.set_reference_photo(text) from public, anon, authenticated;
grant execute on function public.server_now() to anon, authenticated;
grant execute on function public.record_attendance(uuid, text, timestamptz, float8, float8, real, text, timestamptz),
  public.set_reference_photo(text) to authenticated;

-- ─────────────────────────── Photos ──────────────────────────────
-- Private storage. Files live at <company>/<person>/<name>.jpg.
-- People upload only into their own folder; owners and managers can view their company's photos.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 102400, array['image/jpeg'])
on conflict (id) do nothing;

create function private.photo_access(p_name text, p_write boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members m
    where m.user_id = auth.uid() and m.active
      and (p_name like m.company_id || '/' || m.id || '/%'
           or (not p_write and m.role in ('owner', 'admin') and p_name like m.company_id || '/%'))
  )
$$;
grant execute on function private.photo_access(text, boolean) to authenticated;

create policy "upload own photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and private.photo_access(name, true));
create policy "view photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and private.photo_access(name, false));
