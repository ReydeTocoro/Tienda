-- Mi Tienda Pro: each person signs in with their own account (email and password).
--
-- Until now one Supabase account (the owner's) opened the app on every device, and whoever worked
-- there signed in on top of it with a PIN — so only the owner could start a device. From here on the
-- account itself says who is working:
--   * public.staff lists the owner's account(s), always Administrador. Adding another owner is still
--     `insert into public.staff (email, name) values (...)`.
--   * Everyone else is a row of public.usuarios whose `email` is their own Supabase Auth account
--     (the API creates it: server/accounts.ts). It counts as staff only while that user is active.
--   * The API binds each signed-in session to its person (private.counter_sessions, as before), and
--     RLS serves the secret tables only through that binding: there's no open counter anymore.
--   * PINs no longer sign anyone in; someone allowed types theirs to authorize one step on another
--     person's session ("autorizar").
--   * Sessions signed in before this migration must sign in again, so a device that was opened with
--     the owner's account doesn't stay the owner's once each person has their own.

-- Staff: an owner's account, or the account of an active user.
create or replace function public.is_staff() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  ) or exists (
    select 1 from public.usuarios u
    where lower(u.data ->> 'email') = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (u.data -> 'active') = 'true'::jsonb
  )
$$;

-- One account per person (the API also keeps the owners' emails off the users).
create unique index usuarios_email on public.usuarios (lower(data ->> 'email')) where (data ->> 'email') is not null;

-- What a session may read: the permissions of the person bound to it, nothing else. The open
-- counter's permissions (private.access_state) aren't read anymore; the table stays, emptied, so the
-- previous app version still runs against this schema while a deploy is under way.
create or replace function public.has_perm(perm text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_staff() and perm = any (coalesce(
    (select s.perms from private.counter_sessions s where s.session_id = auth.jwt() ->> 'session_id' and s.expires_at > now()),
    '{}'::text[]
  ))
$$;
update private.access_state set counter_perms = '{}';

-- Sessions that signed in before this moment get "sign in again" from the API (server/auth.ts).
create table private.account_policy (id int primary key check (id = 1), sessions_since timestamptz not null);
insert into private.account_policy (id, sessions_since) values (1, now());

-- Nobody is bound through a PIN anymore: every device binds its account again as it starts.
delete from private.counter_sessions;
delete from private.approvals;
