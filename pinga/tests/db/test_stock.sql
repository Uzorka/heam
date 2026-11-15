-- Products and stock: who can see and change what, imports (stock count vs delivery), alerts, the log.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;

insert into auth.users (id, email) values
  ('b0000000-0000-0000-0000-000000000001', 'owner.stock@example.com'),
  ('b0000000-0000-0000-0000-000000000002', '2348060000002@phone.usepinga.com'),   -- manager of Yaba
  ('b0000000-0000-0000-0000-000000000003', '2348060000003@phone.usepinga.com'),   -- Yaba shop staff
  ('b0000000-0000-0000-0000-000000000004', '2348060000004@phone.usepinga.com'),   -- Surulere shop staff
  ('b0000000-0000-0000-0000-000000000005', 'owner.field2@example.com'),
  ('b0000000-0000-0000-0000-000000000006', 'owner.other@example.com');

select tests.act_as('b0000000-0000-0000-0000-000000000001');
create temp table co as select public.create_company('Mama Put Stores', 'Ada Owner', 'storefront') as id;
grant all on co to public;
reset role;
select tests.act_as('b0000000-0000-0000-0000-000000000005');
create temp table fco as select public.create_company('Field Co', 'Bola Owner') as id;
grant all on fco to public;
reset role;
select tests.act_as('b0000000-0000-0000-0000-000000000006');
create temp table oco as select public.create_company('Other Shop', 'Chi Owner', 'storefront') as id;
grant all on oco to public;
reset role;

insert into public.branches (id, company_id, name, lat, lng) values
  ('5d000000-0000-0000-0000-000000000001', (select id from co), 'Yaba shop', 6.5095, 3.3711),
  ('5d000000-0000-0000-0000-000000000002', (select id from co), 'Surulere shop', 6.50, 3.35),
  ('5d000000-0000-0000-0000-000000000003', (select id from fco), 'Head office', 6.5, 3.37),
  ('5d000000-0000-0000-0000-000000000004', (select id from oco), 'Other shop', 6.5, 3.37);
insert into public.members (id, company_id, user_id, full_name, phone, role, branch_id, joined_at) values
  ('eb000000-0000-0000-0000-000000000002', (select id from co), 'b0000000-0000-0000-0000-000000000002', 'Ade Manager', '+2348060000002', 'admin', null, now()),
  ('eb000000-0000-0000-0000-000000000003', (select id from co), 'b0000000-0000-0000-0000-000000000003', 'Sade Yaba', '+2348060000003', 'staff', '5d000000-0000-0000-0000-000000000001', now()),
  ('eb000000-0000-0000-0000-000000000004', (select id from co), 'b0000000-0000-0000-0000-000000000004', 'Tolu Surulere', '+2348060000004', 'staff', '5d000000-0000-0000-0000-000000000002', now());
insert into public.manager_shops (company_id, manager_id, branch_id) values ((select id from co), 'eb000000-0000-0000-0000-000000000002', '5d000000-0000-0000-0000-000000000001');

-- ── Owner: products and a first stock count ──
select tests.act_as('b0000000-0000-0000-0000-000000000001');
insert into public.products (id, company_id, name, code, price, lowest_price) values
  ('9d000000-0000-0000-0000-000000000001', (select id from co), 'Peak Milk 400g', 'PM400', 2500, 2300);
select tests.refused($$ insert into public.products (company_id, name, price, lowest_price) values ((select id from co), 'Bad', 100, 200) $$, 'lowest price cannot be above the selling price');
select tests.refused($$ insert into public.products (company_id, name) values ((select id from co), ' peak milk 400G ') $$, 'no two products with the same name');
select tests.eq(
  public.import_stock('5d000000-0000-0000-0000-000000000001', 'count', 'yaba-count.xlsx', '[
    {"code": "pm400", "qty": 24, "expires_on": "2027-03-01"},
    {"name": "Indomie Chicken 70g", "qty": 120, "price": 250, "lowest_price": 220, "low_stock_at": 30},
    {"name": "Golden Penny Sugar 500g", "qty": 3, "price": 1200}
  ]'::jsonb) - 'import_id',
  '{"rows": 3, "new_products": 2, "units": 147}'::jsonb, 'stock count: 3 rows, 2 new products made from the file');
