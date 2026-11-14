-- Foundation rules: company isolation, roles, invites.
-- Runs in one transaction that is rolled back, so it leaves nothing behind.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;

-- ── People ──────────────────────────────────────────────────────
-- Company A: owner, admin, office staff, sales rep.  Company B: owner, rep.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'owner.a@example.com'),
  ('a0000000-0000-0000-0000-000000000002', '2348030000002@phone.usepinga.com'),
  ('a0000000-0000-0000-0000-000000000003', '2348030000003@phone.usepinga.com'),
  ('a0000000-0000-0000-0000-000000000004', '2348030000004@phone.usepinga.com'),
  ('b0000000-0000-0000-0000-000000000001', 'owner.b@example.com'),
  ('b0000000-0000-0000-0000-000000000004', '2348050000004@phone.usepinga.com'),
  ('c0000000-0000-0000-0000-000000000000', 'elvis@example.com'),
  ('d0000000-0000-0000-0000-000000000000', 'stranger@example.com');
insert into public.platform_admins values ('c0000000-0000-0000-0000-000000000000');

-- Owners create their companies the real way.
create temp table ids (a uuid, b uuid);
grant all on ids to public;
insert into ids values (null, null);
select tests.act_as('a0000000-0000-0000-0000-000000000001');
update ids set a = public.create_company('CHF Heron', 'Ada Owner');
reset role;
select tests.act_as('b0000000-0000-0000-0000-000000000001');
update ids set b = public.create_company('Other Co', 'Bola Owner');
reset role;

-- Seed the rest directly (as the database superuser).
insert into public.branches (company_id, name, lat, lng)
  select a, 'Yaba', 6.5095, 3.3711 from ids union all
  select b, 'B HQ', 6.6, 3.3 from ids;
insert into public.stores (id, company_id, name, lat, lng) values
  ('5a000000-0000-0000-0000-000000000001', (select a from ids), 'Shoprite Ikeja', 6.6, 3.35),
  ('5a000000-0000-0000-0000-000000000002', (select a from ids), 'Spar Lekki', 6.44, 3.47),
  ('5b000000-0000-0000-0000-000000000001', (select b from ids), 'B Store', 6.5, 3.3);
insert into public.members (id, company_id, user_id, full_name, phone, role, joined_at) values
  ('ea000000-0000-0000-0000-000000000002', (select a from ids), 'a0000000-0000-0000-0000-000000000002', 'Ade Admin', '+2348030000002', 'admin', now()),
  ('ea000000-0000-0000-0000-000000000003', (select a from ids), 'a0000000-0000-0000-0000-000000000003', 'Sade Staff', '+2348030000003', 'staff', now()),
  ('ea000000-0000-0000-0000-000000000004', (select a from ids), 'a0000000-0000-0000-0000-000000000004', 'Remi Rep', '+2348030000004', 'rep', now()),
  ('eb000000-0000-0000-0000-000000000004', (select b from ids), 'b0000000-0000-0000-0000-000000000004', 'Bayo Rep', '+2348050000004', 'rep', now());
insert into public.store_assignments (company_id, member_id, store_id) values
  ((select a from ids), 'ea000000-0000-0000-0000-000000000004', '5a000000-0000-0000-0000-000000000001'),
  ((select b from ids), 'eb000000-0000-0000-0000-000000000004', '5b000000-0000-0000-0000-000000000001');

-- ── The database itself refuses mixed-company links ──────────────
select tests.refused($$
  insert into public.store_assignments (company_id, member_id, store_id)
  values ((select a from ids), 'ea000000-0000-0000-0000-000000000004', '5b000000-0000-0000-0000-000000000001')
$$, 'cannot assign a store from another company');
select tests.refused($$
  insert into public.members (company_id, full_name, role) values ((select a from ids), 'No Phone', 'staff')
$$, 'invited staff must have a phone number');
select tests.refused($$
  insert into public.members (company_id, full_name, phone, role) values ((select a from ids), 'Bad', '08031234567', 'staff')
$$, 'phone must be in international format');

