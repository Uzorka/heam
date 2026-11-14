-- Owner dashboard, register export, pay privacy, evening summary.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'owner.a@example.com'),
  ('a0000000-0000-0000-0000-000000000002', '2348030000002@phone.usepinga.com'),
  ('a0000000-0000-0000-0000-000000000003', '2348030000003@phone.usepinga.com'),
  ('a0000000-0000-0000-0000-000000000004', '2348030000004@phone.usepinga.com');
-- Mon–Fri, 8:00–17:00 (9 hours), 15 minutes grace, Lagos.
insert into public.companies (id, name) values ('c000000a-0000-0000-0000-000000000000', 'CHF Heron');
insert into public.branches (id, company_id, name, lat, lng) values
  ('ba000000-0000-0000-0000-000000000001', 'c000000a-0000-0000-0000-000000000000', 'Yaba office', 6.5095, 3.3711),
  ('ba000000-0000-0000-0000-000000000002', 'c000000a-0000-0000-0000-000000000000', 'Ikeja office', 6.6018, 3.3515);
insert into public.members (id, company_id, user_id, full_name, phone, role, branch_id, daily_visit_target, joined_at, created_at) values
  ('ea000000-0000-0000-0000-000000000001', 'c000000a-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001', 'Ada Owner', null, 'owner', null, null, now(), '2026-11-02'),
  ('ea000000-0000-0000-0000-000000000002', 'c000000a-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000002', 'Ade Manager', '+2348030000002', 'admin', null, null, now(), '2026-11-02'),
  ('ea000000-0000-0000-0000-000000000003', 'c000000a-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000003', 'Sade Staff', '+2348030000003', 'staff', 'ba000000-0000-0000-0000-000000000001', null, now(), '2026-11-02'),
  ('ea000000-0000-0000-0000-000000000004', 'c000000a-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000004', 'Remi Rep', '+2348030000004', 'rep', null, 3, now(), '2026-11-02'),
  ('ea000000-0000-0000-0000-000000000005', 'c000000a-0000-0000-0000-000000000000', null, 'Tolu Staff', '+2348030000005', 'staff', 'ba000000-0000-0000-0000-000000000002', null, null, '2026-11-02');
insert into public.stores (id, company_id, name, lat, lng) values
  ('5a000000-0000-0000-0000-000000000001', 'c000000a-0000-0000-0000-000000000000', 'Shoprite', 6.6018, 3.3515),
  ('5a000000-0000-0000-0000-000000000002', 'c000000a-0000-0000-0000-000000000000', 'Spar', 6.4400, 3.4700),
  ('5a000000-0000-0000-0000-000000000003', 'c000000a-0000-0000-0000-000000000000', 'Unassigned store', 6.5, 3.4);
insert into public.store_assignments (company_id, member_id, store_id) values
  ('c000000a-0000-0000-0000-000000000000', 'ea000000-0000-0000-0000-000000000004', '5a000000-0000-0000-0000-000000000001'),
  ('c000000a-0000-0000-0000-000000000000', 'ea000000-0000-0000-0000-000000000004', '5a000000-0000-0000-0000-000000000002');

-- Sade: late Mon 9 (40 min), Tue 10 (30), Wed 11 (20); on time Fri 13.
select tests.act_as('a0000000-0000-0000-0000-000000000003');
select public.record_attendance(gen_random_uuid(), 'in', t, 6.5096 + random() / 10000, 3.3712, 10, null, now())
from unnest(array['2026-11-09 08:40+01', '2026-11-10 08:30+01', '2026-11-11 08:20+01', '2026-11-13 08:05+01']::timestamptz[]) t;
reset role;
-- Remi: 2 visits on each of Tue 3, Wed 4, Thu 5 (6 the week before), then 2 on Fri 13.
select tests.act_as('a0000000-0000-0000-0000-000000000004');
select public.record_visit(gen_random_uuid(), s, t, 6.6019 + random() / 10000, 3.3516, 10, null, null, null, now())
from unnest(array['2026-11-03 10:00+01', '2026-11-04 10:00+01', '2026-11-05 10:00+01', '2026-11-13 10:00+01']::timestamptz[]) t,
     unnest(array['5a000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000002']::uuid[]) s;
reset role;

