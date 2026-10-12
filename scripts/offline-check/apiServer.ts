/** The real API (server/app.ts) on an in-memory Postgres (PGlite, built from the real migrations) — never the Supabase
 * data — with controls to break the connection on purpose, and a stand-in for Supabase next to it. It is what the
 * browser checks of selling without internet talk to:  npx tsx scripts/offline-check/apiServer.ts
 *
 *   POST /__test/mode   { kind: 'down' | 'hang' | 'status' | 'lostAnswer' | 'delay', status?, times?, path?, down?, html?, slow?, ms? }
 *       'down'        cut the connection; 'hang' never answer; 'status' answer with that HTTP status (JSON; `down: true`
 *       marks it as "the database can't be reached", `html: true` makes it a gateway's page instead; `slow: ms` holds the
 *       headers and the body apart that long, to see that a stalled body is cut off too); 'delay' answers normally, but
 *       only after `ms` (to make requests overlap);
 *       'lostAnswer'  do the work but cut the connection before the answer reaches the device;
 *       `times`: only for the next N requests; `path`: only for URLs starting with it.
 *   POST /__test/supa   { down?: boolean, accessTtl?: number }   the "internet" of the Supabase stand-in
 *   POST /__test/reset  start over from the seed data
 *   GET  /__test/state  stocks, sales and cash movements as the database has them, and `requests`: how many times each
 *       "METHOD /path" reached the API since the last reset (whatever the mode did with it) */
import express, { type RequestHandler } from 'express'
import { createApp } from '../../server/app'
import type { AuthInfo } from '../../server/auth'
import { pgliteDb } from '../../server/db'
import { checkAccount, refreshCounterPerms } from '../../server/domain/counter'
import { testDatabase } from '../../server/testDb'
import { dayKeyOf } from '../../src/shared/lib/currency'
import { startFakeSupabase, TEST_EMAIL, type SupaControl } from './fakeSupabase'

console.error = () => {} // the routes log the errors this check provokes

const lite = await testDatabase()
const db = pgliteDb(lite)

async function seed() {
  await lite.exec(`
  insert into public.staff (email, name) values ('${TEST_EMAIL}', 'Propietario');
  insert into public.products (code, data) values
    ('A1', '{"code":"A1","name":"Balde","price":2000,"price2":1800,"cost":1200,"stock":50,"min":0,"cat":"","brand":"","unit":"unidad","esPaquete":false}'),
    ('B2', '{"code":"B2","name":"Ponchera","price":5000,"cost":3000,"stock":3,"min":0,"cat":"","brand":"","unit":"unidad","esPaquete":false}'),
    ('C3', '{"code":"C3","name":"Cuerda","price":4000,"cost":2500,"stock":20,"min":0,"cat":"","brand":"","unit":"m","esPaquete":false}');
  insert into public.customers (id, data) values ('cli1', '{"id":"cli1","name":"Ana Gómez","createdAt":"2026-01-01T00:00:00Z"}');
  `)
  await lite.query(`insert into public."cashSessions" (data) values ($1)`, [
    JSON.stringify({ status: 'abierta', dayKey: dayKeyOf(new Date()), openedAt: new Date(Date.now() - 3_600_000).toISOString(), openedBy: 'Ana', openingCash: 0, systemAtOpen: 0, openDiff: 0 }),
  ])
}
await seed()

// Whoever calls is the owner: sign-in is the stand-in's business, not this API's.
const fakeAuth: RequestHandler = async (req, res, next) => {
  const auth: AuthInfo = { sessionId: 'dev-owner', email: TEST_EMAIL, passwordAt: null }
  try {
    await checkAccount(db, auth)
  } catch (err) {
    const e = err as { status?: number; message: string }
    return void res.status(e.status ?? 500).json({ error: e.message })
  }
  req.auth = auth
  next()
}
await db.tx(refreshCounterPerms)

type Mode = { kind: 'ok' | 'down' | 'hang' | 'status' | 'lostAnswer' | 'delay'; status?: number; times?: number; path?: string; down?: boolean; html?: boolean; slow?: number; ms?: number }
let mode: Mode = { kind: 'ok' }
const log: string[] = []
const requests: Record<string, number> = {}
const supa: SupaControl = { down: false, accessTtl: 3600 }

const outer = express()
outer.use((req, res, next) => {
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS' })
  if (req.method === 'OPTIONS') return void res.status(204).end()
  next()
})
outer.use(express.json())
outer.post('/__test/mode', (req, res) => {
  mode = { kind: 'ok', ...req.body }
  res.json({ ok: true, mode })
})
outer.post('/__test/supa', (req, res) => {
  Object.assign(supa, req.body)
  res.json(supa)
})
outer.post('/__test/reset', async (_req, res) => {
  await lite.exec(`truncate public.sales, public."cashMovements", public.deletions restart identity cascade; delete from public.products; delete from public.customers; delete from public.staff; delete from public."cashSessions";`)
  await seed()
  await db.tx(refreshCounterPerms)
  mode = { kind: 'ok' }
  log.length = 0
  for (const k of Object.keys(requests)) delete requests[k]
  res.json({ ok: true })
})
outer.get('/__test/state', async (_req, res) => {
  const stocks = Object.fromEntries((await lite.query<{ code: string; s: string }>(`select code, data ->> 'stock' as s from public.products order by code`)).rows.map((r) => [r.code, Number(r.s)]))
  const sales = (await lite.query<{ data: Record<string, unknown> }>(`select data from public.sales order by id`)).rows.map((r) => r.data)
  const movements = Number((await lite.query<{ c: string }>(`select count(*) as c from public."cashMovements"`)).rows[0].c)
  res.json({ stocks, sales, movements, mode, log, requests })
})

// The break-the-connection layer, in front of the real API.
outer.use('/api', (req, res, next) => {
  const key = `${req.method} ${req.originalUrl.split('?')[0]}`
  requests[key] = (requests[key] ?? 0) + 1
  const m = mode
  if (m.kind === 'ok' || (m.path && !req.originalUrl.startsWith(m.path))) return next()
  if (m.times !== undefined) {
    m.times -= 1
    if (m.times <= 0) mode = { kind: 'ok' }
  }
  log.push(`${m.kind} ${req.method} ${req.originalUrl}`)
  if (m.kind === 'down') return void req.socket.destroy()
  if (m.kind === 'hang') return // never answers
  if (m.kind === 'delay') return void setTimeout(next, m.ms ?? 200)
  if (m.kind === 'status') {
    if (m.html) return void res.status(m.status ?? 502).type('html').send('<html><body><h1>Bad Gateway</h1></body></html>')
    if (m.slow) {
      // The headers go out at once, the body only after `slow` ms: a connection that dies in the middle of an answer.
      res.status(m.status ?? 200).type('json')
      res.flushHeaders()
      return void setTimeout(() => res.end(JSON.stringify({ ok: true })), m.slow)
    }
    return void res.status(m.status ?? 500).json({ ...(m.down ? { down: true } : {}), error: 'error de prueba' })
  }
  const end = res.end.bind(res) // 'lostAnswer'
  res.end = ((...args: unknown[]) => {
    req.socket.destroy()
    return end(...(args as []))
  }) as typeof res.end
  next()
})
outer.use(createApp(db, fakeAuth))

startFakeSupabase(lite, Number(process.env.SUPA_PORT ?? 3003), supa)
const PORT = Number(process.env.API_PORT ?? 3002)
outer.listen(PORT, '127.0.0.1', () => console.log(`READY ${PORT}`))
