-- Business types: Field sales / Storefront / Both, shops, and managers who look after shops.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'owner.shop@example.com'),
  ('a0000000-0000-0000-0000-000000000002', '2348030000002@phone.usepinga.com'),   -- manager of shop 1
  ('a0000000-0000-0000-0000-000000000003', '2348030000003@phone.usepinga.com'),   -- shop 1 staff
  ('a0000000-0000-0000-0000-000000000004', '2348030000004@phone.usepinga.com'),   -- shop 2 staff
  ('f0000000-0000-0000-0000-000000000001', 'owner.field@example.com');

-- Sign-up with a type.
select tests.act_as('a0000000-0000-0000-0000-000000000001');
create temp table co as select public.create_company('Mama Put Stores', 'Ada Owner', 'storefront') as id;
grant all on co to public;
select tests.eq((select business_type from public.companies where id = (select id from co)), 'storefront', 'owner picks Storefront at sign-up');
select tests.refused($$ select public.create_company('X', 'Y', 'restaurant') $$, 'only Field sales, Storefront or Both');
reset role;
select tests.act_as('f0000000-0000-0000-0000-000000000001');
create temp table fco as select public.create_company('Field Co', 'Bola Owner') as id;
grant all on fco to public;
select tests.eq((select business_type from public.companies where id = (select id from fco)), 'field', 'existing sign-up (no type) is Field sales');
reset role;

-- Two shops, a manager for shop 1, staff in each shop.
insert into public.branches (id, company_id, name, lat, lng) values
  ('5b000000-0000-0000-0000-000000000001', (select id from co), 'Yaba shop', 6.5095, 3.3711),
  ('5b000000-0000-0000-0000-000000000002', (select id from co), 'Surulere shop', 6.50, 3.35);
insert into public.members (id, company_id, user_id, full_name, phone, role, branch_id, joined_at) values
  ('ea000000-0000-0000-0000-000000000002', (select id from co), 'a0000000-0000-0000-0000-000000000002', 'Ade Manager', '+2348030000002', 'admin', null, now()),
  ('ea000000-0000-0000-0000-000000000003', (select id from co), 'a0000000-0000-0000-0000-000000000003', 'Sade Yaba', '+2348030000003', 'staff', '5b000000-0000-0000-0000-000000000001', now()),
  ('ea000000-0000-0000-0000-000000000004', (select id from co), 'a0000000-0000-0000-0000-000000000004', 'Tolu Surulere', '+2348030000004', 'staff', '5b000000-0000-0000-0000-000000000002', now()),
  ('ea000000-0000-0000-0000-000000000005', (select id from co), null, 'New Starter', '+2348030000005', 'staff', null, null);

-- Storefront: no stores, reps or store visits.
select tests.act_as('a0000000-0000-0000-0000-000000000001');
select tests.refused($$ insert into public.stores (company_id, name) values ((select id from co), 'A store') $$, 'Storefront: no stores to visit');
select tests.refused($$ insert into public.members (company_id, full_name, phone, role) values ((select id from co), 'Rep', '+2348030000009', 'rep') $$, 'Storefront: no sales reps');
select tests.refused($$ update public.members set role = 'rep' where id = 'ea000000-0000-0000-0000-000000000005' $$, 'Storefront: cannot turn someone into a sales rep');

-- Owner assigns shop 1 to the manager.
insert into public.manager_shops (company_id, manager_id, branch_id) values ((select id from co), 'ea000000-0000-0000-0000-000000000002', '5b000000-0000-0000-0000-000000000001');
select tests.refused($$ insert into public.manager_shops (company_id, manager_id, branch_id) values ((select id from co), 'ea000000-0000-0000-0000-000000000003', '5b000000-0000-0000-0000-000000000002') $$, 'only managers can be given shops');
select tests.eq((select count(*) from public.members where company_id = (select id from co)), 5::bigint, 'owner sees everyone in every shop');
select tests.eq((select count(*) from public.day_board(current_date)), 3::bigint, 'owner''s Today shows all shop staff');
reset role;

