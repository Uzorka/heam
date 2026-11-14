-- Pinga · Payments switch
-- Billing stays built but switched off until PAYSTACK_SECRET_KEY is saved. The billing function
-- reports whether it is on; the app hides "Pay" and trial reminders until then.

create function public.billing_report(p_enabled boolean) returns void
language sql security definer set search_path = '' as $$
  insert into private.settings (key, value) values ('billing', jsonb_build_object('enabled', p_enabled, 'at', now())::text)
  on conflict (key) do update set value = excluded.value
$$;
revoke all on function public.billing_report(boolean) from public, anon, authenticated;
grant execute on function public.billing_report(boolean) to service_role;

-- What's switched on, for the app (no secrets, just on/off).
create function public.app_flags() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'payments', coalesce((select (value::jsonb ->> 'enabled')::boolean from private.settings where key = 'billing'), false),
    'face_check', coalesce((select (value::jsonb ->> 'enabled')::boolean from private.settings where key = 'face_check'), false))
$$;
revoke all on function public.app_flags() from public, anon;
grant execute on function public.app_flags() to authenticated;
