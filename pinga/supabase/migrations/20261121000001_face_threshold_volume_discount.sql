-- Pinga · Face-match threshold per company, and volume discounts.

-- ── Face match: how alike a selfie must be to the reference photo (owner can lower it) ──
alter table public.companies add column face_match_percent smallint not null default 90
  check (face_match_percent between 50 and 99);

create function public.set_face_match_percent(p_percent smallint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members := private.my_admin_membership();
begin
  if v_me.role <> 'owner' then raise exception 'Only the owner can change this' using errcode = '42501'; end if;
  if p_percent is null or p_percent < 50 or p_percent > 99 then
    raise exception 'Choose a number from 50 to 99' using errcode = '22023';
  end if;
  update public.companies set face_match_percent = p_percent where id = v_me.company_id;
end $$;
revoke all on function public.set_face_match_percent(smallint) from public, anon, authenticated;
grant execute on function public.set_face_match_percent(smallint) to authenticated;

-- The checker now gets each company's threshold with each waiting selfie.
drop function public.face_checks_due(integer);
create function public.face_checks_due(p_limit integer)
returns table (kind text, id uuid, photo_path text, reference_path text, match_percent smallint)
language sql stable security definer set search_path = '' as $$
  select * from (
    select 'attendance'::text, a.id, a.photo_path, m.reference_photo_path, c.face_match_percent
    from public.attendance a join public.members m on m.id = a.member_id join public.companies c on c.id = a.company_id
    where a.face_status = 'pending' and a.happened_at > now() - interval '3 days'
    union all
    select 'visit', v.id, v.selfie_path, m.reference_photo_path, c.face_match_percent
    from public.visits v join public.members m on m.id = v.member_id join public.companies c on c.id = v.company_id
    where v.face_status = 'pending' and v.happened_at > now() - interval '3 days'
  ) x limit greatest(1, least(p_limit, 50))
$$;
revoke all on function public.face_checks_due(integer) from public, anon, authenticated;
grant execute on function public.face_checks_due(integer) to service_role;

create or replace function public.face_check_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me public.members := private.my_admin_membership();
  v jsonb;
begin
  select value::jsonb into v from private.settings where key = 'face_check';
  return jsonb_build_object(
    'enabled', coalesce((v->>'enabled')::boolean, false),
    'last_run', v->>'at',
    'match_percent', (select face_match_percent from public.companies where id = v_me.company_id),
    'waiting', (select count(*) from public.attendance where company_id = v_me.company_id and face_status = 'pending')
             + (select count(*) from public.visits where company_id = v_me.company_id and face_status = 'pending'));
end $$;

-- ── Volume discounts: one place, next to the prices ─────────────
-- A company with at least min_people billable people gets percent_off on its whole monthly price.
-- The highest tier it qualifies for applies. PLACEHOLDER tier: 100+ people → 10% off.
create table public.billing_discounts (
  min_people  integer primary key check (min_people > 1),
  percent_off numeric(5, 2) not null check (percent_off > 0 and percent_off < 100)
);
insert into public.billing_discounts values (100, 10);
alter table public.billing_discounts enable row level security;
revoke all on public.billing_discounts from anon, authenticated;
grant select on public.billing_discounts to authenticated;
create policy "everyone signed in reads discounts" on public.billing_discounts for select to authenticated using (true);

create or replace function private.billing_quote(p_company uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with seats as (
    select count(*) filter (where role = 'staff') as staff, count(*) filter (where role = 'rep') as reps
    from public.members where company_id = p_company and active and joined_at is not null
  ), c as (select has_attendance, has_field from public.companies where id = p_company),
  p as (select max(naira_per_seat) filter (where module = 'attendance') as att, max(naira_per_seat) filter (where module = 'field') as field from public.billing_prices),
  n as (select (case when c.has_attendance then seats.staff else 0 end) as staff,
               (case when c.has_field then seats.reps else 0 end) as reps from seats, c),
  d as (select coalesce(max(percent_off) filter (where min_people <= (select staff + reps from n)), 0) as pct,
               max(min_people) filter (where min_people <= (select staff + reps from n)) as tier
        from public.billing_discounts),
  g as (select n.staff * p.att + n.reps * p.field as gross from n, p)
  select jsonb_build_object(
    'staff_seats', n.staff, 'rep_seats', n.reps,
    'staff_price', p.att, 'rep_price', p.field,
    'gross_kobo', g.gross * 100,
    'discount_percent', d.pct, 'discount_min_people', d.tier,
    -- whole naira, rounded
    'amount_kobo', round(g.gross * (100 - d.pct) / 100) * 100)
  from n, p, d, g
$$;
