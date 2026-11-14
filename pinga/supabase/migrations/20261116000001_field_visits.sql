-- Pinga · Step 3 · Field sales visits
-- Reps check in at their assigned stores: GPS + selfie, optional shelf photo and note.
-- Saved on the phone first; flagged for review, never blocked.

-- A store can be added with just a name and address. Its location is then taken from the
-- first visit with good GPS (flagged so the manager can check it), or entered by the manager.
alter table public.stores alter column lat drop not null, alter column lng drop not null;
alter table public.stores add constraint stores_location_pair check ((lat is null) = (lng is null));
alter table public.stores add column location_source text check (location_source in ('manager', 'first_visit'));
update public.stores set location_source = 'manager' where lat is not null;

create table public.visits (
  id               uuid primary key,            -- made on the phone, so a re-send never creates a duplicate
  company_id       uuid not null references public.companies (id) on delete cascade,
  member_id        uuid not null,
  store_id         uuid not null,
  happened_at      timestamptz not null,        -- when the rep tapped "Check in"
  received_at      timestamptz not null default now(),
  local_date       date not null,
  lat              double precision not null check (lat between -90 and 90),
  lng              double precision not null check (lng between -180 and 180),
  accuracy_m       real,
  distance_m       integer,                     -- from the store, when its location is known
  selfie_path      text,
  shelf_photo_path text,
  note             text check (length(note) <= 500),
  flags            text[] not null default '{}',
  foreign key (company_id, member_id) references public.members (company_id, id),
  foreign key (company_id, store_id) references public.stores (company_id, id)
);
create index on public.visits (company_id, local_date);
create index on public.visits (member_id, happened_at desc);
create index on public.visits (store_id, happened_at desc);

alter table public.visits enable row level security;
revoke all on public.visits from anon, authenticated;
grant select on public.visits to authenticated;  -- written only through record_visit()
create policy "read visits" on public.visits for select to authenticated
  using (member_id in (select private.my_member_ids()) or private.is_admin(company_id));

create function public.record_visit(
  p_id uuid, p_store uuid, p_happened_at timestamptz,
  p_lat float8, p_lng float8, p_accuracy real,
  p_selfie_path text, p_shelf_path text, p_note text, p_device_now timestamptz
) returns public.visits
language plpgsql security definer set search_path = '' as $$
declare
  v_me    public.members;
  v_co    public.companies;
  v_store public.stores;
  v_row   public.visits;
  v_prev  record;
  v_dist  float8;
  v_flags text[] := '{}';
  v_secs  float8;
  v_prefix text;
begin
  select * into v_me from public.members where user_id = auth.uid() and active order by created_at limit 1;
  if v_me.id is null then raise exception 'Not allowed' using errcode = '42501'; end if;

  -- Sent twice (signal dropped mid-send)? Return what was already saved.
  select * into v_row from public.visits where id = p_id;
  if found then
    if v_row.member_id <> v_me.id then raise exception 'Not allowed' using errcode = '42501'; end if;
    return v_row;
  end if;

  select * into v_store from public.stores where id = p_store and company_id = v_me.company_id;
  if v_store.id is null then raise exception 'Unknown store' using errcode = '22023'; end if;

  v_prefix := v_me.company_id || '/' || v_me.id || '/';
  if (p_selfie_path is not null and p_selfie_path not like v_prefix || '%')
     or (p_shelf_path is not null and p_shelf_path not like v_prefix || '%') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select * into v_co from public.companies where id = v_me.company_id;

  -- Assigned? (An assignment may have changed while the phone was offline: flag, don't refuse.)
  if not exists (select 1 from public.store_assignments where member_id = v_me.id and store_id = v_store.id) then
    v_flags := v_flags || 'not_assigned'::text;
  end if;

  -- Where is the store?
  if v_store.lat is null then
    if p_accuracy is not null and p_accuracy <= 50 then
      update public.stores set lat = p_lat, lng = p_lng, location_source = 'first_visit' where id = v_store.id;
      v_dist := 0;
      v_flags := v_flags || 'store_located'::text;     -- manager should confirm this spot once
    else
      v_flags := v_flags || 'no_store_location'::text;
    end if;
  else
    v_dist := private.distance_m(p_lat, p_lng, v_store.lat, v_store.lng);
    if v_dist > v_store.radius_m + least(coalesce(p_accuracy, 0), 50) then
      v_flags := v_flags || 'outside_radius'::text;
    end if;
  end if;

  if p_accuracy is null or p_accuracy > 100 then v_flags := v_flags || 'weak_gps'::text; end if;
  if p_selfie_path is null then v_flags := v_flags || 'no_photo'::text; end if;
  if p_device_now is null or abs(extract(epoch from now() - p_device_now)) > 300 then
    v_flags := v_flags || 'clock_changed'::text;
  end if;

  -- Compare with this person's previous position (store visit or office clock-in).
  select x.lat, x.lng, x.happened_at into v_prev from (
    select lat, lng, happened_at from public.visits where member_id = v_me.id and happened_at <= p_happened_at
    union all
    select lat, lng, happened_at from public.attendance where member_id = v_me.id and happened_at <= p_happened_at
  ) x order by x.happened_at desc limit 1;
  if p_accuracy is not null and p_accuracy < 1 then
    v_flags := v_flags || 'suspicious_gps'::text;
  elsif v_prev.happened_at is not null and v_prev.lat = p_lat and v_prev.lng = p_lng then
    v_flags := v_flags || 'suspicious_gps'::text;
  end if;
  if v_prev.happened_at is not null then
    v_secs := greatest(extract(epoch from p_happened_at - v_prev.happened_at), 1);
    if private.distance_m(p_lat, p_lng, v_prev.lat, v_prev.lng) > 1000
       and private.distance_m(p_lat, p_lng, v_prev.lat, v_prev.lng) / v_secs > 50 then
      v_flags := v_flags || 'impossible_speed'::text;
    end if;
  end if;

  insert into public.visits
    (id, company_id, member_id, store_id, happened_at, local_date, lat, lng, accuracy_m, distance_m,
     selfie_path, shelf_photo_path, note, flags)
  values
    (p_id, v_me.company_id, v_me.id, v_store.id, p_happened_at, (p_happened_at at time zone v_co.timezone)::date,
     p_lat, p_lng, p_accuracy, round(v_dist), p_selfie_path, p_shelf_path, nullif(btrim(p_note), ''), v_flags)
  returning * into v_row;
  return v_row;
end $$;

revoke all on function public.record_visit(uuid, uuid, timestamptz, float8, float8, real, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_visit(uuid, uuid, timestamptz, float8, float8, real, text, text, text, timestamptz)
  to authenticated;
