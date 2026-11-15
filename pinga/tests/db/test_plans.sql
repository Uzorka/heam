-- Plans: Starter and Business, the trial, Starter's limits, moving between plans, the setup wizard,
-- and the promise that nobody pays more on Business than on Starter for the same set-up.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;

insert into auth.users (id, email) values
  ('a7000000-0000-0000-0000-000000000001', 'starter.owner@example.com'),
  ('a7000000-0000-0000-0000-000000000002', '2348130000002@phone.usepinga.com'),
  ('a7000000-0000-0000-0000-000000000003', 'business.owner@example.com');

-- ── The landing page reads the plans without signing in ──
select tests.act_as(null);
select tests.eq((public.plans()->>'trial_days')::int, 30, 'landing page: first month free (30 days, from the settings)');
select tests.eq((public.plans()->'starter'->>'price')::int || ' ' || (public.plans()->'starter'->>'staff') || ' ' || (public.plans()->'starter'->>'locations'), '5000 5 1', 'landing page: Starter ₦5,000 for 1 location and up to 5 staff');
select tests.eq((public.plans()->'business'->>'shop')::int || ' ' || (public.plans()->'business'->>'shop_staff') || ' ' || (public.plans()->'business'->>'extra_staff') || ' ' || (public.plans()->'business'->>'office_staff') || ' ' || (public.plans()->'business'->>'rep'),
  '5000 5 1000 1500 2500', 'landing page: Business ₦5,000 a shop with 5 staff, ₦1,000 extra staff, ₦1,500 office staff, ₦2,500 a rep');
select tests.refused($$ select public.create_company('X', 'Y', 'storefront', 'starter', null) $$, 'a visitor cannot create a business without signing up');
select tests.refused($$ select * from public.billing_settings $$, 'the settings are not readable by visitors');
reset role;

-- ── Sign-up creates the business on the chosen plan, with the trial from the settings ──
select tests.act_as('a7000000-0000-0000-0000-000000000001');
create temp table co as select public.create_company('Mama Put Stores', 'Ada Owner', 'storefront', 'starter', '0803 000 1111') as id;
grant all on co to public;
select tests.eq((select plan || ' ' || setup_done::text || ' ' || setup_step || ' ' || phone from public.companies where id = (select id from co)), 'starter false 3 0803 000 1111', 'new business: Starter, wizard not done, on step 3 (type and details already given), phone kept');
select tests.eq((select (trial_ends_at at time zone 'Africa/Lagos')::date - (now() at time zone 'Africa/Lagos')::date from public.companies where id = (select id from co)), 30, 'the free trial lasts 30 days');
select tests.refused_saying($$ select public.create_company('X', 'Y', 'storefront', 'premium', null) $$, 'Starter or Business', 'Premium is not sold yet');
select public.save_setup(4, false);
select tests.eq((select setup_step from public.companies where id = (select id from co)), 4, 'the wizard saves the step the owner got to');
select public.save_setup(6, true);
select public.save_setup(5, false);
select tests.eq((select setup_done from public.companies where id = (select id from co)), true, 'once done, the wizard stays done');
update public.companies set address = '12 Herbert Macaulay Way', phone = '0803 000 2222' where id = (select id from co);
select tests.eq((select address from public.companies where id = (select id from co)), '12 Herbert Macaulay Way', 'the owner saves the business address');
reset role;

-- The trial length is set in one place.
update public.billing_settings set trial_days = 14;
select tests.act_as('a7000000-0000-0000-0000-000000000003');
create temp table bco as select public.create_company('Big Stores', 'Bola Owner', 'both', 'business', null) as id;
grant all on bco to public;
select tests.eq((select (trial_ends_at at time zone 'Africa/Lagos')::date - (now() at time zone 'Africa/Lagos')::date from public.companies where id = (select id from bco)), 14, 'changing the setting changes the trial for new businesses');
reset role;
update public.billing_settings set trial_days = 30;