-- ── Owner A ─────────────────────────────────────────────────────
select tests.act_as('a0000000-0000-0000-0000-000000000001');
select tests.eq((select count(*) from public.companies), 1::bigint, 'owner sees only their own company');
select tests.eq((select count(*) from public.members), 4::bigint, 'owner sees all 4 people in their company');
select tests.eq((select count(*) from public.stores), 2::bigint, 'owner sees all their stores, none from B');
select tests.eq((select count(*) from public.members where company_id = (select b from ids)), 0::bigint, 'owner cannot see company B people');
select tests.no_rows($$ update public.stores set name = 'hacked' where company_id = (select b from ids) $$, 'owner cannot edit company B stores');
select tests.refused($$ insert into public.stores (company_id, name, lat, lng) values ((select b from ids), 'x', 0, 0) $$, 'owner cannot add a store to company B');
select tests.refused($$ insert into public.members (company_id, full_name, phone, role) values ((select b from ids), 'Spy', '+2348039999999', 'admin') $$, 'owner cannot add people to company B');
select tests.refused($$ update public.companies set status = 'active' $$, 'owner cannot change their own billing status');
select tests.refused($$ update public.companies set trial_ends_at = now() + interval '10 years' $$, 'owner cannot extend their own trial');
update public.companies set work_starts = '09:00';
select tests.eq((select work_starts from public.companies), '09:00'::time, 'owner can change working hours');
select tests.refused($$ update public.members set role = 'staff' where role = 'owner' $$, 'the only owner cannot step down');
reset role;

-- ── Admin A ─────────────────────────────────────────────────────
select tests.act_as('a0000000-0000-0000-0000-000000000002');
insert into public.members (company_id, full_name, phone, role) values ((select a from ids), 'New Person', '+2348030000009', 'staff');
select tests.ok((select invite_token is not null from public.members where phone = '+2348030000009'), 'admin can invite; an invite link is created');
select tests.refused($$ insert into public.members (company_id, full_name, phone, role) values ((select a from ids), 'Boss', '+2348030000010', 'owner') $$, 'admin cannot create an owner');
select tests.no_rows($$ update public.members set active = false where role = 'owner' $$, 'admin cannot deactivate the owner');
select tests.refused($$ update public.members set role = 'owner' where id = 'ea000000-0000-0000-0000-000000000002' $$, 'admin cannot promote themselves to owner');
select tests.refused($$ update public.members set user_id = 'd0000000-0000-0000-0000-000000000000' where id = 'ea000000-0000-0000-0000-000000000003' $$, 'admin cannot link a login to a person directly');
select tests.refused($$ delete from public.members where id = 'ea000000-0000-0000-0000-000000000003' $$, 'people are deactivated, never deleted');
insert into public.store_assignments (company_id, member_id, store_id)
  values ((select a from ids), 'ea000000-0000-0000-0000-000000000004', '5a000000-0000-0000-0000-000000000002');
select tests.eq((select count(*) from public.store_assignments where member_id = 'ea000000-0000-0000-0000-000000000004'), 2::bigint, 'admin can assign stores to a rep');
select tests.ok(public.renew_invite('ea000000-0000-0000-0000-000000000003') is not null, 'admin can create a PIN reset link for staff');
select tests.refused($$ select public.renew_invite('eb000000-0000-0000-0000-000000000004') $$, 'admin cannot create a PIN reset link for company B');
reset role;

-- ── Office staff A ──────────────────────────────────────────────
select tests.act_as('a0000000-0000-0000-0000-000000000003');
select tests.eq((select count(*) from public.members), 1::bigint, 'staff see only themselves');
select tests.eq((select count(*) from public.branches), 1::bigint, 'staff see their company branches (to clock in)');
select tests.eq((select count(*) from public.stores), 0::bigint, 'office staff see no stores');
select tests.no_rows($$ update public.members set full_name = 'x' $$, 'staff cannot edit people');
select tests.refused($$ insert into public.branches (company_id, name, lat, lng) values ((select a from ids), 'x', 0, 0) $$, 'staff cannot add branches');
select tests.no_rows($$ update public.companies set work_starts = '11:00' $$, 'staff cannot change working hours');
select tests.refused($$ select public.renew_invite('ea000000-0000-0000-0000-000000000004') $$, 'staff cannot create invite links');
reset role;

