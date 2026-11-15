-- The Sell upgrade: split payments, customer name, quick picks, opening and closing the till.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;

insert into auth.users (id, email) values
  ('80000000-0000-0000-0000-000000000001', 'owner.pos@example.com'),
  ('80000000-0000-0000-0000-000000000002', '2348120000002@phone.usepinga.com'),   -- manager of Yaba
  ('80000000-0000-0000-0000-000000000003', '2348120000003@phone.usepinga.com'),   -- Yaba staff
  ('80000000-0000-0000-0000-000000000004', '2348120000004@phone.usepinga.com');   -- Surulere staff

select tests.act_as('80000000-0000-0000-0000-000000000001');
create temp table co as select public.create_company('Mama Put Stores', 'Ada Owner', 'storefront') as id;
grant all on co to public;
reset role;
update public.companies set sell_requires_clock_in = false where id = (select id from co);   -- clock-in rule tested in test_roles.sql
insert into public.branches (id, company_id, name, lat, lng) values
  ('81000000-0000-0000-0000-000000000001', (select id from co), 'Yaba shop', 6.5095, 3.3711),
  ('81000000-0000-0000-0000-000000000002', (select id from co), 'Surulere shop', 6.50, 3.35);
insert into public.members (id, company_id, user_id, full_name, phone, role, branch_id, joined_at) values
  ('82000000-0000-0000-0000-000000000002', (select id from co), '80000000-0000-0000-0000-000000000002', 'Ade Manager', '+2348120000002', 'admin', null, now()),
  ('82000000-0000-0000-0000-000000000003', (select id from co), '80000000-0000-0000-0000-000000000003', 'Sade Yaba', '+2348120000003', 'staff', '81000000-0000-0000-0000-000000000001', now()),
  ('82000000-0000-0000-0000-000000000004', (select id from co), '80000000-0000-0000-0000-000000000004', 'Tolu Surulere', '+2348120000004', 'staff', '81000000-0000-0000-0000-000000000002', now());
insert into public.manager_shops (company_id, manager_id, branch_id) values ((select id from co), '82000000-0000-0000-0000-000000000002', '81000000-0000-0000-0000-000000000001');
select tests.act_as('80000000-0000-0000-0000-000000000001');
insert into public.products (id, company_id, name, code, price, lowest_price, category) values
  ('83000000-0000-0000-0000-000000000001', (select id from co), 'Peak Milk 400g', '6151100000017', 2500, 2300, 'Provisions'),
  ('83000000-0000-0000-0000-000000000002', (select id from co), 'Coke 50cl', null, 300, null, 'Drinks');
select tests.eq((select array_agg(category order by category) from public.products), array['Drinks', 'Provisions'], 'products have categories');
reset role;

-- ── Staff open the till with the cash in the drawer ──
select tests.act_as('80000000-0000-0000-0000-000000000003');
select tests.eq((public.till_status('81000000-0000-0000-0000-000000000001')->>'opened')::boolean, false, 'the till starts closed each day');
select public.open_till('81000000-0000-0000-0000-000000000001', 5000);
select tests.eq((select public.till_status('81000000-0000-0000-0000-000000000001') ? 'expected_cash'), false, 'staff see only whether the till is open, not the cash');
select public.open_till('81000000-0000-0000-0000-000000000001', 99999);
select tests.refused($$ select public.open_till('81000000-0000-0000-0000-000000000002', 100) $$, 'staff cannot open another shop''s till');

-- ── Split payment and customer name ──
select tests.eq((select payments from public.record_sale('84000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', now(),
  '[{"product_id": "83000000-0000-0000-0000-000000000001", "qty": 1, "unit_price": 2500}, {"product_id": "83000000-0000-0000-0000-000000000002", "qty": 1, "unit_price": 300}]', now(),
  'split', 'tok_pos_aaaaaaaaaaaaaaaaaaaaaaaaa1', '[{"method": "cash", "amount": 2000}, {"method": "transfer", "amount": 800}]', 'Mama Ngozi')),
  '[{"method": "cash", "amount": 2000}, {"method": "transfer", "amount": 800}]'::jsonb, 'split payment: part cash, part transfer, kept with the sale');