-- ── Starter limits (the database refuses, whichever way the change comes) ──
select tests.act_as('a7000000-0000-0000-0000-000000000001');
insert into public.branches (id, company_id, name, lat, lng) values ('a7100000-0000-0000-0000-000000000001', (select id from co), 'Yaba shop', 6.5095, 3.3711);
select tests.refused_saying($$ insert into public.branches (company_id, name, lat, lng) values ((select id from co), 'Second shop', 6.5, 3.3) $$, 'Starter includes 1 shop or office', 'Starter: a second shop is refused');
select tests.refused_saying($$ insert into public.members (company_id, full_name, phone, role) values ((select id from co), 'Ade Manager', '+2348130000009', 'admin') $$, 'Managers come with the Business plan', 'Starter: no managers');
select tests.refused_saying($$ insert into public.members (company_id, full_name, phone, role) values ((select id from co), 'Rep', '+2348130000008', 'rep') $$, 'Sales reps come with the Business plan', 'Starter: no sales reps');
insert into public.members (company_id, full_name, phone, role, branch_id)
  select (select id from co), 'Staff ' || i, '+23481300001' || lpad(i::text, 2, '0'), 'staff', 'a7100000-0000-0000-0000-000000000001' from generate_series(1, 5) i;
select tests.refused_saying($$ insert into public.members (company_id, full_name, phone, role) values ((select id from co), 'Staff 6', '+2348130000199', 'staff') $$, 'Starter includes up to 5 staff', 'Starter: a 6th staff member is refused');
update public.members set active = false where full_name = 'Staff 5' and company_id = (select id from co);
insert into public.members (company_id, full_name, phone, role) values ((select id from co), 'Staff 6', '+2348130000199', 'staff');
select tests.ok(true, 'Starter: after someone leaves, a new person can join');
select tests.refused_saying($$ update public.members set active = true where full_name = 'Staff 5' and company_id = (select id from co) $$, 'up to 5 staff', 'Starter: bringing someone back counts too');
select tests.refused_saying($$ insert into public.stores (company_id, name) values ((select id from co), 'Shoprite') $$, 'Business plan', 'Starter: no stores to visit');
select tests.refused_saying($$ select public.import_stock('a7100000-0000-0000-0000-000000000001', 'count', 'stock.xlsx', '[{"name": "Peak Milk", "qty": 10, "price": 2500}]') $$, 'Excel stock imports come with the Business plan', 'Starter: no Excel import');
select tests.refused_saying($$ select * from public.register(current_date - 7, current_date) $$, 'Excel export comes with the Business plan', 'Starter: no Excel export');
insert into public.products (company_id, name, price) values ((select id from co), 'Peak Milk 400g', 2500);
select tests.ok(true, 'Starter: products can still be added by hand');
reset role;

-- ── Starter price: flat, once someone has joined ──
select tests.eq((private.billing_quote((select id from co))->>'amount_kobo')::bigint, 0::bigint, 'Starter: nothing to pay before anyone joins');
update public.members set joined_at = now() where company_id = (select id from co) and role = 'staff' and active;
select tests.eq((private.billing_quote((select id from co))->>'amount_kobo')::bigint, 500000::bigint, 'Starter: ₦5,000 a month for the shop and its 5 staff');

-- ── Moving between plans ──
select tests.act_as('a7000000-0000-0000-0000-000000000001');
select public.set_plan('business');
insert into public.branches (company_id, name, lat, lng) values ((select id from co), 'Second shop', 6.5, 3.3);
select tests.ok(true, 'Business: a second shop is fine');
select tests.refused_saying($$ select public.set_plan('starter') $$, 'more than 1 shop or office', 'cannot move down to Starter with 2 shops (and it says why)');
delete from public.branches where name = 'Second shop' and company_id = (select id from co);
select public.set_plan('starter');
select tests.eq((select plan from public.companies where id = (select id from co)), 'starter', 'back to Starter once it fits');
reset role;
select tests.act_as('a7000000-0000-0000-0000-000000000002');
select tests.refused($$ select public.set_plan('business') $$, 'only the owner changes the plan');
select tests.refused($$ select public.save_setup(6, true) $$, 'only the owner saves the wizard');
reset role;
select tests.act_as('a7000000-0000-0000-0000-000000000001');
select tests.refused($$ update public.companies set plan = 'business' where id = (select id from co) $$, 'the plan cannot be changed by editing the business directly');
select tests.refused($$ update public.companies set setup_done = true, trial_ends_at = now() + interval '1 year' where id = (select id from co) $$, 'nor the trial');
reset role;

