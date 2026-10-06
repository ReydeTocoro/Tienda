-- Mi Tienda Pro: permissions enforced by the database and the API, not just by the screen.
--
-- Until now every signed-in device could read every table (RLS "staff can read") and PINs were
-- checked in the browser against hashes mirrored to every device. From here on:
--   * Secret fields never stay in the rows every device reads. A product's purchase price moves to
--     "productCosts"; a sale's profit (and the item costs it came from) and a cierre's profit move to
--     "profits"; PIN hashes move to private.pins. Triggers do the moving on every write, so no code
--     path — old or new — can leave one behind in a public row.
--   * Who is working on each device is server state: the API checks the PIN (rate-limited) and binds
--     that person to the device's Supabase session (private.counter_sessions). RLS asks
--     public.has_perm() — that person's permissions, or the open counter's role — before serving a
--     secret table: costs, profits, the cash ledger, purchasing, cierres.
--   * The `private` schema isn't served by the API (PostgREST exposes `public` only) and grants
--     nothing to anon/authenticated.

create extension if not exists pgcrypto with schema extensions;

create schema private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------------------------
-- PINs
-- ---------------------------------------------------------------------------------------------

-- Random key mixed into every stored PIN hash. Created once here; it never leaves the database.
create table private.app_secrets (name text primary key, value text not null);
insert into private.app_secrets (name, value) values ('pin_pepper', encode(extensions.gen_random_bytes(32), 'hex'));

-- One row per PIN: 'owner' (the master PIN) or 'user:<usuario id>'. `hash` = HMAC(pepper,
-- sha256(PIN)): the API only ever handles sha256(PIN), and a stored value is useless without the
-- pepper. Two people could share a PIN in rows saved before PINs had to be unique, so no unique
-- constraint — the API refuses new duplicates and the owner's PIN wins a tie.
create table private.pins (owner_id text primary key, hash text not null);
create index pins_hash on private.pins (hash);

create function private.pin_digest(sha text) returns text
language sql
stable
set search_path = ''
as $$
  select encode(extensions.hmac(sha, (select value from private.app_secrets where name = 'pin_pepper'), 'sha256'), 'hex')
$$;

-- ---------------------------------------------------------------------------------------------
-- Who is working, and what the open counter may do
-- ---------------------------------------------------------------------------------------------

