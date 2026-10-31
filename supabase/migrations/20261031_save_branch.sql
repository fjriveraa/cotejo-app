-- Crear, renombrar y desactivar sucursales (solo propietario o administrador).
create or replace function public.save_branch(
  p_organization_id uuid,
  p_name text,
  p_branch_id uuid default null,
  p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role text;
  v_name text := nullif(trim(p_name), '');
  v_id uuid;
begin
  select role into v_role
  from memberships
  where organization_id = p_organization_id and user_id = auth.uid() and memberships.status = 'active'
  limit 1;

  if v_role is null or v_role not in ('propietario', 'admin') then
    raise exception 'No autorizado';
  end if;
  if v_name is null then
    raise exception 'Escribe el nombre de la sucursal';
  end if;

  if p_branch_id is null then
    if exists (select 1 from branches where organization_id = p_organization_id and lower(name) = lower(v_name) and active) then
      raise exception 'Ya existe una sucursal con ese nombre';
    end if;
    insert into branches (organization_id, name) values (p_organization_id, v_name) returning id into v_id;
    return v_id;
  end if;

  if not exists (select 1 from branches where id = p_branch_id and organization_id = p_organization_id) then
    raise exception 'Sucursal no encontrada';
  end if;
  if not p_active and not exists (
    select 1 from branches where organization_id = p_organization_id and active and id <> p_branch_id
  ) then
    raise exception 'La empresa debe tener al menos una sucursal activa';
  end if;
  if exists (select 1 from branches where organization_id = p_organization_id and id <> p_branch_id and active and lower(name) = lower(v_name)) then
    raise exception 'Ya existe una sucursal con ese nombre';
  end if;

  update branches set name = v_name, active = p_active where id = p_branch_id;
  return p_branch_id;
end;
$$;

revoke all on function public.save_branch(uuid, text, uuid, boolean) from public, anon;
grant execute on function public.save_branch(uuid, text, uuid, boolean) to authenticated;
