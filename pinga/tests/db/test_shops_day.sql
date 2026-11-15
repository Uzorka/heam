-- Part D: billing per shop, the shops on the dashboard, and the shops in the evening email.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;

insert into auth.users (id, email) values
  ('d0000000-0000-0000-0000-000000000001', 'owner.d@example.com'),
  ('d0000000-0000-0000-0000-000000000002', '2348090000002@phone.usepinga.com'),
  ('d0000000-0000-0000-0000-000000000003', '2348090000003@phone.usepinga.com');

select tests.act_as('d0000000-0000-0000-0000-000000000001');
create temp table co as select public.create_company('Mama Put Stores', 'Ada Owner', 'storefront') as id;
grant all on co to public;
reset role;
-- These tests are about selling itself: the owner's till rules (clock in first; nothing below the lowest price) are off here, tested in test_roles.sql.
update public.companies set sell_requires_clock_in = false, staff_below_lowest = true where id = (select id from co);

insert into public.branches (id, company_id, name, lat, lng) values
  ('5f000000-0000-0000-0000-000000000001', (select id from co), 'Yaba shop', 6.5095, 3.3711),
  ('5f000000-0000-0000-0000-000000000002', (select id from co), 'Surulere shop', 6.50, 3.35),
  ('5f000000-0000-0000-0000-000000000003', (select id from co), 'Empty shop', 6.40, 3.30);
-- Yaba: 5 joined staff (3 included + 2 extra). Surulere: 1. Empty shop: nobody joined yet. One person not in a shop.
insert into public.members (id, company_id, user_id, full_name, phone, role, branch_id, joined_at)
select ('ed000000-0000-0000-0000-00000000000' || g)::uuid, (select id from co),
  case g when 1 then 'd0000000-0000-0000-0000-000000000002'::uuid when 2 then 'd0000000-0000-0000-0000-000000000003'::uuid end,
  'Yaba ' || g, '+23480900001' || lpad(g::text, 2, '0'), 'staff', '5f000000-0000-0000-0000-000000000001', now()
from generate_series(1, 5) g;
insert into public.members (company_id, full_name, phone, role, branch_id, joined_at) values
  ((select id from co), 'Surulere 1', '+2348090000201', 'staff', '5f000000-0000-0000-0000-000000000002', now()),
  ((select id from co), 'Not joined', '+2348090000202', 'staff', '5f000000-0000-0000-0000-000000000003', null),
  ((select id from co), 'Floating', '+2348090000203', 'staff', null, now());

select tests.act_as('d0000000-0000-0000-0000-000000000001');
create temp table q as select public.billing_overview()->'quote' as j;
select tests.eq((select (j->>'shop_seats')::int from q), 2, 'billed shops: those with someone joined (the empty shop is free)');
select tests.eq((select (j->>'shop_extra_staff')::int from q), 2, 'Yaba has 5 staff: 3 included, 2 extra');
select tests.eq((select (j->>'loose_staff')::int from q), 1, 'staff not in a shop yet are counted as extra staff');
select tests.eq((select (j->>'staff_seats')::int + (j->>'rep_seats')::int from q), 0, 'no office staff or rep prices in a Storefront business');
select tests.eq((select (j->>'amount_kobo')::bigint from q), 1300000::bigint, '2 shops × ₦5,000 + 3 extra × ₦1,000 = ₦13,000 a month');
update public.members set role = 'admin' where full_name = 'Yaba 5';
select tests.eq((select (public.billing_overview()->'quote'->>'amount_kobo')::bigint), 1200000::bigint, 'managers are free (one fewer extra: ₦12,000)');
reset role;
update public.billing_prices set naira_per_seat = 6000, included_staff = 4 where module = 'shop';
select tests.act_as('d0000000-0000-0000-0000-000000000001');
select tests.eq((select (public.billing_overview()->'quote'->>'amount_kobo')::bigint), 1300000::bigint, 'prices are set in one table (₦6,000 incl. 4 staff → ₦13,000)');
reset role;
update public.billing_prices set naira_per_seat = 5000, included_staff = 3 where module = 'shop';

-- Both: office staff at the attendance price, shops per shop.
update public.companies set business_type = 'both' where id = (select id from co);
update public.branches set kind = 'shop' where company_id = (select id from co);
select tests.act_as('d0000000-0000-0000-0000-000000000001');
select tests.eq((select (public.billing_overview()->'quote'->>'staff_seats')::int), 1, 'Both: staff not in a shop pay the office staff price');
reset role;
update public.companies set business_type = 'storefront' where id = (select id from co);

