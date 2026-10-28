-- Almuerzo asignado por turno + importación masiva de horarios (la lectura del
-- archivo la hace la función parse-schedule; aquí solo se guarda lo confirmado).
-- Requiere a, b, c y d aplicadas antes.

alter table public.attendance_schedules add column if not exists lunch_start time;

-- Días libres: el colaborador no trabaja ese día aunque tenga horario fijo.
-- No cuentan como ausencia; si aun así marca, se registra normal.
create table if not exists public.attendance_days_off (
  membership_id uuid not null references public.memberships(id) on delete cascade,
  work_date date not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (membership_id, work_date)
);
alter table public.attendance_days_off enable row level security;

-- Turnos efectivos (reemplaza la de la migración d): ahora sin los días libres.
create or replace function public.attendance_effective_schedule(p_org uuid, p_from date, p_to date, p_membership uuid default null)
returns table (organization_id uuid, membership_id uuid, work_date date, branch_id uuid, start_time time)
language sql
stable
security definer
set search_path to 'public'
as $$
  select s.organization_id, s.membership_id, s.work_date, s.branch_id, s.start_time
  from attendance_schedules s
  where s.organization_id = p_org and s.work_date between p_from and p_to
    and (p_membership is null or s.membership_id = p_membership)
    and not exists (select 1 from attendance_days_off o where o.membership_id = s.membership_id and o.work_date = s.work_date)
  union all
  select pr.organization_id, pr.membership_id, d::date, pr.branch_id, pr.start_time
  from attendance_profiles pr
  join memberships m on m.id = pr.membership_id and m.status = 'active'
  cross join generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
  where pr.organization_id = p_org and pr.mode = 'fijo' and pr.start_time is not null
    and (p_membership is null or pr.membership_id = p_membership)
    and extract(isodow from d)::int = any (pr.work_days)
    and not exists (select 1 from attendance_schedules s2 where s2.membership_id = pr.membership_id and s2.work_date = d::date)
    and not exists (select 1 from attendance_days_off o where o.membership_id = pr.membership_id and o.work_date = d::date);
$$;

create or replace function public.list_attendance_days_off(p_organization_id uuid, p_from date, p_to date)
returns table (membership_id uuid, work_date date)
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
    select o.membership_id, o.work_date from attendance_days_off o
    where o.organization_id = p_organization_id and o.work_date between p_from and p_to;
end;
$$;

create or replace function public.set_attendance_day_off(p_organization_id uuid, p_membership_id uuid, p_work_date date, p_off boolean)
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
  if p_off then
    delete from attendance_schedules where membership_id = p_membership_id and work_date = p_work_date;
    insert into attendance_days_off (membership_id, work_date, organization_id, created_by)
    values (p_membership_id, p_work_date, p_organization_id, auth.uid())
    on conflict do nothing;
  else
    delete from attendance_days_off where membership_id = p_membership_id and work_date = p_work_date;
  end if;
end;
$$;

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

  delete from attendance_days_off where membership_id = p_membership_id and work_date = p_work_date;

  insert into attendance_schedules (organization_id, membership_id, work_date, branch_id, start_time, end_time, lunch_start, created_by)
  values (p_organization_id, p_membership_id, p_work_date, p_branch_id, p_start_time, p_end_time, p_lunch_start, auth.uid())
  on conflict (membership_id, work_date) do update
    set branch_id = excluded.branch_id, start_time = excluded.start_time, end_time = excluded.end_time,
        lunch_start = excluded.lunch_start, created_by = auth.uid();
end;
$$;

-- Guarda de una vez los turnos que el usuario confirmó en la vista previa.
-- p_rows: [{membership_id, work_date, branch_id, start_time, end_time, lunch_start}]
drop function if exists public.import_attendance_schedule(uuid, jsonb);
create or replace function public.import_attendance_schedule(p_organization_id uuid, p_rows jsonb, p_days_off jsonb default '[]'::jsonb)
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

    delete from attendance_days_off where membership_id = v_mid and work_date = v_date;
    insert into attendance_schedules (organization_id, membership_id, work_date, branch_id, start_time, end_time, lunch_start, created_by)
    values (p_organization_id, v_mid, v_date, v_branch, v_start,
            nullif(r->>'end_time', '')::time, nullif(r->>'lunch_start', '')::time, auth.uid())
    on conflict (membership_id, work_date) do update
      set branch_id = excluded.branch_id, start_time = excluded.start_time, end_time = excluded.end_time,
          lunch_start = excluded.lunch_start, created_by = auth.uid();
    v_count := v_count + 1;
  end loop;

  -- Días libres confirmados: [{membership_id, work_date}]
  if p_days_off is not null and jsonb_typeof(p_days_off) = 'array' then
    for r in select * from jsonb_array_elements(p_days_off)
    loop
      v_mid := nullif(r->>'membership_id', '')::uuid;
      v_date := nullif(r->>'work_date', '')::date;
      if v_mid is null or v_date is null then
        continue;
      end if;
      if not exists (select 1 from memberships m where m.id = v_mid and m.organization_id = p_organization_id) then
        raise exception 'Empleado no válido';
      end if;
      delete from attendance_schedules where membership_id = v_mid and work_date = v_date;
      insert into attendance_days_off (membership_id, work_date, organization_id, created_by)
      values (v_mid, v_date, p_organization_id, auth.uid())
      on conflict do nothing;
      v_count := v_count + 1;
    end loop;
  end if;

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
      and p.proname = any (array['set_attendance_schedule', 'import_attendance_schedule', 'my_today_schedule', 'list_attendance_schedule', 'attendance_effective_schedule', 'list_attendance_days_off', 'set_attendance_day_off'])
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
