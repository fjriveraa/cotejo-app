-- Un mismo banco llegaba escrito de varias formas ("BAC", "BAC Credomatic",
-- "Banco BAC Honduras"), lo que rompía agrupar/filtrar por banco y dispersaba
-- los patrones de referencia. Se normaliza al guardar, y si la IA leyó los
-- últimos 4 dígitos de la cuenta destino pero no el banco, se completa con el
-- banco de la cuenta registrada de la empresa que termina en esos dígitos.
create or replace function public.canonical_bank(p text)
returns text language sql immutable as $$
  select case
    when p is null or btrim(p) = '' then null
    when p ~* 'credomatic' or p ~* '(^|[^[:alpha:]])bac([^[:alpha:]]|$)' then 'BAC Credomatic'
    when p ~* 'atl[aá]ntida' then 'Banco Atlántida'
    when p ~* 'ficohsa' then 'Ficohsa'
    when p ~* 'occidente' then 'Banco de Occidente'
    when p ~* 'banpa[ií]s' then 'Banpaís'
    when p ~* 'davivienda' then 'Davivienda Honduras'
    when p ~* 'lafise' then 'Lafise Honduras'
    when p ~* 'promerica' then 'Banco Promerica'
    when p ~* 'azteca' then 'Banco Azteca Honduras'
    when p ~* 'popular' then 'Banco Popular Honduras'
    when p ~* 'banhcafe' then 'BANHCAFE'
    when p ~* 'banrural' then 'Banrural'
    when p ~* 'g&t|continental' then 'G&T Continental'
    when p ~* 'bantrab' then 'Bantrab'
    else btrim(p)
  end
$$;

create or replace function public.normalize_guest_submission_banks()
returns trigger language plpgsql as $$
begin
  new.detected_bank := public.canonical_bank(new.detected_bank);
  new.origin_bank := public.canonical_bank(new.origin_bank);
  if new.detected_bank is null and new.detected_account_last4 is not null then
    select public.canonical_bank(ra.bank) into new.detected_bank
    from public.receiving_accounts ra
    where ra.organization_id = new.organization_id and ra.active and ra.last4 = new.detected_account_last4
    limit 1;
  end if;
  return new;
end; $$;

drop trigger if exists trg_normalize_guest_submission_banks on public.guest_submissions;
create trigger trg_normalize_guest_submission_banks
before insert on public.guest_submissions
for each row execute function public.normalize_guest_submission_banks();

-- Datos existentes
update public.guest_submissions g set
  detected_bank = coalesce(
    public.canonical_bank(g.detected_bank),
    (select public.canonical_bank(ra.bank) from public.receiving_accounts ra
      where ra.organization_id = g.organization_id and ra.active and ra.last4 = g.detected_account_last4 limit 1)
  ),
  origin_bank = public.canonical_bank(g.origin_bank);
