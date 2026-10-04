# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Branches

GitHub only has `main`, and it carries the whole app (React 19 + TypeScript + Vite + Tailwind 4 + Zustand client, Express API, Supabase Postgres); the old single-file HTML/JS/CSS app survives only as `legacy/`. Day-to-day work happens on the local `react-rewrite` branch and is published with `git push origin HEAD:main` (merge `origin/main` into it first if it moved). Commit and push only when the user asks; `MIOS/` (their real Excel with costs and suppliers) is git-ignored and must never be committed.

## Commands

```
npm run dev               # Vite dev server (proxies /api to localhost:3001 — run `npm run server` alongside)
npm run server            # the API locally: tsx server/index.ts (Express → Supabase Postgres), http://0.0.0.0:3001
npm run build             # tsc -b && vite build → dist/
npm run lint              # oxlint — exits 0 even with its standing warnings, see Config notes
npm run typecheck:server  # tsc --noEmit -p server/tsconfig.json (server isn't covered by the app build)
npm run check:cash        # assert-based self-check of the money logic (cajas, traslados, pedidos, cuentas por pagar, cierre) on an in-memory Postgres (PGlite) built from the real migration
npm run db:push           # apply supabase/migrations to the Supabase database (append `-- --dry-run` to only list them)
npm run db:import         # ALREADY RUN (2026-10-02): it copied the old SQLite file into Supabase and REPLACES every table there, so running it again would wipe the live store's data — don't
npm run build:functions   # esbuild server/serverApp.ts → functions/lib/server.js (the Function's bundle)
npm run deploy            # build + build:functions + firebase deploy (Hosting + Function) to plastimax-fr
```

There is no test runner configured, so there is no single-test command. Per Ponytail's rule, only non-trivial logic you add gets a runnable self-check (assert-based, like `server/selfcheck.ts`) — not a full suite.

**There is one database, and it is production**: the Supabase project `vwydllsxuyfxtyrgvtdk` holds the store's real data, and both `npm run server` and the deployed Function write to it. Exercise money logic through `npm run check:cash` (PGlite, in memory), never by trying writes in the running app. `npm run build` also rewrites `dist/`, which `npm run server` serves.

`npm install-scripts approve <pkg>` was already run for `better-sqlite3`, `esbuild` and `core-js` (native/postinstall builds) and is recorded in `package.json`'s `allowScripts` — a fresh `npm install` should not need it re-approved. `functions/` has its own `package.json`; run `npm install` there once before the first deploy.

## Architecture

### Cloud model (the thing to understand first)

Several devices (a PC and a phone, say) share the same live data through the internet:

