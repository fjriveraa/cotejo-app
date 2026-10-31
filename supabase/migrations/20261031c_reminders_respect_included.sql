-- Los recordatorios de 5 minutos solo van a quien está incluido en el horario.
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
  return query
    select s.organization_id, s.membership_id, s.branch_id, 'entrada'::text,
           ((v_today + s.start_time) at time zone attendance_tz()), v_today
    from (
      select o.id as organization_id from organizations o
    ) org
    cross join lateral attendance_effective_schedule(org.organization_id, v_today, v_today) s
    join memberships m on m.id = s.membership_id and m.status = 'active' and m.role = 'empleado' and m.attendance_included
    where s.start_time is not null
      and ((v_today + s.start_time) at time zone attendance_tz()) > p_now
      and ((v_today + s.start_time) at time zone attendance_tz()) <= p_now + make_interval(mins => p_minutes)
      and not exists (
        select 1 from attendance_punches p
        where p.membership_id = s.membership_id and p.voided_at is null and p.event_type = 'entrada'
          and (p.punched_at at time zone attendance_tz())::date = v_today
      );

  return query
    select m.organization_id, m.id,
           (select p.branch_id from attendance_punches p
             where p.membership_id = m.id and p.voided_at is null and p.event_type = 'entrada'
             order by p.punched_at desc limit 1),
           'salida'::text, x.out_at, v_today
    from memberships m
    cross join lateral (select attendance_expected_out(m.id) as out_at) x
    where m.status = 'active' and m.role = 'empleado' and m.attendance_included and x.out_at is not null
      and x.out_at > p_now and x.out_at <= p_now + make_interval(mins => p_minutes);
end;
$$;
