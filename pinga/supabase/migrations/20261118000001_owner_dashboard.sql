-- Pinga · Step 5 · Owner dashboard, register export and evening summary

-- ── Pay (owner only) ────────────────────────────────────────────
-- Kept apart from members so managers and staff never see colleagues' pay.
create table public.pay_rates (
  member_id    uuid primary key,
  company_id   uuid not null references public.companies (id) on delete cascade,
  monthly_naira numeric(12, 2) not null check (monthly_naira >= 0),
  updated_at   timestamptz not null default now(),
  foreign key (company_id, member_id) references public.members (company_id, id) on delete cascade
);
alter table public.pay_rates enable row level security;
revoke all on public.pay_rates from anon, authenticated;
grant select, insert, update, delete on public.pay_rates to authenticated;
create policy "owners read pay" on public.pay_rates for select to authenticated using (private.my_role(company_id) = 'owner');
create policy "owners add pay" on public.pay_rates for insert to authenticated with check (private.my_role(company_id) = 'owner');
create policy "owners change pay" on public.pay_rates for update to authenticated
  using (private.my_role(company_id) = 'owner') with check (private.my_role(company_id) = 'owner');
create policy "owners remove pay" on public.pay_rates for delete to authenticated using (private.my_role(company_id) = 'owner');

-- Evening summary: on by default; one row per company per day once sent.
alter table public.companies add column summary_email boolean not null default true;
grant update (summary_email) on public.companies to authenticated;

create table public.summary_log (
  company_id uuid not null references public.companies (id) on delete cascade,
  day        date not null,
  sent_at    timestamptz not null default now(),
  ok         boolean not null,
  detail     text,
  primary key (company_id, day)
);
alter table public.summary_log enable row level security;
revoke all on public.summary_log from anon, authenticated;

-- ── The day board, usable without a signed-in manager (for the summary) ──
create function private.board(p_company uuid, p_day date)
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
    and (m.created_at at time zone v_co.timezone)::date <= p_day
  order by m.full_name;
end $$;
revoke all on function private.board(uuid, date) from public, anon, authenticated;

