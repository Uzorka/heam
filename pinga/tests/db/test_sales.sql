-- Sales: recording (safe to re-send), price and stock flags, cancelling, "report a mistake", who sees what.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;

insert into auth.users (id, email) values
  ('c0000000-0000-0000-0000-000000000001', 'owner.sales@example.com'),
  ('c0000000-0000-0000-0000-000000000002', '2348070000002@phone.usepinga.com'),   -- manager of Yaba
  ('c0000000-0000-0000-0000-000000000003', '2348070000003@phone.usepinga.com'),   -- Yaba shop staff
  ('c0000000-0000-0000-0000-000000000004', '2348070000004@phone.usepinga.com'),   -- Surulere shop staff
  ('c0000000-0000-0000-0000-000000000005', '2348070000005@phone.usepinga.com');   -- manager of Surulere

select tests.act_as('c0000000-0000-0000-0000-000000000001');
create temp table co as select public.create_company('Mama Put Stores', 'Ada Owner', 'storefront') as id;
grant all on co to public;
reset role;

insert into public.branches (id, company_id, name, lat, lng) values
  ('5e000000-0000-0000-0000-000000000001', (select id from co), 'Yaba shop', 6.5095, 3.3711),
  ('5e000000-0000-0000-0000-000000000002', (select id from co), 'Surulere shop', 6.50, 3.35);
insert into public.members (id, company_id, user_id, full_name, phone, role, branch_id, joined_at) values
  ('ec000000-0000-0000-0000-000000000002', (select id from co), 'c0000000-0000-0000-0000-000000000002', 'Ade Manager', '+2348070000002', 'admin', null, now()),
  ('ec000000-0000-0000-0000-000000000003', (select id from co), 'c0000000-0000-0000-0000-000000000003', 'Sade Yaba', '+2348070000003', 'staff', '5e000000-0000-0000-0000-000000000001', now()),
  ('ec000000-0000-0000-0000-000000000004', (select id from co), 'c0000000-0000-0000-0000-000000000004', 'Tolu Surulere', '+2348070000004', 'staff', '5e000000-0000-0000-0000-000000000002', now()),
  ('ec000000-0000-0000-0000-000000000005', (select id from co), 'c0000000-0000-0000-0000-000000000005', 'Bayo Manager', '+2348070000005', 'admin', null, now());
insert into public.manager_shops (company_id, manager_id, branch_id) values
  ((select id from co), 'ec000000-0000-0000-0000-000000000002', '5e000000-0000-0000-0000-000000000001'),
  ((select id from co), 'ec000000-0000-0000-0000-000000000005', '5e000000-0000-0000-0000-000000000002');

select tests.act_as('c0000000-0000-0000-0000-000000000001');
insert into public.products (id, company_id, name, price, lowest_price) values
  ('9e000000-0000-0000-0000-000000000001', (select id from co), 'Peak Milk 400g', 2500, 2300),
  ('9e000000-0000-0000-0000-000000000002', (select id from co), 'Indomie Chicken 70g', 250, null);
select public.import_stock('5e000000-0000-0000-0000-000000000001', 'count', 'start.csv',
  '[{"name": "Peak Milk 400g", "qty": 10}, {"name": "Indomie Chicken 70g", "qty": 1}]'::jsonb);
reset role;

-- ── Shop staff sell ──
select tests.act_as('c0000000-0000-0000-0000-000000000003');
select tests.eq((public.record_sale('5a1e0000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001', now() - interval '2 hours',
  '[{"product_id": "9e000000-0000-0000-0000-000000000001", "qty": 2, "unit_price": 2400}]', now())).total, 4800.00, 'a sale at a haggled price inside the range: total ₦4,800');
select tests.eq((select flags from public.sales where id = '5a1e0000-0000-0000-0000-000000000001'), '{}'::text[], '...not flagged');
select tests.eq((select discount from public.sales where id = '5a1e0000-0000-0000-0000-000000000001'), 200.00, '...discount ₦200 (2 × ₦100) kept for the evening email');
select tests.eq((select qty from public.stock where product_id = '9e000000-0000-0000-0000-000000000001'), 8, 'stock goes down (10 − 2)');
-- Sent again (lost signal before the answer came): counted once.
select public.record_sale('5a1e0000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001', now() - interval '2 hours',
  '[{"product_id": "9e000000-0000-0000-0000-000000000001", "qty": 2, "unit_price": 2400}]', now());
select tests.eq((select qty from public.stock where product_id = '9e000000-0000-0000-0000-000000000001'), 8, 're-sending the same sale does not take stock twice');
select tests.eq((select count(*) from public.sales), 1::bigint, '...or record it twice');

-- Below the lowest price, and more than is in stock: allowed but flagged.
select public.record_sale('5a1e0000-0000-0000-0000-000000000002', '5e000000-0000-0000-0000-000000000001', now(),
  '[{"product_id": "9e000000-0000-0000-0000-000000000001", "qty": 1, "unit_price": 2000}, {"product_id": "9e000000-0000-0000-0000-000000000002", "qty": 3, "unit_price": 250}]', now());
select tests.eq((select array_agg(product_name || ':' || array_to_string(flags, ',') order by line) from public.sale_items where sale_id = '5a1e0000-0000-0000-0000-000000000002'),
  array['Peak Milk 400g:below_lowest', 'Indomie Chicken 70g:out_of_stock'], 'below the lowest price and out of stock are flagged on the line');
