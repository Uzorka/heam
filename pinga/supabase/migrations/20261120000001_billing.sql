-- Pinga · Step 7 · Billing (Paystack)
-- Monthly subscription per active person, priced per module:
--   Office Attendance → each joined, active office staff member
--   Field Sales       → each joined, active sales rep
-- 14-day free trial. The owner pays through Paystack Checkout; a reusable card then renews monthly.
-- Staff are never locked out for late payment: owners and managers see a banner instead.

-- PLACEHOLDER prices (naira per person per month). Confirm before going live.
create table public.billing_prices (
  module         text primary key check (module in ('attendance', 'field')),
  naira_per_seat integer not null check (naira_per_seat >= 0)
);
insert into public.billing_prices values ('attendance', 1500), ('field', 2500);
alter table public.billing_prices enable row level security;
revoke all on public.billing_prices from anon, authenticated;
grant select on public.billing_prices to authenticated;
create policy "everyone signed in reads prices" on public.billing_prices for select to authenticated using (true);

alter table public.companies add column paid_until date;

create table public.billing_invoices (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  staff_seats  integer not null,
  rep_seats    integer not null,
  amount_kobo  bigint not null check (amount_kobo > 0),
  status       text not null default 'open' check (status in ('open', 'paid', 'failed', 'void')),
  reference    text not null unique,
  channel      text,
  detail       text,
  created_at   timestamptz not null default now(),
  paid_at      timestamptz,
  check (period_end >= period_start)
);
create unique index billing_one_open_invoice on public.billing_invoices (company_id) where status = 'open';
alter table public.billing_invoices enable row level security;
revoke all on public.billing_invoices from anon, authenticated;
grant select on public.billing_invoices to authenticated;   -- written only by the billing functions
create policy "owners read invoices" on public.billing_invoices for select to authenticated
  using (private.my_role(company_id) = 'owner' or private.is_platform_admin());

-- Saved card for renewals. The Paystack authorization code never leaves the server.
create table private.billing_cards (
  company_id         uuid primary key references public.companies (id) on delete cascade,
  authorization_code text not null,
  email              text not null,
  label              text not null,      -- e.g. "Visa •••• 4081"
  expires            text,               -- e.g. "12/30"
  updated_at         timestamptz not null default now()
);

