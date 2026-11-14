-- Pinga · Step 6 · Server-side face check
-- After a clock-in or store visit is saved, the server compares its selfie with the person's
-- reference photo (AWS Rekognition, EU Ireland). Nothing is ever blocked: a mismatch is flagged
-- for the manager and listed in the owner's evening email.
-- Switched off until the AWS keys are saved as Supabase secrets; records then simply wait.

-- face_status: pending | match | mismatch | no_face | no_reference | error   (null = no selfie)
alter table public.attendance add column face_status text check (face_status in ('pending', 'match', 'mismatch', 'no_face', 'no_reference', 'error')),
  add column face_similarity real, add column face_checked_at timestamptz, add column face_attempts smallint not null default 0;
alter table public.visits add column face_status text check (face_status in ('pending', 'match', 'mismatch', 'no_face', 'no_reference', 'error')),
  add column face_similarity real, add column face_checked_at timestamptz, add column face_attempts smallint not null default 0;

create function private.face_pending() returns trigger language plpgsql as $$
begin
  -- Clock-ins keep their selfie in photo_path, visits in selfie_path.
  if coalesce(to_jsonb(new) ->> 'photo_path', to_jsonb(new) ->> 'selfie_path') is not null then
    new.face_status := 'pending';
  end if;
  return new;
end $$;
create trigger face_pending before insert on public.attendance for each row execute function private.face_pending();
create trigger face_pending before insert on public.visits for each row execute function private.face_pending();
create index on public.attendance (happened_at) where face_status = 'pending';
create index on public.visits (happened_at) where face_status = 'pending';

-- Consent (Nigeria Data Protection Act: face photos used to identify someone are sensitive data).
alter table public.members add column face_consent_at timestamptz;

create or replace function public.set_reference_photo(p_path text) returns void
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
  update public.members set reference_photo_path = p_path, face_consent_at = now() where id = v_me.id;
  -- Selfies taken while there was no reference photo can now be checked.
  update public.attendance set face_status = 'pending', face_attempts = 0 where member_id = v_me.id and face_status = 'no_reference';
  update public.visits set face_status = 'pending', face_attempts = 0 where member_id = v_me.id and face_status = 'no_reference';
end $$;

-- A manager asks someone to take a new reference photo (e.g. it was blurry, or it isn't them).
create function public.clear_reference_photo(p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members := private.my_admin_membership();
begin
  update public.members set reference_photo_path = null
  where id = p_member and company_id = v_me.company_id and role in ('staff', 'rep');
  if not found then raise exception 'Not allowed' using errcode = '42501'; end if;
end $$;
revoke all on function public.clear_reference_photo(uuid) from public, anon, authenticated;
grant execute on function public.clear_reference_photo(uuid) to authenticated;

-- ── Used only by the server's face-check function (service role) ──

-- The same random key proves the schedule for every server job.
create function public.job_key_ok(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.settings where key = 'summary_key' and value = p_key)
$$;

-- Selfies waiting to be checked (last 3 days only, so switching on never bills for a long backlog).
create function public.face_checks_due(p_limit integer) returns table (kind text, id uuid, photo_path text, reference_path text)
language sql stable security definer set search_path = '' as $$
  select * from (
    select 'attendance'::text, a.id, a.photo_path, m.reference_photo_path
    from public.attendance a join public.members m on m.id = a.member_id
    where a.face_status = 'pending' and a.happened_at > now() - interval '3 days'
    union all
    select 'visit', v.id, v.selfie_path, m.reference_photo_path
    from public.visits v join public.members m on m.id = v.member_id
    where v.face_status = 'pending' and v.happened_at > now() - interval '3 days'
  ) x limit greatest(1, least(p_limit, 50))
$$;

-- Saves a result. Mismatch and no-face add a flag for the manager. Errors are retried 3 times.
create function public.face_check_save(p_kind text, p_id uuid, p_status text, p_similarity real) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_flag text := case p_status when 'mismatch' then 'face_mismatch' when 'no_face' then 'no_face' end;
begin
  if p_status not in ('match', 'mismatch', 'no_face', 'no_reference', 'error') then
    raise exception 'Unknown face status' using errcode = '22023';
  end if;
  if p_kind = 'attendance' then
    update public.attendance set
      face_attempts = face_attempts + 1,
      face_status = case when p_status = 'error' and face_attempts + 1 < 3 then 'pending' else p_status end,
      face_similarity = p_similarity, face_checked_at = now(),
      flags = case when v_flag is not null and not v_flag = any (flags) then flags || v_flag else flags end
    where id = p_id and face_status = 'pending';
  elsif p_kind = 'visit' then
    update public.visits set
      face_attempts = face_attempts + 1,
      face_status = case when p_status = 'error' and face_attempts + 1 < 3 then 'pending' else p_status end,
      face_similarity = p_similarity, face_checked_at = now(),
      flags = case when v_flag is not null and not v_flag = any (flags) then flags || v_flag else flags end
    where id = p_id and face_status = 'pending';
  else
    raise exception 'Unknown kind' using errcode = '22023';
  end if;
end $$;

-- Whether face checking is on (the function reports in each time it runs).
create function public.face_check_report(p_enabled boolean) returns void
language sql security definer set search_path = '' as $$
  insert into private.settings (key, value) values ('face_check', jsonb_build_object('enabled', p_enabled, 'at', now())::text)
  on conflict (key) do update set value = excluded.value
$$;

revoke all on function public.job_key_ok(text), public.face_checks_due(integer), public.face_check_save(text, uuid, text, real),
  public.face_check_report(boolean) from public, anon, authenticated;
grant execute on function public.job_key_ok(text), public.face_checks_due(integer), public.face_check_save(text, uuid, text, real),
  public.face_check_report(boolean) to service_role;

-- For owners and managers: is it on, and how many are waiting?
create function public.face_check_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me public.members := private.my_admin_membership();
  v jsonb;
begin
  select value::jsonb into v from private.settings where key = 'face_check';
  return jsonb_build_object(
    'enabled', coalesce((v->>'enabled')::boolean, false),
    'last_run', v->>'at',
    'waiting', (select count(*) from public.attendance where company_id = v_me.company_id and face_status = 'pending')
             + (select count(*) from public.visits where company_id = v_me.company_id and face_status = 'pending'));
end $$;
revoke all on function public.face_check_status() from public, anon, authenticated;
grant execute on function public.face_check_status() to authenticated;

-- ── Evening email: add face mismatches ──────────────────────────
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

  return v || jsonb_build_object('face_mismatches', (
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
end $$;
