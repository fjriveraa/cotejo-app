-- Recordatorios de marcación: 5 minutos antes de la entrada y de la salida.
-- Cada minuto, pg_cron llama a send_attendance_reminders(). Por cada colaborador
-- que debe marcar pronto y aún no lo ha hecho, crea una notificación (el trigger
-- existente la manda como push) y pide el correo. Un registro evita repetirla.

create extension if not exists pg_cron;

create table if not exists public.attendance_reminder_log (
  membership_id uuid not null references public.memberships(id) on delete cascade,
  work_date date not null,
  kind text not null check (kind in ('entrada', 'salida')),
  sent_at timestamptz not null default now(),
  primary key (membership_id, work_date, kind)
);
alter table public.attendance_reminder_log enable row level security;

-- Hora de salida esperada de la jornada en curso (misma regla que my_attendance_status).
create or replace function public.attendance_expected_out(p_membership uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_org uuid;
  v_last record;
  v_entry timestamptz;
  v_hours numeric;
  v_cap numeric;
  v_stip int;
begin
  select organization_id into v_org from memberships where id = p_membership;
  select p.event_type, p.punched_at into v_last
  from attendance_punches p
  where p.membership_id = p_membership and p.voided_at is null and p.punched_at > now() - interval '18 hours'
  order by p.punched_at desc limit 1;
  if v_last.event_type is null or v_last.event_type = 'salida' then
    return null;
  end if;
  select max(p.punched_at) into v_entry
  from attendance_punches p
  where p.membership_id = p_membership and p.voided_at is null and p.event_type = 'entrada'
    and p.punched_at > now() - interval '18 hours';
  if v_entry is null then return null; end if;

  select pr.daily_hours into v_hours from attendance_profiles pr where pr.membership_id = p_membership;
  select coalesce(st.daily_hours_cap, 8), coalesce(st.lunch_max_minutes, 60)
    into v_cap, v_stip
  from attendance_settings st where st.organization_id = v_org;
  v_cap := coalesce(v_cap, 8);
  v_stip := coalesce(v_stip, 60);
  v_hours := coalesce(v_hours, case when v_cap < 24 then v_cap end);
  if v_hours is null then return null; end if;
  return v_entry + make_interval(mins => round(v_hours * 60)::int + v_stip);
end;
$$;

-- Quién debe marcar en los próximos p_minutes minutos (entrada o salida).
create or replace function public.attendance_due_marks(p_minutes int default 5, p_now timestamptz default now())
returns table (organization_id uuid, membership_id uuid, branch_id uuid, kind text, due_at timestamptz, work_date date)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_today date := (p_now at time zone attendance_tz())::date;
begin
  -- Entradas: según el horario efectivo de hoy (fijo o armado), sin entrada marcada hoy.
  return query
    select s.organization_id, s.membership_id, s.branch_id, 'entrada'::text,
           ((v_today + s.start_time) at time zone attendance_tz()), v_today
    from (
      select o.id as organization_id from organizations o
    ) org
    cross join lateral attendance_effective_schedule(org.organization_id, v_today, v_today) s
    join memberships m on m.id = s.membership_id and m.status = 'active' and m.role = 'empleado'
    where s.start_time is not null
      and ((v_today + s.start_time) at time zone attendance_tz()) > p_now
      and ((v_today + s.start_time) at time zone attendance_tz()) <= p_now + make_interval(mins => p_minutes)
      and not exists (
        select 1 from attendance_punches p
        where p.membership_id = s.membership_id and p.voided_at is null and p.event_type = 'entrada'
          and (p.punched_at at time zone attendance_tz())::date = v_today
      );

  -- Salidas: según la hora de salida esperada de la jornada en curso.
  return query
    select m.organization_id, m.id,
           (select p.branch_id from attendance_punches p
             where p.membership_id = m.id and p.voided_at is null and p.event_type = 'entrada'
             order by p.punched_at desc limit 1),
           'salida'::text, x.out_at, v_today
    from memberships m
    cross join lateral (select attendance_expected_out(m.id) as out_at) x
    where m.status = 'active' and m.role = 'empleado' and x.out_at is not null
      and x.out_at > p_now and x.out_at <= p_now + make_interval(mins => p_minutes);
end;
$$;

create or replace function public.send_attendance_reminders(p_dry boolean default false, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_id uuid;
  v_items jsonb := '[]'::jsonb;
  v_hour text;
begin
  for r in select * from attendance_due_marks(5, p_now) loop
    if exists (select 1 from attendance_reminder_log l
               where l.membership_id = r.membership_id and l.work_date = r.work_date and l.kind = r.kind) then
      continue;
    end if;
    v_hour := to_char(r.due_at at time zone attendance_tz(), 'HH12:MI AM');
    v_items := v_items || jsonb_build_object('membership_id', r.membership_id, 'kind', r.kind, 'due_at', r.due_at);
    if p_dry then continue; end if;

    insert into attendance_reminder_log (membership_id, work_date, kind) values (r.membership_id, r.work_date, r.kind)
    on conflict do nothing;

    insert into notifications (organization_id, membership_id, type, title, body)
    values (
      r.organization_id, r.membership_id, 'attendance_reminder',
      case r.kind when 'entrada' then '⏰ Tu entrada es en 5 minutos' else '⏰ Tu salida es en 5 minutos' end,
      case r.kind
        when 'entrada' then 'Tu horario empieza a las ' || v_hour || ' · No olvides marcar tu entrada'
        else 'Tu jornada termina a las ' || v_hour || ' · No olvides marcar tu salida'
      end
    ) returning id into v_id;

    -- El push sale solo por el trigger de notifications; el correo se pide aparte.
    perform request_notification_email(v_id);
  end loop;
  return v_items;
end;
$$;

-- Aviso para la tablet de la sucursal: quién debe marcar pronto (solo nombre, tipo y hora).
create or replace function public.attendance_due_soon(p_device_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_dev attendance_devices;
  v_role text;
begin
  select * into v_dev from attendance_devices d where d.id = p_device_id and d.active;
  if v_dev.id is null then raise exception 'Dispositivo no válido'; end if;
  v_role := attendance_caller_role(v_dev.organization_id);
  if v_role is null or v_role not in ('propietario', 'admin', 'supervisor', 'marcador') then
    raise exception 'No autorizado';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('name', attendance_member_name(d.membership_id), 'kind', d.kind, 'due_at', d.due_at) order by d.due_at)
    from attendance_due_marks(10) d
    where d.organization_id = v_dev.organization_id
      and (d.branch_id is null or d.branch_id = v_dev.branch_id)
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.send_attendance_reminders(boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.attendance_due_marks(int, timestamptz) from public, anon, authenticated;
revoke all on function public.attendance_expected_out(uuid) from public, anon, authenticated;
grant execute on function public.attendance_due_soon(uuid) to authenticated;

-- Cada minuto.
select cron.unschedule(jobid) from cron.job where jobname = 'attendance-reminders';
select cron.schedule('attendance-reminders', '* * * * *', $$select public.send_attendance_reminders()$$);
