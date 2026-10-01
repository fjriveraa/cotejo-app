-- Búsqueda de empresas: mínimo 3 letras en el servidor (no solo en la
-- pantalla) y los comodines % y _ se tratan como texto literal, para que no
-- se pueda listar el directorio completo.
create or replace function public.public_search_organizations_for_payment(p_query text default '')
returns table(organization_id uuid, name text, country text, org_type text, verification_status text)
language plpgsql security definer set search_path to 'public' as $$
declare q text := trim(coalesce(p_query, ''));
begin
  if length(q) < 3 then return; end if;
  q := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');
  return query
    select o.id, o.name, o.country, o.org_type, o.verification_status
    from organizations o
    where o.status = 'active' and o.name ilike '%' || q || '%'
    order by (o.verification_status = 'verified') desc, o.name asc
    limit 20;
end; $$;

create or replace function public.search_organizations(p_query text default '')
returns table(organization_id uuid, name text, country text, org_type text, verification_status text, already_member boolean, pending_request boolean)
language plpgsql security definer set search_path to 'public' as $$
declare q text := trim(coalesce(p_query, ''));
begin
  if auth.uid() is null then raise exception 'No autorizado'; end if;
  if length(q) < 3 then return; end if;
  q := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');
  return query
    select o.id, o.name, o.country, o.org_type, o.verification_status,
      exists(select 1 from memberships m where m.organization_id = o.id and m.user_id = auth.uid() and m.status = 'active'),
      exists(select 1 from join_requests jr where jr.organization_id = o.id and jr.user_id = auth.uid() and jr.status = 'pending')
    from organizations o
    where o.status = 'active' and o.is_public = true and o.name ilike '%' || q || '%'
    order by (o.verification_status = 'verified') desc, o.name asc
    limit 30;
end; $$;
