-- Comprobantes de invitados pendientes que ya fueron registrados por la sucursal
-- (mismo monto y moneda, cerca en el tiempo, y misma referencia o misma persona).
create or replace function public.guest_branch_matches(p_organization_id uuid)
returns table (submission_id uuid, payment_id uuid, payment_public_id text, payment_created_at timestamptz, payment_status text)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_role text;
begin
  select role into v_role
  from memberships
  where organization_id = p_organization_id and user_id = auth.uid() and memberships.status = 'active'
  limit 1;

  if v_role is null or v_role not in ('propietario', 'admin', 'contador', 'supervisor', 'auditor') then
    raise exception 'No autorizado';
  end if;

  return query
    select distinct on (g.id) g.id, p.id, p.public_id::text, p.created_at, p.verification_status::text
    from guest_submissions g
    join payment_records p
      on p.organization_id = g.organization_id
     and p.amount = g.amount
     and p.currency = g.currency
     and p.created_at between g.created_at - interval '2 days' and g.created_at + interval '2 days'
     and p.reversed_at is null
     and p.duplicate_of is null
     and (
       (nullif(regexp_replace(lower(coalesce(g.reference_raw, '')), '[^a-z0-9]', '', 'g'), '') is not null
         and regexp_replace(lower(coalesce(g.reference_raw, '')), '[^a-z0-9]', '', 'g')
           = regexp_replace(lower(coalesce(p.reference_raw, '')), '[^a-z0-9]', '', 'g'))
       or (nullif(trim(p.origin_account_holder), '') is not null
         and lower(trim(p.origin_account_holder)) in (lower(trim(coalesce(g.submitter_name, ''))), lower(trim(coalesce(g.origin_account_holder, '')))))
     )
    where g.organization_id = p_organization_id and g.status = 'pending'
    order by g.id, p.created_at desc;
end;
$$;

revoke all on function public.guest_branch_matches(uuid) from public, anon;
grant execute on function public.guest_branch_matches(uuid) to authenticated;
