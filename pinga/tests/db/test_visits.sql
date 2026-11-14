-- Field sales visits: progress, store locations, review flags, who sees what.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'owner.a@example.com'),
  ('a0000000-0000-0000-0000-000000000004', '2348030000004@phone.usepinga.com'),
  ('a0000000-0000-0000-0000-000000000006', '2348030000006@phone.usepinga.com'),
  ('b0000000-0000-0000-0000-000000000001', 'owner.b@example.com');
insert into public.companies (id, name) values
  ('c000000a-0000-0000-0000-000000000000', 'CHF Heron'),
  ('c000000b-0000-0000-0000-000000000000', 'Other Co');
insert into public.members (id, company_id, user_id, full_name, phone, role, daily_visit_target, joined_at) values
  ('ea000000-0000-0000-0000-000000000001', 'c000000a-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001', 'Ada Owner', null, 'owner', null, now()),
  ('ea000000-0000-0000-0000-000000000004', 'c000000a-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000004', 'Remi Rep', '+2348030000004', 'rep', 4, now()),
  ('ea000000-0000-0000-0000-000000000006', 'c000000a-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000006', 'Kemi Rep', '+2348030000006', 'rep', 4, now()),
  ('eb000000-0000-0000-0000-000000000001', 'c000000b-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000001', 'Bola Owner', null, 'owner', null, now());
insert into public.stores (id, company_id, name, lat, lng, radius_m) values
  ('5a000000-0000-0000-0000-000000000001', 'c000000a-0000-0000-0000-000000000000', 'Shoprite Ikeja', 6.6018, 3.3515, 100),
  ('5a000000-0000-0000-0000-000000000003', 'c000000a-0000-0000-0000-000000000000', 'Kemi''s store', 6.45, 3.40, 100),
  ('5b000000-0000-0000-0000-000000000001', 'c000000b-0000-0000-0000-000000000000', 'B Store', 6.5, 3.3, 100);
insert into public.stores (id, company_id, name, address) values
  ('5a000000-0000-0000-0000-000000000002', 'c000000a-0000-0000-0000-000000000000', 'Spar Lekki', 'Admiralty Way, Lekki');
insert into public.store_assignments (company_id, member_id, store_id) values
  ('c000000a-0000-0000-0000-000000000000', 'ea000000-0000-0000-0000-000000000004', '5a000000-0000-0000-0000-000000000001'),
  ('c000000a-0000-0000-0000-000000000000', 'ea000000-0000-0000-0000-000000000004', '5a000000-0000-0000-0000-000000000002'),
  ('c000000a-0000-0000-0000-000000000000', 'ea000000-0000-0000-0000-000000000006', '5a000000-0000-0000-0000-000000000003');

