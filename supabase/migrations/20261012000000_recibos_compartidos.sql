-- Mi Tienda Pro: the link a customer gets on WhatsApp to see (and download as a PDF) their receipt.
--
-- The receipt is stored as text — the same data the printed receipt shows, taken from the sale by
-- the API — under a random 128-bit code; the link is /recibo/<code>. Whoever has the code can read
-- that one receipt (GET /api/recibo/<code>, no sign-in), nobody can list them, and no PDF file is
-- ever stored: the customer's own phone builds it.
--
-- It lives in the `private` schema, which no browser can reach (nothing is granted to
-- anon/authenticated and the API only serves `public`): the only way in is the API, which checks
-- who may share a receipt and reads the sale itself instead of trusting what a browser sends.

create table private.shared_receipts (
  -- 32 hex digits = 16 random bytes, made by the API (never by a browser).
  id text primary key check (id ~ '^[0-9a-f]{32}$'),
  -- One link per sale: sharing the same sale again refreshes the data (a corrected sale shows the
  -- correction) and the expiry, and keeps the same link.
  sale_id bigint not null unique,
  data jsonb not null,
  created_at timestamptz not null default now(),
  -- The link stops opening after this (30 days from the last time it was shared); the API deletes
  -- the expired rows whenever it creates a link.
  expires_at timestamptz not null
);
create index shared_receipts_expires on private.shared_receipts (expires_at);
