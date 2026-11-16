-- Pinga · Printing receipts: the paper each shop's printer uses (58 mm or 80 mm thermal roll, or A4).
alter table public.branches add column receipt_paper text not null default '80' check (receipt_paper in ('58', '80', 'a4'));

-- The receipt says which paper its shop prints on, so the receipt page prints it the same way.
create or replace function public.receipt(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when p_token !~ '^[A-Za-z0-9_-]{20,64}$' then null else (
    select jsonb_build_object(
      'business', c.name,
      'logo_path', coalesce(b.logo_path, c.logo_path),
      'shop', b.name, 'address', b.address, 'phone', b.phone,
      'paper', b.receipt_paper,
      'number', s.receipt_code,
      'at', s.happened_at, 'timezone', c.timezone,
      'served_by', split_part(s.seller_name, ' ', 1),
      'customer', s.customer_name,
      'items', (select jsonb_agg(jsonb_build_object('name', i.product_name, 'qty', i.qty, 'price', i.unit_price,
                 'list_price', i.list_price) order by i.line) from public.sale_items i where i.sale_id = s.id),
      'discount', s.discount, 'total', s.total,
      'payment', s.payment_method, 'payments', s.payments,
      'note', c.receipt_note,
      'cancelled', s.cancelled_at is not null)
    from public.sales s join public.branches b on b.id = s.branch_id join public.companies c on c.id = s.company_id
    where s.receipt_token = p_token) end
$$;