select tests.eq((select qty from public.stock s join public.products p on p.id = s.product_id where p.name = 'Peak Milk 400g' and s.branch_id = '5d000000-0000-0000-0000-000000000001'), 24, 'existing product matched by its code (any case)');
select tests.eq((select lowest_price from public.products where name = 'Indomie Chicken 70g'), 220.00, 'prices from the file are saved');
select tests.eq((select count(*) from public.stock_changes where reason = 'count'), 3::bigint, 'each product''s change is logged');

-- A delivery adds; a recount replaces.
select public.import_stock('5d000000-0000-0000-0000-000000000001', 'delivery', 'delivery-15-nov.csv', '[
  {"name": "INDOMIE CHICKEN 70G", "qty": 60, "price": 260},
  {"name": "Peak Milk 400g", "qty": 12, "expires_on": "2027-01-15"}
]'::jsonb);
select tests.eq((select qty from public.stock s join public.products p on p.id = s.product_id where p.name = 'Indomie Chicken 70g'), 180, 'delivery adds to what is there (120 + 60)');
select tests.eq((select price from public.products where name = 'Indomie Chicken 70g'), 260.00, 'a new price in the delivery file updates the product');
select tests.eq((select expires_on from public.stock s join public.products p on p.id = s.product_id where p.name = 'Peak Milk 400g'), '2027-01-15'::date, 'delivery keeps the earliest expiry date');
select public.import_stock('5d000000-0000-0000-0000-000000000001', 'count', 'recount.csv', '[{"name": "Indomie Chicken 70g", "qty": 150}]'::jsonb);
select tests.eq((select qty from public.stock s join public.products p on p.id = s.product_id where p.name = 'Indomie Chicken 70g'), 150, 'stock count replaces the number');
select tests.eq((select qty from public.stock s join public.products p on p.id = s.product_id where p.name = 'Peak Milk 400g'), 36, 'products not in a count file are left as they are');
select tests.eq((select count(*) from public.stock_imports), 3::bigint, 'every import is in the log');
select tests.eq((select kind || ' ' || by_name || ' ' || units from public.stock_imports where file_name = 'delivery-15-nov.csv'), 'delivery Ada Owner 72', 'the log says what kind, who and how many');

-- Bad files are refused whole (nothing half-saved).
select tests.refused($$ select public.import_stock('5d000000-0000-0000-0000-000000000001', 'count', 'x.csv', '[{"name": "Milo", "qty": 5}, {"name": "", "qty": 2}]') $$, 'a row with no name is refused');
select tests.refused($$ select public.import_stock('5d000000-0000-0000-0000-000000000001', 'count', 'x.csv', '[{"name": "Milo", "qty": -1}]') $$, 'negative quantity is refused');
select tests.refused($$ select public.import_stock('5d000000-0000-0000-0000-000000000001', 'count', 'x.csv', '[{"name": "Milo", "qty": 1}, {"name": "milo", "qty": 2}]') $$, 'the same product twice in one file is refused');
select tests.refused($$ select public.import_stock('5d000000-0000-0000-0000-000000000001', 'restock', 'x.csv', '[{"name": "Milo", "qty": 1}]') $$, 'only stock count or delivery');
select tests.eq((select count(*) from public.products where name ilike 'milo'), 0::bigint, 'a refused file saves nothing');

-- One-product correction with a note; alerts.
select public.set_stock('5d000000-0000-0000-0000-000000000001', (select id from public.products where name = 'Peak Milk 400g'), 30, null, 'Six tins were damaged');
select tests.eq((select change || ' ' || note from public.stock_changes where reason = 'correction'), '-6 Six tins were damaged', 'a correction is logged with the difference and a note');
reset role;
update public.stock set expires_on = current_date + 10 where product_id = (select id from public.products where name = 'Peak Milk 400g');
select tests.act_as('b0000000-0000-0000-0000-000000000001');
select tests.eq((select array_agg(product || ':' || alert order by product) from public.stock_alerts()), array['Golden Penny Sugar 500g:low', 'Peak Milk 400g:expiring'], 'alerts: low stock (3 of 5) and expiring within 30 days');
select public.import_stock('5d000000-0000-0000-0000-000000000002', 'count', 'surulere.csv', '[{"name": "Peak Milk 400g", "qty": 0}]'::jsonb);
select tests.eq((select count(*) from public.stock_alerts() where shop = 'Surulere shop' and alert = 'out'), 1::bigint, 'owner sees alerts for every shop, including out of stock');
reset role;

