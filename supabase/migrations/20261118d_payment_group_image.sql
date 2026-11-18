-- Imágenes de referencia por grupo (hasta 4): se muestran en el detalle, en la pantalla de
-- quien paga, y la primera es la imagen de la vista previa del enlace (WhatsApp).
-- Bucket público a propósito.
alter table public.payment_groups add column if not exists image_paths text[] not null default '{}';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('group-images', 'group-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists group_images_insert on storage.objects;
create policy group_images_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'group-images'
  and exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.status = 'active'
      and m.role in ('propietario','admin')
      and m.organization_id::text = (storage.foldername(name))[1]
  )
);

create or replace function public.set_payment_group_images(p_group_id uuid, p_image_paths text[])
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid; v_role text; v_p text;
begin
  select g.organization_id into v_org from payment_groups g where g.id = p_group_id;
  if v_org is null then raise exception 'Grupo no encontrado'; end if;
  select m.role into v_role from memberships m
  where m.organization_id = v_org and m.user_id = auth.uid() and m.status = 'active';
  if v_role is null or v_role not in ('propietario','admin') then raise exception 'No autorizado'; end if;
  p_image_paths := coalesce(p_image_paths, '{}');
  if array_length(p_image_paths, 1) > 4 then raise exception 'Máximo 4 imágenes'; end if;
  foreach v_p in array p_image_paths loop
    if split_part(v_p, '/', 1) <> v_org::text then raise exception 'Imagen no válida'; end if;
  end loop;
  update payment_groups set image_paths = p_image_paths where id = p_group_id;
end $$;

drop function if exists public.payment_group_public_info(text);
create or replace function public.payment_group_public_info(p_link_code text)
returns table(group_name text, organization_name text, image_paths text[], expected_amount numeric)
language sql security definer set search_path to 'public' stable as $$
  select g.name, o.name, g.image_paths, g.default_expected_amount
  from payment_groups g join organizations o on o.id = g.organization_id
  where g.link_code = p_link_code and g.active and o.status = 'active';
$$;

grant execute on function public.set_payment_group_images(uuid, text[]) to authenticated;
grant execute on function public.payment_group_public_info(text) to anon, authenticated;

