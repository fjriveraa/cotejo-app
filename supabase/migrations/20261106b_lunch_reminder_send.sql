-- Envío del recordatorio de almuerzo (push + correo) y aviso en la tablet.
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

    perform request_notification_email(v_id);
  end loop;

  -- Almuerzo: 4 horas después de la entrada sin haber marcado inicio de almuerzo.
  for r in select * from attendance_lunch_pending(p_now) loop
    if exists (select 1 from attendance_reminder_log l
               where l.membership_id = r.membership_id and l.work_date = r.work_date and l.kind = 'almuerzo') then
      continue;
    end if;
    v_items := v_items || jsonb_build_object('membership_id', r.membership_id, 'kind', 'almuerzo', 'due_at', r.due_at);
    if p_dry then continue; end if;

    insert into attendance_reminder_log (membership_id, work_date, kind) values (r.membership_id, r.work_date, 'almuerzo')
    on conflict do nothing;

    insert into notifications (organization_id, membership_id, type, title, body)
    values (
      r.organization_id, r.membership_id, 'attendance_reminder',
      '🍽 ¿Ya almorzaste?',
      'Llevas 4 horas trabajando · Marca el inicio de tu almuerzo'
    ) returning id into v_id;

    perform request_notification_email(v_id);
  end loop;
  return v_items;
end;
$$;

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
    select jsonb_agg(jsonb_build_object('name', attendance_member_name(x.membership_id), 'kind', x.kind, 'due_at', x.due_at) order by x.due_at)
    from (
      select d.organization_id, d.membership_id, d.branch_id, d.kind, d.due_at from attendance_due_marks(10) d
      union all
      select l.organization_id, l.membership_id, l.branch_id, 'almuerzo'::text, l.due_at from attendance_lunch_pending() l
    ) x
    where x.organization_id = v_dev.organization_id
      and (x.branch_id is null or x.branch_id = v_dev.branch_id)
  ), '[]'::jsonb);
end;
$$;
