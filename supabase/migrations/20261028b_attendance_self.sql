-- Marcación directa desde el teléfono del empleado (opcional, apagada por defecto).
-- Requiere 20261028_attendance.sql aplicada antes.
--
-- Cuando el dueño la enciende, cada empleado ve botones (Entrada / Almuerzo /
-- Salida) en vez de solo el QR. La marca exige selfie y guarda la ubicación
-- (si el teléfono la da) como evidencia; queda etiquetada source = 'telefono'
-- para que el supervisor pueda distinguirla de las del dispositivo de sucursal.

alter table public.attendance_settings
  add column if not exists allow_self_punch boolean not null default false;

alter table public.attendance_punches
  add column if not exists geo jsonb;

alter table public.attendance_punches drop constraint if exists attendance_punches_source_check;
alter table public.attendance_punches
  add constraint attendance_punches_source_check check (source in ('kiosco', 'correccion', 'telefono'));

-- get/set de reglas con el nuevo interruptor
create or replace function public.get_attendance_settings(p_organization_id uuid)
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
  if v_role is null or v_role not in ('propietario', 'admin', 'supervisor', 'contador', 'auditor') then
    raise exception 'No autorizado';
  end if;

  select * into s from attendance_settings where organization_id = p_organization_id;

  return jsonb_build_object(
    'tolerance_minutes', coalesce(s.tolerance_minutes, 5),
    'daily_hours_cap', coalesce(s.daily_hours_cap, 8),
    'lunch_max_minutes', coalesce(s.lunch_max_minutes, 60),
    'allow_self_punch', coalesce(s.allow_self_punch, false)
  );
end;
$$;

drop function if exists public.set_attendance_settings(uuid, int, numeric, int);

