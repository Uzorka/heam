-- Billing: price per active person per module, trial, checkout, confirmation, renewals, privacy.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'owner.a@example.com'),
  ('a0000000-0000-0000-0000-000000000002', '2348030000002@phone.usepinga.com'),
  ('a0000000-0000-0000-0000-000000000003', '2348030000003@phone.usepinga.com'),
  ('b0000000-0000-0000-0000-000000000001', 'owner.b@example.com');
-- Company A is in its trial (ends in 5 days). Company B's trial ended yesterday.
insert into public.companies (id, name, trial_ends_at) values
  ('c000000a-0000-0000-0000-000000000000', 'CHF Heron', now() + interval '5 days'),
  ('c000000b-0000-0000-0000-000000000000', 'Other Co', now() - interval '1 day');
insert into public.members (id, company_id, user_id, full_name, phone, role, joined_at) values
  ('ea000000-0000-0000-0000-000000000001', 'c000000a-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001', 'Ada Owner', null, 'owner', now()),
  ('ea000000-0000-0000-0000-000000000002', 'c000000a-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000002', 'Ade Manager', '+2348030000002', 'admin', now()),
  ('ea000000-0000-0000-0000-000000000003', 'c000000a-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000003', 'Sade Staff', '+2348030000003', 'staff', now()),
  ('ea000000-0000-0000-0000-000000000004', 'c000000a-0000-0000-0000-000000000000', null, 'Tolu Staff', '+2348030000004', 'staff', now()),
  ('ea000000-0000-0000-0000-000000000005', 'c000000a-0000-0000-0000-000000000000', null, 'Remi Rep', '+2348030000005', 'rep', now()),
  ('ea000000-0000-0000-0000-000000000006', 'c000000a-0000-0000-0000-000000000000', null, 'Not Joined', '+2348030000006', 'staff', null),
  ('ea000000-0000-0000-0000-000000000007', 'c000000a-0000-0000-0000-000000000000', null, 'Left Company', '+2348030000007', 'rep', now()),
  ('eb000000-0000-0000-0000-000000000001', 'c000000b-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000001', 'Bola Owner', null, 'owner', now()),
  ('eb000000-0000-0000-0000-000000000002', 'c000000b-0000-0000-0000-000000000000', null, 'B Staff', '+2348050000002', 'staff', now());
update public.members set active = false where id = 'ea000000-0000-0000-0000-000000000007';

select tests.act_as('a0000000-0000-0000-0000-000000000001');
create temp table o as select public.billing_overview() as j;
select tests.eq((select j->'quote' from o), '{"staff_seats": 2, "rep_seats": 1, "staff_price": 1500, "rep_price": 2500, "shop_seats": 0, "shop_price": 5000, "shop_included_staff": 5, "plan": "business", "people": 3, "starter_price": 5000, "capped": false, "shop_staff": 0, "shop_extra_staff": 0, "loose_staff": 0, "extra_staff_price": 1000, "gross_kobo": 550000, "discount_percent": 0, "discount_min_people": null, "amount_kobo": 550000}'::jsonb,
  'price: 2 office staff × ₦1,500 + 1 rep × ₦2,500 = ₦5,500 (owners, managers, not-joined and inactive people are free)');
select tests.eq((select j->>'status' from o), 'trial', 'starts on the free trial');
select tests.eq((select (j->>'trial_days_left')::int from o), 5, '5 days of trial left');

create temp table ch as select public.billing_start_checkout() as j;
grant all on ch to public;
select tests.eq((select (j->>'amount_kobo')::bigint from ch), 550000::bigint, 'checkout asks for ₦5,500 (in kobo for Paystack)');
select tests.eq((select j->>'email' from ch), 'owner.a@example.com', 'the receipt goes to the owner''s email');
select tests.eq((select (j->>'period_start')::date from ch), (now() at time zone 'Africa/Lagos')::date + 5, 'paying during the trial starts the paid month when the trial ends');
select tests.eq((select public.billing_start_checkout()->>'reference'), (select j->>'reference' from ch), 'pressing Pay twice reuses the same invoice');
reset role;

