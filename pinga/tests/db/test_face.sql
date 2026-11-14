-- Face check: queued after saving, never blocks, flags mismatches, consent, retake, evening email.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'owner.a@example.com'),
  ('a0000000-0000-0000-0000-000000000003', '2348030000003@phone.usepinga.com'),
  ('a0000000-0000-0000-0000-000000000004', '2348030000004@phone.usepinga.com'),
  ('b0000000-0000-0000-0000-000000000001', 'owner.b@example.com');
insert into public.companies (id, name) values
  ('c000000a-0000-0000-0000-000000000000', 'CHF Heron'),
  ('c000000b-0000-0000-0000-000000000000', 'Other Co');
insert into public.branches (company_id, name, lat, lng) values ('c000000a-0000-0000-0000-000000000000', 'Yaba', 6.5095, 3.3711);
insert into public.stores (id, company_id, name, lat, lng) values ('5a000000-0000-0000-0000-000000000001', 'c000000a-0000-0000-0000-000000000000', 'Shoprite', 6.6018, 3.3515);
insert into public.members (id, company_id, user_id, full_name, phone, role, joined_at, created_at) values
  ('ea000000-0000-0000-0000-000000000001', 'c000000a-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001', 'Ada Owner', null, 'owner', now(), now() - interval '10 days'),
  ('ea000000-0000-0000-0000-000000000003', 'c000000a-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000003', 'Sade Staff', '+2348030000003', 'staff', now(), now() - interval '10 days'),
  ('ea000000-0000-0000-0000-000000000004', 'c000000a-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000004', 'Remi Rep', '+2348030000004', 'rep', now(), now() - interval '10 days'),
  ('eb000000-0000-0000-0000-000000000001', 'c000000b-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000001', 'Bola Owner', null, 'owner', now(), now() - interval '10 days');

-- Sade takes her reference photo (and so gives consent), then clocks in with a selfie and once without.
select tests.act_as('a0000000-0000-0000-0000-000000000003');
select public.set_reference_photo('c000000a-0000-0000-0000-000000000000/ea000000-0000-0000-0000-000000000003/reference.jpg');
create temp table r1 as select * from public.record_attendance(gen_random_uuid(), 'in', now() - interval '1 hour', 6.5096, 3.3712, 10,
  'c000000a-0000-0000-0000-000000000000/ea000000-0000-0000-0000-000000000003/1.jpg', now());
create temp table r2 as select * from public.record_attendance(gen_random_uuid(), 'out', now() - interval '30 minutes', 6.5097, 3.3713, 10, null, now());
grant all on r1, r2 to public;
select tests.eq((select face_status from r1), 'pending', 'a clock-in with a selfie is queued for a face check');
select tests.eq((select face_status from r2), null::text, 'a clock-in without a selfie is not');
select tests.eq((select flags from r1), '{}'::text[], 'clocking in works normally while the check is pending');
reset role;
select tests.ok((select face_consent_at is not null from public.members where id = 'ea000000-0000-0000-0000-000000000003'), 'consent time is recorded with the reference photo');

-- Remi (no reference photo yet) checks in at a store.
select tests.act_as('a0000000-0000-0000-0000-000000000004');
create temp table v1 as select * from public.record_visit(gen_random_uuid(), '5a000000-0000-0000-0000-000000000001', now() - interval '20 minutes', 6.6019, 3.3516, 10,
  'c000000a-0000-0000-0000-000000000000/ea000000-0000-0000-0000-000000000004/v1.jpg', null, null, now());
grant all on v1 to public;
reset role;

-- The server's view (service role).
select tests.act_as_server();
select tests.eq((select count(*) from public.face_checks_due(10)), 2::bigint, 'two selfies waiting');
select tests.eq((select reference_path from public.face_checks_due(10) where kind = 'visit'), null::text, 'Remi has no reference photo yet');
select public.face_check_save('visit', (select id from v1), 'no_reference', null);
select public.face_check_save('attendance', (select id from r1), 'mismatch', 12.5);
reset role;
select tests.eq((select face_status || ' ' || face_similarity || ' ' || array_to_string(flags, ',') from public.attendance where id = (select id from r1)),
  'mismatch 12.5 face_mismatch', 'a mismatch is saved with its similarity and flagged for review');

-- Errors retry, then stop after 3 tries; a result is never overwritten.
select tests.act_as('a0000000-0000-0000-0000-000000000003');
create temp table r3 as select * from public.record_attendance(gen_random_uuid(), 'in', now() - interval '10 minutes', 6.5098, 3.3714, 10,
  'c000000a-0000-0000-0000-000000000000/ea000000-0000-0000-0000-000000000003/3.jpg', now());