-- Written only by the API, after it verified that person's PIN. `perms` is their role's permissions
-- (plus 'admin' for the Administrador), kept current by the API whenever roles or users change.
-- `expires_at` is pushed forward by the app's heartbeat, so a closed tab or a sleeping phone loses
-- its session within minutes even if it never said goodbye.
create table private.counter_sessions (
  session_id text primary key,
  operator_id text not null,
  operator_name text not null,
  role_id text not null,
  perms text[] not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- The open counter's permissions (mode 'abierto', nobody signed in) — empty in PIN mode. One row,
-- rewritten by the API whenever roles or the access mode change.
create table private.access_state (id int primary key check (id = 1), counter_perms text[] not null default '{}');
insert into private.access_state (id) values (1);

-- Someone else's PIN letting a step through on this session ("autorizar"): short-lived, and the
-- sale-related ones are spent by the sale that used them.
create table private.approvals (
  session_id text not null,
  need text not null,
  approver_id text not null,
  approver_name text not null,
  expires_at timestamptz not null,
  primary key (session_id, need)
);

-- Wrong-PIN counters, per device session and store-wide, so guessing PINs through the API takes
-- days instead of minutes.
create table private.pin_guard (
  scope text primary key,
  failures int not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz
);

-- The permission check every secret table's RLS policy uses. Staff only; then the permissions of
-- whoever is signed in on this Supabase session (if their session hasn't expired), else the open
-- counter's.
create function public.has_perm(perm text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_staff() and perm = any (coalesce(
    (select s.perms from private.counter_sessions s where s.session_id = auth.jwt() ->> 'session_id' and s.expires_at > now()),
    (select a.counter_perms from private.access_state a where a.id = 1),
    '{}'::text[]
  ))
$$;
revoke execute on function public.has_perm(text) from public, anon;
grant execute on function public.has_perm(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Tables for the secret fields, plus the open/closed state of the caja everyone may see
-- ---------------------------------------------------------------------------------------------

create table public."productCosts" (code text primary key, data jsonb not null, updated_at timestamptz not null default clock_timestamp());
-- key = 'sale:<sale id>' or 'cierre:<cierre id>'
create table public.profits (key text primary key, data jsonb not null, updated_at timestamptz not null default clock_timestamp());
-- key = 'menor': whether the Caja Menor is open (and since when, by whom) — no amounts.
create table public."cajaState" (key text primary key, data jsonb not null, updated_at timestamptz not null default clock_timestamp());

create trigger sync_row before insert or update on public."productCosts" for each row execute function public.sync_row('code');
create trigger sync_row before insert or update on public.profits for each row execute function public.sync_row('key');
create trigger sync_row before insert or update on public."cajaState" for each row execute function public.sync_row('key');
create trigger log_deletion after delete on public."productCosts" for each row execute function public.log_deletion('code');
create trigger log_deletion after delete on public.profits for each row execute function public.log_deletion('key');
create trigger log_deletion after delete on public."cajaState" for each row execute function public.log_deletion('key');

create index product_costs_updated_at on public."productCosts" (updated_at);
create index profits_updated_at on public.profits (updated_at);
create index caja_state_updated_at on public."cajaState" (updated_at);

-- ---------------------------------------------------------------------------------------------
-- Triggers that move secret fields out of the public rows
-- ---------------------------------------------------------------------------------------------

-- A jsonb array, or [] for anything else (a malformed row must not break a write).
create function private.array_of(j jsonb) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end
$$;

create function private.number_or_zero(j jsonb) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(j) = 'number' then j else '0'::jsonb end
$$;

-- Items without their `cost`.
create function private.items_without_costs(items jsonb) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(case when jsonb_typeof(i) = 'object' then i - 'cost' else i end order by n), '[]'::jsonb)
  from jsonb_array_elements(private.array_of(items)) with ordinality as t(i, n)
$$;

-- products: `cost` → "productCosts". A write without `cost` leaves the stored cost as it was.
create function private.split_product_cost() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public."productCosts" where code = old.code;
    return old;
  end if;
  if new.data ? 'cost' then
    insert into public."productCosts" (code, data)
    values (new.code, jsonb_build_object('cost', private.number_or_zero(new.data -> 'cost')))
    on conflict (code) do update set data = excluded.data
    where "productCosts".data is distinct from excluded.data;
    new.data := new.data - 'cost';
  end if;
  return new;
end
$$;

-- sales: `ganancia` and every item's `cost` → profits['sale:<id>'], with the sale's day for reports.
create function private.split_sale_profit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  items jsonb;
begin
  if tg_op = 'DELETE' then
    delete from public.profits where key = 'sale:' || old.id;
    return old;
  end if;
  items := private.array_of(new.data -> 'items');
  if new.data ? 'ganancia' or exists (select 1 from jsonb_array_elements(items) i where jsonb_typeof(i) = 'object' and i ? 'cost') then
    insert into public.profits (key, data)
    values ('sale:' || new.id, jsonb_build_object(
      'kind', 'sale',
      'refId', new.id,
      'dayKey', new.data -> 'dayKey',
      'ganancia', private.number_or_zero(new.data -> 'ganancia'),
      'itemCosts', (select coalesce(jsonb_agg(case when jsonb_typeof(i -> 'cost') = 'number' then i -> 'cost' else 'null'::jsonb end order by n), '[]'::jsonb)
                    from jsonb_array_elements(items) with ordinality as t(i, n))
    ))
    on conflict (key) do update set data = excluded.data
    where profits.data is distinct from excluded.data;
    new.data := new.data - 'ganancia';
    if new.data ? 'items' then
      new.data := new.data || jsonb_build_object('items', private.items_without_costs(new.data -> 'items'));
    end if;
  end if;
  return new;
end
$$;

-- cierres: `totalGanancia` → profits['cierre:<id>'].
create function private.split_cierre_profit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.profits where key = 'cierre:' || old.id;
    return old;
  end if;
  if new.data ? 'totalGanancia' then
    insert into public.profits (key, data)
    values ('cierre:' || new.id, jsonb_build_object('kind', 'cierre', 'refId', new.id, 'dayKey', new.data -> 'fecha', 'ganancia', private.number_or_zero(new.data -> 'totalGanancia')))
    on conflict (key) do update set data = excluded.data
    where profits.data is distinct from excluded.data;
    new.data := new.data - 'totalGanancia';
  end if;
  return new;
end
$$;

-- auditLog: a corrected sale's before/after snapshots keep prices, never costs.
create function private.strip_audit_costs() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.data ->> 'type' = 'correccion_venta' then
    if jsonb_typeof(new.data -> 'before') = 'object' then
      new.data := jsonb_set(new.data, '{before,items}', private.items_without_costs(new.data -> 'before' -> 'items'));
    end if;
    if jsonb_typeof(new.data -> 'after') = 'object' then
      new.data := jsonb_set(new.data, '{after,items}', private.items_without_costs(new.data -> 'after' -> 'items'));
    end if;
  end if;
  return new;
end
$$;

-- settings: the master PIN's hash → private.pins['owner']; the old browser-side lockout is gone.
create function private.split_settings_pin() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.data ? 'pinHash' then
    if new.data ->> 'pinHash' ~ '^[0-9a-f]{64}$' then
      insert into private.pins (owner_id, hash) values ('owner', private.pin_digest(new.data ->> 'pinHash'))
      on conflict (owner_id) do update set hash = excluded.hash;
    end if;
    new.data := new.data - 'pinHash';
  end if;
  new.data := new.data - 'pinLockedUntil';
  return new;
end
$$;

-- usuarios: each PIN's hash → private.pins['user:<id>']. Deleting a user removes their PIN and
-- signs them out everywhere.
create function private.split_usuario_pin() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from private.pins where owner_id = 'user:' || old.id;
    delete from private.counter_sessions where operator_id = old.id;
    return old;
  end if;
  if new.data ? 'pinHash' then
    if new.data ->> 'pinHash' ~ '^[0-9a-f]{64}$' then
      insert into private.pins (owner_id, hash) values ('user:' || new.id, private.pin_digest(new.data ->> 'pinHash'))
      on conflict (owner_id) do update set hash = excluded.hash;
    end if;
    new.data := new.data - 'pinHash';
  end if;
  return new;
end
$$;

-- BEFORE triggers run in name order: "split_secrets" before "sync_row", so sync_row stamps the
-- cleaned row.
create trigger split_secrets before insert or update on public.products for each row execute function private.split_product_cost();
create trigger drop_secrets after delete on public.products for each row execute function private.split_product_cost();
create trigger split_secrets before insert or update on public.sales for each row execute function private.split_sale_profit();
create trigger drop_secrets after delete on public.sales for each row execute function private.split_sale_profit();
create trigger split_secrets before insert or update on public.cierres for each row execute function private.split_cierre_profit();
create trigger drop_secrets after delete on public.cierres for each row execute function private.split_cierre_profit();
create trigger split_secrets before insert or update on public."auditLog" for each row execute function private.strip_audit_costs();
create trigger split_secrets before insert or update on public.settings for each row execute function private.split_settings_pin();
create trigger split_secrets before insert or update on public.usuarios for each row execute function private.split_usuario_pin();
create trigger drop_secrets after delete on public.usuarios for each row execute function private.split_usuario_pin();

-- "cajaState" follows the sessions table on every change: open or not, since when and by whom.
create function private.write_caja_state() returns void
language sql
security definer
set search_path = ''
as $$
  insert into public."cajaState" (key, data)
  select 'menor', jsonb_strip_nulls(jsonb_build_object(
    'started', exists (select 1 from public."cashSessions"),
    'open', s.id is not null,
    'sessionId', s.id,
    'dayKey', s.data -> 'dayKey',
    'openedAt', s.data -> 'openedAt',
    'openedBy', s.data -> 'openedBy'
  ))
  from (select 1) as one
  left join lateral (select id, data from public."cashSessions" where data ->> 'status' = 'abierta' order by id desc limit 1) s on true
  on conflict (key) do update set data = excluded.data
  where "cajaState".data is distinct from excluded.data
$$;

create function private.refresh_caja_state() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.write_caja_state();
  return null;
end
$$;
create trigger refresh_caja_state after insert or update or delete on public."cashSessions" for each statement execute function private.refresh_caja_state();

-- ---------------------------------------------------------------------------------------------
-- Who may read what
-- ---------------------------------------------------------------------------------------------

do $$
declare
  t text;
begin
  -- Only SELECT, and only for signed-in users; RLS decides which rows. (Supabase grants new public
  -- tables to anon/authenticated by default.)
  foreach t in array array[
    'products', 'customers', 'settings', 'usuarios', 'suppliers', 'sales', 'cierres', 'auditLog',
    'entradas', 'cashMovements', 'cashSessions', 'purchaseOrders', 'payables', 'deletions', 'sync_meta',
    'productCosts', 'profits', 'cajaState'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;

  -- Secret tables: the staff-wide policy goes; each one asks for its permission.
  foreach t in array array['suppliers', 'cierres', 'cashMovements', 'cashSessions', 'purchaseOrders', 'payables'] loop
    execute format('drop policy "staff can read" on public.%I', t);
  end loop;
end
$$;

create policy "staff can read" on public."cajaState" for select to authenticated using ((select public.is_staff()));
create policy "costos.ver" on public."productCosts" for select to authenticated using ((select public.has_perm('costos.ver')));
create policy "costos.ver" on public."purchaseOrders" for select to authenticated using ((select public.has_perm('costos.ver')));
create policy "costos.ver" on public.payables for select to authenticated using ((select public.has_perm('costos.ver')));
create policy "ganancias.ver" on public.profits for select to authenticated using ((select public.has_perm('ganancias.ver')));
create policy "proveedores.gestionar" on public.suppliers for select to authenticated using ((select public.has_perm('proveedores.gestionar')));
create policy "caja.verEsperado" on public."cashMovements" for select to authenticated using ((select public.has_perm('caja.verEsperado')));
create policy "caja.verEsperado" on public."cashSessions" for select to authenticated using ((select public.has_perm('caja.verEsperado')));
create policy "reportes.ver" on public.cierres for select to authenticated using ((select public.has_perm('reportes.ver')));

alter publication supabase_realtime add table public."productCosts", public.profits, public."cajaState";

-- ---------------------------------------------------------------------------------------------
-- Move what's already there
-- ---------------------------------------------------------------------------------------------

-- Rewriting a row runs its split trigger.
update public.products set data = data where data ? 'cost';
update public.sales set data = data
where data ? 'ganancia' or exists (select 1 from jsonb_array_elements(private.array_of(data -> 'items')) i where jsonb_typeof(i) = 'object' and i ? 'cost');
update public.cierres set data = data where data ? 'totalGanancia';
update public."auditLog" set data = data where data ->> 'type' = 'correccion_venta';
update public.settings set data = data;
update public.usuarios set data = data where data ? 'pinHash';
select private.write_caja_state();

-- Every device drops its local copy (which still holds costs and PIN hashes) and downloads the
-- cleaned data again.
update public.sync_meta set value = (value::bigint + 1)::text where key = 'epoch';
