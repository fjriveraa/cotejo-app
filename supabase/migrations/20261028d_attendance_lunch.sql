-- Almuerzo con pausas, flujo de marcas simplificado e historial del empleado.
-- Requiere a, b y c aplicadas antes.
--
-- Marcas nuevas: almuerzo_pausa / almuerzo_reanuda (interrupciones del almuerzo).
-- Flujo: entrada -> almuerzo_inicio -> (pausa <-> reanuda)* -> almuerzo_fin -> salida.
-- Un solo almuerzo por día. Las pausas y reanudaciones no piden foto.
-- Almuerzo efectivo = (fin - inicio) - tiempo en pausa. "No cuadra" = el efectivo
-- difiere del estipulado por más que la tolerancia.

alter table public.attendance_punches drop constraint if exists attendance_punches_event_type_check;
alter table public.attendance_punches
  add constraint attendance_punches_event_type_check
  check (event_type in ('entrada', 'almuerzo_inicio', 'almuerzo_pausa', 'almuerzo_reanuda', 'almuerzo_fin', 'salida'));

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
    when 'almuerzo_inicio' then array['almuerzo_fin', 'almuerzo_pausa']
    when 'almuerzo_pausa' then array['almuerzo_reanuda', 'almuerzo_fin']
    when 'almuerzo_reanuda' then array['almuerzo_fin', 'almuerzo_pausa']
    when 'almuerzo_fin' then array['salida']
    else array['entrada']
  end;
end;
$$;

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
  v_qr boolean;
  v_stip int;
  v_last record;
  v_ls timestamptz;
  v_open boolean := false;
  v_paused_seconds numeric := 0;
  v_paused_since timestamptz;
  r record;
  v_lunch jsonb := null;