-- day_board now uses the shared version (same columns as before).
create or replace function public.day_board(p_day date)
returns table (
  member_id uuid, full_name text, role public.member_role, status text, set_by_manager boolean,
  first_in timestamptz, last_out timestamptz, late_minutes integer,
  visits integer, visit_target integer, to_review integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me public.members := private.my_admin_membership();
begin
  if p_day > (select (now() at time zone timezone)::date from public.companies where id = v_me.company_id) then
    raise exception 'That date is in the future' using errcode = 'P0001';
  end if;
  return query select b.member_id, b.full_name, b.role, b.status, b.set_by_manager, b.first_in, b.last_out,
    b.late_minutes, b.visits, b.visit_target, b.to_review from private.board(v_me.company_id, p_day) b;
end $$;

-- ── Register: every person, every day, for export ───────────────
create function public.register(p_from date, p_to date)
returns table (
  day date, member_id uuid, full_name text, role public.member_role, status text, set_by_manager boolean,
  first_in timestamptz, last_out timestamptz, late_minutes integer, visits integer, visit_target integer, to_review integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me public.members := private.my_admin_membership();
  v_today date;
  d date;
begin
  select (now() at time zone timezone)::date into v_today from public.companies where id = v_me.company_id;
  if p_to > v_today then p_to := v_today; end if;
  if p_from > p_to or p_to - p_from > 92 then
    raise exception 'Choose a period of up to 3 months, not in the future' using errcode = 'P0001';
  end if;
  for d in select generate_series(p_from, p_to, interval '1 day')::date loop
    return query select d, b.member_id, b.full_name, b.role, b.status, b.set_by_manager, b.first_in, b.last_out,
      b.late_minutes, b.visits, b.visit_target, b.to_review from private.board(v_me.company_id, d) b;
  end loop;
end $$;

-- ── Owner dashboard: the day in 10 seconds ──────────────────────
create function public.owner_overview(p_day date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me     public.members := private.my_admin_membership();
  v_co     public.companies;
  v_today  date;
  v_month  date;
  v_hours  numeric;                 -- working hours in a day
  v_days_m numeric;                 -- working days in a month (average)
  v_board  jsonb;
  v_offices jsonb;
  v_field  jsonb;
  v_stores jsonb;
  v_late   jsonb;
  v_drop   jsonb;
  v_lost   jsonb := null;
begin
  select * into v_co from public.companies where id = v_me.company_id;
  v_today := (now() at time zone v_co.timezone)::date;
  if p_day > v_today then raise exception 'That date is in the future' using errcode = 'P0001'; end if;
  v_month := date_trunc('month', p_day)::date;
  v_hours := extract(epoch from v_co.work_ends - v_co.work_starts) / 3600;
  v_days_m := cardinality(v_co.work_days) * 52.0 / 12;

  -- Right now
  select jsonb_build_object(
    'people', count(*),
    'present', count(*) filter (where status = 'present'),
    'late', count(*) filter (where status = 'late'),
    'absent', count(*) filter (where status in ('absent', 'none')),
    'away', count(*) filter (where status in ('leave', 'off')),
    'to_review', coalesce(sum(to_review), 0))
  into v_board from private.board(v_me.company_id, p_day);

  select coalesce(jsonb_agg(o order by o->>'name'), '[]') into v_offices from (
    select jsonb_build_object('name', coalesce(office, 'No office set'),
      'present', count(*) filter (where status = 'present'),
      'late', count(*) filter (where status = 'late'),
      'absent', count(*) filter (where status in ('absent', 'none')),
      'away', count(*) filter (where status in ('leave', 'off'))) o
    from private.board(v_me.company_id, p_day) where role = 'staff' group by office) x;

  -- Field visits: planned vs done, per rep
  select jsonb_build_object(
    'planned', coalesce(sum(visit_target) filter (where status not in ('leave', 'off')), 0),
    'done', coalesce(sum(least(visits, visit_target)), 0),
    'reps', coalesce(jsonb_agg(jsonb_build_object('name', full_name, 'visits', visits, 'target', visit_target, 'status', status) order by full_name), '[]'))
  into v_field from private.board(v_me.company_id, p_day) where role = 'rep';

  -- Stores for the map (assigned to someone, with a location), visited that day or not
  select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'lat', s.lat, 'lng', s.lng,
      'visited', exists (select 1 from public.visits v where v.store_id = s.id and v.local_date = p_day))
    order by s.name), '[]')
  into v_stores from public.stores s
  where s.company_id = v_me.company_id and s.active and s.lat is not null
    and exists (select 1 from public.store_assignments a join public.members m on m.id = a.member_id where a.store_id = s.id and m.active);

  -- Patterns: late 3+ times in the last 14 days
  select coalesce(jsonb_agg(jsonb_build_object('name', m.full_name, 'times', x.n) order by x.n desc), '[]') into v_late
  from (select a.member_id, count(distinct a.local_date) n from public.attendance a
        where a.company_id = v_me.company_id and a.late_minutes > 0 and a.local_date between p_day - 13 and p_day
        group by a.member_id having count(distinct a.local_date) >= 3) x
  join public.members m on m.id = x.member_id and m.active;

  -- Patterns: reps whose visits dropped 30%+ (last 7 days vs the 7 before; at least 5 before)
  select coalesce(jsonb_agg(jsonb_build_object('name', m.full_name, 'this_week', x.now_n, 'last_week', x.before_n) order by x.now_n::numeric / x.before_n), '[]')
  into v_drop
  from (select v.member_id,
          count(*) filter (where v.local_date between p_day - 6 and p_day) now_n,
          count(*) filter (where v.local_date between p_day - 13 and p_day - 7) before_n
        from public.visits v where v.company_id = v_me.company_id and v.local_date between p_day - 13 and p_day
        group by v.member_id) x
  join public.members m on m.id = x.member_id and m.active and m.role = 'rep'
  where x.before_n >= 5 and x.now_n <= x.before_n * 0.7;

  -- Cost of lost time this month (owners only): late minutes + absent days.
  if v_me.role = 'owner' then
    select jsonb_build_object(
      'hours', round(coalesce(sum(lost_h), 0), 1),
      'naira', round(coalesce(sum(lost_h * (p.monthly_naira / nullif(v_days_m * v_hours, 0))), 0)),
      'with_pay', count(distinct p.member_id),
      'people', count(distinct r.member_id))
    into v_lost
    from (
      select b.member_id,
        (case when b.status = 'late' then coalesce(b.late_minutes, 0) / 60.0
              when b.status = 'absent' then v_hours else 0 end) as lost_h
      from generate_series(v_month, p_day, interval '1 day') g(d)
      cross join lateral private.board(v_me.company_id, g.d::date) b
    ) r
    left join public.pay_rates p on p.member_id = r.member_id;
  end if;

  return jsonb_build_object(
    'day', p_day, 'now', v_board, 'offices', v_offices, 'field', v_field, 'stores', v_stores,
    'repeat_late', v_late, 'visits_dropping', v_drop, 'lost', v_lost);
end $$;

revoke all on function public.register(date, date), public.owner_overview(date) from public, anon, authenticated;
grant execute on function public.register(date, date), public.owner_overview(date) to authenticated;

-- ── Evening summary (used only by the server's daily-summary function) ──
-- Companies whose evening (19:00 local) has come and who haven't had today's summary yet.
create function public.summaries_due() returns table (company_id uuid, day date)
language sql stable security definer set search_path = '' as $$
  select c.id, (now() at time zone c.timezone)::date
  from public.companies c
  where c.summary_email and c.status in ('trial', 'active')
    and (now() at time zone c.timezone)::time >= '19:00'
    and not exists (select 1 from public.summary_log l where l.company_id = c.id and l.day = (now() at time zone c.timezone)::date)
$$;

create function public.summary_content(p_company uuid, p_day date) returns jsonb
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
  return v;
end $$;

create function public.summary_logged(p_company uuid, p_day date, p_ok boolean, p_detail text) returns void
language sql security definer set search_path = '' as $$
  insert into public.summary_log (company_id, day, ok, detail) values (p_company, p_day, p_ok, left(p_detail, 500))
  on conflict (company_id, day) do update set ok = excluded.ok, detail = excluded.detail, sent_at = now()
$$;

-- The hourly schedule proves itself with a random key kept here (set by the deploy script).
create table private.settings (key text primary key, value text not null);
create function public.summary_key_ok(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.settings where key = 'summary_key' and value = p_key)
$$;

revoke all on function public.summaries_due(), public.summary_content(uuid, date), public.summary_logged(uuid, date, boolean, text),
  public.summary_key_ok(text) from public, anon, authenticated;
grant execute on function public.summaries_due(), public.summary_content(uuid, date), public.summary_logged(uuid, date, boolean, text),
  public.summary_key_ok(text) to service_role;