- **Supabase Postgres is the source of truth** (`supabase/migrations`). Each table mirrors a Dexie table: a primary-key column plus `data jsonb` holding the whole row exactly as its type in `src/types/` defines it. Triggers do the bookkeeping: `sync_row` copies the key into `data` (so an insert comes back carrying its generated id) and stamps `updated_at`; `log_deletion` records deletes in `deletions`. `sync_meta.epoch` is bumped when data is reloaded wholesale (`db:import`), which makes every device drop its mirror and pull everything again.
- **Reads go straight from the browser to Supabase.** `src/sync/index.ts` keeps the Dexie mirror current: on every (re)connect it pulls the rows whose `updated_at` passed its per-table cursor (all of them the first time), replays `deletions`, then applies Realtime `postgres_changes` as they arrive. `src/db/repositories/*.ts` read Dexie only, through `useLiveQuery`, so the app keeps showing the last known data offline.
- **Writes go through the API** (`server/`, Express): `src/api/client.ts` (`apiPost`/`apiPut`/`apiDelete`) sends the Supabase session as a Bearer token, and a repository never writes Dexie itself (Realtime brings the result back). The API runs as the Firebase Function `api` (`functions/index.js`, region us-east4, next to the database) behind the Hosting rewrite `/api/**`; locally it's `npm run server`, with Vite proxying `/api`. It connects through the Supabase session pooler with certificate verification (`server/supabaseCa.ts`) — the direct `db.<ref>.supabase.co` host is IPv6-only.
- **Who can do what:** Supabase Auth (email + password) says who someone is. The `staff` table says they work at the store, and neither reads (RLS policy `staff can read`, via `public.is_staff()`) nor writes (`server/auth.ts`, which verifies the token with `/auth/v1/user` and then checks `staff`) work without it. Browsers can never write tables directly (privileges revoked). Grant access with `insert into public.staff (email, name) values (...)` after creating the user in the Supabase dashboard.
- **Money logic lives in `server/domain/`** (`cash.ts`, `purchasing.ts`, `cierre.ts`): plain async functions `(q, input)` that run inside the caller's `db.tx`, so a rejected operation changes nothing. `db.tx` (`server/db.ts`) takes one app-wide `pg_advisory_xact_lock` first, so writes run one at a time — the guarantee the old synchronous SQLite server had — and a stock or balance check can't be raced by another device. Every route goes through `handle()` (`server/routes/http.ts`), because Express 4 doesn't catch rejected promises.
- Adding a new entity touches:
  - the type in `src/types/`;
  - a **new** migration in `supabase/migrations` (table with `data jsonb` + `updated_at`, both triggers, RLS policy, privileges, `supabase_realtime` publication) applied with `npm run db:push`;
  - the Dexie schema in `src/db/schema.ts` as a **new** `this.version(n+1).stores({...})` block (never edit an earlier one; `null` drops a table);
  - the route in `server/routes/*.ts`, mounted in `server/app.ts`;
  - the repository's read/write split;
  - `TABLES` in `src/sync/index.ts`, which must list every synced table.

  A plain new field on an existing entity needs none of that schema work — Dexie only declares *indexed* fields and Postgres keeps the row as `data` — only a new index or table does.
- The default `Settings` row exists twice and the two copies must stay identical: the seed in the first migration and the `getSettings()` fallback in `src/db/repositories/settings.ts` (initial admin PIN `1234`).

### Deployment and secrets