-- The manager of shop 1.
select tests.act_as('a0000000-0000-0000-0000-000000000002');
select tests.eq((select array_agg(full_name order by full_name) from public.members), array['Ada Owner', 'Ade Manager', 'New Starter', 'Sade Yaba'], 'manager sees their shop''s staff and people not yet in a shop, not the other shop');
select tests.eq((select array_agg(full_name order by full_name) from public.day_board(current_date)), array['New Starter', 'Sade Yaba'], 'manager''s Today shows only their shop (and unassigned staff)');
select tests.no_rows($$ update public.members set full_name = 'x' where id = 'ea000000-0000-0000-0000-000000000004' $$, 'manager cannot edit staff of another shop');
select tests.refused($$ select public.renew_invite('ea000000-0000-0000-0000-000000000004') $$, 'manager cannot send a PIN link to another shop''s staff');
select tests.refused($$ insert into public.manager_shops (company_id, manager_id, branch_id) values ((select id from co), 'ea000000-0000-0000-0000-000000000002', '5b000000-0000-0000-0000-000000000002') $$, 'managers cannot give themselves more shops');
select tests.eq((select count(*) from public.manager_shops), 1::bigint, 'manager can see which shops they look after');
select tests.refused($$ select public.set_business_type('field') $$, 'only the owner can change the business type');
reset role;

-- Shop staff see only themselves (as before).
select tests.act_as('a0000000-0000-0000-0000-000000000003');
select tests.eq((select count(*) from public.members), 1::bigint, 'shop staff see only themselves');
select tests.eq((select count(*) from public.manager_shops), 0::bigint, 'shop staff cannot see manager assignments');
reset role;

-- Changing the type hides features but deletes nothing.
select tests.act_as('a0000000-0000-0000-0000-000000000001');
select public.set_business_type('both');
insert into public.stores (id, company_id, name, lat, lng) values ('5c000000-0000-0000-0000-000000000001', (select id from co), 'Partner store', 6.6, 3.35);
select tests.eq((select count(*) from public.stores), 1::bigint, 'Both: stores allowed');
update public.branches set kind = 'office' where id = '5b000000-0000-0000-0000-000000000002';
reset role;
select tests.act_as('a0000000-0000-0000-0000-000000000002');
select tests.ok((select count(*) = 2 from public.day_board(current_date) where full_name in ('Sade Yaba', 'Tolu Surulere')), 'Both: once Surulere is an office, its staff are visible to every manager');
reset role;
select tests.act_as('a0000000-0000-0000-0000-000000000001');
select public.set_business_type('storefront');
select tests.eq((select count(*) from public.stores), 1::bigint, 'switching back keeps the data (nothing deleted)');
reset role;

-- Field sales company: everything as before; no shops, so managers see everyone.
insert into public.branches (company_id, name, lat, lng) values ((select id from fco), 'Head office', 6.5, 3.37);
insert into public.members (company_id, full_name, phone, role, joined_at) values ((select id from fco), 'Field Rep', '+2348040000001', 'rep', now());
select tests.act_as('f0000000-0000-0000-0000-000000000001');
select tests.ok((select count(*) = 1 from public.day_board(current_date)), 'Field sales: reps listed as before');
insert into public.stores (company_id, name, lat, lng) values ((select id from fco), 'Shoprite', 6.6, 3.35);
select tests.eq((select count(*) from public.stores), 1::bigint, 'Field sales: stores allowed');
reset role;

-- Server job (evening email) sees everyone.
select tests.act_as_server();
select tests.eq((public.summary_content((select id from co), current_date)->>'people')::int, 3, 'evening email covers staff in every shop');
reset role;

-- Offices never count as shops, whatever the business type.
select tests.act_as('a0000000-0000-0000-0000-000000000001');
select public.set_business_type('storefront');
insert into public.branches (id, company_id, name, kind, lat, lng) values ('5b000000-0000-0000-0000-000000000009', (select id from co), 'Head office', 'office', 6.5, 3.37);
insert into public.branches (id, company_id, name, lat, lng) values ('5b000000-0000-0000-0000-000000000010', (select id from co), 'New shop', 6.51, 3.37);
reset role;
select tests.eq(private.branch_is_shop('5b000000-0000-0000-0000-000000000009'), false, 'Storefront: a location marked office is not a shop (no sales, stock or till there)');
select tests.eq((select kind from public.branches where id = '5b000000-0000-0000-0000-000000000010'), 'shop', 'Storefront: a new location is a shop unless marked otherwise');
select tests.eq((select kind from public.branches where company_id = (select id from fco) limit 1), 'office', 'Field sales: a new location is an office');
select tests.act_as('a0000000-0000-0000-0000-000000000001');
select tests.refused($$ select public.import_stock('5b000000-0000-0000-0000-000000000009', 'count', 'x.csv', '[{"name": "Milo", "qty": 1}]') $$, 'no stock in an office');
select tests.eq((public.setup_progress()->>'first_sale')::boolean, false, 'Get started knows whether anything has been sold yet');
reset role;

rollback;
\echo 'All business type database tests passed.'