-- What a company would pay this month.
create function private.billing_quote(p_company uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with seats as (
    select count(*) filter (where role = 'staff') as staff, count(*) filter (where role = 'rep') as reps
    from public.members where company_id = p_company and active and joined_at is not null
  ), c as (select has_attendance, has_field from public.companies where id = p_company),
  p as (select max(naira_per_seat) filter (where module = 'attendance') as att, max(naira_per_seat) filter (where module = 'field') as field from public.billing_prices)
  select jsonb_build_object(
    'staff_seats', case when c.has_attendance then seats.staff else 0 end,
    'rep_seats', case when c.has_field then seats.reps else 0 end,
    'staff_price', p.att, 'rep_price', p.field,
    'amount_kobo', ((case when c.has_attendance then seats.staff else 0 end) * p.att
                  + (case when c.has_field then seats.reps else 0 end) * p.field) * 100)
  from seats, c, p
$$;

-- The billing page (owners only).
create function public.billing_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me    public.members := private.my_admin_membership();
  v_co    public.companies;
  v_today date;
begin
  if v_me.role <> 'owner' then raise exception 'Only the owner can see billing' using errcode = '42501'; end if;
  select * into v_co from public.companies where id = v_me.company_id;
  v_today := (now() at time zone v_co.timezone)::date;
  return jsonb_build_object(
    'status', v_co.status,
    'trial_ends', (v_co.trial_ends_at at time zone v_co.timezone)::date,
    'trial_days_left', greatest(0, (v_co.trial_ends_at at time zone v_co.timezone)::date - v_today),
    'paid_until', v_co.paid_until,
    'quote', private.billing_quote(v_co.id),
    'card', (select jsonb_build_object('label', label, 'expires', expires) from private.billing_cards where company_id = v_co.id),
    'invoices', (select coalesce(jsonb_agg(jsonb_build_object('reference', reference, 'period_start', period_start, 'period_end', period_end,
        'amount_kobo', amount_kobo, 'status', status, 'paid_at', paid_at, 'staff_seats', staff_seats, 'rep_seats', rep_seats) order by created_at desc), '[]')
      from (select * from public.billing_invoices where company_id = v_co.id order by created_at desc limit 12) i));
end $$;

-- Owner starts a payment: creates (or reuses) this period's open invoice.
-- The period starts after the trial, or after the last paid period, or today.
create function public.billing_start_checkout() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me    public.members := private.my_admin_membership();
  v_co    public.companies;
  v_today date;
  v_start date;
  v_q     jsonb;
  v_inv   public.billing_invoices;
  v_email text;
begin
  if v_me.role <> 'owner' then raise exception 'Only the owner can pay' using errcode = '42501'; end if;
  select * into v_co from public.companies where id = v_me.company_id for update;
  v_today := (now() at time zone v_co.timezone)::date;
  if v_co.paid_until is not null and v_co.paid_until >= v_today + 7 then
    raise exception 'Already paid until %', to_char(v_co.paid_until, 'DD Mon YYYY') using errcode = 'P0001';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  v_q := private.billing_quote(v_co.id);
  if (v_q->>'amount_kobo')::bigint = 0 then
    raise exception 'Nothing to pay yet: invite your team first' using errcode = 'P0001';
  end if;
  v_start := greatest(v_today, (v_co.trial_ends_at at time zone v_co.timezone)::date, coalesce(v_co.paid_until + 1, v_today));

  select * into v_inv from public.billing_invoices where company_id = v_co.id and status = 'open';
  if v_inv.id is not null and (v_inv.amount_kobo <> (v_q->>'amount_kobo')::bigint or v_inv.period_start <> v_start) then
    update public.billing_invoices set status = 'void', detail = 'replaced' where id = v_inv.id;   -- team size changed
    v_inv := null;
  end if;
  if v_inv.id is null then
    insert into public.billing_invoices (company_id, period_start, period_end, staff_seats, rep_seats, amount_kobo, reference)
    values (v_co.id, v_start, (v_start + interval '1 month' - interval '1 day')::date,
            (v_q->>'staff_seats')::int, (v_q->>'rep_seats')::int, (v_q->>'amount_kobo')::bigint,
            'PNG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)))
    returning * into v_inv;
  end if;
  return jsonb_build_object('reference', v_inv.reference, 'amount_kobo', v_inv.amount_kobo, 'email', v_email,
    'company_id', v_co.id, 'invoice_id', v_inv.id, 'period_start', v_inv.period_start, 'period_end', v_inv.period_end);
end $$;

-- ── Server only (service role): payment results and renewals ────

-- Called after Paystack confirms a payment (webhook, or the app returning from checkout).
-- Marks the invoice paid only when the amount and currency match exactly. Safe to call twice.
create function public.billing_confirm(p_reference text, p_status text, p_amount_kobo bigint, p_currency text,
  p_channel text, p_card jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.billing_invoices;
begin
  select * into v_inv from public.billing_invoices where reference = p_reference for update;
  if v_inv.id is null then return 'unknown'; end if;
  if v_inv.status = 'paid' then return 'already paid'; end if;
  if p_status <> 'success' then
    update public.billing_invoices set status = case when status = 'open' then 'failed' else status end, detail = left(p_status, 200)
    where id = v_inv.id;
    update public.companies set status = 'past_due'
    where id = v_inv.company_id and status <> 'trial' and coalesce(paid_until, '-infinity') < current_date;
    return 'failed';
  end if;
  if p_currency <> 'NGN' or p_amount_kobo <> v_inv.amount_kobo then
    update public.billing_invoices set detail = format('amount mismatch: paid %s %s', p_amount_kobo, p_currency) where id = v_inv.id;
    return 'amount mismatch';
  end if;

  update public.billing_invoices set status = 'paid', paid_at = now(), channel = p_channel, detail = null where id = v_inv.id;
  update public.companies set status = 'active', paid_until = greatest(coalesce(paid_until, v_inv.period_end), v_inv.period_end)
  where id = v_inv.company_id;
  if p_channel = 'card' and coalesce((p_card->>'reusable')::boolean, false) and p_card->>'authorization_code' is not null then
    insert into private.billing_cards (company_id, authorization_code, email, label, expires)
    values (v_inv.company_id, p_card->>'authorization_code', coalesce(p_card->>'email', ''),
            initcap(coalesce(nullif(btrim(p_card->>'card_type'), ''), 'Card')) || ' •••• ' || coalesce(p_card->>'last4', '????'),
            nullif(concat_ws('/', p_card->>'exp_month', right(p_card->>'exp_year', 2)), ''))
    on conflict (company_id) do update set authorization_code = excluded.authorization_code, email = excluded.email,
      label = excluded.label, expires = excluded.expires, updated_at = now();
  end if;
  return 'paid';
end $$;

-- Daily renewals: companies whose trial or paid month has ended.
-- Creates this month's invoice (one at a time) and returns the saved card, if any, to charge.
-- Companies without a saved card become "payment due" (banner for the owner; staff unaffected).
create function public.billing_due() returns table (company_id uuid, reference text, amount_kobo bigint, authorization_code text, email text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  c record;
  v_q jsonb;
  v_today date;
  v_inv public.billing_invoices;
begin
  for c in
    select co.* from public.companies co
    where co.status in ('trial', 'active', 'past_due')
      and coalesce(co.paid_until, (co.trial_ends_at at time zone co.timezone)::date - 1) < (now() at time zone co.timezone)::date
  loop
    v_today := (now() at time zone c.timezone)::date;
    v_q := private.billing_quote(c.id);
    if (v_q->>'amount_kobo')::bigint = 0 then continue; end if;   -- nobody to bill yet
    update public.companies set status = 'past_due' where id = c.id and status <> 'past_due';
    -- At most one automatic card attempt per company per day.
    if exists (select 1 from public.billing_invoices i where i.company_id = c.id and (i.created_at at time zone c.timezone)::date = v_today
               and i.status in ('open', 'failed')) then
      continue;
    end if;
    update public.billing_invoices set status = 'void', detail = 'replaced' where billing_invoices.company_id = c.id and status = 'open';
    insert into public.billing_invoices (company_id, period_start, period_end, staff_seats, rep_seats, amount_kobo, reference)
    values (c.id, v_today, (v_today + interval '1 month' - interval '1 day')::date,
            (v_q->>'staff_seats')::int, (v_q->>'rep_seats')::int, (v_q->>'amount_kobo')::bigint,
            'PNG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)))
    returning * into v_inv;
    return query select c.id, v_inv.reference, v_inv.amount_kobo, k.authorization_code, k.email
      from (select 1) x left join private.billing_cards k on k.company_id = c.id;
  end loop;
end $$;

revoke all on function public.billing_overview(), public.billing_start_checkout(),
  public.billing_confirm(text, text, bigint, text, text, jsonb), public.billing_due() from public, anon, authenticated;
grant execute on function public.billing_overview(), public.billing_start_checkout() to authenticated;
grant execute on function public.billing_confirm(text, text, bigint, text, text, jsonb), public.billing_due() to service_role;
