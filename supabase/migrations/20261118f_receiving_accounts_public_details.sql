-- Datos completos de la cuenta para mostrarlos a quien va a pagar (opcional, por cuenta).
alter table public.receiving_accounts
  add column if not exists account_number text,
  add column if not exists holder_name text,
  add column if not exists account_type text,
  add column if not exists show_to_payers boolean not null default false;

create or replace function public.public_payment_accounts(p_organization_id uuid)
returns table(bank text, alias text, account_number text, holder_name text, account_type text, currency text)
language sql security definer set search_path to 'public' stable as $$
  select a.bank, a.alias, a.account_number, a.holder_name, a.account_type, a.currency
  from receiving_accounts a
  join organizations o on o.id = a.organization_id and o.status = 'active'
  where a.organization_id = p_organization_id
    and a.active and a.show_to_payers and coalesce(a.account_number, '') <> ''
  order by a.created_at;
$$;
grant execute on function public.public_payment_accounts(uuid) to anon, authenticated;
