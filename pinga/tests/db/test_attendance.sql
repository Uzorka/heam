-- Office attendance: clock in/out, lateness, re-sends, review flags, photos.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;

-- Company A (Lagos, 8:00 start, 15 min grace, Mon–Fri) with a Yaba office. Company B separate.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'owner.a@example.com'),
  ('a0000000-0000-0000-0000-000000000003', '2348030000003@phone.usepinga.com'),
  ('a0000000-0000-0000-0000-000000000005', '2348030000005@phone.usepinga.com'),
  ('b0000000-0000-0000-0000-000000000001', 'owner.b@example.com');
insert into public.companies (id, name) values
  ('c000000a-0000-0000-0000-000000000000', 'CHF Heron'),
  ('c000000b-0000-0000-0000-000000000000', 'Other Co');
insert into public.branches (company_id, name, lat, lng, radius_m) values
  ('c000000a-0000-0000-0000-000000000000', 'Yaba', 6.5095, 3.3711, 100);
insert into public.members (id, company_id, user_id, full_name, phone, role, joined_at) values
  ('ea000000-0000-0000-0000-000000000001', 'c000000a-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001', 'Ada Owner', null, 'owner', now()),
  ('ea000000-0000-0000-0000-000000000003', 'c000000a-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000003', 'Sade Staff', '+2348030000003', 'staff', now()),
  ('ea000000-0000-0000-0000-000000000005', 'c000000a-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000005', 'Tolu Staff', '+2348030000005', 'staff', now()),
  ('eb000000-0000-0000-0000-000000000001', 'c000000b-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000001', 'Bola Owner', null, 'owner', now());

