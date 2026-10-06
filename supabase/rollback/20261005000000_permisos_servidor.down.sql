-- EMERGENCY ONLY: undoes supabase/migrations/20261005000000_permisos_servidor.sql.
--
-- Not a migration (the Supabase CLI only reads supabase/migrations): run it by hand in the SQL editor,
-- and only together with deploying the app version from before that migration — the current app
-- and API need everything it creates. Then remove the migration's row from
-- supabase_migrations.schema_migrations so `db:push` doesn't consider it applied.
--
-- What comes back: purchase prices into products, profits (and item costs) into sales and cierres,
-- the old read policies. What can't: the PINs — only keyed hashes (HMAC) were kept — so the owner's master
-- PIN goes back to the factory 1234 (change it right away) and every user needs a new PIN.

-- Stop moving fields out, before putting them back.
drop trigger split_secrets on public.products;
drop trigger drop_secrets on public.products;
drop trigger split_secrets on public.sales;
drop trigger drop_secrets on public.sales;
drop trigger split_secrets on public.cierres;
drop trigger drop_secrets on public.cierres;
drop trigger split_secrets on public."auditLog";
drop trigger split_secrets on public.settings;
drop trigger split_secrets on public.usuarios;
drop trigger drop_secrets on public.usuarios;
drop trigger refresh_caja_state on public."cashSessions";

update public.products p set data = p.data || jsonb_build_object('cost', c.data -> 'cost')
from public."productCosts" c where c.code = p.code;

update public.sales s set data = s.data
  || jsonb_build_object('ganancia', f.data -> 'ganancia')
  || jsonb_build_object('items', (
       select coalesce(jsonb_agg(
         case when jsonb_typeof(i) = 'object' and jsonb_typeof(f.data -> 'itemCosts' -> (n::int - 1)) = 'number'
              then i || jsonb_build_object('cost', f.data -> 'itemCosts' -> (n::int - 1))
              else i end
         order by n), '[]'::jsonb)
       from jsonb_array_elements(private.array_of(s.data -> 'items')) with ordinality as t(i, n)))
from public.profits f where f.key = 'sale:' || s.id;

update public.cierres c set data = c.data || jsonb_build_object('totalGanancia', f.data -> 'ganancia')
from public.profits f where f.key = 'cierre:' || c.id;

-- The factory PIN 1234 (sha256), as the first migration seeded it.
update public.settings set data = data || '{"pinHash":"03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4"}' where key = 'main';

do $$
declare
  t text;
begin
  foreach t in array array['suppliers', 'cierres', 'cashMovements', 'cashSessions', 'purchaseOrders', 'payables'] loop
    execute format('drop policy if exists "costos.ver" on public.%I', t);
    execute format('drop policy if exists "proveedores.gestionar" on public.%I', t);
    execute format('drop policy if exists "caja.verEsperado" on public.%I', t);
    execute format('drop policy if exists "reportes.ver" on public.%I', t);
    execute format('create policy "staff can read" on public.%I for select to authenticated using ((select public.is_staff()))', t);
  end loop;
end
$$;

alter publication supabase_realtime drop table public."productCosts", public.profits, public."cajaState";
drop table public."productCosts", public.profits, public."cajaState";
drop function public.has_perm(text);
drop schema private cascade;

-- Devices drop their copy and download the restored rows.
update public.sync_meta set value = (value::bigint + 1)::text where key = 'epoch';
