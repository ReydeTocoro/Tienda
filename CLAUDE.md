# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Branches

- `main` — the old single-file HTML/JS/CSS POS app (`legacy/`). Untouched, kept for reference only.
- `react-rewrite` (current work happens here) — full React 19 + TypeScript + Vite + Tailwind 4 + Zustand rewrite, now with a Node/SQLite server. Always work on this branch unless told otherwise.

## Commands

```
npm run dev              # Vite dev server (proxies /api and /ws to localhost:3001 — run the server separately)
npm run server            # Node server: tsx server/index.ts (Express + better-sqlite3 + ws), http://0.0.0.0:3001
npm run build              # tsc -b && vite build
npm run lint                # oxlint
npm run preview
npm run typecheck:server   # tsc --noEmit -p server/tsconfig.json (server isn't covered by the app build)
npm run check:cash         # assert-based self-check of the money logic (cajas, traslados, pedidos, cuentas por pagar, cierre) on an in-memory SQLite — never the real DB
```

There is no test runner configured. There's no single-test command because there are no tests — follow Ponytail's rule of leaving a runnable self-check (assert-based `demo()`/`__main__` or a small `test_*` file) only for non-trivial logic you add, not a full suite.

For a real end-to-end check of the client-server sync, `npm run build` then `npm run server`, and hit `http://localhost:3001` from two devices on the same network — see "Client-server architecture" below.

`npm install-scripts approve <pkg>` was already run for `better-sqlite3` and `esbuild` (native/postinstall builds) and is recorded in `package.json`'s `allowScripts` — a fresh `npm install` should not need it re-approved.

## Architecture

### Client-server model (the thing to understand first)

The app used to be single-device, IndexedDB-only. It's now a client-server app so multiple devices (a PC and a phone, say) see the same live data:

- **`server/`** — Express + `better-sqlite3`, the source of truth. Each Dexie table has a mirror SQLite table storing one `json` blob column per row (plus a couple of indexed columns like `customers.cedula` where a query needs them) — see `server/db.ts` and the helpers in `server/routes/generic.ts` (`listAll`/`getRow`/`putRow`/`deleteRow`/`insertAutoRow`). Every write handler calls `broadcast()` (`server/broadcast.ts`) over WebSocket (`/ws`) after writing. In production the server also serves the built `dist/` as static files, so PC and phone hit one process for both the UI and the API.
- **`src/db/`** — Dexie (IndexedDB) is now a **local mirror/cache, not the source of truth**. `src/db/schema.ts` defines the same tables (`TABLES` in `src/sync/index.ts` is the list). `src/sync/index.ts` connects the WebSocket, does a full pull of all tables on every (re)connect, and applies each broadcast (`put`/`delete`) into Dexie. It's mounted once from `src/app/AppShell.tsx`.
- **`src/db/repositories/*.ts`** — one file per entity, the only place components should touch data. **Read functions still read Dexie directly** (`db.products.toArray()`, etc.) and are consumed via `useLiveQuery` from `dexie-react-hooks`, unchanged from before the server existed. **Write functions now call the server** via `src/api/client.ts` (`apiPost`/`apiPut`/`apiDelete`) instead of writing Dexie — the mirror updates itself when the broadcast comes back over the WebSocket, so a repository never writes to Dexie after a mutation.
- Transactional operations (stock changes tied to a sale, package-opening, cyclic count adjustments, import) live as dedicated server endpoints using `db.transaction(fn)` (synchronous, `better-sqlite3`) rather than being ported 1:1 from the old async Dexie transactions — see `server/routes/inventoryOps.ts`, `server/routes/sales.ts`.
- **Money logic lives in `server/domain/`** (`cash.ts`, `purchasing.ts`, `cierre.ts`): plain functions `(db, out, input)` that run inside the caller's transaction and push the rows they touched onto `out`; `runAndBroadcast` (`server/domain/tx.ts`) commits first and broadcasts after, so a rejected operation changes nothing. Routes stay thin. `npm run check:cash` exercises these.
- When adding a new entity or field: update the type in `src/types/`, the Dexie schema (`src/db/schema.ts`), the server table (`server/db.ts`), the repository's read/write split, and the corresponding `server/routes/*.ts` handler + `broadcast()` call. `TABLES` in `src/sync/index.ts` must list every synced table.

### Networking beyond local WiFi

