-- Grupo principal con paquetes: un grupo puede contener "paquetes" (subgrupos). El enlace del
-- principal deja elegir el paquete; el pago queda registrado en el paquete elegido.
alter table public.payment_groups
  add column if not exists parent_group_id uuid references public.payment_groups(id) on delete set null,
  add column if not exists option_label text;

create or replace function public.set_payment_group_parent(p_group_id uuid, p_parent_group_id uuid, p_option_label text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid; v_role text; v_parent record;
begin
  select g.organization_id into v_org from payment_groups g where g.id = p_group_id;
  if v_org is null then raise exception 'Grupo no encontrado'; end if;
  select m.role into v_role from memberships m
  where m.organization_id = v_org and m.user_id = auth.uid() and m.status = 'active';
  if v_role is null or v_role not in ('propietario','admin') then raise exception 'No autorizado'; end if;
  if p_parent_group_id is not null then
    if p_parent_group_id = p_group_id then raise exception 'Un grupo no puede estar dentro de sí mismo'; end if;
    select id, organization_id, parent_group_id into v_parent from payment_groups where id = p_parent_group_id;
    if v_parent.id is null or v_parent.organization_id <> v_org then raise exception 'Grupo principal no válido'; end if;
    if v_parent.parent_group_id is not null then raise exception 'El grupo principal no puede estar dentro de otro'; end if;
    if exists (select 1 from payment_groups c where c.parent_group_id = p_group_id) then
      raise exception 'Este grupo ya tiene paquetes dentro, no puede quedar dentro de otro';
    end if;
  end if;
  update payment_groups
  set parent_group_id = p_parent_group_id,
      option_label = case when p_parent_group_id is null then null else nullif(trim(coalesce(p_option_label, '')), '') end
  where id = p_group_id;
end $$;

-- Pública: paquetes (hijos activos) del grupo con ese enlace.
create or replace function public.payment_group_options(p_link_code text)
returns table(group_id uuid, label text, name text, expected_amount numeric)
language sql security definer set search_path to 'public' stable as $$
  select c.id, coalesce(c.option_label, c.name), c.name, c.default_expected_amount
  from payment_groups p
  join payment_groups c on c.parent_group_id = p.id and c.active
  join organizations o on o.id = p.organization_id and o.status = 'active'
  where p.link_code = p_link_code and p.active
  order by c.default_expected_amount nulls last, c.created_at;
$$;

create or replace function public.payment_group_parents(p_organization_id uuid)
returns table(group_id uuid, parent_group_id uuid, option_label text)
language sql security definer set search_path to 'public' stable as $$
  select g.id, g.parent_group_id, g.option_label
  from payment_groups g
  where g.organization_id = p_organization_id
    and exists (select 1 from memberships m where m.organization_id = p_organization_id
                and m.user_id = auth.uid() and m.status = 'active'
                and m.role in ('propietario','admin','contador','supervisor','auditor'));
$$;

create or replace function public.list_payment_group_children(p_group_id uuid)
returns table(group_id uuid, name text, option_label text, default_expected_amount numeric,
              link_code text, active boolean, confirmed_count bigint, pending_count bigint, confirmed_amount numeric)
language sql security definer set search_path to 'public' stable as $$
  select c.id, c.name, c.option_label, c.default_expected_amount, c.link_code, c.active,
    (select count(*) from guest_submissions s where s.group_id = c.id and s.status = 'confirmed'),
    (select count(*) from guest_submissions s where s.group_id = c.id and s.status = 'pending'),
    (select coalesce(sum(s.amount), 0) from guest_submissions s where s.group_id = c.id and s.status = 'confirmed')
  from payment_groups p
  join payment_groups c on c.parent_group_id = p.id
  where p.id = p_group_id
    and exists (select 1 from memberships m where m.organization_id = p.organization_id
                and m.user_id = auth.uid() and m.status = 'active'
                and m.role in ('propietario','admin','contador','supervisor','auditor'))
  order by c.default_expected_amount nulls last, c.created_at;
$$;

grant execute on function public.set_payment_group_parent(uuid, uuid, text) to authenticated;
grant execute on function public.payment_group_options(text) to anon, authenticated;
grant execute on function public.payment_group_parents(uuid) to authenticated;
grant execute on function public.list_payment_group_children(uuid) to authenticated;