grant all on r3 to public;
reset role;
select tests.act_as_server();
select public.face_check_save('attendance', (select id from r3), 'error', null);
select public.face_check_save('attendance', (select id from r3), 'error', null);
reset role;
select tests.eq((select face_status from public.attendance where id = (select id from r3)), 'pending', 'after 2 errors it is tried again');
select tests.act_as_server();
select public.face_check_save('attendance', (select id from r3), 'error', null);
select public.face_check_save('attendance', (select id from r1), 'match', 99);
reset role;
select tests.eq((select face_status from public.attendance where id = (select id from r3)), 'error', 'after 3 errors it stops (no endless charges)');
select tests.eq((select face_status from public.attendance where id = (select id from r1)), 'mismatch', 'a saved result is never overwritten');
select tests.eq((select array_to_string(flags, ',') from public.attendance where id = (select id from r3)), '', 'errors don''t flag the person');

-- Remi takes his reference photo later: his earlier selfie is queued again.
select tests.act_as('a0000000-0000-0000-0000-000000000004');
select public.set_reference_photo('c000000a-0000-0000-0000-000000000000/ea000000-0000-0000-0000-000000000004/reference.jpg');
reset role;
select tests.eq((select face_status from public.visits where id = (select id from v1)), 'pending', 'once a reference photo exists, earlier selfies are checked');
select tests.act_as_server();
select public.face_check_save('visit', (select id from v1), 'no_face', 0);
reset role;
select tests.ok((select 'no_face' = any (flags) from public.visits where id = (select id from v1)), '"no face in photo" is flagged for review');

-- Only the last 3 days are checked.
update public.attendance set happened_at = now() - interval '5 days', face_status = 'pending' where id = (select id from r3);
select tests.act_as_server();
select tests.eq((select count(*) from public.face_checks_due(10) where id = (select id from r3)), 0::bigint, 'old selfies are not checked when switching on (no surprise bill)');

-- Evening email lists mismatches.
select tests.eq((select public.summary_content('c000000a-0000-0000-0000-000000000000', (now() at time zone 'Africa/Lagos')::date)->'face_mismatches'),
  '[{"name": "Sade Staff", "what": "clock-in"}]'::jsonb, 'evening email lists face mismatches');
reset role;

-- Today page counts it to review.
select tests.act_as('a0000000-0000-0000-0000-000000000001');
select tests.ok((select to_review >= 1 from public.day_board((now() at time zone 'Africa/Lagos')::date) where full_name = 'Sade Staff'), 'Today page shows the mismatch as something to check');
select tests.eq((select (public.face_check_status()->>'enabled')::boolean), false, 'status says face check is off until the server reports in');

-- Manager asks for a new reference photo.
select public.clear_reference_photo('ea000000-0000-0000-0000-000000000003');
select tests.eq((select reference_photo_path from public.members where id = 'ea000000-0000-0000-0000-000000000003'), null::text, 'owner can ask for a new reference photo');
select tests.refused($$ select public.clear_reference_photo('eb000000-0000-0000-0000-000000000001') $$, 'not for people in another company');
reset role;

-- Who may do what.
select tests.act_as('a0000000-0000-0000-0000-000000000003');
select tests.refused($$ select public.face_check_save('attendance', gen_random_uuid(), 'match', 99) $$, 'staff cannot mark their own face check as a match');
select tests.refused($$ select * from public.face_checks_due(10) $$, 'staff cannot list waiting selfies');
select tests.refused($$ select public.clear_reference_photo('ea000000-0000-0000-0000-000000000004') $$, 'staff cannot clear reference photos');
select tests.refused($$ update public.attendance set face_status = 'match' $$, 'staff cannot change face results');
reset role;
select tests.act_as('b0000000-0000-0000-0000-000000000001');
select tests.eq((select (public.face_check_status()->>'waiting')::int), 0, 'another company sees only its own waiting count');
reset role;

-- Per-company threshold (owner only).
select tests.act_as('a0000000-0000-0000-0000-000000000001');
select tests.eq((select (public.face_check_status()->>'match_percent')::int), 90, 'face match starts at 90%');
select public.set_face_match_percent(80::smallint);
select tests.eq((select (public.face_check_status()->>'match_percent')::int), 80, 'owner can lower it (e.g. for cheap phone cameras)');
select tests.refused($$ select public.set_face_match_percent(30::smallint) $$, 'not below 50%');
select tests.refused($$ select public.set_face_match_percent(100::smallint) $$, 'not 100%');
select tests.refused($$ update public.companies set face_match_percent = 50 $$, 'only through the owner''s setting');
reset role;
select tests.act_as('b0000000-0000-0000-0000-000000000001');
select tests.eq((select (public.face_check_status()->>'match_percent')::int), 90, 'each company has its own setting');
reset role;
-- A queued selfie carries its company's threshold to the checker.
select tests.act_as('a0000000-0000-0000-0000-000000000004');
create temp table v9 as select * from public.record_visit(gen_random_uuid(), '5a000000-0000-0000-0000-000000000001', now() - interval '5 minutes', 6.6017, 3.3514, 10,
  'c000000a-0000-0000-0000-000000000000/ea000000-0000-0000-0000-000000000004/v9.jpg', null, null, now());
grant all on v9 to public;
reset role;
select tests.act_as_server();
select tests.eq((select match_percent from public.face_checks_due(50) where id = (select id from v9)), 80::smallint, 'the checker uses the company''s threshold');
reset role;

rollback;
\echo 'All face check database tests passed.'
