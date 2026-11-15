-- Roles and permissions in a business with shops: shop staff, managers (default and optional rights), owners.
-- Every rule checked here is enforced by the database itself.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;

insert into auth.users (id, email) values
  ('70000000-0000-0000-0000-000000000001', 'owner.roles@example.com'),
  ('70000000-0000-0000-0000-000000000002', '2348110000002@phone.usepinga.com'),   -- Ade: manager of Yaba
  ('70000000-0000-0000-0000-000000000003', '2348110000003@phone.usepinga.com'),   -- Sade: Yaba shop staff
  ('70000000-0000-0000-0000-000000000004', '2348110000004@phone.usepinga.com'),   -- Tolu: Surulere shop staff
  ('70000000-0000-0000-0000-000000000005', 'owner.field.roles@example.com'),
  ('70000000-0000-0000-0000-000000000006', '2348110000006@phone.usepinga.com');   -- manager in a Field sales business

select tests.act_as('70000000-0000-0000-0000-000000000001');
create temp table co as select public.create_company('Mama Put Stores', 'Ada Owner', 'storefront') as id;
grant all on co to public;
reset role;
select tests.act_as('70000000-0000-0000-0000-000000000005');
create temp table fco as select public.create_company('Field Co', 'Bola Owner') as id;
grant all on fco to public;
reset role;

insert into public.branches (id, company_id, name, lat, lng) values
  ('71000000-0000-0000-0000-000000000001', (select id from co), 'Yaba shop', 6.5095, 3.3711),
  ('71000000-0000-0000-0000-000000000002', (select id from co), 'Surulere shop', 6.50, 3.35),
  ('71000000-0000-0000-0000-000000000009', (select id from fco), 'Head office', 6.5, 3.37);
insert into public.members (id, company_id, user_id, full_name, phone, role, branch_id, joined_at) values
  ('72000000-0000-0000-0000-000000000002', (select id from co), '70000000-0000-0000-0000-000000000002', 'Ade Manager', '+2348110000002', 'admin', null, now()),
  ('72000000-0000-0000-0000-000000000003', (select id from co), '70000000-0000-0000-0000-000000000003', 'Sade Yaba', '+2348110000003', 'staff', '71000000-0000-0000-0000-000000000001', now()),
  ('72000000-0000-0000-0000-000000000004', (select id from co), '70000000-0000-0000-0000-000000000004', 'Tolu Surulere', '+2348110000004', 'staff', '71000000-0000-0000-0000-000000000002', now()),
  ('72000000-0000-0000-0000-000000000006', (select id from fco), '70000000-0000-0000-0000-000000000006', 'Field Manager', '+2348110000006', 'admin', null, now());
insert into public.manager_shops (company_id, manager_id, branch_id) values ((select id from co), '72000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000001');

select tests.act_as('70000000-0000-0000-0000-000000000001');
insert into public.products (id, company_id, name, code, price, lowest_price) values
  ('73000000-0000-0000-0000-000000000001', (select id from co), 'Peak Milk 400g', 'PM400', 2500, 2300),
  ('73000000-0000-0000-0000-000000000002', (select id from co), 'Never sold', null, 100, null);
insert into public.product_costs (product_id, company_id, cost_price) values ('73000000-0000-0000-0000-000000000001', (select id from co), 2000);
select public.import_stock('71000000-0000-0000-0000-000000000001', 'count', 'a.csv', '[{"name": "Peak Milk 400g", "qty": 50}]'::jsonb);
select public.import_stock('71000000-0000-0000-0000-000000000002', 'count', 'b.csv', '[{"name": "Peak Milk 400g", "qty": 50}]'::jsonb);
reset role;