-- Paystack confirms (server only).
select tests.act_as('a0000000-0000-0000-0000-000000000001');
select tests.refused($$ select public.billing_confirm((select j->>'reference' from ch), 'success', 550000, 'NGN', 'card', '{}') $$, 'an owner cannot mark their own payment as paid');
reset role;
select tests.act_as_server();
select tests.eq(public.billing_confirm((select j->>'reference' from ch), 'success', 100, 'NGN', 'card', '{}'), 'amount mismatch', 'a payment for the wrong amount is not accepted');
select tests.eq(public.billing_confirm((select j->>'reference' from ch), 'success', 550000, 'USD', 'card', '{}'), 'amount mismatch', '...nor in the wrong currency');
select tests.eq(public.billing_confirm((select j->>'reference' from ch), 'success', 550000, 'NGN', 'card',
  '{"authorization_code": "AUTH_abc", "reusable": true, "card_type": "visa ", "last4": "4081", "exp_month": "12", "exp_year": "2030", "email": "owner.a@example.com"}'), 'paid', 'the right payment is accepted');
select tests.eq(public.billing_confirm((select j->>'reference' from ch), 'success', 550000, 'NGN', 'card', '{}'), 'already paid', 'confirming twice is safe');
select tests.eq(public.billing_confirm('PNG-NOPE', 'success', 1, 'NGN', 'card', '{}'), 'unknown', 'unknown references are ignored');
reset role;

select tests.act_as('a0000000-0000-0000-0000-000000000001');
create temp table o2 as select public.billing_overview() as j;
select tests.eq((select j->>'status' from o2), 'active', 'company is now active');
select tests.eq((select (j->>'paid_until')::date from o2), ((now() at time zone 'Africa/Lagos')::date + 5 + interval '1 month' - interval '1 day')::date, 'paid until a month after the trial ends');
select tests.eq((select j->'card' from o2), '{"label": "Visa •••• 4081", "expires": "12/30"}'::jsonb, 'card saved for renewals (shown masked)');
select tests.ok((select not (j::text like '%AUTH_abc%') from o2), 'the card''s Paystack code is never shown to anyone');
select tests.refused($$ select public.billing_start_checkout() $$, 'cannot pay again while paid more than a week ahead');
select tests.refused($$ update public.companies set paid_until = '2099-01-01' $$, 'owners cannot change their own paid-until date');
reset role;

-- Renewals (daily job).
select tests.act_as_server();
create temp table due1 as select * from public.billing_due();
grant all on due1 to public;
select tests.eq((select count(*) from due1 where company_id = 'c000000a-0000-0000-0000-000000000000'), 0::bigint, 'a paid company is not due');
select tests.eq((select count(*) from due1 where company_id = 'c000000b-0000-0000-0000-000000000000'), 1::bigint, 'company B (trial over, unpaid) is due');
select tests.eq((select authorization_code from due1 where company_id = 'c000000b-0000-0000-0000-000000000000'), null::text, 'B has no saved card, so nothing is charged automatically');
select tests.eq((select count(*) from public.billing_due()), 0::bigint, 'never more than one automatic attempt per company per day');
reset role;
select tests.eq((select status from public.companies where id = 'c000000b-0000-0000-0000-000000000000'), 'past_due', 'B shows "payment due"');

-- B's staff keep working while payment is due.
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-000000000002', '2348050000002@phone.usepinga.com');
update public.members set user_id = 'b0000000-0000-0000-0000-000000000002' where id = 'eb000000-0000-0000-0000-000000000002';
insert into public.branches (company_id, name, lat, lng) values ('c000000b-0000-0000-0000-000000000000', 'B HQ', 6.5, 3.3);
select tests.act_as('b0000000-0000-0000-0000-000000000002');
select tests.ok((select id is not null from public.record_attendance(gen_random_uuid(), 'in', now(), 6.5001, 3.3001, 10, null, now())), 'staff can still clock in when payment is due');
reset role;