select tests.eq((select customer_name from public.sales where id = '84000000-0000-0000-0000-000000000001'), 'Mama Ngozi', 'the customer''s name is kept with the sale');
select tests.refused($$ select public.record_sale(gen_random_uuid(), '81000000-0000-0000-0000-000000000001', now(), '[{"product_id": "83000000-0000-0000-0000-000000000002", "qty": 1, "unit_price": 300}]', now(), 'split', null, '[{"method": "cash", "amount": 100}, {"method": "card", "amount": 100}]', null) $$, 'split parts must add up to the total');
select tests.refused($$ select public.record_sale(gen_random_uuid(), '81000000-0000-0000-0000-000000000001', now(), '[{"product_id": "83000000-0000-0000-0000-000000000002", "qty": 1, "unit_price": 300}]', now(), 'split', null, '[{"method": "cash", "amount": 300}]', null) $$, 'a split needs two or more parts');
select tests.refused($$ select public.record_sale(gen_random_uuid(), '81000000-0000-0000-0000-000000000001', now(), '[{"product_id": "83000000-0000-0000-0000-000000000002", "qty": 1, "unit_price": 300}]', now(), 'split', null, '[{"method": "cash", "amount": 200}, {"method": "cheque", "amount": 100}]', null) $$, 'each part is cash, transfer or POS card');
select tests.eq((select payments from public.record_sale('84000000-0000-0000-0000-000000000002', '81000000-0000-0000-0000-000000000001', now(),
  '[{"product_id": "83000000-0000-0000-0000-000000000002", "qty": 2, "unit_price": 300}]', now(), 'cash', null)), '[{"method": "cash", "amount": 600}]'::jsonb, 'a phone on the previous version still works (one method, no name)');
select tests.eq(array(select public.shop_quick_picks('81000000-0000-0000-0000-000000000001')), array['83000000-0000-0000-0000-000000000002', '83000000-0000-0000-0000-000000000001']::uuid[], 'quick picks: the shop''s best sellers, most sold first');
reset role;
select tests.act_as('80000000-0000-0000-0000-000000000004');
select tests.eq(array(select public.shop_quick_picks('81000000-0000-0000-0000-000000000001')), '{}'::uuid[], 'quick picks of another shop: nothing');
reset role;

-- ── The receipt shows the split ──
select tests.act_as(null);
select tests.eq(public.receipt('tok_pos_aaaaaaaaaaaaaaaaaaaaaaaaa1')->>'payment' || ' ' || (public.receipt('tok_pos_aaaaaaaaaaaaaaaaaaaaaaaaa1')->'payments'->1->>'method') || ' ' || (public.receipt('tok_pos_aaaaaaaaaaaaaaaaaaaaaaaaa1')->>'customer'), 'split transfer Mama Ngozi', 'the receipt shows the split and the customer''s name');
reset role;

-- ── Closing the till: managers and owners ──
select tests.act_as('80000000-0000-0000-0000-000000000003');
select tests.refused($$ select public.close_till('81000000-0000-0000-0000-000000000001', 7000, null) $$, 'staff cannot close the till');
reset role;
select tests.act_as('80000000-0000-0000-0000-000000000002');
select tests.eq((public.till_status('81000000-0000-0000-0000-000000000001')->>'expected_cash')::numeric, 7600::numeric, 'expected cash = opening ₦5,000 + cash ₦2,000 (split) + ₦600');
select tests.eq((public.close_till('81000000-0000-0000-0000-000000000001', 7100, 'Counted twice')->>'difference')::numeric, -500::numeric, 'counted ₦7,100: ₦500 short');
select tests.refused($$ select public.close_till('81000000-0000-0000-0000-000000000002', 0, null) $$, 'a manager cannot close another shop''s till');
select tests.eq((select jsonb_array_length(public.shops_overview(current_date)->'tills')), 1, 'dashboard: the till close for their shop');
reset role;
select tests.act_as('80000000-0000-0000-0000-000000000001');
select tests.eq((public.shops_overview((now() at time zone 'Africa/Lagos')::date)->'by_method'->>'transfer')::numeric, 800::numeric, 'totals per method count each part of a split');
select tests.eq((public.shops_overview((now() at time zone 'Africa/Lagos')::date)->'by_method'->>'cash')::numeric, 2600::numeric, '...cash ₦2,000 + ₦600');
reset role;
select tests.act_as_server();
select tests.eq((public.summary_content((select id from co), (now() at time zone 'Africa/Lagos')::date)->'shops'->'tills'->0->>'difference')::numeric, -500::numeric, 'evening email: the till difference');
reset role;

rollback;
\echo 'All Sell (POS) database tests passed.'