-- Owner sets Tolu's pay (₦180,000 a month).
select tests.act_as('a0000000-0000-0000-0000-000000000001');
insert into public.pay_rates (member_id, company_id, monthly_naira) values ('ea000000-0000-0000-0000-000000000005', 'c000000a-0000-0000-0000-000000000000', 180000);
create temp table o as select public.owner_overview('2026-11-13') as j;
select tests.eq((select j->'now'->>'present' || '/' || (j->'now'->>'people') from o), '2/3', 'right now: 2 of 3 present on Friday');
select tests.eq((select (j->'now'->>'absent')::int from o), 1, 'one absent (Tolu)');
select tests.eq((select jsonb_path_query_array(j->'offices', '$[*].name') from o), '["Ikeja office", "Yaba office"]'::jsonb, 'staff grouped by office (home office when they didn''t clock in)');
select tests.eq((select (j->'offices'->0->>'absent')::int from o), 1, 'Ikeja: 1 absent');
select tests.eq((select j->'field'->>'done' || ' of ' || (j->'field'->>'planned') from o), '2 of 3', 'field visits: 2 of 3 planned');
select tests.eq((select jsonb_array_length(j->'stores') from o), 2, 'map shows assigned stores with a location (not unassigned ones)');
select tests.ok((select bool_and((x->>'visited')::boolean) from o, jsonb_array_elements(j->'stores') x), 'both visited stores are marked visited');
select tests.eq((select j->'repeat_late' from o), '[{"name": "Sade Staff", "times": 3}]'::jsonb, 'pattern: Sade late 3 times in 2 weeks');
select tests.eq((select j->'visits_dropping' from o), '[{"name": "Remi Rep", "this_week": 2, "last_week": 6}]'::jsonb, 'pattern: Remi''s visits dropped from 6 to 2');
-- Lost time Nov 2–13: Tolu 10 absent days × 9 h = 90 h; Sade 6 absent days × 9 h + 1.5 h late = 55.5 h;
-- Remi 6 days with no visits × 9 h = 54 h. Total 199.5 h. Only Tolu has pay: 90 h × ₦180,000 / (21.67 days × 9 h) ≈ ₦83,077.
select tests.eq((select (j->'lost'->>'hours')::numeric from o), 199.5, 'lost time this month: 199.5 hours');
select tests.eq((select (j->'lost'->>'naira')::numeric from o), 83077::numeric, 'cost in naira for people with pay set: ₦83,077');
select tests.eq((select (j->'lost'->>'with_pay')::int from o), 1, 'one person has pay set');
select tests.refused($$ select public.owner_overview(current_date + 30) $$, 'cannot view a future date');
reset role;

-- Managers see the dashboard but not pay or cost.
select tests.act_as('a0000000-0000-0000-0000-000000000002');
select tests.eq((select public.owner_overview('2026-11-13')->'lost'), 'null'::jsonb, 'managers don''t see the cost of lost time');
select tests.eq((select count(*) from public.pay_rates), 0::bigint, 'managers cannot see pay');
select tests.refused($$ insert into public.pay_rates (member_id, company_id, monthly_naira) values ('ea000000-0000-0000-0000-000000000003', 'c000000a-0000-0000-0000-000000000000', 1) $$, 'managers cannot set pay');
-- Register for export
select tests.eq((select count(*) from public.register('2026-11-09', '2026-11-13')), 15::bigint, 'register: 5 days × 3 people');
select tests.eq((select status || ' ' || late_minutes from public.register('2026-11-09', '2026-11-13') where day = '2026-11-09' and full_name = 'Sade Staff'), 'late 40', 'register shows Sade late 40 min on the 9th');
select tests.refused($$ select * from public.register('2026-01-01', '2026-11-13') $$, 'register is limited to 3 months');
reset role;

select tests.act_as('a0000000-0000-0000-0000-000000000003');
select tests.eq((select count(*) from public.pay_rates), 0::bigint, 'staff cannot see anyone''s pay, even their own');
select tests.refused($$ select public.owner_overview('2026-11-13') $$, 'staff cannot see the owner dashboard');
select tests.refused($$ select * from public.register('2026-11-09', '2026-11-13') $$, 'staff cannot export the register');
select tests.refused($$ select public.summary_content('c000000a-0000-0000-0000-000000000000', '2026-11-13') $$, 'staff cannot read the summary');
reset role;

-- Evening summary (server only)
select tests.act_as_server();
create temp table sm as select public.summary_content('c000000a-0000-0000-0000-000000000000', '2026-11-13') as j;
select tests.eq((select j->'to' from sm), '["owner.a@example.com"]'::jsonb, 'summary goes to the owner''s email');
select tests.eq((select j->'absent' from sm), '["Tolu Staff"]'::jsonb, 'summary lists who was absent');
select tests.eq((select (j->>'visits_done') || '/' || (j->>'visits_planned') from sm), '2/3', 'summary: 2 of 3 visits');
select tests.eq((select j->'below_target' from sm), '[{"name": "Remi Rep", "visits": 2, "target": 3}]'::jsonb, 'summary: reps below target');
select public.summary_logged('c000000a-0000-0000-0000-000000000000', (now() at time zone 'Africa/Lagos')::date, true, 'sent');
select tests.eq((select count(*) from public.summaries_due() where company_id = 'c000000a-0000-0000-0000-000000000000'), 0::bigint, 'never sent twice on the same day');
select tests.eq(public.summary_key_ok('guess'), false, 'the schedule key must match');
reset role;
insert into private.settings values ('summary_key', 'k-123') on conflict (key) do update set value = excluded.value;  -- rolled back below
select tests.act_as_server();
select tests.eq(public.summary_key_ok('k-123'), true, '...and the right key is accepted');
reset role;

rollback;
\echo 'All owner dashboard database tests passed.'
