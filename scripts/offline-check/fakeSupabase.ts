/** A stand-in for Supabase (Auth + PostgREST + Realtime) that serves the in-memory database of apiServer.ts, so the real
 * app build can sign in, download its data and be cut off from "the internet" on purpose. It never talks to the real
 * Supabase. Realtime is just enough of the protocol for the app to consider itself connected (it then downloads its data). */
import crypto from 'node:crypto'
import http from 'node:http'
import type { Duplex } from 'node:stream'
import express from 'express'
import type { PGlite } from '@electric-sql/pglite'

export interface SupaControl {
  /** The "internet" is down: every connection is cut. */
  down: boolean
  /** Seconds a new access token lives. */
  accessTtl: number
  /** What each `PUT /auth/v1/user` (a password change) carried. */
  passwordUpdates: Array<{ password?: string; current_password?: string }>
}

export const TEST_EMAIL = 'dueno@x.com'
export const TEST_PASSWORD = 'clave123'

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/** One text frame of a WebSocket, server to client (never masked). */
function frame(text: string): Buffer {
  const body = Buffer.from(text)
  const head = body.length < 126 ? Buffer.from([0x81, body.length]) : Buffer.from([0x81, 126, body.length >> 8, body.length & 255])
  return Buffer.concat([head, body])
}

/** Reads the text frames a client sent (clients always mask them); other kinds are ignored. */
function readFrames(buffer: Buffer): { texts: string[]; rest: Buffer; close: boolean } {
  const texts: string[] = []
  let at = 0
  while (buffer.length - at >= 2) {
    const opcode = buffer[at] & 0x0f
    let len = buffer[at + 1] & 0x7f
    let head = 2
    if (len === 126) {
      if (buffer.length - at < 4) break
      len = buffer.readUInt16BE(at + 2)
      head = 4
    } else if (len === 127) {
      if (buffer.length - at < 10) break
      len = Number(buffer.readBigUInt64BE(at + 2))
      head = 10
    }
    const masked = (buffer[at + 1] & 0x80) !== 0
    const total = head + (masked ? 4 : 0) + len
    if (buffer.length - at < total) break
    if (opcode === 0x8) return { texts, rest: Buffer.alloc(0), close: true }
    if (opcode === 0x1) {
      const mask = masked ? buffer.subarray(at + head, at + head + 4) : null
      const payload = Buffer.from(buffer.subarray(at + head + (masked ? 4 : 0), at + total))
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]
      texts.push(payload.toString())
    }
    at += total
  }
  return { texts, rest: buffer.subarray(at), close: false }
}

export function startFakeSupabase(lite: PGlite, port: number, ctl: SupaControl) {
  const app = express()
  const refreshTokens = new Map<string, string>() // refresh token -> email
  let n = 0

  function session(email: string) {
    const exp = Math.floor(Date.now() / 1000) + ctl.accessTtl
    const refresh = `refresh-${++n}-${Math.random().toString(36).slice(2)}`
    refreshTokens.set(refresh, email)
    const user = { id: 'u1', aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {}, identities: [], created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
    const access = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', email, role: 'authenticated', aud: 'authenticated', exp, iat: exp - ctl.accessTtl, session_id: 's1' })}.sig`
    return { access_token: access, token_type: 'bearer', expires_in: ctl.accessTtl, expires_at: exp, refresh_token: refresh, user }
  }

  app.use((req, res, next) => {
    if (ctl.down) return void req.socket.destroy()
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': req.header('access-control-request-headers') ?? '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Type',
    })
    if (req.method === 'OPTIONS') return void res.status(204).end()
    next()
  })
  app.use(express.json())

  app.post('/auth/v1/token', (req, res) => {
    const grant = req.query.grant_type
    if (grant === 'password') {
      const { email, password } = req.body as { email?: string; password?: string }
      if (email?.toLowerCase() === TEST_EMAIL && password === TEST_PASSWORD) return void res.json(session(TEST_EMAIL))
      return void res.status(400).json({ code: 'invalid_credentials', message: 'Invalid login credentials' })
    }
    if (grant === 'refresh_token') {
      const who = refreshTokens.get((req.body as { refresh_token?: string }).refresh_token ?? '')
      if (!who) return void res.status(400).json({ code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' })
      return void res.json(session(who))
    }
    res.status(400).json({ message: 'unsupported' })
  })
  app.get('/auth/v1/user', (_req, res) => res.json(session(TEST_EMAIL).user))
  app.put('/auth/v1/user', (req, res) => {
    ctl.passwordUpdates.push(req.body as { password?: string; current_password?: string })
    res.json(session(TEST_EMAIL).user)
  })
  app.post('/auth/v1/logout', (_req, res) => res.status(204).end())
  app.post('/rest/v1/rpc/is_staff', (_req, res) => res.json(true))
  app.get('/rest/v1/sync_meta', (req, res) => {
    const row = { value: 'epoch-1' }
    res.json((req.header('accept') ?? '').includes('vnd.pgrst.object') ? row : [row])
  })
  app.get('/rest/v1/deletions', (_req, res) => res.json([]))
  app.get('/rest/v1/:table', async (req, res) => {
    const table = req.params.table
    if (!/^[A-Za-z]+$/.test(table)) return void res.status(400).json({ message: 'bad table' })
    const range = /^(\d+)-(\d+)$/.exec(req.header('range') ?? '')
    const from = range ? Number(range[1]) : 0
    const to = range ? Number(range[2]) : 999
    try {
      const all = (await lite.query<{ data: unknown; updated_at: string }>(`select data, updated_at from public."${table}" order by updated_at`)).rows
      const rows = all.slice(from, to + 1)
      res.set('Content-Range', `${rows.length ? `${from}-${from + rows.length - 1}` : '*'}/${all.length}`)
      res.status(rows.length < all.length ? 206 : 200).json(rows.map((r) => ({ data: r.data, updated_at: new Date(r.updated_at).toISOString() })))
    } catch {
      res.json([]) // a table the stand-in doesn't have: nothing in it
    }
  })

  const server = http.createServer(app)
  server.on('upgrade', (req, socket: Duplex) => {
    const key = req.headers['sec-websocket-key']
    if (ctl.down || !req.url?.startsWith('/realtime/v1/websocket') || typeof key !== 'string') return void socket.destroy()
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    let pending: Buffer = Buffer.alloc(0)
    socket.on('data', (chunk: Buffer) => {
      const { texts, rest, close } = readFrames(Buffer.concat([pending, chunk]))
      pending = rest
      if (close) return void socket.end()
      for (const text of texts) {
        let msg: unknown
        try {
          msg = JSON.parse(text)
        } catch {
          continue
        }
        const array = Array.isArray(msg)
        const [joinRef, ref, topic, event] = array ? (msg as unknown[]) : [(msg as any).join_ref, (msg as any).ref, (msg as any).topic, (msg as any).event]
        if (event === 'access_token') continue
        const reply = { status: 'ok', response: {} } // no postgres_changes in the reply: the client takes the channel as subscribed
        socket.write(frame(JSON.stringify(array ? [joinRef, ref, topic, 'phx_reply', reply] : { topic, event: 'phx_reply', payload: reply, ref, join_ref: joinRef })))
      }
    })
    socket.on('error', () => {})
  })
  server.listen(port, '127.0.0.1')
  return server
}
