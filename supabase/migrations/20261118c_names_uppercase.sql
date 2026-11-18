-- Los nombres de empresas, grupos y sucursales se guardan siempre en MAYÚSCULAS (y sin espacios dobles),
-- aunque se escriban en minúscula. Aplicado en producción, incluyendo los nombres ya existentes.
create or replace function public.normalize_name_upper()
returns trigger language plpgsql as $$
begin
  if new.name is not null then
    new.name := upper(regexp_replace(trim(new.name), '\s+', ' ', 'g'));
  end if;
  return new;
end;
$$;
-- Triggers: trg_organizations_name_upper, trg_payment_groups_name_upper, trg_branches_name_upper
-- (before insert or update of name).
