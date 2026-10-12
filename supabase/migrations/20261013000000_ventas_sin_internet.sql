-- Mi Tienda Pro: sales made while the internet was down.
--
-- A device without internet keeps the sale it just made and sends it when the connection comes back.
-- Each sale carries the code the device gave it (`clientId`, a UUID), so sending the same sale twice —
-- a reply that got lost, two windows sending the same queue — can never save it twice: the API looks the
-- code up first (server/domain/sales.ts, `saleByClientId`), and this index is both what makes that lookup
-- fast (every sale does it) and the safety net under it, the one place two requests at the very same
-- moment could still both pass the check.
--
-- A plain unique index on the expression, not a partial one (`where data ? 'clientId'`): the planner can't
-- prove that `data ->> 'clientId' = $1` implies that predicate, so a partial index would never be used by
-- the lookup. Sales that carry no code (everything made before this) have NULL there, and NULLs never
-- collide in a unique index.
--
-- Nothing else changes in the database: the new fields of a sale (`offline`, `reviewNotes`…) live inside
-- its `data`, like every other field.

create unique index sales_client_id on public.sales ((data ->> 'clientId'));