-- ── Manager of Yaba only ──
select tests.act_as('b0000000-0000-0000-0000-000000000002');
select tests.eq((select count(*) from public.products), 3::bigint, 'manager sees the price list');
select tests.eq((select count(distinct branch_id) from public.stock), 1::bigint, 'manager sees stock of their shop only');
select tests.ok((select bool_and(shop = 'Yaba shop') from public.stock_alerts()), 'manager''s alerts are for their shop only');
select tests.eq((select count(distinct branch_id) from public.stock_imports), 1::bigint, 'manager sees the import log of their shop only');
select public.import_stock('5d000000-0000-0000-0000-000000000001', 'delivery', 'mgr.csv', '[{"name": "Peak Milk 400g", "qty": 6}]'::jsonb);
select tests.eq((select by_name from public.stock_imports where file_name = 'mgr.csv'), 'Ade Manager', 'manager can import into their shop');
select tests.refused($$ select public.import_stock('5d000000-0000-0000-0000-000000000002', 'delivery', 'x.csv', '[{"name": "Peak Milk 400g", "qty": 6}]') $$, 'manager cannot import into another shop');
select tests.refused($$ select public.set_stock('5d000000-0000-0000-0000-000000000002', (select id from public.products where name = 'Peak Milk 400g'), 99, null, null) $$, 'manager cannot change another shop''s stock');
update public.products set price = 2600 where name = 'Peak Milk 400g';
select tests.eq((select price from public.products where name = 'Peak Milk 400g'), 2600.00, 'manager can set prices');
select tests.refused($$ insert into public.stock (company_id, branch_id, product_id, qty) values ((select id from co), '5d000000-0000-0000-0000-000000000001', (select id from public.products where name = 'Peak Milk 400g'), 1000) $$, 'stock cannot be written directly (only through logged changes)');
select tests.refused($$ insert into public.stock_changes (company_id, branch_id, product_id, change, qty_after, reason, by_name) values ((select id from co), '5d000000-0000-0000-0000-000000000001', (select id from public.products where name = 'Peak Milk 400g'), 1, 1, 'count', 'x') $$, 'the log cannot be written directly');
reset role;

-- ── Shop staff ──
select tests.act_as('b0000000-0000-0000-0000-000000000003');
select tests.eq((select count(*) from public.products), 3::bigint, 'shop staff see the price list (for the till)');
select tests.eq((select count(distinct branch_id) from public.stock where branch_id = '5d000000-0000-0000-0000-000000000001'), 1::bigint, 'shop staff see their own shop''s stock');
select tests.eq((select count(*) from public.stock where branch_id = '5d000000-0000-0000-0000-000000000002'), 0::bigint, '...and not another shop''s');
select tests.eq((select count(*) from public.stock_imports), 0::bigint, 'shop staff do not see the import log');
select tests.eq((select count(*) from public.stock_changes), 0::bigint, 'shop staff do not see the change log');
select tests.refused($$ select public.import_stock('5d000000-0000-0000-0000-000000000001', 'delivery', 'x.csv', '[{"name": "Peak Milk 400g", "qty": 6}]') $$, 'shop staff cannot import');
select tests.refused($$ select public.set_stock('5d000000-0000-0000-0000-000000000001', (select id from public.products where name = 'Peak Milk 400g'), 99, null, null) $$, 'shop staff cannot change stock');
select tests.no_rows($$ update public.products set price = 1 $$, 'shop staff cannot change prices');
select tests.eq((select count(*) from public.stock_alerts()), 0::bigint, 'shop staff get no alerts list');
reset role;

-- ── Other companies ──
select tests.act_as('b0000000-0000-0000-0000-000000000006');
select tests.eq((select count(*) from public.products), 0::bigint, 'another business sees none of these products');
select tests.eq((select count(*) from public.stock), 0::bigint, '...or stock');
select tests.refused($$ select public.import_stock('5d000000-0000-0000-0000-000000000001', 'count', 'x.csv', '[{"name": "Steal", "qty": 1}]') $$, 'another business cannot import into this shop');
reset role;
select tests.act_as('b0000000-0000-0000-0000-000000000005');
select tests.refused($$ insert into public.products (company_id, name, price) values ((select id from fco), 'Soap', 100) $$, 'Field sales business: no products');
select tests.refused($$ select public.import_stock('5d000000-0000-0000-0000-000000000003', 'count', 'x.csv', '[{"name": "Soap", "qty": 1}]') $$, 'an office is not a shop: no stock');
reset role;

-- Server (evening email) sees all alerts.
select tests.act_as_server();
select tests.ok((select count(*) >= 3 from public.stock_alerts()), 'evening email job can read every shop''s alerts');
reset role;

rollback;
\echo 'All stock database tests passed.'
