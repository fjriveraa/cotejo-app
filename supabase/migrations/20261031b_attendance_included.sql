-- Quién entra en el horario/asistencia (la cuenta Sucursal/reloj nunca aparece en la cuadrícula).
alter table public.memberships add column if not exists attendance_included boolean not null default true;

create or replace function public.list_attendance_included(p_organization_id uuid)
returns table (membership_id uuid, included boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_role text;
begin
  v_role := attendance_caller_role(p_organization_id);
  if v_role is null or v_role not in ('propietario', 'admin', 'supervisor', 'contador', 'auditor') then
    raise exception 'No autorizado';
  end if;
  return query
    select m.id, m.attendance_included
    from memberships m
    where m.organization_id = p_organization_id and m.status = 'active';
end;
$$;
grant execute on function public.list_attendance_included(uuid) to authenticated;

create or replace function public.set_attendance_included(p_organization_id uuid, p_membership_id uuid, p_included boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role text;
begin
  v_role := attendance_caller_role(p_organization_id);
  if v_role is null or v_role not in ('propietario', 'admin', 'supervisor') then
    raise exception 'No autorizado';
  end if;
  update memberships set attendance_included = p_included
  where id = p_membership_id and organization_id = p_organization_id;
  if not found then raise exception 'Persona no encontrada'; end if;
end;
$$;
revoke all on function public.set_attendance_included(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_attendance_included(uuid, uuid, boolean) to authenticated;