create or replace function public.set_attendance_settings(
  p_organization_id uuid,
  p_tolerance_minutes int,
  p_daily_hours_cap numeric,
  p_lunch_max_minutes int,
  p_allow_self_punch boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role text;
begin
  v_role := attendance_caller_role(p_organization_id);
  if v_role is null or v_role not in ('propietario', 'admin') then
    raise exception 'No autorizado';
  end if;

  insert into attendance_settings (organization_id, tolerance_minutes, daily_hours_cap, lunch_max_minutes, allow_self_punch, updated_at)
  values (p_organization_id, p_tolerance_minutes, p_daily_hours_cap, p_lunch_max_minutes, coalesce(p_allow_self_punch, false), now())
  on conflict (organization_id) do update
    set tolerance_minutes = excluded.tolerance_minutes,
        daily_hours_cap = excluded.daily_hours_cap,
        lunch_max_minutes = excluded.lunch_max_minutes,
        allow_self_punch = excluded.allow_self_punch,
        updated_at = now();
end;
$$;

-- Estado del empleado para la hoja "Marcar": qué puede marcar ahora y si la
-- marcación directa está habilitada. Cualquier miembro activo puede verlo.
create or replace function public.my_attendance_status(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_membership uuid;
  v_allow boolean;
  v_last record;
begin
  select m.id into v_membership
  from memberships m
  where m.organization_id = p_organization_id and m.user_id = auth.uid() and m.status = 'active'
  limit 1;

  if v_membership is null then
    raise exception 'No autorizado';
  end if;

  select coalesce((select st.allow_self_punch from attendance_settings st where st.organization_id = p_organization_id), false)
  into v_allow;

  select p.event_type, p.punched_at into v_last
  from attendance_punches p
  where p.membership_id = v_membership and p.voided_at is null and p.punched_at > now() - interval '18 hours'
  order by p.punched_at desc
  limit 1;

  return jsonb_build_object(
    'allow_self_punch', v_allow,
    'allowed', to_jsonb(attendance_allowed_events(v_membership)),
    'last_event', v_last.event_type,
    'last_at', v_last.punched_at
  );
end;
$$;

create or replace function public.self_record_attendance(
  p_organization_id uuid,
  p_event_type text,
  p_photo_path text,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_membership uuid;
  v_allow boolean;
  v_now timestamptz := now();
  v_branch uuid;
  v_branch_name text;
  v_late int;
begin
  select m.id into v_membership
  from memberships m
  where m.organization_id = p_organization_id and m.user_id = auth.uid() and m.status = 'active'
  limit 1;

  if v_membership is null then
    raise exception 'No autorizado';
  end if;

  select coalesce((select st.allow_self_punch from attendance_settings st where st.organization_id = p_organization_id), false)
  into v_allow;
  if not v_allow then
    raise exception 'La marcación desde el teléfono no está habilitada. Usa el código QR en el dispositivo de la sucursal.';
  end if;

  if p_event_type is null or not (p_event_type = any (attendance_allowed_events(v_membership))) then
    raise exception 'Esa marca no corresponde ahora';
  end if;

  if coalesce(btrim(p_photo_path), '') = '' then
    raise exception 'Se necesita la foto para marcar';
  end if;
  -- La foto debe ser de esta persona: <empresa>/self/<usuario>/archivo
  if split_part(p_photo_path, '/', 1) <> p_organization_id::text
     or split_part(p_photo_path, '/', 2) <> 'self'
     or split_part(p_photo_path, '/', 3) <> auth.uid()::text then
    raise exception 'Foto no válida';
  end if;

  select s.branch_id into v_branch from attendance_schedules s
  where s.membership_id = v_membership and s.work_date = (v_now at time zone attendance_tz())::date;

  insert into attendance_punches (organization_id, branch_id, membership_id, event_type, punched_at, photo_path, source, geo, created_by)
  values (p_organization_id, v_branch, v_membership, p_event_type, v_now, p_photo_path, 'telefono',
          case when p_lat is null or p_lng is null then null
               else jsonb_build_object('lat', p_lat, 'lng', p_lng, 'accuracy', p_accuracy) end,
          auth.uid());

  if p_event_type = 'entrada' then
    v_late := attendance_late_minutes(p_organization_id, v_membership, v_now);
  end if;

  select b.name into v_branch_name from branches b where b.id = v_branch;

  return jsonb_build_object(
    'employee_name', attendance_member_name(v_membership),
    'event_type', p_event_type,
    'punched_at', v_now,
    'late_minutes', v_late,
    'branch_name', v_branch_name
  );
end;
$$;

-- list_attendance_punches devuelve también la ubicación
drop function if exists public.list_attendance_punches(uuid, uuid, date);

create or replace function public.list_attendance_punches(p_organization_id uuid, p_membership_id uuid, p_work_date date)
returns table (
  punch_id uuid,
  event_type text,
  punched_at timestamptz,
  branch_name text,
  source text,
  note text,
  photo_path text,
  voided_at timestamptz,
  void_reason text,
  geo jsonb
)
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
    select p.id, p.event_type, p.punched_at, b.name, p.source, p.note, p.photo_path, p.voided_at, p.void_reason, p.geo
    from attendance_punches p
    left join branches b on b.id = p.branch_id
    where p.organization_id = p_organization_id
      and p.membership_id = p_membership_id
      and p.punched_at >= (p_work_date::timestamp at time zone attendance_tz())
      and p.punched_at < ((p_work_date + 1)::timestamp at time zone attendance_tz())
    order by p.punched_at;
end;
$$;

-- El empleado puede subir SU selfie a <empresa>/self/<su usuario>/...
drop policy if exists "Empleado sube su selfie de asistencia" on storage.objects;
create policy "Empleado sube su selfie de asistencia"
  on storage.objects for insert
  with check (
    bucket_id = 'attendance-photos'
    and (storage.foldername(name))[2] = 'self'
    and (storage.foldername(name))[3] = auth.uid()::text
    and ((storage.foldername(name))[1])::uuid in (
      select m.organization_id from memberships m where m.user_id = auth.uid() and m.status = 'active'
    )
  );

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array['get_attendance_settings', 'set_attendance_settings', 'my_attendance_status', 'self_record_attendance', 'list_attendance_punches'])
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
