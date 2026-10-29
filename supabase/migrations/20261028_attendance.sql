-- Control de asistencia de empleados (fase 1).
--
-- Diseño:
--   * Cada empleado tiene su propio usuario (membership). Desde su teléfono
--     pide un código de un solo uso que vale ~45 segundos y lo muestra como QR.
--   * Un dispositivo de la sucursal (tableta con una sesión de propietario /
--     admin / supervisor) escanea el QR y toma una foto en el momento de la
--     marca. Los empleados NO marcan solos desde su teléfono: así nadie puede
--     marcar a distancia ni pasar una captura del QR a un compañero.
--   * Las marcas nunca se editan ni se borran: una corrección crea una marca
--     nueva ('correccion') y una marca errónea se anula con motivo
--     (voided_at). El original queda siempre en el historial.
--   * Todo el acceso es por funciones (RPC) con revisión de rol. Las tablas
--     tienen RLS activado y ninguna política, igual que payment_groups.
--
-- Zona horaria: todo el cálculo de días usa hora de Honduras.

create or replace function public.attendance_tz()
returns text
language sql
immutable
as $$ select 'America/Tegucigalpa'::text $$;

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table if not exists public.attendance_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  tolerance_minutes int not null default 5 check (tolerance_minutes between 0 and 120),
  daily_hours_cap numeric not null default 8 check (daily_hours_cap between 1 and 24),
  lunch_max_minutes int not null default 60 check (lunch_max_minutes between 0 and 240),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  name text not null,
  active boolean not null default true,
  registered_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.attendance_codes (
  code text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists attendance_codes_membership_idx on public.attendance_codes (membership_id);

create table if not exists public.attendance_punches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id),
  membership_id uuid not null references public.memberships(id),
  event_type text not null check (event_type in ('entrada', 'almuerzo_inicio', 'almuerzo_fin', 'salida')),
  punched_at timestamptz not null default now(),
  device_id uuid references public.attendance_devices(id),
  photo_path text,
  source text not null default 'kiosco' check (source in ('kiosco', 'correccion')),
  note text,
  created_by uuid,
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  created_at timestamptz not null default now()
);
create index if not exists attendance_punches_org_time_idx on public.attendance_punches (organization_id, punched_at);
create index if not exists attendance_punches_member_time_idx on public.attendance_punches (membership_id, punched_at);

create table if not exists public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null references public.memberships(id),
  work_date date not null,
  event_type text not null check (event_type in ('entrada', 'almuerzo_inicio', 'almuerzo_fin', 'salida')),
  requested_time time not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_notes text,
  punch_id uuid references public.attendance_punches(id),
  created_at timestamptz not null default now()
);

create table if not exists public.attendance_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  work_date date not null,
  branch_id uuid references public.branches(id),
  start_time time not null,
  end_time time,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (membership_id, work_date)
);

alter table public.attendance_settings enable row level security;
alter table public.attendance_devices enable row level security;
alter table public.attendance_codes enable row level security;
alter table public.attendance_punches enable row level security;
alter table public.attendance_corrections enable row level security;
alter table public.attendance_schedules enable row level security;

-- ---------------------------------------------------------------------------
-- Ayudas internas
-- ---------------------------------------------------------------------------

create or replace function public.attendance_caller_role(p_org uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select m.role
  from memberships m
  where m.organization_id = p_org and m.user_id = auth.uid() and m.status = 'active'
  limit 1
$$;

create or replace function public.attendance_member_name(p_membership uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    nullif(trim(pr.display_name), ''),
    nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(u.raw_user_meta_data->>'name'), ''),
    nullif(split_part(u.email, '@', 1), ''),
    'Sin nombre'
  )
  from memberships m
  join auth.users u on u.id = m.user_id
  left join profiles pr on pr.id = m.user_id
  where m.id = p_membership
$$;

-- Minutos tarde para una marca de entrada. Regla: si llega dentro de la
-- tolerancia no cuenta como tarde; si la pasa, se cuentan TODOS los minutos
-- desde la hora de entrada del horario. Devuelve null si ese día no tiene
-- horario asignado (no se puede medir).
create or replace function public.attendance_late_minutes(p_org uuid, p_membership uuid, p_at timestamptz)
returns int
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_start time;
  v_tol int;
  v_local_date date;
  v_min int;