-- Short-hand: Sade records something. Arguments: id-suffix, kind, time, lat, lng, accuracy, photo?, device clock offset
create function pg_temp.sade(p_n int, p_kind text, p_at timestamptz, p_lat float8 default 6.5096, p_lng float8 default 3.3712,
  p_acc real default 10, p_photo boolean default true, p_clock interval default '0') returns public.attendance language sql as $$
  select * from public.record_attendance(
    ('00000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid, p_kind, p_at, p_lat, p_lng, p_acc,
    case when p_photo then 'c000000a-0000-0000-0000-000000000000/ea000000-0000-0000-0000-000000000003/' || p_n || '.jpg' end,
    now() + p_clock)
$$;
grant execute on function pg_temp.sade to public;

select tests.act_as('a0000000-0000-0000-0000-000000000003');

-- ── Clocking in and out ─────────────────────────────────────────
create temp table r as select * from pg_temp.sade(1, 'in', '2026-11-09 08:10+01');  -- Monday, inside grace
select tests.eq((select flags from r), '{}'::text[], 'clock-in at the office has no flags');
select tests.eq((select late_minutes from r), 0, '8:10 with 15 minutes grace is on time');
select tests.ok((select distance_m < 20 from r), 'distance to the office is recorded');
select tests.eq((select local_date from r), '2026-11-09'::date, 'saved on the right day');
select tests.eq((select received_at > happened_at from r), true, 'time of tapping is kept, not time of sending');

select tests.eq((select id from pg_temp.sade(1, 'in', '2026-11-09 08:10+01')), '00000000-0000-0000-0000-000000000001'::uuid, 'sending the same clock-in twice is safe');
select tests.eq((select count(*) from public.attendance), 1::bigint, '...and saves it only once');

select tests.eq((select flags from pg_temp.sade(2, 'out', '2026-11-09 17:05+01', 6.5094, 3.3710)), '{}'::text[], 'clock-out is saved');
select tests.eq((select late_minutes from pg_temp.sade(3, 'in', '2026-11-10 08:40+01', 6.5095, 3.3712)), 40, 'Tuesday 8:40 is 40 minutes late');
select tests.eq((select late_minutes from pg_temp.sade(4, 'in', '2026-11-10 13:00+01', 6.5096, 3.3711)), null::int, 'a second clock-in that day is not counted as late');
select tests.eq((select late_minutes from pg_temp.sade(5, 'in', '2026-11-14 10:00+01', 6.5097, 3.3712)), null::int, 'Saturday is not a work day, so never late');
select tests.eq((select local_date from pg_temp.sade(6, 'out', '2026-11-14 23:30+00', 6.5093, 3.3713)), '2026-11-15'::date, 'uses Lagos time for the day (00:30 Lagos is the next day)');

-- ── Flags for the manager to review (never blocked) ─────────────
select tests.ok((select 'outside_radius' = any (flags) from pg_temp.sade(10, 'in', '2026-11-16 08:00+01', 6.5185, 3.3711)), 'one kilometre away is flagged as outside the office');
select tests.ok((select 'impossible_speed' = any (flags) from pg_temp.sade(11, 'in', '2026-11-16 08:02+01', 6.6018, 3.3515)), '10 km in 2 minutes is flagged as impossible');
select tests.ok((select 'clock_changed' = any (flags) from pg_temp.sade(12, 'out', '2026-11-16 17:00+01', 6.6019, 3.3516, 10, true, '-2 hours')), 'a phone clock that was changed is flagged');
select tests.ok((select 'no_photo' = any (flags) from pg_temp.sade(13, 'in', '2026-11-17 08:00+01', 6.5095, 3.3713, 10, false)), 'clock-in without a photo is flagged');
select tests.ok((select 'weak_gps' = any (flags) from pg_temp.sade(14, 'out', '2026-11-17 17:00+01', 6.5094, 3.3712, 500)), 'very rough GPS is flagged');
select tests.ok((select 'suspicious_gps' = any (flags) from pg_temp.sade(15, 'in', '2026-11-18 08:00+01', 6.5095, 3.3712, 0.5)), 'impossibly perfect GPS (fake location app) is flagged');
select tests.ok((select 'suspicious_gps' = any (flags) from pg_temp.sade(16, 'out', '2026-11-18 17:00+01', 6.5095, 3.3712)), 'exactly the same GPS point twice is flagged');
select tests.refused($$ select public.record_attendance(gen_random_uuid(), 'in', now(), 6.5, 3.37, 10,
  'c000000a-0000-0000-0000-000000000000/ea000000-0000-0000-0000-000000000005/x.jpg', now()) $$, 'cannot attach a colleague''s photo');
select tests.refused($$ insert into public.attendance (id, company_id, member_id, kind, happened_at, local_date, lat, lng)
  values (gen_random_uuid(), 'c000000a-0000-0000-0000-000000000000', 'ea000000-0000-0000-0000-000000000003', 'in', now(), current_date, 0, 0) $$,
  'records can only be made through the clock-in action');
select tests.refused($$ update public.attendance set happened_at = happened_at - interval '1 hour' $$, 'staff cannot edit their times');
reset role;

-- ── Who can see records ─────────────────────────────────────────
select tests.act_as('a0000000-0000-0000-0000-000000000005');
select tests.eq((select count(*) from public.attendance), 0::bigint, 'staff cannot see a colleague''s records');
select tests.refused($$ select public.record_attendance('00000000-0000-0000-0000-000000000001', 'in', now(), 6.5, 3.37, 10, null, now()) $$, 'cannot take over someone else''s record by re-sending it');
reset role;
select tests.act_as('a0000000-0000-0000-0000-000000000001');
select tests.eq((select count(*) from public.attendance), 13::bigint, 'owner sees all their company''s records');
reset role;
select tests.act_as('b0000000-0000-0000-0000-000000000001');
select tests.eq((select count(*) from public.attendance), 0::bigint, 'another company sees none');
reset role;

-- ── Photos ──────────────────────────────────────────────────────
select tests.act_as('a0000000-0000-0000-0000-000000000003');
insert into storage.objects (bucket_id, name) values ('photos', 'c000000a-0000-0000-0000-000000000000/ea000000-0000-0000-0000-000000000003/1.jpg');
select tests.eq((select count(*) from storage.objects), 1::bigint, 'staff upload photos into their own folder');
select tests.refused($$ insert into storage.objects (bucket_id, name) values ('photos', 'c000000a-0000-0000-0000-000000000000/ea000000-0000-0000-0000-000000000005/1.jpg') $$, 'staff cannot upload into a colleague''s folder');
select tests.refused($$ insert into storage.objects (bucket_id, name) values ('photos', 'c000000b-0000-0000-0000-000000000000/x/1.jpg') $$, 'staff cannot upload into another company');
select public.set_reference_photo('c000000a-0000-0000-0000-000000000000/ea000000-0000-0000-0000-000000000003/reference.jpg');
select tests.refused($$ select public.set_reference_photo('c000000a-0000-0000-0000-000000000000/ea000000-0000-0000-0000-000000000003/other.jpg') $$, 'the reference photo cannot be swapped by staff');
reset role;
select tests.ok((select reference_photo_path like '%/reference.jpg' from public.members where id = 'ea000000-0000-0000-0000-000000000003'), 'reference photo is saved once');
select tests.act_as('a0000000-0000-0000-0000-000000000005');
select tests.eq((select count(*) from storage.objects), 0::bigint, 'staff cannot see a colleague''s photos');
select tests.refused($$ select public.set_reference_photo('c000000a-0000-0000-0000-000000000000/ea000000-0000-0000-0000-000000000003/x.jpg') $$, 'cannot set a reference photo from someone else''s folder');
reset role;
select tests.act_as('a0000000-0000-0000-0000-000000000001');
select tests.eq((select count(*) from storage.objects), 1::bigint, 'owner can view their staff''s photos');
reset role;
select tests.act_as('b0000000-0000-0000-0000-000000000001');
select tests.eq((select count(*) from storage.objects), 0::bigint, 'another company cannot view them');
reset role;

rollback;
\echo 'All attendance database tests passed.'
