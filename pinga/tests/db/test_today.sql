-- Manager's Today page: computed statuses, bulk marking, Clear, past dates, who may do it.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'owner.a@example.com'),
  ('a0000000-0000-0000-0000-000000000002', '2348030000002@phone.usepinga.com'),
  ('a0000000-0000-0000-0000-000000000003', '2348030000003@phone.usepinga.com'),
  ('a0000000-0000-0000-0000-000000000004', '2348030000004@phone.usepinga.com'),
  ('b0000000-0000-0000-0000-000000000001', 'owner.b@example.com');
-- Mon–Fri company in Lagos, 8:00 start, 15 minutes grace.
insert into public.companies (id, name) values
  ('c000000a-0000-0000-0000-000000000000', 'CHF Heron'),
  ('c000000b-0000-0000-0000-000000000000', 'Other Co');
insert into public.branches (company_id, name, lat, lng) values ('c000000a-0000-0000-0000-000000000000', 'Yaba', 6.5095, 3.3711);
insert into public.stores (id, company_id, name, lat, lng) values
  ('5a000000-0000-0000-0000-000000000001', 'c000000a-0000-0000-0000-000000000000', 'Shoprite', 6.6018, 3.3515),
  ('5a000000-0000-0000-0000-000000000002', 'c000000a-0000-0000-0000-000000000000', 'Spar', 6.44, 3.47);
-- Everyone was added on 1 November.
insert into public.members (id, company_id, user_id, full_name, phone, role, daily_visit_target, joined_at, created_at) values
  ('ea000000-0000-0000-0000-000000000001', 'c000000a-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001', 'Ada Owner', null, 'owner', null, now(), '2026-11-01'),
  ('ea000000-0000-0000-0000-000000000002', 'c000000a-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000002', 'Ade Admin', '+2348030000002', 'admin', null, now(), '2026-11-01'),
  ('ea000000-0000-0000-0000-000000000003', 'c000000a-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000003', 'Sade Staff', '+2348030000003', 'staff', null, now(), '2026-11-01'),
  ('ea000000-0000-0000-0000-000000000004', 'c000000a-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000004', 'Remi Rep', '+2348030000004', 'rep', 3, now(), '2026-11-01'),
  ('ea000000-0000-0000-0000-000000000005', 'c000000a-0000-0000-0000-000000000000', null, 'Tolu Staff', '+2348030000005', 'staff', null, null, '2026-11-01'),
  ('ea000000-0000-0000-0000-000000000006', 'c000000a-0000-0000-0000-000000000000', null, 'New Person', '+2348030000006', 'staff', null, null, '2026-11-12'),
  ('eb000000-0000-0000-0000-000000000001', 'c000000b-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000001', 'Bola Owner', null, 'owner', null, now(), '2026-11-01');

-- Monday 9 November: Sade clocks in 8:40 (late), Remi visits two stores.
select tests.act_as('a0000000-0000-0000-0000-000000000003');
select public.record_attendance(gen_random_uuid(), 'in', '2026-11-09 08:40+01', 6.5096, 3.3712, 10, null, now());
select public.record_attendance(gen_random_uuid(), 'out', '2026-11-09 17:05+01', 6.5095, 3.3713, 10, null, now());
reset role;
select tests.act_as('a0000000-0000-0000-0000-000000000004');
select public.record_visit(gen_random_uuid(), '5a000000-0000-0000-0000-000000000001', '2026-11-09 10:00+01', 6.6019, 3.3516, 10, null, null, null, now());
select public.record_visit(gen_random_uuid(), '5a000000-0000-0000-0000-000000000002', '2026-11-09 13:00+01', 6.4401, 3.4701, 10, null, null, null, now());
reset role;

