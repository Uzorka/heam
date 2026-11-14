-- Pinga · Step 4 · Manager's Today page
-- Day statuses set by a manager (Present / Absent / Leave / Off), and the day board that
-- combines them with clock-ins and store visits.

create table public.day_status (
  company_id uuid not null references public.companies (id) on delete cascade,
  member_id  uuid not null,
  day        date not null,
  status     text not null check (status in ('present', 'absent', 'leave', 'off')),
  set_by     uuid not null references public.members (id),
  set_at     timestamptz not null default now(),
  primary key (member_id, day),
  foreign key (company_id, member_id) references public.members (company_id, id)
);
create index on public.day_status (company_id, day);

alter table public.day_status enable row level security;
revoke all on public.day_status from anon, authenticated;
grant select on public.day_status to authenticated;  -- written only through set_day_status()
create policy "read day status" on public.day_status for select to authenticated
  using (member_id in (select private.my_member_ids()) or private.is_admin(company_id));

-- The signed-in owner or manager (or an error).
create function private.my_admin_membership() returns public.members
language plpgsql stable security definer set search_path = '' as $$
declare v public.members;
begin
  select * into v from public.members
  where user_id = auth.uid() and active and role in ('owner', 'admin') order by created_at limit 1;
  if v.id is null then raise exception 'Not allowed' using errcode = '42501'; end if;
  return v;
end $$;
revoke all on function private.my_admin_membership() from public, anon;
grant execute on function private.my_admin_membership() to authenticated;

-- Marks several people at once. p_status null = Clear (removes only what a manager set).
-- Returns how many people were changed.
create function public.set_day_status(p_members uuid[], p_day date, p_status text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_me    public.members := private.my_admin_membership();
  v_today date;
  v_n     integer;
begin
  select (now() at time zone timezone)::date into v_today from public.companies where id = v_me.company_id;
  if p_day > v_today then raise exception 'You can''t set a status for a future date' using errcode = 'P0001'; end if;
  if p_status is not null and p_status not in ('present', 'absent', 'leave', 'off') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_members) x(id)
             where not exists (select 1 from public.members m where m.id = x.id and m.company_id = v_me.company_id)) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  if p_status is null then
    delete from public.day_status where member_id = any (p_members) and day = p_day;
  else
    insert into public.day_status (company_id, member_id, day, status, set_by)
    select v_me.company_id, x.id, p_day, p_status, v_me.id from unnest(p_members) x(id)
    on conflict (member_id, day) do update set status = excluded.status, set_by = excluded.set_by, set_at = now();
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Everyone (office staff and sales reps) and how their day went. One row per person.
-- status: present | late | absent | none (no check-in yet today) | leave | off
create function public.day_board(p_day date)
returns table (
  member_id uuid, full_name text, role public.member_role, status text, set_by_manager boolean,
  first_in timestamptz, last_out timestamptz, late_minutes integer,
  visits integer, visit_target integer, to_review integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me      public.members := private.my_admin_membership();
  v_co      public.companies;
  v_today   date;
  v_workday boolean;
begin
  select * into v_co from public.companies where id = v_me.company_id;
  v_today := (now() at time zone v_co.timezone)::date;
  if p_day > v_today then raise exception 'That date is in the future' using errcode = 'P0001'; end if;
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
    (coalesce(a.flagged, 0) + coalesce(v.flagged, 0))::integer
  from public.members m
  left join public.day_status ds on ds.member_id = m.id and ds.day = p_day
  left join lateral (
    select min(x.happened_at) filter (where x.kind = 'in') as first_in,
           max(x.happened_at) filter (where x.kind = 'out') as last_out,
           max(x.late_minutes) as late,
           count(*) filter (where x.flags <> '{}') as flagged
    from public.attendance x where x.member_id = m.id and x.local_date = p_day
  ) a on true
  left join lateral (
    select count(distinct y.store_id) as n,
           count(*) filter (where y.flags <> '{}' and y.flags <> '{store_located}') as flagged
    from public.visits y where y.member_id = m.id and y.local_date = p_day
  ) v on true
  where m.company_id = v_me.company_id and m.active and m.role in ('staff', 'rep')
    and (m.created_at at time zone v_co.timezone)::date <= p_day   -- not "absent" before they were added
  order by m.full_name;
end $$;

revoke all on function public.set_day_status(uuid[], date, text), public.day_board(date) from public, anon, authenticated;
grant execute on function public.set_day_status(uuid[], date, text), public.day_board(date) to authenticated;
