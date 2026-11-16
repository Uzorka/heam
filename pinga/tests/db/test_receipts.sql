-- Logos and receipts: numbers per shop (never reused), the public receipt link, payment methods, who may change the logo.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;

insert into auth.users (id, email) values
  ('e0000000-0000-0000-0000-000000000001', 'owner.r@example.com'),
  ('e0000000-0000-0000-0000-000000000002', '2348100000002@phone.usepinga.com'),   -- Yaba staff
  ('e0000000-0000-0000-0000-000000000003', '2348100000003@phone.usepinga.com'),   -- manager
  ('e0000000-0000-0000-0000-000000000004', 'owner.other.r@example.com');

select tests.act_as('e0000000-0000-0000-0000-000000000001');
create temp table co as select public.create_company('Mama Put Stores', 'Ada Owner', 'storefront') as id;
grant all on co to public;
reset role;
-- These tests are about selling itself: the owner's till rules (clock in first; nothing below the lowest price) are off here, tested in test_roles.sql.
update public.companies set sell_requires_clock_in = false, staff_below_lowest = true where id = (select id from co);
select tests.act_as('e0000000-0000-0000-0000-000000000004');
create temp table oco as select public.create_company('Other', 'Chi Owner', 'storefront') as id;
grant all on oco to public;
reset role;

select tests.act_as('e0000000-0000-0000-0000-000000000001');
insert into public.branches (id, company_id, name, address, phone, lat, lng) values
  ('51000000-0000-0000-0000-000000000001', (select id from co), 'Yaba shop', '12 Herbert Macaulay Way', '0803 000 0001', 6.5095, 3.3711),
  ('51000000-0000-0000-0000-000000000002', (select id from co), 'Yaba Annex', null, null, 6.51, 3.37),
  ('51000000-0000-0000-0000-000000000003', (select id from co), '#1', null, null, 6.52, 3.37);
reset role;
select tests.eq((select array_agg(prefix order by prefix) from private.receipt_counters where company_id = (select id from co)), array['SHP', 'YAB', 'YAB2'], 'each shop gets its own receipt prefix (YAB, YAB2; SHP when the name has no letters)');

insert into public.members (id, company_id, user_id, full_name, phone, role, branch_id, joined_at) values
  ('e1000000-0000-0000-0000-000000000002', (select id from co), 'e0000000-0000-0000-0000-000000000002', 'Kemi Adebayo', '+2348100000002', 'staff', '51000000-0000-0000-0000-000000000001', now()),
  ('e1000000-0000-0000-0000-000000000003', (select id from co), 'e0000000-0000-0000-0000-000000000003', 'Ade Manager', '+2348100000003', 'admin', null, now());
insert into public.manager_shops (company_id, manager_id, branch_id) values ((select id from co), 'e1000000-0000-0000-0000-000000000003', '51000000-0000-0000-0000-000000000001');

select tests.act_as('e0000000-0000-0000-0000-000000000001');
insert into public.products (id, company_id, name, price, lowest_price) values
  ('91000000-0000-0000-0000-000000000001', (select id from co), 'Peak Milk 400g', 2500, 2300);
update public.companies set receipt_note = 'Thank you! Come again.', logo_path = (select id from co)::text || '/logo-abc.png' where id = (select id from co);
select tests.refused($$ update public.companies set logo_path = 'someone-else/logo.png' where id = (select id from co) $$, 'a logo must be in the business''s own folder');
reset role;

-- ── Sales get numbers in order, per shop ──
select tests.act_as('e0000000-0000-0000-0000-000000000002');
select tests.eq((public.record_sale('5b100000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', now(),
  '[{"product_id": "91000000-0000-0000-0000-000000000001", "qty": 2, "unit_price": 2400}]', now(), 'transfer', 'tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1')).receipt_code, 'YAB-000001', 'first receipt in Yaba shop: YAB-000001');