-- Renewal with a saved card: A's month ends.
update public.companies set paid_until = (now() at time zone 'Africa/Lagos')::date - 1 where id = 'c000000a-0000-0000-0000-000000000000';
select tests.act_as_server();
create temp table due2 as select * from public.billing_due();
grant all on due2 to public;
select tests.eq((select authorization_code || ' ' || amount_kobo from due2 where company_id = 'c000000a-0000-0000-0000-000000000000'), 'AUTH_abc 550000', 'A is renewed with its saved card for the current team size');
select tests.eq(public.billing_confirm((select reference from due2 where company_id = 'c000000a-0000-0000-0000-000000000000'), 'failed', 550000, 'NGN', 'card', '{}'), 'failed', 'a declined card is recorded');
reset role;
select tests.eq((select status from public.companies where id = 'c000000a-0000-0000-0000-000000000000'), 'past_due', '...and the company shows "payment due"');

-- Who can see billing.
select tests.act_as('a0000000-0000-0000-0000-000000000002');
select tests.refused($$ select public.billing_overview() $$, 'managers cannot see billing');
select tests.eq((select count(*) from public.billing_invoices), 0::bigint, 'managers cannot see invoices');
reset role;
select tests.act_as('a0000000-0000-0000-0000-000000000003');
select tests.refused($$ select public.billing_start_checkout() $$, 'staff cannot start a payment');
reset role;
select tests.act_as('b0000000-0000-0000-0000-000000000001');
select tests.eq((select count(*) from public.billing_invoices where company_id = 'c000000a-0000-0000-0000-000000000000'), 0::bigint, 'another company cannot see these invoices');
select tests.refused($$ update public.billing_prices set naira_per_seat = 1 $$, 'nobody can change prices from the app');
reset role;

-- Volume discount: 100+ people → 10% off (placeholder tier), whole naira.
insert into public.members (company_id, full_name, phone, role, joined_at)
select 'c000000b-0000-0000-0000-000000000000', 'Staff ' || g, '+234806' || lpad(g::text, 7, '0'), 'staff', now() from generate_series(1, 98) g;
insert into public.members (company_id, full_name, phone, role, joined_at)
values ('c000000b-0000-0000-0000-000000000000', 'Rep One', '+2348069999999', 'rep', now());
select tests.act_as('b0000000-0000-0000-0000-000000000001');
create temp table big as select public.billing_overview()->'quote' as q;
select tests.eq((select (q->>'staff_seats')::int + (q->>'rep_seats')::int from big), 100, '100 billable people');
select tests.eq((select (q->>'gross_kobo')::bigint from big), ((99 * 1500 + 2500) * 100)::bigint, 'before discount: 99 × ₦1,500 + 1 × ₦2,500 = ₦151,000');
select tests.eq((select (q->>'discount_percent')::numeric from big), 10::numeric, '10% volume discount applies at 100 people');
select tests.eq((select (q->>'amount_kobo')::bigint from big), 13590000::bigint, 'pays ₦135,900 a month');
reset role;
delete from public.members where full_name = 'Rep One';
select tests.act_as('b0000000-0000-0000-0000-000000000001');
select tests.eq((select (public.billing_overview()->'quote'->>'discount_percent')::numeric), 0::numeric, 'at 99 people there is no discount');
reset role;
insert into public.billing_discounts values (50, 5);
select tests.act_as('b0000000-0000-0000-0000-000000000001');
select tests.eq((select (public.billing_overview()->'quote'->>'discount_percent')::numeric), 5::numeric, 'tiers are set in one table (e.g. adding 50+ → 5%)');
select tests.refused($$ insert into public.billing_discounts values (2, 99) $$, 'companies cannot give themselves discounts');
reset role;

rollback;
\echo 'All billing database tests passed.'
