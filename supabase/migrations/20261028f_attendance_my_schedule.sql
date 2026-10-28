-- "Mi horario": lo que cada colaborador ve de su propio horario (días, entrada,
-- almuerzo, salida, sucursal, libres y el tipo de horario). Requiere a–e.

create or replace function public.my_schedule(p_organization_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_membership uuid;
  v_profile jsonb;
  v_days jsonb;
begin
  select m.id into v_membership
  from memberships m
  where m.organization_id = p_organization_id and m.user_id = auth.uid() and m.status = 'active'
  limit 1;
  if v_membership is null then
    raise exception 'No autorizado';
  end if;
  if p_from is null or p_to is null or p_to < p_from or (p_to - p_from) > 62 then
    raise exception 'Rango de fechas no válido';
  end if;

  select jsonb_build_object('mode', pr.mode, 'start_time', pr.start_time, 'work_days', pr.work_days, 'daily_hours', pr.daily_hours)
  into v_profile
  from attendance_profiles pr where pr.membership_id = v_membership;

  select coalesce(jsonb_agg(jsonb_build_object(
           'work_date', d.dt,
           'is_off', (o.membership_id is not null),
           'start_time', e.start_time,
           'lunch_start', s.lunch_start,
           'end_time', s.end_time,
           'branch_name', b.name,
           'is_default', (e.start_time is not null and s.membership_id is null)
         ) order by d.dt), '[]'::jsonb)
  into v_days
  from (select g::date as dt from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g) d
  left join attendance_effective_schedule(p_organization_id, p_from, p_to, v_membership) e on e.work_date = d.dt
  left join attendance_schedules s on s.membership_id = v_membership and s.work_date = d.dt
  left join attendance_days_off o on o.membership_id = v_membership and o.work_date = d.dt
  left join branches b on b.id = e.branch_id;

  return jsonb_build_object('profile', v_profile, 'days', v_days);
end;
$$;

revoke execute on function public.my_schedule(uuid, date, date) from public, anon;
grant execute on function public.my_schedule(uuid, date, date) to authenticated;