-- ══ SHOP STAFF ══
select tests.act_as('70000000-0000-0000-0000-000000000003');
select tests.refused($$ select public.record_sale(gen_random_uuid(), '71000000-0000-0000-0000-000000000001', now(), '[{"product_id": "73000000-0000-0000-0000-000000000001", "qty": 1, "unit_price": 2500}]', now(), 'cash', null) $$, 'staff: must clock in before selling (owner setting, on by default)');
select public.record_attendance('74000000-0000-0000-0000-000000000001', 'in', now() - interval '1 hour', 6.5095, 3.3711, 10, null, now());
select tests.eq((public.record_sale('75000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', now(), '[{"product_id": "73000000-0000-0000-0000-000000000001", "qty": 1, "unit_price": 2400}]', now(), 'cash', null)).total, 2400.00, 'staff: once clocked in, sells at a price between the lowest and the selling price');
select tests.refused($$ select public.record_sale(gen_random_uuid(), '71000000-0000-0000-0000-000000000001', now(), '[{"product_id": "73000000-0000-0000-0000-000000000001", "qty": 1, "unit_price": 2000}]', now(), 'cash', null) $$, 'staff: cannot sell below the lowest allowed price');
select tests.refused($$ select public.record_sale(gen_random_uuid(), '71000000-0000-0000-0000-000000000001', now(), '[{"product_id": "73000000-0000-0000-0000-000000000001", "qty": 1, "unit_price": 2600}]', now(), 'cash', null) $$, 'staff: cannot sell above the selling price');
select tests.refused($$ select public.record_sale(gen_random_uuid(), '71000000-0000-0000-0000-000000000002', now(), '[{"product_id": "73000000-0000-0000-0000-000000000001", "qty": 1, "unit_price": 2500}]', now(), 'cash', null) $$, 'staff: cannot sell in another shop');
select tests.eq((select count(*) from public.products), 2::bigint, 'staff: see product names and prices (for the till)');
select tests.eq((select count(*) from public.stock), 1::bigint, 'staff: see stock left in their own shop only');
select tests.eq((select count(*) from public.product_costs), 0::bigint, 'staff: cannot see cost prices');
select tests.refused($$ insert into public.products (company_id, name, price) values ((select id from co), 'X', 1) $$, 'staff: cannot add products');
select tests.no_rows($$ update public.products set price = 1 $$, 'staff: cannot change products or prices');
select tests.refused($$ select public.delete_product('73000000-0000-0000-0000-000000000002') $$, 'staff: cannot delete products');
select tests.refused($$ select public.import_stock('71000000-0000-0000-0000-000000000001', 'delivery', 'x.csv', '[{"name": "Peak Milk 400g", "qty": 1}]') $$, 'staff: cannot import');
select tests.refused($$ select public.set_stock('71000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', 99, null, null) $$, 'staff: cannot change stock');
select tests.eq(public.shop_sales_summary('71000000-0000-0000-0000-000000000001', current_date), null::jsonb, 'staff: no shop totals, stock value or profit');
select tests.refused($$ select public.shops_overview(current_date) $$, 'staff: no reports');
select tests.refused($$ select public.billing_overview() $$, 'staff: no billing');
select tests.refused($$ select * from public.register(current_date, current_date) $$, 'staff: no exports');
reset role;
-- Tolu (another shop) sells; Sade can't see it.
select tests.act_as('70000000-0000-0000-0000-000000000004');
select public.record_attendance('74000000-0000-0000-0000-000000000002', 'in', now() - interval '1 hour', 6.50, 3.35, 10, null, now());
select public.record_sale('75000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000002', now(), '[{"product_id": "73000000-0000-0000-0000-000000000001", "qty": 1, "unit_price": 2500}]', now(), 'cash', null);
reset role;
select tests.act_as('70000000-0000-0000-0000-000000000003');
select tests.eq((select count(*) from public.sales), 1::bigint, 'staff: see only their own sales, not other staff''s');
-- A price changed after a sale made offline: the sale is kept, flagged.
reset role;
select tests.act_as('70000000-0000-0000-0000-000000000001');
update public.products set lowest_price = 2450 where id = '73000000-0000-0000-0000-000000000001';
reset role;
select tests.act_as('70000000-0000-0000-0000-000000000003');
select tests.eq((select flags from public.record_sale('75000000-0000-0000-0000-000000000003', '71000000-0000-0000-0000-000000000001', now() - interval '20 minutes', '[{"product_id": "73000000-0000-0000-0000-000000000001", "qty": 1, "unit_price": 2400}]', now(), 'cash', null)), array['price_changed', 'below_lowest'], 'staff: a sale made offline before a price change is kept and flagged');
select public.record_attendance('74000000-0000-0000-0000-000000000003', 'out', now(), 6.5095, 3.3711, 10, null, now());
select tests.refused($$ select public.record_sale(gen_random_uuid(), '71000000-0000-0000-0000-000000000001', now() + interval '1 minute', '[{"product_id": "73000000-0000-0000-0000-000000000001", "qty": 1, "unit_price": 2500}]', now(), 'cash', null) $$, 'staff: after clocking out, can''t sell');
reset role;
-- The owner can switch the till rules.
select tests.act_as('70000000-0000-0000-0000-000000000001');
update public.companies set sell_requires_clock_in = false, staff_below_lowest = true where id = (select id from co);
reset role;
select tests.act_as('70000000-0000-0000-0000-000000000003');
select tests.ok((select 'below_lowest' = any (flags) from public.record_sale(gen_random_uuid(), '71000000-0000-0000-0000-000000000001', now(), '[{"product_id": "73000000-0000-0000-0000-000000000001", "qty": 1, "unit_price": 2000}]', now(), 'cash', null)), 'owner settings off: staff can sell without clocking in, and below the lowest price (flagged)');
reset role;
select tests.act_as('70000000-0000-0000-0000-000000000001');
update public.companies set sell_requires_clock_in = true, staff_below_lowest = false where id = (select id from co);
reset role;