select tests.act_as('a0000000-0000-0000-0000-000000000002');  -- the manager
create temp table b as select * from public.day_board('2026-11-09');
select tests.eq((select count(*) from b), 3::bigint, 'board lists office staff and reps only (not owner or managers), and not people added later');
select tests.eq((select status || ' ' || late_minutes from b where full_name = 'Sade Staff'), 'late 40', 'office staff clocking in at 8:40 is Late (40 min)');
select tests.ok((select first_in is not null and last_out is not null from b where full_name = 'Sade Staff'), 'clock-in and clock-out times are shown');
select tests.eq((select status || ' ' || visits || '/' || visit_target from b where full_name = 'Remi Rep'), 'present 2/3', 'a rep with visits is Present, "2 of 3"');
select tests.eq((select status from b where full_name = 'Tolu Staff'), 'absent', 'no check-in on a past work day is Absent');
select tests.eq((select status from public.day_board('2026-11-08') where full_name = 'Tolu Staff'), 'off', 'Sunday (not a work day) is Off');
select tests.eq((select count(*) from public.day_board('2026-11-10') where full_name = 'New Person'), 0::bigint, 'someone added on the 12th is not listed for the 10th');
select tests.eq((select to_review from b where full_name = 'Sade Staff'), 2, 'records with flags are counted for review (no photos here)');

-- Bulk marking.
select tests.eq(public.set_day_status(array['ea000000-0000-0000-0000-000000000005', 'ea000000-0000-0000-0000-000000000003']::uuid[], '2026-11-09', 'leave'), 2, 'mark two people On leave at once');
select tests.eq((select status || ' ' || set_by_manager from public.day_board('2026-11-09') where full_name = 'Tolu Staff'), 'leave true', 'manager-set status wins and is marked as set by a manager');
select tests.eq((select status from public.day_board('2026-11-09') where full_name = 'Sade Staff'), 'leave', '...even over a clock-in');
select tests.eq(public.set_day_status(array['ea000000-0000-0000-0000-000000000005']::uuid[], '2026-11-09', 'present'), 1, 'changing a status replaces it');
select tests.eq((select status from public.day_board('2026-11-09') where full_name = 'Tolu Staff'), 'present', '...now Present');

-- Clear removes only what a manager set.
select tests.eq(public.set_day_status(array['ea000000-0000-0000-0000-000000000003', 'ea000000-0000-0000-0000-000000000004']::uuid[], '2026-11-09', null), 1, 'Clear removes only manager-set statuses (Remi had none)');
select tests.eq((select status from public.day_board('2026-11-09') where full_name = 'Sade Staff'), 'late', 'after Clear, Sade is back to Late from her clock-in');
select tests.eq((select count(*) from public.attendance where member_id = 'ea000000-0000-0000-0000-000000000003'), 2::bigint, 'Clear never deletes clock-ins');

-- Rules.
select tests.refused($$ select public.set_day_status(array['ea000000-0000-0000-0000-000000000005']::uuid[], current_date + 30, 'leave') $$, 'cannot mark a future date');
select tests.refused($$ select public.day_board(current_date + 30) $$, 'cannot view a future date');
select tests.refused($$ select public.set_day_status(array['eb000000-0000-0000-0000-000000000001']::uuid[], '2026-11-09', 'absent') $$, 'cannot mark people in another company');
select tests.refused($$ select public.set_day_status(array['ea000000-0000-0000-0000-000000000005']::uuid[], '2026-11-09', 'holiday') $$, 'only Present, Absent, Leave or Off');
select tests.refused($$ insert into public.day_status (company_id, member_id, day, status, set_by) values ('c000000a-0000-0000-0000-000000000000', 'ea000000-0000-0000-0000-000000000005', '2026-11-02', 'off', 'ea000000-0000-0000-0000-000000000002') $$, 'statuses can only be set through the bulk action');
reset role;

select tests.act_as('a0000000-0000-0000-0000-000000000003');
select tests.refused($$ select * from public.day_board('2026-11-09') $$, 'office staff cannot see the board');
select tests.refused($$ select public.set_day_status(array['ea000000-0000-0000-0000-000000000003']::uuid[], '2026-11-09', 'present') $$, 'staff cannot mark themselves present');
select tests.eq((select count(*) from public.day_status), 0::bigint, 'staff see only their own day statuses (none left)');
reset role;
select tests.act_as('b0000000-0000-0000-0000-000000000001');
select tests.eq((select count(*) from public.day_board('2026-11-09')), 0::bigint, 'another company''s owner sees only their own (empty) board');
select tests.eq((select count(*) from public.day_status), 0::bigint, 'and none of these statuses');
reset role;

rollback;
\echo 'All Today page database tests passed.'
