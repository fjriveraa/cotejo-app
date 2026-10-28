-- Almuerzo asignado por turno + importación masiva de horarios (la lectura del
-- archivo la hace la función parse-schedule; aquí solo se guarda lo confirmado).
-- Requiere a, b, c y d aplicadas antes.

alter table public.attendance_schedules add column if not exists lunch_start time;

drop function if exists public.set_attendance_schedule(uuid, uuid, date, uuid, time, time);
create or replace function public.set_attendance_schedule(
  p_organization_id uuid,
  p_membership_id uuid,
  p_work_date date,
  p_branch_id uuid,
  p_start_time time,
  p_end_time time default null,
  p_lunch_start time default null
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

  insert into attendance_schedules (organization_id, membership_id, work_date, branch_id, start_time, end_time, lunch_start, created_by)
  values (p_organization_id, p_membership_id, p_work_date, p_branch_id, p_start_time, p_end_time, p_lunch_start, auth.uid())
  on conflict (membership_id, work_date) do update
    set branch_id = excluded.branch_id, start_time = excluded.start_time, end_time = excluded.end_time,
        lunch_start = excluded.lunch_start, created_by = auth.uid();
end;
$$;

-- Guarda de una vez los turnos que el usuario confirmó en la vista previa.
-- p_rows: [{membership_id, work_date, branch_id, start_time, end_time, lunch_start}]
create or replace function public.import_attendance_schedule(p_organization_id uuid, p_rows jsonb)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role text;
  r jsonb;
  v_count int := 0;
  v_mid uuid;
  v_branch uuid;
  v_date date;
  v_start time;
begin
  v_role := attendance_caller_role(p_organization_id);
  if v_role is null or v_role not in ('propietario', 'admin', 'supervisor') then
    raise exception 'No autorizado';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Datos no válidos';
  end if;
  if jsonb_array_length(p_rows) > 1000 then
    raise exception 'Demasiados turnos a la vez (máximo 1000)';
  end if;

  for r in select * from jsonb_array_elements(p_rows)
  loop
    v_mid := nullif(r->>'membership_id', '')::uuid;
    v_date := nullif(r->>'work_date', '')::date;
    v_start := nullif(r->>'start_time', '')::time;
    v_branch := nullif(r->>'branch_id', '')::uuid;
    if v_mid is null or v_date is null or v_start is null then
      continue;
    end if;
    if not exists (select 1 from memberships m where m.id = v_mid and m.organization_id = p_organization_id) then
      raise exception 'Empleado no válido';
    end if;
    if v_branch is not null and not exists (select 1 from branches b where b.id = v_branch and b.organization_id = p_organization_id) then
      v_branch := null;
    end if;

    insert into attendance_schedules (organization_id, membership_id, work_date, branch_id, start_time, end_time, lunch_start, created_by)
    values (p_organization_id, v_mid, v_date, v_branch, v_start,
            nullif(r->>'end_time', '')::time, nullif(r->>'lunch_start', '')::time, auth.uid())
    on conflict (membership_id, work_date) do update
      set branch_id = excluded.branch_id, start_time = excluded.start_time, end_time = excluded.end_time,
          lunch_start = excluded.lunch_start, created_by = auth.uid();
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Turno de hoy del empleado que llama (para mostrarle su almuerzo asignado).
create or replace function public.my_today_schedule(p_organization_id uuid)
returns table (start_time time, lunch_start time, end_time time, branch_name text)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_membership uuid;
  v_today date := (now() at time zone attendance_tz())::date;
begin
  select m.id into v_membership
  from memberships m
  where m.organization_id = p_organization_id and m.user_id = auth.uid() and m.status = 'active'
  limit 1;
  if v_membership is null then
    raise exception 'No autorizado';
  end if;

  return query
    select e.start_time, s.lunch_start, s.end_time, b.name
    from attendance_effective_schedule(p_organization_id, v_today, v_today, v_membership) e
    left join attendance_schedules s on s.membership_id = e.membership_id and s.work_date = e.work_date
    left join branches b on b.id = e.branch_id
    limit 1;
end;
$$;

drop function if exists public.list_attendance_schedule(uuid, date, date);
create or replace function public.list_attendance_schedule(p_organization_id uuid, p_from date, p_to date)
returns table (membership_id uuid, work_date date, branch_id uuid, branch_name text, start_time time, end_time time, is_default boolean, lunch_start time)
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
    select e.membership_id, e.work_date, e.branch_id, b.name, e.start_time, s.end_time,
           (s.membership_id is null), s.lunch_start
    from attendance_effective_schedule(p_organization_id, p_from, p_to, null) e
    left join attendance_schedules s on s.membership_id = e.membership_id and s.work_date = e.work_date
    left join branches b on b.id = e.branch_id;
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
      and p.proname = any (array['set_attendance_schedule', 'import_attendance_schedule', 'my_today_schedule', 'list_attendance_schedule'])
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
