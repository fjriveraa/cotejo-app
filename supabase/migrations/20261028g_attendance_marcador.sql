-- Rol "marcador": la cuenta del teléfono o tableta de una sucursal (el reloj).
-- No es una persona: solo puede abrir el modo marcador, escanear los QR y
-- subir las fotos de marcación. No ve pagos, reportes ni horarios.
-- Parte de esto ya estaba en la base (restricción de memberships, peek/record
-- y la política de fotos); aquí se completa lo que faltaba. Requiere a–f.

alter table public.memberships drop constraint if exists memberships_role_check;
alter table public.memberships
  add constraint memberships_role_check
  check (role = any (array['empleado', 'supervisor', 'contador', 'propietario', 'admin', 'auditor', 'marcador']));

alter table public.email_invites drop constraint if exists email_invites_role_check;
alter table public.email_invites
  add constraint email_invites_role_check
  check (role = any (array['empleado', 'supervisor', 'contador', 'propietario', 'admin', 'auditor', 'marcador']));

-- Invitar por correo: ahora acepta el rol marcador (misma lógica de siempre).
create or replace function public.invite_by_email(p_organization_id uuid, p_email text, p_role text, p_branch_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller_role text; v_email text; v_existing_user_id uuid;
  v_existing_membership_id uuid; v_invite_id uuid; v_activated boolean := false;
begin
  select m.role into v_caller_role from memberships m
    where m.organization_id = p_organization_id and m.user_id = auth.uid() and m.status = 'active';
  if v_caller_role is null or v_caller_role not in ('propietario', 'admin') then
    raise exception 'No autorizado';
  end if;
  if p_role not in ('empleado','supervisor','contador','propietario','admin','auditor','marcador') then
    raise exception 'Rol no válido';
  end if;

  if p_role = 'propietario' and v_caller_role <> 'propietario' then
    if exists (
      select 1 from memberships
      where organization_id = p_organization_id and role = 'propietario' and status = 'active'
    ) then
      raise exception 'Ya existe un propietario activo en esta empresa — solo un propietario puede nombrar a otro';
    end if;
  end if;

  v_email := lower(trim(p_email));
  if v_email is null or v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Correo no válido';
  end if;
  select id into v_existing_user_id from auth.users where lower(email) = v_email limit 1;
  if v_existing_user_id is not null then
    select id into v_existing_membership_id from memberships
      where organization_id = p_organization_id and user_id = v_existing_user_id;
    if v_existing_membership_id is not null then
      update memberships set status = 'active', role = p_role,
        branch_scope = case when p_branch_id is not null then array[p_branch_id] else branch_scope end
        where id = v_existing_membership_id;
    else
      insert into memberships (organization_id, user_id, role, branch_scope, status)
        values (p_organization_id, v_existing_user_id, p_role,
                case when p_branch_id is not null then array[p_branch_id] else null end, 'active');
    end if;
    v_activated := true;
  end if;
  insert into email_invites (organization_id, email, role, branch_id, invited_by, status, accepted_at)
    values (p_organization_id, v_email, p_role, p_branch_id, auth.uid(),
            case when v_activated then 'accepted' else 'pending' end,
            case when v_activated then now() else null end)
    on conflict (organization_id, lower(email)) where status = 'pending'
    do update set role = excluded.role, branch_id = excluded.branch_id, invited_by = excluded.invited_by, created_at = now()
    returning id into v_invite_id;
  return jsonb_build_object('invite_id', v_invite_id, 'activated', v_activated);
end;
$$;

-- El marcador necesita ver la lista de dispositivos para elegir cuál es su equipo.
create or replace function public.list_attendance_devices(p_organization_id uuid)
returns table (device_id uuid, name text, branch_id uuid, branch_name text, active boolean, created_at timestamptz)
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
  if v_role is null or v_role not in ('propietario', 'admin', 'supervisor', 'marcador') then
    raise exception 'No autorizado';
  end if;

  return query
    select d.id, d.name, d.branch_id, b.name, d.active, d.created_at
    from attendance_devices d
    join branches b on b.id = d.branch_id
    where d.organization_id = p_organization_id
      -- Un reloj de sucursal solo ve los dispositivos de la sucursal que se le asignó.
      and (v_role <> 'marcador' or not exists (
             select 1 from memberships mm
             where mm.organization_id = p_organization_id and mm.user_id = auth.uid() and mm.status = 'active'
               and mm.branch_scope is not null and cardinality(mm.branch_scope) > 0
               and not (d.branch_id = any (mm.branch_scope))))
    order by d.created_at desc;
end;
$$;

-- Ajustes que el modo marcador necesita (foto y QR), sin abrir el resto de las reglas.
create or replace function public.get_kiosk_settings(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_role text;
  s attendance_settings;
begin
  v_role := attendance_caller_role(p_organization_id);
  if v_role is null or v_role not in ('propietario', 'admin', 'supervisor', 'marcador') then
    raise exception 'No autorizado';
  end if;
  select * into s from attendance_settings where organization_id = p_organization_id;
  return jsonb_build_object(
    'method_qr', coalesce(s.method_qr, true),
    'photo_kiosk', coalesce(s.photo_kiosk, true)
  );
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array['invite_by_email', 'list_attendance_devices', 'get_kiosk_settings'])
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