-- ══ MANAGER (default rights) ══
select tests.act_as('70000000-0000-0000-0000-000000000002');
insert into public.products (company_id, name, price) values ((select id from co), 'Milo 400g', 2800);
select tests.ok(true, 'manager: adds products');
update public.products set price = 2900, lowest_price = 2700 where name = 'Milo 400g';
select tests.eq((select price from public.products where name = 'Milo 400g'), 2900.00, 'manager: sets selling and lowest prices');
select public.import_stock('71000000-0000-0000-0000-000000000001', 'delivery', 'd.csv', '[{"name": "Milo 400g", "qty": 12}]'::jsonb);
select tests.ok(true, 'manager: imports into their shop');
select public.set_stock('71000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', 40, null, 'recount');
select tests.ok(true, 'manager: adjusts stock in their shop');
select public.cancel_sale('75000000-0000-0000-0000-000000000001', 'Wrong item');
select tests.ok(true, 'manager: cancels a sale in their shop, with a reason');
select tests.refused($$ select public.cancel_sale('75000000-0000-0000-0000-000000000002', 'x') $$, 'manager: cannot cancel a sale in another shop');
select tests.eq((select count(*) from public.sales), 3::bigint, 'manager: sees their shop''s sales only (3 in Yaba; not Surulere''s)');
select tests.eq(public.set_day_status(array['72000000-0000-0000-0000-000000000003'::uuid], current_date, 'present'), 1, 'manager: marks attendance for their shop''s staff');
select tests.refused($$ select public.set_day_status(array['72000000-0000-0000-0000-000000000004'::uuid], current_date, 'absent') $$, 'manager: cannot mark attendance for another shop''s staff');
select tests.refused($$ select public.billing_overview() $$, 'manager: cannot see billing');
select tests.refused($$ insert into public.branches (company_id, name, lat, lng) values ((select id from co), 'New shop', 6.5, 3.3) $$, 'manager: cannot add shops');
select tests.no_rows($$ delete from public.branches where id = '71000000-0000-0000-0000-000000000001' $$, 'manager: cannot remove shops');
select tests.no_rows($$ update public.branches set name = 'x' where id = '71000000-0000-0000-0000-000000000002' $$, 'manager: cannot change another shop');
select tests.refused($$ insert into public.members (company_id, full_name, phone, role) values ((select id from co), 'New Manager', '+2348110000099', 'admin') $$, 'manager: cannot invite managers');
select tests.refused($$ insert into public.members (company_id, full_name, phone, role, branch_id) values ((select id from co), 'New Staff', '+2348110000098', 'staff', '71000000-0000-0000-0000-000000000001') $$, 'manager: cannot invite shop staff without the right');
select tests.no_rows($$ update public.members set active = false where id = '72000000-0000-0000-0000-000000000003' $$, 'manager: cannot remove shop staff without the right');
select tests.refused($$ select public.renew_invite('72000000-0000-0000-0000-000000000003') $$, 'manager: cannot send PIN links without the staff right');
select tests.refused($$ select public.set_business_type('field') $$, 'manager: cannot change the business type');
select tests.no_rows($$ update public.companies set work_starts = '07:00' $$, 'manager: cannot change business settings');
select tests.eq((select count(*) from public.product_costs), 0::bigint, 'manager: no cost prices without the right');
select tests.ok((public.shop_sales_summary('71000000-0000-0000-0000-000000000001', current_date)->'profit') = 'null'::jsonb, 'manager: no profit without the right');
select tests.refused($$ select public.delete_product('73000000-0000-0000-0000-000000000002') $$, 'manager: cannot delete products for good (only Stop selling)');
update public.products set active = false where id = '73000000-0000-0000-0000-000000000002';
select tests.ok(true, 'manager: can archive (Stop selling)');
select tests.refused($$ select * from public.register(current_date - 7, current_date) $$, 'manager: cannot export all the business''s data');
select tests.no_rows($$ update public.members set can_see_costs = true where id = '72000000-0000-0000-0000-000000000002' $$, 'manager: cannot give themselves rights');
reset role;
select tests.eq((select can_see_costs from public.members where id = '72000000-0000-0000-0000-000000000002'), false, '...the right is still off');
select tests.act_as('70000000-0000-0000-0000-000000000002');
reset role;