select tests.eq((public.record_sale('5b100000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-000000000001', now(),
  '[{"product_id": "91000000-0000-0000-0000-000000000001", "qty": 1, "unit_price": 2500}]', now(), 'card', 'tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2')).receipt_code, 'YAB-000002', 'next one: YAB-000002');
select tests.eq((public.record_sale('5b100000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', now(),
  '[{"product_id": "91000000-0000-0000-0000-000000000001", "qty": 2, "unit_price": 2400}]', now(), 'transfer', 'tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1')).receipt_code, 'YAB-000001', 'sending the same sale again keeps its number (no gap, no double)');
-- An older app (no payment method or link) still works.
select tests.eq((select payment_method || ' ' || receipt_code || ' ' || (length(receipt_token) >= 20)::text
  from public.record_sale('5b100000-0000-0000-0000-000000000003', '51000000-0000-0000-0000-000000000001', now(),
  '[{"product_id": "91000000-0000-0000-0000-000000000001", "qty": 1, "unit_price": 2500}]', now())), 'cash YAB-000003 true', 'a sale from the older app: cash, next number, a link made by the server');
select tests.refused($$ select public.record_sale(gen_random_uuid(), '51000000-0000-0000-0000-000000000001', now(), '[{"product_id": "91000000-0000-0000-0000-000000000001", "qty": 1, "unit_price": 1}]', now(), 'cheque', null) $$, 'payment must be cash, transfer or POS card');
select tests.refused($$ select public.record_sale(gen_random_uuid(), '51000000-0000-0000-0000-000000000001', now(), '[{"product_id": "91000000-0000-0000-0000-000000000001", "qty": 1, "unit_price": 1}]', now(), 'cash', 'short') $$, 'a guessable receipt link is refused');
select tests.no_rows($$ update public.companies set logo_path = null $$, 'staff cannot change the logo');
reset role;

-- ── The receipt link: anyone with it, no sign-in ──
select tests.act_as(null);
create temp table r as select public.receipt('tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1') as j;
select tests.eq((select j->>'number' from r), 'YAB-000001', 'receipt opens without signing in');
select tests.eq((select j->>'business' || ' · ' || (j->>'shop') || ' · ' || (j->>'address') || ' · ' || (j->>'phone') from r), 'Mama Put Stores · Yaba shop · 12 Herbert Macaulay Way · 0803 000 0001', '...with the business, shop, address and phone');
select tests.eq((select (j->>'served_by') || ' · ' || (j->>'payment') || ' · ' || (j->>'total') || ' · ' || (j->>'discount') from r), 'Kemi · transfer · 4800.00 · 200.00', '...first name of the staff member, payment method, total and discount');
select tests.eq((select j->'items'->0->>'name' || ' ' || (j->'items'->0->>'qty') || ' × ' || (j->'items'->0->>'price') from r), 'Peak Milk 400g 2 × 2400.00', '...and the items');
select tests.eq((select j->>'note' from r), 'Thank you! Come again.', '...and the owner''s thank-you note');
select tests.ok((select (j->>'logo_path') like '%/logo-abc.png' from r), '...and the logo');
select tests.eq((select (j->>'cancelled')::boolean from r), false, 'not cancelled');
select tests.eq((select j->>'paper' from r), '80', 'receipts print on 80 mm paper unless the shop says otherwise');
select tests.eq(public.receipt('tok_doesnotexistdoesnotexist00'), null::jsonb, 'an unknown link shows nothing');
select tests.eq(public.receipt('x'), null::jsonb, 'a short link shows nothing');
select tests.refused($$ select count(*) from public.sales $$, 'the link gives no other access (no sales list)');
reset role;

-- A shop logo replaces the business logo on that shop's receipts.
select tests.act_as('e0000000-0000-0000-0000-000000000001');
update public.branches set logo_path = (select id from co)::text || '/shop-yaba.png' where id = '51000000-0000-0000-0000-000000000001';
reset role;
select tests.ok((public.receipt('tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1')->>'logo_path') like '%/shop-yaba.png', 'a shop''s own logo is used on its receipts');

