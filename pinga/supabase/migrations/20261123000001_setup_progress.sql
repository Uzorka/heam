-- Pinga · "Get started" checklist for new companies (owners and managers).
create function public.setup_progress() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me public.members := private.my_admin_membership();
  c uuid := v_me.company_id;
begin
  return jsonb_build_object(
    'offices', exists (select 1 from public.branches where company_id = c),
    'stores', exists (select 1 from public.stores where company_id = c),
    'people', (select count(*) from public.members where company_id = c and active and role in ('staff', 'rep')),
    'first_check_in', exists (select 1 from public.attendance where company_id = c)
                   or exists (select 1 from public.visits where company_id = c));
end $$;
revoke all on function public.setup_progress() from public, anon, authenticated;
grant execute on function public.setup_progress() to authenticated;
