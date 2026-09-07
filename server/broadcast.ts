import type { WebSocket } from 'ws'

/** Every write handler emits one of these per row it touched, after its SQLite transaction has
 * committed. `data` is the full row for 'put' (client applies `db.<table>.put(data)`), or the
 * bare primary-key value for 'delete' (client applies `db.<table>.delete(data)`) — works
 * uniformly whether the key is a number (sales, purchases...), a string id (customers) or a
 * code (products), unlike always assuming `data.id`. */
export interface BroadcastMsg {
  table: string
  op: 'put' | 'delete'
  data: unknown
}

const clients = new Set<WebSocket>()

export function addClient(ws: WebSocket): void {
  clients.add(ws)
  ws.on('close', () => clients.delete(ws))
}

export function broadcast(msg: BroadcastMsg): void {
  const payload = JSON.stringify(msg)
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(payload)
  }
}