select tests.act_as('e0000000-0000-0000-0000-000000000001');
update public.branches set receipt_paper = '58' where id = '51000000-0000-0000-0000-000000000001';
select tests.refused($$ update public.branches set receipt_paper = 'a3' where id = '51000000-0000-0000-0000-000000000001' $$, 'paper is 58 mm, 80 mm or A4');
reset role;
select tests.eq(public.receipt('tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1')->>'paper', '58', 'the shop''s paper size comes with its receipts');

-- ── Cancelled: the link says so; numbers are never reused ──
select tests.act_as('e0000000-0000-0000-0000-000000000003');
select tests.refused($$ update public.branches set logo_path = null where id = '51000000-0000-0000-0000-000000000001' $$, 'managers cannot change a shop logo');
select tests.no_rows($$ update public.companies set receipt_note = 'x' $$, 'managers cannot change the receipt note');
select public.cancel_sale('5b100000-0000-0000-0000-000000000002', 'Customer changed their mind');
reset role;
select tests.eq((public.receipt('tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2')->>'cancelled')::boolean, true, 'a cancelled sale''s receipt says cancelled');
select tests.act_as('e0000000-0000-0000-0000-000000000002');
select tests.eq((public.record_sale(gen_random_uuid(), '51000000-0000-0000-0000-000000000001', now(),
  '[{"product_id": "91000000-0000-0000-0000-000000000001", "qty": 1, "unit_price": 2500}]', now(), 'cash', null)).receipt_code, 'YAB-000004', 'after a cancellation the next number is still new (YAB-000004)');
select tests.refused($$ select * from private.receipt_counters $$, 'nobody can read or reset the receipt counter');
reset role;
select tests.act_as('e0000000-0000-0000-0000-000000000001');
select tests.refused($$ update private.receipt_counters set last_no = 0 $$, 'not even the owner can reset receipt numbers');

-- Totals per payment method.
select tests.eq((select array[(m->>'cash')::numeric, (m->>'card')::numeric, (m->>'transfer')::numeric] from (select public.shops_overview((now() at time zone 'Africa/Lagos')::date)->'by_method' m) x), array[5000, 0, 4800]::numeric[], 'dashboard: totals per payment method (cancelled card sale left out)');
reset role;
select tests.act_as_server();
select tests.eq((select (public.summary_content((select id from co), (now() at time zone 'Africa/Lagos')::date)->'shops'->'by_method'->>'transfer')::numeric), 4800::numeric, 'evening email: totals per payment method');
select tests.ok((select (public.summary_content((select id from co), current_date)->>'logo_path') like '%/logo-abc.png'), 'evening email: the business logo');
reset role;

-- ── Logo files: only the owner, only into their own folder ──
insert into storage.buckets (id, name, public) values ('logos', 'logos', true) on conflict do nothing;
select tests.act_as('e0000000-0000-0000-0000-000000000001');
insert into storage.objects (bucket_id, name) values ('logos', (select id from co)::text || '/logo-new.png');
select tests.ok(true, 'owner uploads a logo into their business''s folder');
select tests.refused($$ insert into storage.objects (bucket_id, name) values ('logos', (select id from oco)::text || '/logo.png') $$, 'owner cannot upload into another business''s folder');
reset role;
select tests.act_as('e0000000-0000-0000-0000-000000000003');
select tests.refused($$ insert into storage.objects (bucket_id, name) values ('logos', (select id from co)::text || '/logo-mgr.png') $$, 'a manager cannot upload logos');
reset role;
select tests.act_as('e0000000-0000-0000-0000-000000000002');
select tests.refused($$ insert into storage.objects (bucket_id, name) values ('logos', (select id from co)::text || '/x.png') $$, 'staff cannot upload logos');
reset role;

rollback;
\echo 'All logo and receipt database tests passed.'