begin
  select m.id into v_membership
  from memberships m
  where m.organization_id = p_organization_id and m.user_id = auth.uid() and m.status = 'active'
  limit 1;

  if v_membership is null then
    raise exception 'No autorizado';
  end if;

  select coalesce((select st.allow_self_punch from attendance_settings st where st.organization_id = p_organization_id), false),
         coalesce((select st.method_qr from attendance_settings st where st.organization_id = p_organization_id), true),
         coalesce((select st.lunch_max_minutes from attendance_settings st where st.organization_id = p_organization_id), 60)
  into v_allow, v_qr, v_stip;

  select p.event_type, p.punched_at into v_last
  from attendance_punches p
  where p.membership_id = v_membership and p.voided_at is null and p.punched_at > now() - interval '18 hours'
  order by p.punched_at desc
  limit 1;

  -- Almuerzo en curso: desde el último inicio, sin fin posterior.
  select max(p.punched_at) into v_ls
  from attendance_punches p
  where p.membership_id = v_membership and p.voided_at is null and p.event_type = 'almuerzo_inicio'
    and p.punched_at > now() - interval '18 hours';

  if v_ls is not null and v_last.event_type in ('almuerzo_inicio', 'almuerzo_pausa', 'almuerzo_reanuda') then
    v_open := true;
    for r in
      select p.event_type, p.punched_at
      from attendance_punches p
      where p.membership_id = v_membership and p.voided_at is null and p.punched_at > v_ls
        and p.event_type in ('almuerzo_pausa', 'almuerzo_reanuda')
      order by p.punched_at
    loop
      if r.event_type = 'almuerzo_pausa' then
        v_paused_since := r.punched_at;
      elsif v_paused_since is not null then
        v_paused_seconds := v_paused_seconds + extract(epoch from (r.punched_at - v_paused_since));
        v_paused_since := null;
      end if;
    end loop;
  end if;

  if v_open then
    v_lunch := jsonb_build_object(
      'started_at', v_ls,
      'paused_seconds', round(v_paused_seconds),
      'paused_since', v_paused_since,
      'stipulated_minutes', v_stip
    );
  end if;

  return jsonb_build_object(
    'allow_self_punch', v_allow,
    'method_qr', v_qr,
    'allowed', to_jsonb(attendance_allowed_events(v_membership)),
    'last_event', v_last.event_type,
    'last_at', v_last.punched_at,
    'lunch', v_lunch,
    'stipulated_minutes', v_stip
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
  v_needs_photo boolean;
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

  v_needs_photo := p_event_type not in ('almuerzo_pausa', 'almuerzo_reanuda');

  if v_needs_photo then
    if coalesce(btrim(p_photo_path), '') = '' then
      raise exception 'Se necesita la foto para marcar';
    end if;
  end if;
  if coalesce(btrim(p_photo_path), '') <> '' then
    if split_part(p_photo_path, '/', 1) <> p_organization_id::text
       or split_part(p_photo_path, '/', 2) <> 'self'
       or split_part(p_photo_path, '/', 3) <> auth.uid()::text then
      raise exception 'Foto no válida';
    end if;
  end if;

  select s.branch_id into v_branch from attendance_schedules s
  where s.membership_id = v_membership and s.work_date = (v_now at time zone attendance_tz())::date;

  insert into attendance_punches (organization_id, branch_id, membership_id, event_type, punched_at, photo_path, source, geo, created_by)
  values (p_organization_id, v_branch, v_membership, p_event_type, v_now, nullif(btrim(coalesce(p_photo_path, '')), ''), 'telefono',
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

-- Historial del empleado: una fila por día trabajado.
create or replace function public.my_attendance_days(p_organization_id uuid, p_from date, p_to date)
returns table (
  work_date date,
  first_in timestamptz,
  lunch_start timestamptz,
  lunch_end timestamptz,
  last_out timestamptz,
  scheduled_start time,
  late_minutes int,
  lunch_minutes int,
  lunch_pause_minutes int,
  worked_minutes int,
  incomplete boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_membership uuid;
  v_tol int;
begin
  select m.id into v_membership
  from memberships m
  where m.organization_id = p_organization_id and m.user_id = auth.uid() and m.status = 'active'
  limit 1;

  if v_membership is null then
    raise exception 'No autorizado';
  end if;

  if p_from is null or p_to is null or p_to < p_from or (p_to - p_from) > 400 then
    raise exception 'Rango de fechas no válido';
  end if;

  v_tol := coalesce((select st.tolerance_minutes from attendance_settings st where st.organization_id = p_organization_id), 5);

  return query
  with ent as (
    select p.punched_at as t_in,
           (p.punched_at at time zone attendance_tz())::date as d,
           least(coalesce(lead(p.punched_at) over (order by p.punched_at), 'infinity'::timestamptz),
                 p.punched_at + interval '18 hours') as win_end
    from attendance_punches p
    where p.membership_id = v_membership and p.event_type = 'entrada' and p.voided_at is null
      and p.punched_at >= (p_from::timestamp at time zone attendance_tz())
      and p.punched_at < ((p_to + 1)::timestamp at time zone attendance_tz())
  ),
  ev as (
    select e.t_in, x.event_type, x.punched_at,
           lag(x.event_type) over w as prev_event,
           lag(x.punched_at) over w as prev_at
    from ent e
    join attendance_punches x
      on x.membership_id = v_membership and x.voided_at is null
     and x.punched_at > e.t_in and x.punched_at < e.win_end
    window w as (partition by e.t_in order by x.punched_at)
  ),
  agg as (
    select ev.t_in,
      min(ev.punched_at) filter (where ev.event_type = 'almuerzo_inicio') as ls,
      max(ev.punched_at) filter (where ev.event_type = 'almuerzo_fin') as le,
      max(ev.punched_at) filter (where ev.event_type = 'salida') as so,
      count(*) filter (where ev.event_type = 'almuerzo_inicio') as c_ls,
      count(*) filter (where ev.event_type = 'almuerzo_fin') as c_le,
      coalesce(sum(extract(epoch from (ev.punched_at - ev.prev_at)) / 60)
        filter (where ev.event_type in ('almuerzo_reanuda', 'almuerzo_fin') and ev.prev_event = 'almuerzo_pausa'), 0) as pause_min
    from ev
    group by ev.t_in
  ),
  calc as (
    select e.d, e.t_in, a.ls, a.le, a.so, a.c_ls, a.c_le, a.pause_min,
           sc.start_time as sched,
           case when a.ls is not null and a.le is not null
                then greatest(0, round(extract(epoch from (a.le - a.ls)) / 60 - a.pause_min))::int else 0 end as lunch_eff
    from ent e
    left join agg a on a.t_in = e.t_in
    left join attendance_schedules sc on sc.membership_id = v_membership and sc.work_date = e.d
  )
  select c.d, c.t_in, c.ls, c.le, c.so, c.sched,
         case when c.sched is null then 0
              else (select case when t.m > v_tol then t.m else 0 end
                    from (select floor(extract(epoch from (c.t_in - ((c.d + c.sched) at time zone attendance_tz()))) / 60)::int as m) t)
         end,
         c.lunch_eff,
         round(coalesce(c.pause_min, 0))::int,
         case when c.so is not null then greatest(0, round(extract(epoch from (c.so - c.t_in)) / 60 - c.lunch_eff))::int else 0 end,
         (c.so is null or coalesce(c.c_ls, 0) <> coalesce(c.c_le, 0))
  from calc c
  order by c.t_in desc;
end;
$$;

drop function if exists public.attendance_report(uuid, date, date, uuid, uuid);

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
  absent boolean,
  lunch_pause_minutes int,
  lunch_diff_minutes int,
  lunch_flag boolean
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
              rows between unbounded preceding and 1 preceding) as last_entry_before,
      max(a.punched_at) filter (where a.event_type = 'almuerzo_inicio')
        over (partition by a.membership_id, a.work_date order by a.punched_at
              rows between unbounded preceding and 1 preceding) as last_ls_before
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
      coalesce(sum(extract(epoch from (s.punched_at - s.last_ls_before)) / 60)
        filter (where s.event_type = 'almuerzo_fin' and s.last_ls_before is not null), 0)
      - coalesce(sum(extract(epoch from (s.punched_at - s.prev_at)) / 60)
        filter (where s.event_type in ('almuerzo_reanuda', 'almuerzo_fin') and s.prev_event = 'almuerzo_pausa'), 0) as lunch_min,
      coalesce(sum(extract(epoch from (s.punched_at - s.prev_at)) / 60)
        filter (where s.event_type in ('almuerzo_reanuda', 'almuerzo_fin') and s.prev_event = 'almuerzo_pausa'), 0) as pause_min,
      coalesce(sum(extract(epoch from (s.punched_at - s.last_entry_before)) / 60)
        filter (where s.event_type = 'salida' and s.last_entry_before is not null), 0) as gross_min,
      (array_agg(s.branch_id order by s.punched_at) filter (where s.event_type = 'entrada'))[1] as branch_id
    from seq s
    group by s.membership_id, s.work_date
  )
  select r.work_date, r.membership_id, r.employee_name, r.branch_name, r.scheduled_start, r.first_in, r.last_out,
         r.lunch_minutes, r.lunch_over_minutes, r.worked_minutes, r.late_minutes, r.overtime_minutes, r.incomplete, r.absent,
         r.lunch_pause_minutes, r.lunch_diff_minutes, r.lunch_flag
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
      false as absent,
      round(d.pause_min)::int as lunch_pause_minutes,
      case when d.cnt_le > 0 then round(d.lunch_min)::int - v_lunch_max else 0 end as lunch_diff_minutes,
      (d.cnt_le > 0 and abs(round(d.lunch_min)::int - v_lunch_max) > v_tol) as lunch_flag
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
      true,
      0, 0, false
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

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array['attendance_allowed_events', 'my_attendance_status', 'self_record_attendance', 'my_attendance_days', 'attendance_report'])
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