- Firebase project `plastimax-fr`: Hosting serves `dist/` at https://plastimax-fr.web.app (`firebase.json`, SPA rewrite, immutable `/assets/**`, no-cache service worker) and rewrites `/api/**` to the Function. `npm run deploy` does it all; the Firebase CLI is installed globally and logged in.
- Secrets: the database URL (with the password) lives in `.env.local` (git-ignored, read by the local server and the db scripts) and in Secret Manager as `SUPABASE_DB_URL` for the Function (`firebase functions:secrets:set SUPABASE_DB_URL`, then redeploy the Function). Public config: `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, bundled into the app) and `functions/.env`. The publishable key is public by design.
- Deliberately no Firebase SDK in the app: Firebase only hosts; Supabase does auth, data and realtime.

### Frontend structure

- `src/app/` — shell chrome: `AppShell.tsx` (layout + mounts global effects: sync, API warm-up, theme, scanner, keyboard shortcuts), `Header`/`DesktopTabs`/`BottomNav` (mobile gets the slim `Header` + `BottomNav`, `md:`+ swaps in the `DesktopTabs` top bar — one breakpoint switch, pages don't special-case it), `navConfig.ts` (single source of nav items + live badge counts, shared by both chromes).
- `src/features/auth/` — `AuthGate` (wraps the router in `App.tsx`: nothing loads until a staff member signs in; non-staff accounts are signed straight back out), `LoginPage`, and `SessionSection` (Configuración's sign-out, which also clears the local mirror).
- `src/features/<name>/` — one folder per route/domain (`pos`, `inventory`, `customers`, `fiados`, `invoices`, `cash` for Cajas, `suppliers` for Proveedores and purchasing, `reports`, `settings`, `pin`, `auth`), each with its own `components/`, `hooks/`, and sometimes `lib/` for pure logic (e.g. `features/fiados/lib/fiadoGrouping.ts`, shared by nav badges and the Fiados page).
- `src/api/` — `supabase.ts` (the single Supabase client) and `client.ts` (the write API wrapper).
- `src/store/` — Zustand stores for ephemeral UI/client state (cart draft, toasts, confirm dialog, PIN session, scanner on/off). Persisted business data goes through `src/db/`, not a store.
- `src/shared/` — cross-feature `components/` (e.g. `ToastHost`, `ConfirmDialog` — both driven by their Zustand stores and rendered once from `AppShell`), `hooks/`, `lib/`. Stock, Clientes, Fiados and Facturas are spreadsheet-style lists on the shared virtualized `DataTable` (with `SearchInput`, `AddFab`, `Chip` and `lib/sortRows`): build any new list that way rather than as a card grid.
- Native `<dialog>` is the standard modal primitive (backdrop, Escape, focus trap, top-layer stacking all come free) — don't hand-roll a new overlay/portal for a modal. Clicking the backdrop deliberately does nothing but nudge (`src/shared/lib/backdropNudge.ts`), so a mis-tap never throws away a half-filled form: every `Modal`/`BottomSheet` needs its own visible Cancelar/Cerrar (X) — Escape still closes. A dialog taller than the screen shrinks its content up to 20% (`useFitHeight`, applied by `Modal`/`BottomSheet`/`PinModal`) instead of showing a scrollbar, so design forms to fit about 600px of height and keep long lists in their own scrolling area.
- Admin gating inside the app has a single mechanism, `usePermission().requireAdmin()` (`src/features/pin/usePermission.ts`): it resolves immediately if the session is already unlocked, otherwise prompts `PinModal`; `{ force: true }` prompts every time, for data that must stay hidden even inside an unlocked section (the inventory's purchase prices). Whole sections (`/inventario`, `/cajas`, `/proveedores`, `/reporte`, `/configuracion`) are wrapped in `AdminGate` in `src/router.tsx`, which calls it, so direct URLs and reloads are covered too. The PIN is a UI-level gate between people sharing a signed-in device — `sha256(entered)` is compared in the browser with the mirrored `settings.pinHash` or an active admin `usuario` — on top of the login, which is what the API and RLS enforce. Don't invent a second gating mechanism.

### Cash-register domain specifics

`Sale` (`src/types/sale.ts`) carries `chargeOverride`, `amountReceived`, `changeGiven`, and `roundingAdjustment` as explicit, separate fields from `subtotal`/`discount`/`total` — never fold a rounding or tender adjustment into those base fields, the UI (`CartPanel`) and reports rely on them staying transparent and separately inspectable.

Cierre Z (day close) is **non-destructive**: sales and cash movements get `closedInCierreId` stamped on them, they're never deleted. Any report/aggregation logic must filter on that field rather than assuming "current day close = current data". It is also how the Caja Menor workday ends: the expected cash is the ledger balance (computed server-side), the gap against the counted cash becomes an `ajuste_arqueo` movement, and an optional transfer to the Caja Mayor happens in the same transaction.

**Cajas are a ledger, not stored balances** (`cashMovements`, `src/types/cash.ts`): a caja's balance is always the sum of its movements (`balanceOf` in `src/shared/lib/cash.ts`), amounts are always positive with a `direction`, and nothing is ever edited or deleted — corrections are new movements. Caja Menor = the drawer (cash sales, fiado collections, petty expenses; a `cashSessions` row per opened workday); Caja Mayor = safe/bank (receives transfers, pays payroll/rent/utilities/suppliers). Money lands where it physically is: cash sales and cash fiado payments go to the Menor, bank-transfer ones to the Mayor (`medio: 'transferencia'`); fiado sales and forgiven debts move nothing. The first opening ever is the start of the books (base inicial of the Menor + optional saldo inicial of the Mayor) — sales from before the cajas existed are deliberately not back-filled. Spending from a caja is rejected when its balance is insufficient.

**Purchasing** (`suppliers`, `purchaseOrders`, `payables`): stock only grows in `receiveOrder`, in the same transaction that books the payment (cash out of the chosen caja) or the account payable (due date = receipt day + the supplier's credit days). The old free-form `extras`/`purchases` tables were replaced by this. Day keys are computed in the store's timezone (`dayKeyOf` in `src/shared/lib/currency.ts`), never from UTC.

## Config notes

- TypeScript: bundler-mode resolution, `verbatimModuleSyntax`, extensionless relative imports, `noUnusedLocals`/`noUnusedParameters` enforced — `npm run build`'s `tsc -b` will fail on unused vars/params, don't rely on lint alone to catch that. The server has its own `server/tsconfig.json` (checked separately via `npm run typecheck:server`, not part of `npm run build`), with `erasableSyntaxOnly` (no enums or constructor parameter properties).
- Lint: `oxlint` (`.oxlintrc.json`), not ESLint.
- Tailwind 4 (`@theme` tokens in `src/index.css`, `.dark` class variant applied to `<body>` from `AppShell`'s theme effect) — no `tailwind.config.js`, tokens live in CSS.
- Colors come only from those tokens, never hex/rgba in components. The identity is the Plastimax F.R. brand palette. `lime` is the brand token and now holds the brand **blue** `#003d98` (primary buttons, active state) — the name is kept only to avoid churning ~230 usages; the other hues are statuses (`green` = money/income, `red` = alert/delete/debt only — never the primary/Cobrar action, `orange` = attention, `blue` = info, `purple` = loyalty). `yellow` (`#fee436`) is only ever a **background** for promos/destacados, always with `text-on-yellow` (`#172033`, dark in both themes — never `text-txt`, which flips to light at night). Text on any other solid color is `text-on-solid` (white in light mode, near-black in dark). The nav chrome (where the modules are: `DesktopTabs`, mobile `Header`, `BottomNav`, plus `HeaderTools`) is the brand navy: `bg-nav`/`border-nav-line`, `text-nav-fg` active (with a `after:bg-yellow` underline on the desktop tabs), `text-nav-fg-dim` inactive, `bg-nav-hover` hover; the `nav-*` tokens stay blue in both themes (dark only lightens them a touch). Zones are separated by `border-br` hairlines and cards lifted with `shadow-xs` (the shadow color follows the theme through `--shadow-rgb`); `br2` is for the outline of controls. `brand-deep` (`#001c5e`) is the navy, also available for gradients. Every text/background pair is kept ≥ WCAG AA 4.5:1 in both themes.
- The banknote photos on the checkout's quick-cash buttons are shrunk copies in `src/assets/bills` (mapped by `src/features/pos/lib/bills.ts`; the originals stay in the git-ignored `MIOS/bills`). `vite.config.ts` precaches `.jpg` so they also show offline.
- The store's logo and the app icons are shrunk copies of the transparent original in the git-ignored `MIOS/icon`: `src/assets/logo.png` (login) and `logo-sm.png` (the corner of the chrome, via `StoreBrand`, which shows the logo instead of the configured name — receipts, the Reporte X and the exports still print the name), plus `public/icons/` (`logo-192/512` for "any", `logo-maskable-192/512` on white with the logo inside the safe circle, `apple-touch-icon`, `favicon-32`). The icon files got new names on purpose, so browsers don't keep the old favicon cached.
- `legacy/` is the old app's static assets (kept for reference/migration, not part of the build). `server/data/tienda.db` is the old SQLite database, frozen since the move to Supabase (its last consistent copy is in `server/data/backups/*-antes-migracion-nube/`); it is git-ignored and nothing reads it anymore.
- `npm run lint` exits 0 but has a standing baseline of React-compiler warnings (`react(refs)`, `react(set-state-in-effect)`, and `react(incompatible-library)` for `useVirtualizer` in `DataTable`/`ProductGrid`): judge new code by whether it adds warnings, and treat `npm run build` + `npm run typecheck:server` as the real gate.
- Windows checkout with `core.autocrlf=true` and no `.gitattributes`: older files are CRLF in the working tree, newer ones LF. A multi-line `Edit` doesn't match the CRLF ones — normalize `\r\n` in a small script (and restore it) instead of rewriting the whole file, so diffs stay small.