Remote access (from outside the local network) goes through Tailscale (`tailscale serve`), not port-forwarding or a cloud backend — deliberately no Firebase/Supabase/third-party backend anywhere in this project. On the phone (Termux + proot-distro Ubuntu), `tienda-start`/`tienda-stop`/`tienda-status` (in `$PREFIX/bin`, outside this repo) start/stop both `tailscaled` and `npm run server` together. Those scripts must be run from a plain Termux shell, never from inside an already-entered `proot-distro login` session (nesting proot-distro sessions doesn't work).

### Frontend structure

- `src/app/` — shell chrome: `AppShell.tsx` (layout + mounts global effects: sync, theme, scanner, keyboard shortcuts), `Header`/`Sidebar`/`BottomNav` (mobile gets `BottomNav`, `md:`+ swaps in `Sidebar` — one breakpoint switch, pages don't special-case it), `navConfig.ts` (single source of nav items + live badge counts, shared by both chromes).
- `src/features/<name>/` — one folder per route/domain (`pos`, `inventory`, `customers`, `fiados`, `history`, `reports`, `pin`), each with its own `components/`, `hooks/`, and sometimes `lib/` for pure logic (e.g. `features/fiados/lib/fiadoGrouping.ts`, shared by nav badges and the Fiados page).
- `src/store/` — Zustand stores for ephemeral UI/client state (cart draft, toasts, confirm dialog, PIN session, scanner on/off). Persisted business data goes through `src/db/`, not a store.
- `src/shared/` — cross-feature `components/` (e.g. `ToastHost`, `ConfirmDialog` — both driven by their Zustand stores and rendered once from `AppShell`), `hooks/`, `lib/`.
- Native `<dialog>` is the standard modal primitive (backdrop, Escape, focus trap, top-layer stacking all come free) — don't hand-roll a new overlay/portal for a modal.
- Admin-gated actions (Inventario, Reporte, etc.) go through `usePermission().requireAdmin()` (`src/features/pin/usePermission.ts`), the single permission mechanism — it resolves immediately if already unlocked this session, otherwise prompts `PinModal`. Don't invent a second gating mechanism.

### Cash-register domain specifics

`Sale` (`src/types/sale.ts`) carries `chargeOverride`, `amountReceived`, `changeGiven`, and `roundingAdjustment` as explicit, separate fields from `subtotal`/`discount`/`total` — never fold a rounding or tender adjustment into those base fields, the UI (`CartPanel`) and reports rely on them staying transparent and separately inspectable.

Cierre Z (day close) is **non-destructive**: sales and cash movements get `closedInCierreId` stamped on them, they're never deleted. Any report/aggregation logic must filter on that field rather than assuming "current day close = current data". It is also how the Caja Menor workday ends: the expected cash is the ledger balance (computed server-side), the gap against the counted cash becomes an `ajuste_arqueo` movement, and an optional transfer to the Caja Mayor happens in the same transaction.

**Cajas are a ledger, not stored balances** (`cashMovements`, `src/types/cash.ts`): a caja's balance is always the sum of its movements (`balanceOf` in `src/shared/lib/cash.ts`), amounts are always positive with a `direction`, and nothing is ever edited or deleted — corrections are new movements. Caja Menor = the drawer (cash sales, fiado collections, petty expenses; a `cashSessions` row per opened workday); Caja Mayor = safe/bank (receives transfers, pays payroll/rent/utilities/suppliers). Money lands where it physically is: cash sales and cash fiado payments go to the Menor, bank-transfer ones to the Mayor (`medio: 'transferencia'`); fiado sales and forgiven debts move nothing. The first opening ever is the start of the books (base inicial of the Menor + optional saldo inicial of the Mayor) — sales from before the cajas existed are deliberately not back-filled. Spending from a caja is rejected when its balance is insufficient.

**Purchasing** (`suppliers`, `purchaseOrders`, `payables`): stock only grows in `receiveOrder`, in the same transaction that books the payment (cash out of the chosen caja) or the account payable (due date = receipt day + the supplier's credit days). The old free-form `extras`/`purchases` tables were replaced by this. Day keys are computed in the store's timezone (`dayKeyOf` in `src/shared/lib/currency.ts`), never from UTC.

## Config notes

- TypeScript: bundler-mode resolution, `verbatimModuleSyntax`, extensionless relative imports, `noUnusedLocals`/`noUnusedParameters` enforced — `npm run build`'s `tsc -b` will fail on unused vars/params, don't rely on lint alone to catch that. The server has its own `server/tsconfig.json` (checked separately via `npm run typecheck:server`, not part of `npm run build`).
- Lint: `oxlint` (`.oxlintrc.json`), not ESLint.
- Tailwind 4 (`@theme` tokens in `src/index.css`, `.dark` class variant applied to `<body>` from `AppShell`'s theme effect) — no `tailwind.config.js`, tokens live in CSS.
- `legacy/` is the old app's static assets (kept for reference/migration, not part of the build).