-- ── Business never costs more than Starter for the same set-up ──
-- Every set-up that fits Starter: each business type, a shop or an office, 0 to 5 people who have joined.
do $$
declare
  t text; k text; n int; v_co uuid; v_b uuid; v_starter bigint; v_business bigint; v_checked int := 0;
begin
  foreach t in array array['storefront', 'field', 'both'] loop
    foreach k in array array['shop', 'office'] loop
      for n in 0..5 loop
        insert into public.companies (name, business_type, plan) values (format('Fit %s %s %s', t, k, n), t, 'business') returning id into v_co;
        insert into public.branches (company_id, name, kind, lat, lng) values (v_co, 'Only place', case when t = 'storefront' then 'shop' when t = 'field' then 'office' else k end, 6.5, 3.3) returning id into v_b;
        insert into public.members (company_id, full_name, phone, role, branch_id, joined_at)
          select v_co, 'P' || i, '+2348140' || lpad(i::text, 6, '0'), 'staff', v_b, now() from generate_series(1, n) i;
        -- and a manager-free, rep-free set-up with someone not yet given a place
        v_business := (private.billing_quote(v_co)->>'amount_kobo')::bigint;
        update public.companies set plan = 'starter' where id = v_co;
        v_starter := (private.billing_quote(v_co)->>'amount_kobo')::bigint;
        if v_business > v_starter then
          raise exception 'FAIL: Business costs more than Starter (% vs % kobo) for %, a %, % people', v_business, v_starter, t, k, n;
        end if;
        v_checked := v_checked + 1;
      end loop;
    end loop;
  end loop;
  raise notice 'ok - Business never costs more than Starter: % set-ups checked', v_checked;
end $$;
-- The example that needs the cap: one office with 5 office staff would be 5 × ₦1,500 = ₦7,500 on Business.
insert into public.companies (id, name, business_type, plan) values ('a7200000-0000-0000-0000-000000000001', 'Office Co', 'field', 'business');
insert into public.branches (id, company_id, name, lat, lng) values ('a7200000-0000-0000-0000-000000000002', 'a7200000-0000-0000-0000-000000000001', 'Head office', 6.5, 3.3);
insert into public.members (company_id, full_name, phone, role, branch_id, joined_at)
  select 'a7200000-0000-0000-0000-000000000001', 'O' || i, '+2348150' || lpad(i::text, 6, '0'), 'staff', 'a7200000-0000-0000-0000-000000000002', now() from generate_series(1, 5) i;
select tests.eq((private.billing_quote('a7200000-0000-0000-0000-000000000001')->>'amount_kobo')::bigint || ' ' || (private.billing_quote('a7200000-0000-0000-0000-000000000001')->>'capped'),
  '500000 true', 'one office with 5 staff on Business: ₦5,000 (capped at the Starter price), not ₦7,500');
-- One more person and it no longer fits Starter: the normal Business price.
insert into public.members (company_id, full_name, phone, role, branch_id, joined_at) values ('a7200000-0000-0000-0000-000000000001', 'O6', '+2348150000006', 'staff', 'a7200000-0000-0000-0000-000000000002', now());
select tests.eq((private.billing_quote('a7200000-0000-0000-0000-000000000001')->>'amount_kobo')::bigint, 900000::bigint, '6 office staff (more than Starter allows): 6 × ₦1,500 = ₦9,000');
-- A shop with its 5 staff costs the same on both plans.
select tests.eq((private.billing_quote((select id from co))->>'amount_kobo')::bigint, 500000::bigint, 'a shop with 5 staff: ₦5,000 on Starter...');
update public.companies set plan = 'business' where id = (select id from co);
select tests.eq((private.billing_quote((select id from co))->>'amount_kobo')::bigint, 500000::bigint, '...and ₦5,000 on Business');

-- ── Existing businesses ──
select tests.eq((select plan || ' ' || setup_done::text from public.companies where id = 'a7200000-0000-0000-0000-000000000001'), 'business true', 'businesses made without the wizard count as set up, on Business');

-- ── The billing page shows the plan ──
select tests.act_as('a7000000-0000-0000-0000-000000000001');
select tests.eq((select public.billing_overview()->>'plan'), 'business', 'the billing page shows the plan');
select tests.eq((select jsonb_array_length(public.billing_overview()->'starter_blockers')), 0, '...and whether the business fits Starter');
reset role;

rollback;
\echo 'All plan and sign-up database tests passed.'