select tests.eq((select flags from public.sales where id = '5a1e0000-0000-0000-0000-000000000002'), array['below_lowest', 'out_of_stock'], '...and on the sale');
select tests.eq((select qty from public.stock where product_id = '9e000000-0000-0000-0000-000000000002'), -2, 'selling more than recorded leaves a negative number (shows the count is wrong)');
select tests.ok((select happened_at <= now() from public.record_sale('5a1e0000-0000-0000-0000-000000000003', '5e000000-0000-0000-0000-000000000001', now() + interval '3 days',
  '[{"product_id": "9e000000-0000-0000-0000-000000000002", "qty": 1, "unit_price": 250}]', now() + interval '3 days')), 'a sale cannot be dated in the future');
select tests.eq((select flags from public.sales where id = '5a1e0000-0000-0000-0000-000000000003'), array['clock_changed', 'out_of_stock'], 'a wrong phone clock is flagged');

select tests.refused($$ select public.record_sale(gen_random_uuid(), '5e000000-0000-0000-0000-000000000002', now(), '[{"product_id": "9e000000-0000-0000-0000-000000000002", "qty": 1, "unit_price": 250}]', now()) $$, 'staff cannot sell in another shop');
select tests.refused($$ select public.record_sale(gen_random_uuid(), '5e000000-0000-0000-0000-000000000001', now(), '[{"product_id": "9e000000-0000-0000-0000-000000000002", "qty": 0, "unit_price": 250}]', now()) $$, 'quantity must be 1 or more');
select tests.refused($$ select public.record_sale(gen_random_uuid(), '5e000000-0000-0000-0000-000000000001', now(), '[]', now()) $$, 'an empty sale is refused');
select tests.refused($$ select public.cancel_sale('5a1e0000-0000-0000-0000-000000000002', 'oops') $$, 'staff cannot cancel a sale');
select tests.refused($$ update public.sales set total = 1 $$, 'staff cannot change a sale');
select public.report_sale_mistake('5a1e0000-0000-0000-0000-000000000002', 'Customer bought 2 Indomie, not 3');
select tests.eq((select mistake_note from public.sales where id = '5a1e0000-0000-0000-0000-000000000002'), 'Customer bought 2 Indomie, not 3', 'staff can report a mistake in their own sale');
select tests.eq((select count(*) from public.sales), 3::bigint, 'staff see their own sales');
reset role;

select tests.act_as('c0000000-0000-0000-0000-000000000004');
select tests.eq((select count(*) from public.sales), 0::bigint, 'staff of another shop see none of these sales');
select tests.refused($$ select public.report_sale_mistake('5a1e0000-0000-0000-0000-000000000001', 'not mine') $$, 'staff cannot report a mistake in someone else''s sale');
select tests.refused($$ select public.record_sale('5a1e0000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000002', now(), '[{"product_id": "9e000000-0000-0000-0000-000000000002", "qty": 1, "unit_price": 250}]', now()) $$, 'cannot take over another person''s sale id');
reset role;

-- ── Manager of Surulere: not this shop ──
select tests.act_as('c0000000-0000-0000-0000-000000000005');
select tests.eq((select count(*) from public.sales), 0::bigint, 'a manager of another shop does not see these sales');
select tests.refused($$ select public.cancel_sale('5a1e0000-0000-0000-0000-000000000002', 'x') $$, '...and cannot cancel them');
select tests.eq(public.shop_sales_summary('5e000000-0000-0000-0000-000000000001', current_date), null::jsonb, '...or read their totals');
reset role;

-- ── Manager of Yaba ──
select tests.act_as('c0000000-0000-0000-0000-000000000002');
select tests.eq((select count(*) from public.sales), 3::bigint, 'the shop''s manager sees all its sales');
select tests.eq((select count(*) from public.sale_items), 4::bigint, '...with their products');
select tests.refused($$ select public.cancel_sale('5a1e0000-0000-0000-0000-000000000002', '  ') $$, 'cancelling needs a reason');
select public.cancel_sale('5a1e0000-0000-0000-0000-000000000002', 'Wrong quantity, re-entered');
select tests.eq((select cancelled_by_name || ': ' || cancel_reason from public.sales where id = '5a1e0000-0000-0000-0000-000000000002'), 'Ade Manager: Wrong quantity, re-entered', 'the cancellation keeps who and why');
select tests.eq((select array_agg(qty order by product_id) from public.stock where branch_id = '5e000000-0000-0000-0000-000000000001'), array[8, 0], 'stock goes back (Peak 7 → 8, Indomie −3 → 0)');
select tests.eq((select count(*) from public.stock_changes where reason = 'sale_cancelled'), 2::bigint, 'the stock coming back is logged');
select tests.refused($$ select public.cancel_sale('5a1e0000-0000-0000-0000-000000000002', 'again') $$, 'a sale cannot be cancelled twice');
select tests.eq(public.shop_sales_summary('5e000000-0000-0000-0000-000000000001', (now() at time zone 'Africa/Lagos')::date) - 'flagged',
  '{"sales": 2, "total": 5050.00, "discount": 200.00, "cancelled": 1, "mistakes": 0}'::jsonb, 'the day''s summary leaves out the cancelled sale');
reset role;

-- The owner sees every shop; the server (evening email) too.
select tests.act_as('c0000000-0000-0000-0000-000000000001');
select tests.eq((select count(*) from public.sales), 3::bigint, 'owner sees every sale');
reset role;
select tests.act_as_server();
select tests.ok(public.shop_sales_summary('5e000000-0000-0000-0000-000000000001', (now() at time zone 'Africa/Lagos')::date) is not null, 'the evening email job can read the summary');
reset role;

rollback;
\echo 'All sales database tests passed.'