-- ── Sales rep A ─────────────────────────────────────────────────
select tests.act_as('a0000000-0000-0000-0000-000000000004');
select tests.eq((select count(*) from public.stores), 2::bigint, 'rep sees only their assigned stores');
select tests.eq((select count(*) from public.store_assignments), 2::bigint, 'rep sees only their own assignments');
select tests.refused($$ insert into public.store_assignments (company_id, member_id, store_id) values ((select a from ids), 'ea000000-0000-0000-0000-000000000004', '5a000000-0000-0000-0000-000000000001') $$, 'rep cannot assign stores to themselves');
reset role;

-- ── Sales rep B ─────────────────────────────────────────────────
select tests.act_as('b0000000-0000-0000-0000-000000000004');
select tests.eq((select count(*) from public.stores), 1::bigint, 'rep in B sees only B store');
select tests.eq((select count(*) from public.companies where id = (select a from ids)), 0::bigint, 'rep in B cannot see company A');
reset role;

-- ── Stranger and anonymous visitor ──────────────────────────────
select tests.act_as('d0000000-0000-0000-0000-000000000000');
select tests.eq((select count(*) from public.companies) + (select count(*) from public.members) + (select count(*) from public.stores), 0::bigint, 'a signed-in stranger sees nothing');
reset role;
select tests.act_as(null);
select tests.refused($$ select count(*) from public.members $$, 'anonymous visitors cannot read people');
select tests.refused($$ select public.create_company('x', 'y') $$, 'anonymous visitors cannot create companies');
reset role;

-- ── Platform admin (Elvis) ──────────────────────────────────────
create temp table all_companies as select count(*) as n from public.companies;  -- includes any real ones on staging
grant all on all_companies to public;
select tests.act_as('c0000000-0000-0000-0000-000000000000');
select tests.eq((select count(*) from public.companies), (select n from all_companies), 'platform admin sees every company');
select tests.no_rows($$ update public.stores set name = 'x' $$, 'platform admin cannot edit company data by accident');
reset role;

-- ── Invites: set your PIN ───────────────────────────────────────
create temp table inv as select invite_token as t from public.members where phone = '+2348030000009';
grant all on inv to public;

select tests.act_as(null);
select tests.eq((select first_name || ' @ ' || company_name from public.invite_preview((select t from inv))), 'New @ CHF Heron', 'invite page shows first name and company only');
select tests.eq((select count(*) from public.invite_preview('wrong-token')), 0::bigint, 'a wrong link shows nothing');
select tests.refused($$ select * from public.invite_prepare((select t from inv)) $$, 'only the server can prepare an invite');
reset role;

select tests.act_as_server();
select tests.eq((select login_email from public.invite_prepare((select t from inv))), '2348030000009@phone.usepinga.com', 'invite maps phone to its login');
reset role;
-- (Supabase's login service creates the login here.)
insert into auth.users (id, email) values ('a0000000-0000-0000-0000-000000000009', '2348030000009@phone.usepinga.com');
select tests.act_as_server();
select tests.refused($$ select public.invite_complete((select t from inv), 'd0000000-0000-0000-0000-000000000000') $$, 'invite cannot be attached to a different login');
select public.invite_complete((select t from inv), 'a0000000-0000-0000-0000-000000000009');
select tests.ok((select user_id = 'a0000000-0000-0000-0000-000000000009' and invite_token is null and joined_at is not null from public.members where phone = '+2348030000009'), 'accepting an invite links the login and uses up the link');
select tests.eq((select ok from public.invite_prepare((select t from inv))), false, 'a used link cannot be used again');
reset role;

-- A manager in company B cannot take over a company A person's PIN by inviting the same phone.
insert into public.members (id, company_id, full_name, phone, role)
  values ('eb000000-0000-0000-0000-000000000099', (select b from ids), 'Copy of Sade', '+2348030000003', 'staff');
select tests.act_as_server();
select tests.eq((select ok from public.invite_prepare((select invite_token from public.members where id = 'eb000000-0000-0000-0000-000000000099'))), false, 'a phone already used by another company is refused');
reset role;

-- An expired link no longer works.
update public.members set invite_expires_at = now() - interval '1 minute' where id = 'eb000000-0000-0000-0000-000000000099';
create temp table old_inv as select invite_token as t from public.members where id = 'eb000000-0000-0000-0000-000000000099';
grant all on old_inv to public;
select tests.act_as(null);
select tests.eq((select count(*) from public.invite_preview((select t from old_inv))), 0::bigint, 'an expired link shows nothing');
reset role;

rollback;
\echo 'All foundation database tests passed.'
