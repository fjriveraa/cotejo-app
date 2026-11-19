-- "Descartar": un envío de invitado que no es un pago (duplicado, captura
-- equivocada). Sale de la cola, del archivo, de los totales y de los informes.
-- Además, un envío con la misma referencia y monto de un pago ya confirmado se
-- frena en el momento de enviarse y nunca crea registro.

do $$
declare
  c text;
begin
  select conname into c from pg_constraint
  where conrelid = 'public.guest_submissions'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%not_confirmed%';
  if c is not null then
    execute format('alter table public.guest_submissions drop constraint %I', c);
  end if;
  alter table public.guest_submissions
    add constraint guest_submissions_status_check
    check (status in ('pending', 'confirmed', 'not_confirmed', 'discarded'));
end $$;

create or replace function public.discard_guest_submission(p_submission_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sub record;
  v_role text;
begin
  select * into v_sub from guest_submissions where id = p_submission_id and status = 'pending' for update;
  if not found then
    raise exception 'Solicitud no encontrada o ya fue resuelta';
  end if;

  select role into v_role
  from memberships
  where organization_id = v_sub.organization_id and user_id = auth.uid() and status = 'active';

  if v_role is null or v_role not in ('propietario', 'admin', 'contador', 'supervisor', 'auditor') then
    raise exception 'No autorizado';
  end if;

  update guest_submissions
    set status = 'discarded',
        review_notes = nullif(trim(p_reason), ''),
        reviewed_at = now(),
        reviewed_by = auth.uid()
    where id = p_submission_id;

  return jsonb_build_object('submission_id', p_submission_id, 'discarded', true);
end;
$$;

revoke all on function public.discard_guest_submission(uuid, text) from public, anon;
grant execute on function public.discard_guest_submission(uuid, text) to authenticated;

-- Los descartados no cuentan como pagados ni como referencia repetida.
do $$
declare
  r record;
  def text;
  nw text;
begin
  for r in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('list_payment_group_member_history', 'list_payment_group_members', 'list_payment_group_periods', 'submit_guest_payment')
  loop
    def := pg_get_functiondef(r.oid);
    nw := replace(def, '<> ''not_confirmed''', 'not in (''not_confirmed'', ''discarded'')');
    if r.proname = 'submit_guest_payment' then
      -- Frenar el duplicado ANTES de crear a la persona en el grupo.
      nw := replace(nw,
        E'raise exception ''Moneda no válida'';\n  end if;\n',
        E'raise exception ''Moneda no válida'';\n  end if;\n\n  if nullif(trim(p_reference_raw), '''') is not null then\n    select tracking_token into v_existing_token\n    from guest_submissions\n    where organization_id = p_organization_id\n      and status = ''confirmed''\n      and lower(trim(reference_raw)) = lower(trim(p_reference_raw))\n      and amount = p_amount\n    order by created_at desc\n    limit 1;\n\n    if v_existing_token is not null then\n      return jsonb_build_object(''duplicate'', true, ''tracking_token'', v_existing_token);\n    end if;\n  end if;\n');
      if position('status = ''confirmed''' in nw) = 0 then
        raise exception 'No se pudo insertar el control de duplicados en submit_guest_payment';
      end if;
    end if;
    if nw = def then
      raise exception 'Sin cambios en %', r.proname;
    end if;
    execute nw;
  end loop;
end $$;

do $$
declare
  r record;
  def text;
  nw text;
begin
  select p.oid into r from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_guest_submissions';
  def := pg_get_functiondef(r.oid);
  nw := replace(def, 'g2.id <> g.id', 'g2.id <> g.id and g2.status <> ''discarded''');
  if nw = def then raise exception 'Sin cambios en list_guest_submissions'; end if;
  execute nw;

  select p.oid into r from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_guest_submissions_for_export';
  def := pg_get_functiondef(r.oid);
  nw := replace(def, 'where g.organization_id = p_organization_id', 'where g.status <> ''discarded'' and g.organization_id = p_organization_id');
  if nw = def then raise exception 'Sin cambios en list_guest_submissions_for_export'; end if;
  execute nw;
end $$;
