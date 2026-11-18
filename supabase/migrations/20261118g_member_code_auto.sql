-- Las personas que se agregan solas al enviar por el enlace general de un grupo no tenían
-- código y el envío fallaba (member_code NOT NULL). Ahora el código se genera al insertar.
create or replace function public.set_member_code_if_null()
returns trigger language plpgsql as $$
declare v_code text; v_tries int := 0;
begin
  if new.member_code is null then
    loop
      v_tries := v_tries + 1;
      v_code := generate_short_link_code();
      exit when not exists (select 1 from payment_group_members where member_code = v_code) or v_tries >= 10;
    end loop;
    new.member_code := v_code;
  end if;
  return new;
end $$;

drop trigger if exists trg_member_code_auto on public.payment_group_members;
create trigger trg_member_code_auto before insert on public.payment_group_members
for each row execute function public.set_member_code_if_null();