begin
  v_local_date := (p_at at time zone attendance_tz())::date;

  select s.start_time into v_start
  from attendance_schedules s
  where s.membership_id = p_membership and s.work_date = v_local_date;

  if v_start is null then
    return null;
  end if;

  select coalesce((select st.tolerance_minutes from attendance_settings st where st.organization_id = p_org), 5)
  into v_tol;

  v_min := floor(extract(epoch from (p_at - ((v_local_date + v_start) at time zone attendance_tz()))) / 60)::int;

  if v_min > v_tol then
    return v_min;
  end if;
  return 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- Configuración
-- ---------------------------------------------------------------------------

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
    'lunch_max_minutes', coalesce(s.lunch_max_minutes, 60)
  );
end;
$$;

create or replace function public.set_attendance_settings(
  p_organization_id uuid,
  p_tolerance_minutes int,
  p_daily_hours_cap numeric,
  p_lunch_max_minutes int
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

  insert into attendance_settings (organization_id, tolerance_minutes, daily_hours_cap, lunch_max_minutes, updated_at)
  values (p_organization_id, p_tolerance_minutes, p_daily_hours_cap, p_lunch_max_minutes, now())
  on conflict (organization_id) do update
    set tolerance_minutes = excluded.tolerance_minutes,
        daily_hours_cap = excluded.daily_hours_cap,
        lunch_max_minutes = excluded.lunch_max_minutes,
        updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Dispositivos de sucursal
-- ---------------------------------------------------------------------------

create or replace function public.register_attendance_device(p_organization_id uuid, p_branch_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role text;
  v_id uuid;
begin
  v_role := attendance_caller_role(p_organization_id);
  if v_role is null or v_role not in ('propietario', 'admin') then
    raise exception 'No autorizado';
  end if;

  if not exists (select 1 from branches b where b.id = p_branch_id and b.organization_id = p_organization_id and b.active) then
    raise exception 'Sucursal no válida';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Ponle un nombre al dispositivo';
  end if;

  insert into attendance_devices (organization_id, branch_id, name, registered_by)
  values (p_organization_id, p_branch_id, btrim(p_name), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

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
  if v_role is null or v_role not in ('propietario', 'admin', 'supervisor') then
    raise exception 'No autorizado';
  end if;

  return query
    select d.id, d.name, d.branch_id, b.name, d.active, d.created_at
    from attendance_devices d
    join branches b on b.id = d.branch_id
    where d.organization_id = p_organization_id
    order by d.created_at desc;
end;
$$;

create or replace function public.deactivate_attendance_device(p_device_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org uuid;
  v_role text;
begin
  select d.organization_id into v_org from attendance_devices d where d.id = p_device_id;
  if v_org is null then
    raise exception 'Dispositivo no encontrado';
  end if;

  v_role := attendance_caller_role(v_org);
  if v_role is null or v_role not in ('propietario', 'admin') then
    raise exception 'No autorizado';
  end if;

  update attendance_devices set active = false where id = p_device_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Código QR del empleado (un solo uso, ~45 segundos)
-- ---------------------------------------------------------------------------

create or replace function public.issue_attendance_code(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_membership uuid;
  v_code text;
  v_expires timestamptz;
begin
  select m.id into v_membership
  from memberships m
  where m.organization_id = p_organization_id and m.user_id = auth.uid() and m.status = 'active'
  limit 1;

  if v_membership is null then
    raise exception 'No autorizado';
  end if;

  -- Un solo código vivo por persona, y limpieza de los viejos.
  delete from attendance_codes where membership_id = v_membership and used_at is null;
  delete from attendance_codes where expires_at < now() - interval '1 hour';

  v_code := upper(substr(md5(random()::text || clock_timestamp()::text || gen_random_uuid()::text), 1, 10));
  v_expires := now() + interval '45 seconds';

  insert into attendance_codes (code, organization_id, membership_id, expires_at)
  values (v_code, p_organization_id, v_membership, v_expires);

  return jsonb_build_object('code', v_code, 'expires_at', v_expires);
end;
$$;

-- Qué puede marcar esta persona ahora, según su última marca de las últimas
-- 18 horas (cubre turnos nocturnos que cruzan la medianoche).
create or replace function public.attendance_allowed_events(p_membership uuid)
returns text[]
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_last text;
begin
  select p.event_type into v_last
  from attendance_punches p
  where p.membership_id = p_membership and p.voided_at is null and p.punched_at > now() - interval '18 hours'
  order by p.punched_at desc
  limit 1;

  return case v_last
    when 'entrada' then array['almuerzo_inicio', 'salida']
    when 'almuerzo_fin' then array['almuerzo_inicio', 'salida']
    when 'almuerzo_inicio' then array['almuerzo_fin']
    else array['entrada']
  end;
end;
$$;

-- El dispositivo escanea el QR: primero se "mira" el código (sin gastarlo)
-- para mostrar el nombre y las opciones válidas.
create or replace function public.peek_attendance_code(p_device_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_dev attendance_devices;
  v_role text;
  v_code attendance_codes;
  v_last record;
begin
  select * into v_dev from attendance_devices where id = p_device_id and active;
  if v_dev.id is null then
    raise exception 'Dispositivo no registrado o desactivado';
  end if;

  v_role := attendance_caller_role(v_dev.organization_id);
  if v_role is null or v_role not in ('propietario', 'admin', 'supervisor', 'marcador') then
    raise exception 'No autorizado';
  end if;

  select * into v_code
  from attendance_codes c
  where c.code = upper(btrim(p_code)) and c.used_at is null and c.expires_at > now()
    and c.organization_id = v_dev.organization_id;

  if v_code.code is null then
    raise exception 'Código no válido o vencido. Pide al empleado que actualice su QR.';
  end if;

  select p.event_type, p.punched_at into v_last
  from attendance_punches p
  where p.membership_id = v_code.membership_id and p.voided_at is null and p.punched_at > now() - interval '18 hours'
  order by p.punched_at desc
  limit 1;

  return jsonb_build_object(
    'employee_name', attendance_member_name(v_code.membership_id),
    'allowed', to_jsonb(attendance_allowed_events(v_code.membership_id)),
    'last_event', v_last.event_type,
    'last_at', v_last.punched_at
  );
end;
$$;

create or replace function public.record_attendance(
  p_device_id uuid,
  p_code text,
  p_event_type text,
  p_photo_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_dev attendance_devices;
  v_role text;
  v_code attendance_codes;
  v_used text;
  v_now timestamptz := now();
  v_late int;
  v_branch_name text;
begin
  select * into v_dev from attendance_devices where id = p_device_id and active;
  if v_dev.id is null then
    raise exception 'Dispositivo no registrado o desactivado';
  end if;

  v_role := attendance_caller_role(v_dev.organization_id);
  if v_role is null or v_role not in ('propietario', 'admin', 'supervisor', 'marcador') then
    raise exception 'No autorizado';
  end if;

  select * into v_code
  from attendance_codes c
  where c.code = upper(btrim(p_code)) and c.used_at is null and c.expires_at > v_now
    and c.organization_id = v_dev.organization_id;

  if v_code.code is null then
    raise exception 'Código no válido o vencido. Pide al empleado que actualice su QR.';
  end if;

  if p_event_type is null or not (p_event_type = any (attendance_allowed_events(v_code.membership_id))) then
    raise exception 'Esa marca no corresponde ahora';
  end if;

  if p_photo_path is not null and split_part(p_photo_path, '/', 1) <> v_dev.organization_id::text then
    raise exception 'Foto no válida';
  end if;

  -- Gastar el código de forma atómica: si dos dispositivos lo escanean a la
  -- vez, solo uno lo consigue.
  update attendance_codes set used_at = v_now
  where code = v_code.code and used_at is null
  returning code into v_used;

  if v_used is null then
    raise exception 'Este código ya se usó. Pide al empleado que actualice su QR.';
  end if;

  insert into attendance_punches (organization_id, branch_id, membership_id, event_type, punched_at, device_id, photo_path, source, created_by)
  values (v_dev.organization_id, v_dev.branch_id, v_code.membership_id, p_event_type, v_now, v_dev.id, p_photo_path, 'kiosco', auth.uid());

  if p_event_type = 'entrada' then
    v_late := attendance_late_minutes(v_dev.organization_id, v_code.membership_id, v_now);
  end if;

  select b.name into v_branch_name from branches b where b.id = v_dev.branch_id;

  return jsonb_build_object(
    'employee_name', attendance_member_name(v_code.membership_id),
    'event_type', p_event_type,
    'punched_at', v_now,
    'late_minutes', v_late,
    'branch_name', v_branch_name
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Lo que ve cada empleado de sí mismo
-- ---------------------------------------------------------------------------

create or replace function public.my_attendance(p_organization_id uuid, p_from date, p_to date)
returns table (punch_id uuid, event_type text, punched_at timestamptz, branch_name text, source text, voided boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_membership uuid;
begin
  select m.id into v_membership
  from memberships m
  where m.organization_id = p_organization_id and m.user_id = auth.uid() and m.status = 'active'
  limit 1;

  if v_membership is null then
    raise exception 'No autorizado';
  end if;

  return query
    select p.id, p.event_type, p.punched_at, b.name, p.source, (p.voided_at is not null)
    from attendance_punches p
    left join branches b on b.id = p.branch_id
    where p.membership_id = v_membership
      and p.punched_at >= (p_from::timestamp at time zone attendance_tz())
      and p.punched_at < ((p_to + 1)::timestamp at time zone attendance_tz())
    order by p.punched_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Horarios (cuadrícula semanal)
-- ---------------------------------------------------------------------------

create or replace function public.list_attendance_employees(p_organization_id uuid)
returns table (membership_id uuid, display_name text, role text)
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
    select m.id, attendance_member_name(m.id), m.role
    from memberships m
    where m.organization_id = p_organization_id and m.status = 'active'
    order by attendance_member_name(m.id);
end;
$$;

create or replace function public.list_attendance_schedule(p_organization_id uuid, p_from date, p_to date)
returns table (membership_id uuid, work_date date, branch_id uuid, branch_name text, start_time time, end_time time)
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
    select s.membership_id, s.work_date, s.branch_id, b.name, s.start_time, s.end_time
    from attendance_schedules s
    left join branches b on b.id = s.branch_id
    where s.organization_id = p_organization_id and s.work_date between p_from and p_to;
end;
$$;

create or replace function public.set_attendance_schedule(
  p_organization_id uuid,
  p_membership_id uuid,
  p_work_date date,
  p_branch_id uuid,
  p_start_time time,
  p_end_time time default null
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
  if v_role is null or v_role not in ('propietario', 'admin', 'supervisor') then
    raise exception 'No autorizado';
  end if;

  if not exists (select 1 from memberships m where m.id = p_membership_id and m.organization_id = p_organization_id) then
    raise exception 'Empleado no válido';
  end if;

  if p_branch_id is not null and not exists (select 1 from branches b where b.id = p_branch_id and b.organization_id = p_organization_id) then
    raise exception 'Sucursal no válida';
  end if;

  insert into attendance_schedules (organization_id, membership_id, work_date, branch_id, start_time, end_time, created_by)
  values (p_organization_id, p_membership_id, p_work_date, p_branch_id, p_start_time, p_end_time, auth.uid())
  on conflict (membership_id, work_date) do update
    set branch_id = excluded.branch_id, start_time = excluded.start_time, end_time = excluded.end_time, created_by = auth.uid();
end;
$$;

create or replace function public.clear_attendance_schedule(p_organization_id uuid, p_membership_id uuid, p_work_date date)
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

  delete from attendance_schedules
  where organization_id = p_organization_id and membership_id = p_membership_id and work_date = p_work_date;
end;
$$;

-- Copia la semana (7 días desde p_from_monday) a otra semana, sin pisar lo
-- que ya esté asignado ahí.
create or replace function public.copy_attendance_week(p_organization_id uuid, p_from_monday date, p_to_monday date)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role text;
  v_count int;
begin
  v_role := attendance_caller_role(p_organization_id);
  if v_role is null or v_role not in ('propietario', 'admin', 'supervisor') then
    raise exception 'No autorizado';
  end if;

  insert into attendance_schedules (organization_id, membership_id, work_date, branch_id, start_time, end_time, created_by)
  select s.organization_id, s.membership_id, s.work_date + (p_to_monday - p_from_monday), s.branch_id, s.start_time, s.end_time, auth.uid()
  from attendance_schedules s
  join memberships m on m.id = s.membership_id and m.status = 'active'
  where s.organization_id = p_organization_id
    and s.work_date between p_from_monday and p_from_monday + 6
  on conflict (membership_id, work_date) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reporte (una fila por empleado y día; día/semana/mes/año se agrupan en la app)
-- ---------------------------------------------------------------------------

create or replace function public.attendance_report(
  p_organization_id uuid,
  p_from date,
  p_to date,
  p_membership_id uuid default null,
  p_branch_id uuid default null
)
returns table (
  work_date date,
  membership_id uuid,
  employee_name text,
  branch_name text,
  scheduled_start time,
  first_in timestamptz,
  last_out timestamptz,
  lunch_minutes int,
  lunch_over_minutes int,
  worked_minutes int,
  late_minutes int,
  overtime_minutes int,
  incomplete boolean,
  absent boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_role text;
  v_tol int;
  v_cap numeric;
  v_lunch_max int;
  v_today date;
  v_now_time time;
begin
  v_role := attendance_caller_role(p_organization_id);
  if v_role is null or v_role not in ('propietario', 'admin', 'supervisor', 'contador', 'auditor') then
    raise exception 'No autorizado';
  end if;

  if p_from is null or p_to is null or p_to < p_from or (p_to - p_from) > 400 then
    raise exception 'Rango de fechas no válido';
  end if;

  select
    coalesce((select st.tolerance_minutes from attendance_settings st where st.organization_id = p_organization_id), 5),
    coalesce((select st.daily_hours_cap from attendance_settings st where st.organization_id = p_organization_id), 8),
    coalesce((select st.lunch_max_minutes from attendance_settings st where st.organization_id = p_organization_id), 60)
  into v_tol, v_cap, v_lunch_max;

  v_today := (now() at time zone attendance_tz())::date;
  v_now_time := (now() at time zone attendance_tz())::time;

  return query
  with base as (
    select p.id, p.membership_id, p.branch_id, p.event_type, p.punched_at,
           (p.punched_at at time zone attendance_tz())::date as local_date
    from attendance_punches p
    where p.organization_id = p_organization_id
      and p.voided_at is null
      and p.punched_at >= ((p_from - 1)::timestamp at time zone attendance_tz())
      and p.punched_at < ((p_to + 2)::timestamp at time zone attendance_tz())
      and (p_membership_id is null or p.membership_id = p_membership_id)
  ),
  -- Cada marca pertenece al día de la entrada que la abrió (hasta 18 h antes),
  -- así un turno nocturno no se parte en dos días.
  assigned as (
    select b.id, b.membership_id, b.branch_id, b.event_type, b.punched_at,
      case
        when b.event_type = 'entrada' then b.local_date
        else coalesce(
          (select (e.punched_at at time zone attendance_tz())::date
           from base e
           where e.membership_id = b.membership_id
             and e.event_type = 'entrada'
             and e.punched_at <= b.punched_at
             and b.punched_at - e.punched_at < interval '18 hours'
           order by e.punched_at desc
           limit 1),
          b.local_date)
      end as work_date
    from base b
  ),
  seq as (
    select a.membership_id, a.work_date, a.branch_id, a.event_type, a.punched_at,
      lag(a.event_type) over w as prev_event,
      lag(a.punched_at) over w as prev_at,
      max(a.punched_at) filter (where a.event_type = 'entrada')
        over (partition by a.membership_id, a.work_date order by a.punched_at
              rows between unbounded preceding and 1 preceding) as last_entry_before
    from assigned a
    window w as (partition by a.membership_id, a.work_date order by a.punched_at)
  ),
  daily as (
    select s.membership_id, s.work_date,
      min(s.punched_at) filter (where s.event_type = 'entrada') as first_in,
      max(s.punched_at) filter (where s.event_type = 'salida') as last_out,
      count(*) filter (where s.event_type = 'entrada') as cnt_in,
      count(*) filter (where s.event_type = 'salida') as cnt_out,
      count(*) filter (where s.event_type = 'almuerzo_inicio') as cnt_ls,
      count(*) filter (where s.event_type = 'almuerzo_fin') as cnt_le,
      coalesce(sum(extract(epoch from (s.punched_at - s.prev_at)) / 60)
        filter (where s.event_type = 'almuerzo_fin' and s.prev_event = 'almuerzo_inicio'), 0) as lunch_min,
      coalesce(sum(extract(epoch from (s.punched_at - s.last_entry_before)) / 60)
        filter (where s.event_type = 'salida' and s.last_entry_before is not null), 0) as gross_min,
      (array_agg(s.branch_id order by s.punched_at) filter (where s.event_type = 'entrada'))[1] as branch_id
    from seq s
    group by s.membership_id, s.work_date
  )
  select r.work_date, r.membership_id, r.employee_name, r.branch_name, r.scheduled_start, r.first_in, r.last_out,
         r.lunch_minutes, r.lunch_over_minutes, r.worked_minutes, r.late_minutes, r.overtime_minutes, r.incomplete, r.absent
  from (
    select
      d.work_date as work_date,
      d.membership_id as membership_id,
      attendance_member_name(d.membership_id) as employee_name,
      br.name as branch_name,
      sc.start_time as scheduled_start,
      d.first_in as first_in,
      d.last_out as last_out,
      round(d.lunch_min)::int as lunch_minutes,
      greatest(0, round(d.lunch_min)::int - v_lunch_max) as lunch_over_minutes,
      greatest(0, round(d.gross_min - d.lunch_min))::int as worked_minutes,
      case
        when sc.start_time is null or d.first_in is null then 0
        else (
          select case when t.m > v_tol then t.m else 0 end
          from (select floor(extract(epoch from (d.first_in - ((d.work_date + sc.start_time) at time zone attendance_tz()))) / 60)::int as m) t
        )
      end as late_minutes,
      greatest(0, round(d.gross_min - d.lunch_min - v_cap * 60))::int as overtime_minutes,
      (d.cnt_in = 0 or d.cnt_out < d.cnt_in or d.cnt_ls <> d.cnt_le) as incomplete,
      false as absent
    from daily d
    left join branches br on br.id = d.branch_id
    left join attendance_schedules sc on sc.membership_id = d.membership_id and sc.work_date = d.work_date
    where (p_branch_id is null or d.branch_id = p_branch_id)

    union all

    -- Días con horario asignado y ninguna marca: ausencia (el día de hoy solo
    -- cuenta si ya pasó la hora de entrada más la tolerancia).
    select
      sc.work_date,
      sc.membership_id,
      attendance_member_name(sc.membership_id),
      br.name,
      sc.start_time,
      null::timestamptz,
      null::timestamptz,
      0, 0, 0, 0, 0,
      false,
      true
    from attendance_schedules sc
    left join branches br on br.id = sc.branch_id
    where sc.organization_id = p_organization_id
      and sc.work_date between p_from and p_to
      and (p_membership_id is null or sc.membership_id = p_membership_id)
      and (p_branch_id is null or sc.branch_id = p_branch_id)
      and (sc.work_date < v_today or (sc.work_date = v_today and v_now_time > sc.start_time + make_interval(mins => v_tol)))
      and not exists (select 1 from daily d where d.membership_id = sc.membership_id and d.work_date = sc.work_date)
  ) r
  where r.work_date between p_from and p_to
  order by r.work_date desc, r.employee_name;
end;
$$;

-- Marcas de un día (con foto) para auditar un caso concreto.
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
  void_reason text
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
    select p.id, p.event_type, p.punched_at, b.name, p.source, p.note, p.photo_path, p.voided_at, p.void_reason
    from attendance_punches p
    left join branches b on b.id = p.branch_id
    where p.organization_id = p_organization_id
      and p.membership_id = p_membership_id
      and p.punched_at >= (p_work_date::timestamp at time zone attendance_tz())
      and p.punched_at < ((p_work_date + 1)::timestamp at time zone attendance_tz())
    order by p.punched_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Correcciones (con historial: nunca se edita una marca, se agrega otra)
-- ---------------------------------------------------------------------------

create or replace function public.request_attendance_correction(
  p_organization_id uuid,
  p_work_date date,
  p_event_type text,
  p_time time,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_membership uuid;
  v_id uuid;
begin
  select m.id into v_membership
  from memberships m
  where m.organization_id = p_organization_id and m.user_id = auth.uid() and m.status = 'active'
  limit 1;

  if v_membership is null then
    raise exception 'No autorizado';
  end if;

  if p_event_type not in ('entrada', 'almuerzo_inicio', 'almuerzo_fin', 'salida') then
    raise exception 'Tipo de marca no válido';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Escribe el motivo de la corrección';
  end if;

  if p_work_date > (now() at time zone attendance_tz())::date or p_work_date < (now() at time zone attendance_tz())::date - 45 then
    raise exception 'La fecha debe ser de los últimos 45 días';
  end if;

  insert into attendance_corrections (organization_id, membership_id, work_date, event_type, requested_time, reason, requested_by)
  values (p_organization_id, v_membership, p_work_date, p_event_type, p_time, btrim(p_reason), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.list_attendance_corrections(p_organization_id uuid, p_status text default 'pending')
returns table (
  correction_id uuid,
  membership_id uuid,
  employee_name text,
  work_date date,
  event_type text,
  requested_time time,
  reason text,
  status text,
  review_notes text,
  created_at timestamptz,
  reviewed_at timestamptz
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
    select c.id, c.membership_id, attendance_member_name(c.membership_id), c.work_date, c.event_type,
           c.requested_time, c.reason, c.status, c.review_notes, c.created_at, c.reviewed_at
    from attendance_corrections c
    where c.organization_id = p_organization_id
      and (p_status is null or c.status = p_status)
    order by c.created_at desc
    limit 300;
end;
$$;

create or replace function public.review_attendance_correction(p_correction_id uuid, p_approve boolean, p_notes text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_c attendance_corrections;
  v_role text;
  v_own uuid;
  v_punch uuid;
  v_branch uuid;
begin
  select * into v_c from attendance_corrections where id = p_correction_id;
  if v_c.id is null then
    raise exception 'Solicitud no encontrada';
  end if;
  if v_c.status <> 'pending' then
    raise exception 'Esta solicitud ya fue revisada';
  end if;

  v_role := attendance_caller_role(v_c.organization_id);
  if v_role is null or v_role not in ('propietario', 'admin', 'supervisor') then
    raise exception 'No autorizado';
  end if;

  -- Nadie aprueba su propia corrección.
  select m.id into v_own from memberships m
  where m.organization_id = v_c.organization_id and m.user_id = auth.uid() and m.status = 'active' limit 1;
  if v_own = v_c.membership_id then
    raise exception 'No puedes aprobar tu propia corrección';
  end if;

  if p_approve then
    select s.branch_id into v_branch from attendance_schedules s
    where s.membership_id = v_c.membership_id and s.work_date = v_c.work_date;

    insert into attendance_punches (organization_id, branch_id, membership_id, event_type, punched_at, source, note, created_by)
    values (v_c.organization_id, v_branch, v_c.membership_id, v_c.event_type,
            ((v_c.work_date + v_c.requested_time) at time zone attendance_tz()),
            'correccion', 'Corrección aprobada: ' || v_c.reason, auth.uid())
    returning id into v_punch;
  end if;

  update attendance_corrections
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = auth.uid(), reviewed_at = now(), review_notes = nullif(btrim(coalesce(p_notes, '')), ''),
      punch_id = v_punch
  where id = p_correction_id;
end;
$$;

-- Un supervisor agrega directamente una marca olvidada (queda como corrección
-- ya aprobada, con motivo y quién la hizo).
create or replace function public.add_manual_attendance_punch(
  p_organization_id uuid,
  p_membership_id uuid,
  p_work_date date,
  p_event_type text,
  p_time time,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role text;
  v_branch uuid;
  v_punch uuid;
begin
  v_role := attendance_caller_role(p_organization_id);
  if v_role is null or v_role not in ('propietario', 'admin', 'supervisor') then
    raise exception 'No autorizado';
  end if;

  if not exists (select 1 from memberships m where m.id = p_membership_id and m.organization_id = p_organization_id) then
    raise exception 'Empleado no válido';
  end if;

  if p_event_type not in ('entrada', 'almuerzo_inicio', 'almuerzo_fin', 'salida') then
    raise exception 'Tipo de marca no válido';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Escribe el motivo';
  end if;

  select s.branch_id into v_branch from attendance_schedules s
  where s.membership_id = p_membership_id and s.work_date = p_work_date;

  insert into attendance_punches (organization_id, branch_id, membership_id, event_type, punched_at, source, note, created_by)
  values (p_organization_id, v_branch, p_membership_id, p_event_type,
          ((p_work_date + p_time) at time zone attendance_tz()),
          'correccion', 'Marca agregada por supervisor: ' || btrim(p_reason), auth.uid())
  returning id into v_punch;

  return v_punch;
end;
$$;

create or replace function public.void_attendance_punch(p_punch_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org uuid;
  v_role text;
begin
  select p.organization_id into v_org from attendance_punches p where p.id = p_punch_id;
  if v_org is null then
    raise exception 'Marca no encontrada';
  end if;

  v_role := attendance_caller_role(v_org);
  if v_role is null or v_role not in ('propietario', 'admin', 'supervisor') then
    raise exception 'No autorizado';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Escribe el motivo';
  end if;

  update attendance_punches
  set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
  where id = p_punch_id and voided_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fotos de las marcas (bucket privado)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('attendance-photos', 'attendance-photos', false)
on conflict (id) do nothing;

drop policy if exists "Dispositivo sube fotos de asistencia de su empresa" on storage.objects;
create policy "Dispositivo sube fotos de asistencia de su empresa"
  on storage.objects for insert
  with check (
    bucket_id = 'attendance-photos'
    and ((storage.foldername(name))[1])::uuid in (
      select m.organization_id from memberships m
      where m.user_id = auth.uid() and m.status = 'active' and m.role in ('propietario', 'admin', 'supervisor', 'marcador')
    )
  );

drop policy if exists "El equipo ve fotos de asistencia de su empresa" on storage.objects;
create policy "El equipo ve fotos de asistencia de su empresa"
  on storage.objects for select
  using (
    bucket_id = 'attendance-photos'
    and ((storage.foldername(name))[1])::uuid in (
      select m.organization_id from memberships m
      where m.user_id = auth.uid() and m.status = 'active' and m.role in ('propietario', 'admin', 'supervisor', 'contador', 'auditor')
    )
  );

-- ---------------------------------------------------------------------------
-- Permisos: solo usuarios con sesión pueden llamar estas funciones
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'attendance_caller_role', 'attendance_member_name', 'attendance_late_minutes', 'attendance_allowed_events',
        'get_attendance_settings', 'set_attendance_settings',
        'register_attendance_device', 'list_attendance_devices', 'deactivate_attendance_device',
        'issue_attendance_code', 'peek_attendance_code', 'record_attendance', 'my_attendance',
        'list_attendance_employees', 'list_attendance_schedule', 'set_attendance_schedule',
        'clear_attendance_schedule', 'copy_attendance_week', 'attendance_report', 'list_attendance_punches',
        'request_attendance_correction', 'list_attendance_corrections', 'review_attendance_correction',
        'add_manual_attendance_punch', 'void_attendance_punch'
      ])
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
