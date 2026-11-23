-- Mensaje para compartir por WhatsApp (descripción de la preventa, precio, fechas...).
alter table public.payment_groups add column if not exists share_message text;

create or replace function public.set_payment_group_message(p_group_id uuid, p_message text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid; v_role text;
begin
  select g.organization_id into v_org from payment_groups g where g.id = p_group_id;
  if v_org is null then raise exception 'Grupo no encontrado'; end if;
  select m.role into v_role from memberships m
  where m.organization_id = v_org and m.user_id = auth.uid() and m.status = 'active';
  if v_role is null or v_role not in ('propietario','admin') then raise exception 'No autorizado'; end if;
  p_message := nullif(btrim(coalesce(p_message, '')), '');
  if p_message is not null and length(p_message) > 3000 then raise exception 'El mensaje es demasiado largo (máx. 3000 caracteres)'; end if;
  update payment_groups set share_message = p_message where id = p_group_id;
end $$;

create or replace function public.get_payment_group_message(p_group_id uuid)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare v_org uuid; v_msg text;
begin
  select g.organization_id, g.share_message into v_org, v_msg from payment_groups g where g.id = p_group_id;
  if v_org is null then return null; end if;
  if not exists (select 1 from memberships m where m.organization_id = v_org and m.user_id = auth.uid() and m.status = 'active') then
    raise exception 'No autorizado';
  end if;
  return v_msg;
end $$;

revoke all on function public.set_payment_group_message(uuid, text) from public, anon;
revoke all on function public.get_payment_group_message(uuid) from public, anon;
grant execute on function public.set_payment_group_message(uuid, text) to authenticated;
grant execute on function public.get_payment_group_message(uuid) to authenticated;
