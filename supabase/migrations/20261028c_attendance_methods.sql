-- Métodos de marcación que elige cada empresa. Requiere 20261028_attendance.sql
-- y 20261028b_attendance_self.sql aplicadas antes.
--   method_qr   : marcar con QR en el dispositivo de la sucursal
--   photo_kiosk : tomar foto de evidencia en ese dispositivo
--   (allow_self_punch, de la migración b, = marcar desde el teléfono con selfie)
-- Horas extras: se "apagan" guardando 24 h como tope diario (nunca se alcanza).

alter table public.attendance_settings add column if not exists method_qr boolean not null default true;
alter table public.attendance_settings add column if not exists photo_kiosk boolean not null default true;

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
    'lunch_max_minutes', coalesce(s.lunch_max_minutes, 60),
    'allow_self_punch', coalesce(s.allow_self_punch, false),
    'method_qr', coalesce(s.method_qr, true),
    'photo_kiosk', coalesce(s.photo_kiosk, true)
  );
end;
$$;

drop function if exists public.set_attendance_settings(uuid, int, numeric, int, boolean);

create or replace function public.set_attendance_settings(
  p_organization_id uuid,
  p_tolerance_minutes int,
  p_daily_hours_cap numeric,
  p_lunch_max_minutes int,
  p_allow_self_punch boolean default false,
  p_method_qr boolean default true,
  p_photo_kiosk boolean default true
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

  if not coalesce(p_method_qr, true) and not coalesce(p_allow_self_punch, false) then
    raise exception 'Deja al menos un método de marcación activo';
  end if;

  insert into attendance_settings (organization_id, tolerance_minutes, daily_hours_cap, lunch_max_minutes, allow_self_punch, method_qr, photo_kiosk, updated_at)
  values (p_organization_id, p_tolerance_minutes, p_daily_hours_cap, p_lunch_max_minutes,
          coalesce(p_allow_self_punch, false), coalesce(p_method_qr, true), coalesce(p_photo_kiosk, true), now())
  on conflict (organization_id) do update
    set tolerance_minutes = excluded.tolerance_minutes,
        daily_hours_cap = excluded.daily_hours_cap,
        lunch_max_minutes = excluded.lunch_max_minutes,
        allow_self_punch = excluded.allow_self_punch,
        method_qr = excluded.method_qr,
        photo_kiosk = excluded.photo_kiosk,
        updated_at = now();
end;
$$;

-- El QR solo se emite si la empresa lo tiene activo.
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

  if not coalesce((select st.method_qr from attendance_settings st where st.organization_id = p_organization_id), true) then
    raise exception 'La empresa tiene desactivada la marcación con QR';
  end if;

  delete from attendance_codes where membership_id = v_membership and used_at is null;
  delete from attendance_codes where expires_at < now() - interval '1 hour';

  v_code := upper(substr(md5(random()::text || clock_timestamp()::text || gen_random_uuid()::text), 1, 10));
  v_expires := now() + interval '45 seconds';

  insert into attendance_codes (code, organization_id, membership_id, expires_at)
  values (v_code, p_organization_id, v_membership, v_expires);

  return jsonb_build_object('code', v_code, 'expires_at', v_expires);
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
  v_last record;
begin
  select m.id into v_membership
  from memberships m
  where m.organization_id = p_organization_id and m.user_id = auth.uid() and m.status = 'active'
  limit 1;

  if v_membership is null then
    raise exception 'No autorizado';
  end if;

  select coalesce((select st.allow_self_punch from attendance_settings st where st.organization_id = p_organization_id), false),
         coalesce((select st.method_qr from attendance_settings st where st.organization_id = p_organization_id), true)
  into v_allow, v_qr;

  select p.event_type, p.punched_at into v_last
  from attendance_punches p
  where p.membership_id = v_membership and p.voided_at is null and p.punched_at > now() - interval '18 hours'
  order by p.punched_at desc
  limit 1;

  return jsonb_build_object(
    'allow_self_punch', v_allow,
    'method_qr', v_qr,
    'allowed', to_jsonb(attendance_allowed_events(v_membership)),
    'last_event', v_last.event_type,
    'last_at', v_last.punched_at
  );
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
      and p.proname = any (array['get_attendance_settings', 'set_attendance_settings', 'issue_attendance_code', 'my_attendance_status'])
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
