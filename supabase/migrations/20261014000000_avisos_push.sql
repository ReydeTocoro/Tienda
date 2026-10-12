-- Mi Tienda Pro: the devices where the Administrador gets the "Pendientes de hoy" on the phone (push notifications
-- through Firebase Cloud Messaging), sent by the Function at fixed hours (functions/index.js, server/domain/push.ts).
--
-- One row per device: its FCM token (made by the browser when the Administrador turns the notices on) and whose it is.
-- It lives in the `private` schema, which no browser can reach (nothing is granted to anon/authenticated and the API
-- only serves `public`): only the API saves a token — for an Administrador's own session — and only the scheduled send
-- reads them, checking each time that the person is still an active Administrador.

create table private.push_tokens (
  token text primary key,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
