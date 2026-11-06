-- Recordatorio de almuerzo: a las 4 horas de la entrada, si no han marcado inicio de almuerzo ni salida.
alter table public.attendance_reminder_log drop constraint if exists attendance_reminder_log_kind_check;
alter table public.attendance_reminder_log add constraint attendance_reminder_log_kind_check
  check (kind in ('entrada', 'salida', 'almuerzo'));

create or replace function public.attendance_lunch_pending(p_now timestamptz default now(), p_after_hours numeric default 4)
returns table (organization_id uuid, membership_id uuid, branch_id uuid, entry_at timestamptz, due_at timestamptz, work_date date)
language sql
stable
security definer
set search_path to 'public'
as $$
  select m.organization_id, m.id, e.branch_id, e.punched_at,
         e.punched_at + make_interval(mins => round(p_after_hours * 60)::int),
         (e.punched_at at time zone attendance_tz())::date
  from memberships m
  cross join lateral (
    select p.punched_at, p.branch_id
    from attendance_punches p
    where p.membership_id = m.id and p.voided_at is null and p.event_type = 'entrada'
      and p.punched_at > p_now - interval '12 hours'
    order by p.punched_at desc limit 1
  ) e
  where m.status = 'active' and m.role = 'empleado' and m.attendance_included
    and p_now >= e.punched_at + make_interval(mins => round(p_after_hours * 60)::int)
    and p_now <  e.punched_at + interval '8 hours'
    and not exists (
      select 1 from attendance_punches p
      where p.membership_id = m.id and p.voided_at is null and p.punched_at > e.punched_at
        and p.event_type in ('almuerzo_inicio', 'salida')
    );
$$;
revoke all on function public.attendance_lunch_pending(timestamptz, numeric) from public, anon, authenticated;