-- A day of sales.
select tests.act_as('d0000000-0000-0000-0000-000000000001');
insert into public.products (id, company_id, name, price, lowest_price, low_stock_at) values
  ('9f000000-0000-0000-0000-000000000001', (select id from co), 'Peak Milk 400g', 2500, 2300, 5),
  ('9f000000-0000-0000-0000-000000000002', (select id from co), 'Indomie Chicken 70g', 250, null, 10);
select public.import_stock('5f000000-0000-0000-0000-000000000001', 'count', 'a.csv', '[{"name": "Peak Milk 400g", "qty": 6, "expires_on": "2000-01-01"}, {"name": "Indomie Chicken 70g", "qty": 50}]'::jsonb);
reset role;
update public.stock set expires_on = current_date + 7 where product_id = '9f000000-0000-0000-0000-000000000001';
select tests.act_as('d0000000-0000-0000-0000-000000000002');
select public.record_sale('5a1f0000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-000000000001', now(),
  '[{"product_id": "9f000000-0000-0000-0000-000000000001", "qty": 2, "unit_price": 2200}, {"product_id": "9f000000-0000-0000-0000-000000000002", "qty": 40, "unit_price": 250}]', now());
select public.record_sale('5a1f0000-0000-0000-0000-000000000002', '5f000000-0000-0000-0000-000000000001', now(),
  '[{"product_id": "9f000000-0000-0000-0000-000000000002", "qty": 2, "unit_price": 250}]', now());
select public.report_sale_mistake('5a1f0000-0000-0000-0000-000000000002', 'typo');
reset role;

select tests.act_as('d0000000-0000-0000-0000-000000000001');
create temp table d as select public.shops_overview((now() at time zone 'Africa/Lagos')::date) as j;
select tests.eq((select (j->>'total')::numeric from d), 14900::numeric, 'dashboard: today''s sales across shops (₦4,400 + ₦10,000 + ₦500)');
select tests.eq((select (j->>'discount')::numeric from d), 600::numeric, 'dashboard: discounts given');
select tests.eq((select jsonb_array_length(j->'shops') from d), 3, 'dashboard: one row per shop');
select tests.eq((select j->'best'->0->>'name' from d), 'Indomie Chicken 70g', 'best seller first (42 sold)');
select tests.eq((select (j->'shops'->2->>'to_check')::int from d), 2, 'Yaba: 2 sales to check (below lowest; mistake reported)');
select tests.eq((select j->'low_stock'->0->>'product' || ' ' || (j->'low_stock'->0->>'qty') from d), 'Indomie Chicken 70g 8', 'low stock listed (8 left, alert at 10)');
select tests.eq((select j->'expiring'->0->>'product' from d), 'Peak Milk 400g', 'expiring soon listed');
select tests.eq((select j->'below_lowest'->0->>'seller' from d), 'Yaba 1', 'below-lowest sales name the seller');
reset role;

-- A manager sees only their shops on the dashboard.
update public.members set role = 'admin', branch_id = null where user_id = 'd0000000-0000-0000-0000-000000000003';
insert into public.manager_shops (company_id, manager_id, branch_id)
  select (select id from co), id, '5f000000-0000-0000-0000-000000000002' from public.members where user_id = 'd0000000-0000-0000-0000-000000000003';
select tests.act_as('d0000000-0000-0000-0000-000000000003');
select tests.eq((select jsonb_array_length(public.shops_overview(current_date)->'shops')), 1, 'a manager''s dashboard shows only their shops');
select tests.eq((select (public.shops_overview((now() at time zone 'Africa/Lagos')::date)->>'total')::numeric), 0::numeric, '...and only their sales');
reset role;
select tests.act_as('d0000000-0000-0000-0000-000000000002');
select tests.refused($$ select public.shops_overview(current_date) $$, 'shop staff cannot read the dashboard');
reset role;

-- The evening email includes the shops.
select tests.act_as_server();
select tests.eq((public.summary_content((select id from co), (now() at time zone 'Africa/Lagos')::date)->'shops'->>'total')::numeric, 14900::numeric, 'evening email: sales across every shop');
reset role;

rollback;
\echo 'All shops dashboard and billing database tests passed.'