-- ══ OWNER switches on the optional rights ══
select tests.act_as('70000000-0000-0000-0000-000000000001');
update public.members set can_see_costs = true, can_manage_staff = true, can_delete_products = true where id = '72000000-0000-0000-0000-000000000002';
select tests.ok(true, 'owner: switches a manager''s optional rights on');
reset role;
select tests.act_as('70000000-0000-0000-0000-000000000002');
select tests.eq((select cost_price from public.product_costs), 2000.00, 'manager with the right: sees cost prices');
select tests.ok((public.shop_sales_summary('71000000-0000-0000-0000-000000000001', current_date)->>'profit') is not null, 'manager with the right: sees profit');
insert into public.members (company_id, full_name, phone, role, branch_id) values ((select id from co), 'New Staff', '+2348110000098', 'staff', '71000000-0000-0000-0000-000000000001');
select tests.ok(true, 'manager with the right: invites shop staff into their shop');
select tests.refused($$ insert into public.members (company_id, full_name, phone, role, branch_id) values ((select id from co), 'Other Staff', '+2348110000097', 'staff', '71000000-0000-0000-0000-000000000002') $$, 'manager with the right: still not into another shop');
select tests.refused($$ insert into public.members (company_id, full_name, phone, role) values ((select id from co), 'New Manager', '+2348110000099', 'admin') $$, 'manager with the right: still cannot invite managers');
update public.members set active = false where full_name = 'New Staff';
select tests.ok(true, 'manager with the right: removes shop staff of their shop');
select public.delete_product('73000000-0000-0000-0000-000000000002');
select tests.eq((select count(*) from public.products where id = '73000000-0000-0000-0000-000000000002'), 0::bigint, 'manager with the right: deletes a product that was never sold');
select tests.refused($$ select public.delete_product('73000000-0000-0000-0000-000000000001') $$, 'a product with sales can''t be deleted (Stop selling instead)');
reset role;

-- ══ OWNER: everything ══
select tests.act_as('70000000-0000-0000-0000-000000000001');
insert into public.branches (company_id, name, lat, lng) values ((select id from co), 'Ikeja shop', 6.6, 3.35);
select tests.ok(true, 'owner: adds shops');
select tests.ok(public.billing_overview() is not null, 'owner: billing');
select tests.ok((select count(*) >= 0 from public.register(current_date - 7, current_date)), 'owner: exports');
select tests.eq((select count(*) from public.sales), 4::bigint, 'owner: every shop''s sales');
-- Overview patterns: a manager sees only their shops' people.
reset role;
insert into public.attendance (id, company_id, member_id, kind, happened_at, local_date, lat, lng, late_minutes)
select gen_random_uuid(), (select id from co), '72000000-0000-0000-0000-000000000004', 'in', now() - (g || ' days')::interval, current_date - g, 6.5, 3.35, 30 from generate_series(1, 3) g;
select tests.act_as('70000000-0000-0000-0000-000000000001');
select tests.ok((public.owner_overview(current_date)->'repeat_late')::text like '%Tolu Surulere%', 'owner: sees "late 3 times" for every shop');
reset role;
select tests.act_as('70000000-0000-0000-0000-000000000002');
select tests.eq(public.owner_overview(current_date)->'repeat_late', '[]'::jsonb, 'manager: "late 3 times" only for their own shops');
reset role;

-- ══ FIELD SALES: unchanged ══
select tests.act_as('70000000-0000-0000-0000-000000000006');
insert into public.branches (company_id, name, lat, lng) values ((select id from fco), 'Ikeja office', 6.6, 3.35);
select tests.ok(true, 'Field sales manager: still adds offices');
insert into public.members (company_id, full_name, phone, role) values ((select id from fco), 'New Rep', '+2348110000096', 'rep');
select tests.ok(true, 'Field sales manager: still invites people');
select tests.ok((select count(*) >= 0 from public.register(current_date - 7, current_date)), 'Field sales manager: still exports the register');
reset role;

rollback;
\echo 'All roles and permissions database tests passed.'
