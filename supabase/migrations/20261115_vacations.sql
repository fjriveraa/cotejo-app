-- Vacaciones: un tipo de día fuera del horario, distinto de "libre".
-- (Aplicado en producción en dos migraciones: vacations_base y vacations_my_schedule.)
alter table public.attendance_days_off add column if not exists kind text not null default 'libre';
alter table public.attendance_days_off drop constraint if exists attendance_days_off_kind_check;
alter table public.attendance_days_off add constraint attendance_days_off_kind_check check (kind in ('libre', 'vacaciones'));
-- set_attendance_day_off (upsert kind='libre'), set_attendance_vacation(org, membership, date, on),
-- list_attendance_vacations(org, from, to) y my_schedule (campo is_vacation): ver migraciones aplicadas.
