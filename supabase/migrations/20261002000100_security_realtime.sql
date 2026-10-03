-- Mi Tienda Pro: who can see the data, and live updates.
--
-- Supabase Auth only proves who someone is; `staff` says they work at the store. Signing up is
-- harmless on its own: an account whose email isn't listed here gets nothing.
--   * Reads: the app reads every table directly (PostgREST + Realtime) with the user's session;
--     RLS lets staff read everything and everyone else nothing.
--   * Writes: none from the browser. Every change goes through the API (server/, deployed as a
--     Firebase Function), which checks the session against this same list and applies the money
--     rules in one transaction.
-- Granting access: insert into public.staff (email, name) values ('someone@example.com', 'Name');

create table public.staff (
  email text primary key,
  name text,
  created_at timestamptz not null default now()
);
alter table public.staff enable row level security; -- no policies: never readable through the API

create function public.is_staff() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
$$;
revoke execute on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'products', 'customers', 'settings', 'usuarios', 'suppliers', 'sales', 'cierres', 'auditLog',
    'entradas', 'cashMovements', 'cashSessions', 'purchaseOrders', 'payables', 'deletions', 'sync_meta'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "staff can read" on public.%I for select to authenticated using ((select public.is_staff()))', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on table public.%I from authenticated', t);
  end loop;
end
$$;

-- Live updates: every committed change reaches the open apps (RLS applies to these too).
alter publication supabase_realtime add table
  public.products, public.customers, public.settings, public.usuarios, public.suppliers,
  public.sales, public.cierres, public."auditLog", public.entradas, public."cashMovements",
  public."cashSessions", public."purchaseOrders", public.payables, public.sync_meta;
