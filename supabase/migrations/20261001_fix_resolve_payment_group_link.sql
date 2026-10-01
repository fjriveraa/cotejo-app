-- Ya aplicada en producción (proyecto COTEJO). Se guarda aquí como registro.
-- El enlace general del grupo (sin código de persona) fallaba con
-- "record v_member is not assigned yet" y la app mostraba "enlace no válido".
CREATE OR REPLACE FUNCTION public.resolve_payment_group_link(p_link_code text, p_member_code text DEFAULT NULL::text)
 RETURNS TABLE(organization_id uuid, organization_name text, group_id uuid, group_name text, period_type text, default_expected_amount numeric, member_id uuid, member_display_name text, member_expected_amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_group record;
  v_member record;
begin
  select null::uuid as id, null::text as display_name, null::numeric as expected_amount into v_member;

  select g.id, g.organization_id, g.name, g.period_type, g.default_expected_amount
  into v_group
  from payment_groups g
  where g.link_code = p_link_code and g.active;

  if v_group.id is null then
    raise exception 'Enlace no válido';
  end if;

  if not exists (select 1 from organizations o where o.id = v_group.organization_id and o.status = 'active') then
    raise exception 'Empresa no encontrada';
  end if;

  if p_member_code is not null then
    select m.id, m.display_name, m.expected_amount into v_member
    from payment_group_members m
    where m.member_code = p_member_code and m.group_id = v_group.id and m.active;

    if v_member.id is null then
      raise exception 'Enlace no válido';
    end if;
  end if;

  return query
    select v_group.organization_id, (select o.name from organizations o where o.id = v_group.organization_id),
      v_group.id, v_group.name, v_group.period_type, v_group.default_expected_amount,
      v_member.id, v_member.display_name, v_member.expected_amount;
end;
$function$;