-- Short-hand: Remi visits a store.
create function pg_temp.visit(p_n int, p_store text, p_at timestamptz, p_lat float8, p_lng float8,
  p_acc real default 10, p_selfie boolean default true, p_clock interval default '0') returns public.visits language sql as $$
  select * from public.record_visit(
    ('00000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid, p_store::uuid, p_at, p_lat, p_lng, p_acc,
    case when p_selfie then 'c000000a-0000-0000-0000-000000000000/ea000000-0000-0000-0000-000000000004/s' || p_n || '.jpg' end,
    case when p_selfie then 'c000000a-0000-0000-0000-000000000000/ea000000-0000-0000-0000-000000000004/p' || p_n || '.jpg' end,
    '  Low stock on Sebamed  ', now() + p_clock)
$$;
grant execute on function pg_temp.visit to public;

select tests.act_as('a0000000-0000-0000-0000-000000000004');

create temp table r as select * from pg_temp.visit(1, '5a000000-0000-0000-0000-000000000001', '2026-11-16 09:10+01', 6.6019, 3.3516);
select tests.eq((select flags from r), '{}'::text[], 'visit at an assigned store, inside its area, has no flags');
select tests.ok((select distance_m < 30 from r), 'distance to the store is recorded');
select tests.eq((select note from r), 'Low stock on Sebamed', 'note is saved (tidied)');
select tests.ok((select shelf_photo_path like '%/p1.jpg' from r), 'shelf photo is saved');
select tests.eq((select local_date from r), '2026-11-16'::date, 'saved on the right day');
select tests.eq((select id from pg_temp.visit(1, '5a000000-0000-0000-0000-000000000001', '2026-11-16 09:10+01', 6.6019, 3.3516)),
  '00000000-0000-0000-0000-000000000001'::uuid, 'sending the same visit twice is safe');
select tests.eq((select count(*) from public.visits), 1::bigint, '...and saves it only once');

-- A store with no location yet gets it from the first good visit.
select tests.ok((select 'store_located' = any (flags) from pg_temp.visit(2, '5a000000-0000-0000-0000-000000000002', '2026-11-16 12:00+01', 6.4400, 3.4700, 12)),
  'first visit to a store with no location pins it (flagged for the manager to confirm)');
reset role;
select tests.ok((select lat = 6.44 and location_source = 'first_visit' from public.stores where id = '5a000000-0000-0000-0000-000000000002'), 'store now has that location');
select tests.act_as('a0000000-0000-0000-0000-000000000004');
select tests.eq((select flags from pg_temp.visit(3, '5a000000-0000-0000-0000-000000000002', '2026-11-17 12:00+01', 6.4401, 3.4701)), '{}'::text[], 'later visits are checked against it');

-- Flags
select tests.ok((select 'outside_radius' = any (flags) from pg_temp.visit(4, '5a000000-0000-0000-0000-000000000001', '2026-11-18 09:00+01', 6.6110, 3.3515)), 'one kilometre from the store is flagged');
select tests.ok((select 'not_assigned' = any (flags) from pg_temp.visit(5, '5a000000-0000-0000-0000-000000000003', '2026-11-18 15:00+01', 6.4501, 3.4001)), 'a store not assigned to the rep is flagged');
select tests.ok((select 'impossible_speed' = any (flags) from pg_temp.visit(6, '5a000000-0000-0000-0000-000000000001', '2026-11-18 15:02+01', 6.6017, 3.3514)), 'Lekki to Ikeja in 2 minutes is flagged');
select tests.ok((select 'no_photo' = any (flags) from pg_temp.visit(7, '5a000000-0000-0000-0000-000000000001', '2026-11-19 09:00+01', 6.6016, 3.3513, 10, false)), 'no selfie is flagged');
select tests.ok((select 'clock_changed' = any (flags) from pg_temp.visit(8, '5a000000-0000-0000-0000-000000000001', '2026-11-20 09:00+01', 6.6015, 3.3512, 10, true, '-1 hour')), 'a changed phone clock is flagged');
select tests.refused($$ select public.record_visit(gen_random_uuid(), '5b000000-0000-0000-0000-000000000001', now(), 6.5, 3.3, 10, null, null, null, now()) $$, 'cannot visit another company''s store');
select tests.refused($$ select public.record_visit(gen_random_uuid(), '5a000000-0000-0000-0000-000000000001', now(), 6.6, 3.35, 10,
  'c000000a-0000-0000-0000-000000000000/ea000000-0000-0000-0000-000000000006/x.jpg', null, null, now()) $$, 'cannot attach a colleague''s photo');
select tests.refused($$ select public.record_visit(gen_random_uuid(), '5a000000-0000-0000-0000-000000000001', now(), 6.6, 3.35, 10, null, null, repeat('x', 501), now()) $$, 'notes are limited to 500 characters');
select tests.refused($$ insert into public.visits (id, company_id, member_id, store_id, happened_at, local_date, lat, lng)
  values (gen_random_uuid(), 'c000000a-0000-0000-0000-000000000000', 'ea000000-0000-0000-0000-000000000004', '5a000000-0000-0000-0000-000000000001', now(), current_date, 0, 0) $$,
  'visits can only be made through the check-in action');
select tests.no_rows($$ update public.stores set lat = 0, lng = 0 $$, 'reps cannot move stores');

-- Progress: "2 of 4 visits done" counts different stores on the day.
select tests.eq((select count(distinct store_id) from public.visits where local_date = '2026-11-16'), 2::bigint, 'two different stores visited on the 16th');
reset role;

-- Who sees what
select tests.act_as('a0000000-0000-0000-0000-000000000006');
select tests.eq((select count(*) from public.visits), 0::bigint, 'a rep cannot see another rep''s visits');
select tests.eq((select count(*) from public.stores), 1::bigint, 'a rep sees only their own assigned stores');
reset role;
select tests.act_as('a0000000-0000-0000-0000-000000000001');
select tests.eq((select count(*) from public.visits), 8::bigint, 'owner sees all their company''s visits');
reset role;
select tests.act_as('b0000000-0000-0000-0000-000000000001');
select tests.eq((select count(*) from public.visits), 0::bigint, 'another company sees none');
reset role;

rollback;
\echo 'All field visit database tests passed.'
