-- EMERGENCY ONLY: undoes supabase/migrations/20261007000000_cuentas_por_persona.sql.
--
-- Not a migration (the Supabase CLI only reads supabase/migrations): run it by hand in the SQL editor,
-- and only together with deploying the app version from before that migration (f7e7a93) — the
-- current app and API need everything it creates. Then remove the migration's row from
-- supabase_migrations.schema_migrations so `db:push` doesn't consider it applied.
--
-- Afterwards only public.staff opens the app again (the owner's account) and people sign in with
-- their PIN. The employees' accounts stay in Supabase Auth and their emails on their user rows, but
-- neither gives access to anything; the old API rewrites the open counter's permissions as it starts.

create or replace function public.is_staff() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
$$;

drop index public.usuarios_email;

create or replace function public.has_perm(perm text) returns boolean
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

drop table private.account_policy;
delete from private.counter_sessions;
