import type { Payable, PurchaseOrder } from '../../../types/purchaseOrder'
import type { Product } from '../../../types/product'
import type { CajaState } from '../../../types/secrets'
import { addDaysToKey, daysBetween, formatDayKey, round2 } from '../../../shared/lib/cash'
import { dayKeyOf, formatMoney, formatQty } from '../../../shared/lib/currency'
import { formatOrderId } from '../../../shared/lib/id'
import { isLowStock } from '../../pos/lib/saleProducts'
import { buildPayableRows, DEFAULT_PAYABLE_SORT, sortPayables, summarizePayables, type PayableStatus } from '../../suppliers/lib/payableRows'

/** What is waiting to be done, as the bell, the daily "Pendientes de hoy" sheet and the rest screen tell it. Pure: the
 * hook (`useNotices`) gathers only what whoever is working may see — a module they can't open passes `undefined` here,
 * and gives no notice. The rules are the ones the screens already use (`buildPayableRows`, the Stock page's "sin stock",
 * `isLowStock`), never new ones. */

export type NoticeTone = 'red' | 'orange' | 'blue'

export interface NoticeLine {
  label: string
  detail?: string
  amount?: number
  tone?: NoticeTone
}

export interface Notice {
  id: 'mensualidad' | 'pagos' | 'caja' | 'sinInternet' | 'agotados' | 'stockBajo' | 'fiados' | 'pedidos'
  tone: NoticeTone
  title: string
  detail: string
  /** The headline money: what is owed to suppliers, what customers owe… */
  amount?: number
  /** Big figures under the headline (the payables: overdue, due within the week). */
  figures?: Array<{ label: string; amount: number; tone: NoticeTone }>
  /** The route that settles it. */
  to?: string
  /** The most urgent first, at most `MAX_LINES`. */
  lines: NoticeLine[]
  /** Lines left out. */
  more: number
  /** A moment it counts down to (ms since the epoch). */
  deadline?: number
  /** The system's monthly payment: the due day 'YYYY-MM-DD' that "Ya pagué" stores (`settings.servicePaid`), which
   * hides that month's reminder on every device and in the push. */
  dismissKey?: string
}

export interface NoticeInput {
  /** 'YYYY-MM-DD', the store's day. */
  today: string
  payables?: Payable[]
  orders?: PurchaseOrder[]
  products?: Product[]
  debtors?: Array<{ name: string; debt: number; since: string }>
  caja?: CajaState | null
  outbox: { pending: number; rejected: number }
  /** The reminder of the system's monthly payment — for the Administrador only; `paid` = the due day marked paid. */
  servicePayment?: { paid?: string }
}

/** The store pays for the system on this day of each month (1–28, so every month has it)… */
export const SERVICE_PAYMENT_DAY = 13
/** …and is reminded from this many days before, the day itself included. */
export const SERVICE_REMINDER_DAYS = 2

/** The next service payment day, today included: 'YYYY-MM-DD'. */
export function nextServiceDue(today: string, day = SERVICE_PAYMENT_DAY): string {
  const [y, m, d] = today.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + (d > day ? 1 : 0), day)).toISOString().slice(0, 10)
}

/** The end of a store day (midnight in Bogotá — Colombia keeps UTC-5 all year, no daylight saving), in ms. */
export const endOfDayMs = (dayKey: string): number => Date.parse(`${addDaysToKey(dayKey, 1)}T00:00:00-05:00`)

/** What is left until `deadline`, for a countdown; all zero once it passed. */
export function countdownParts(deadline: number, now: number): { days: number; hours: number; minutes: number; seconds: number } {
  const s = Math.max(0, Math.floor((deadline - now) / 1000))
  return { days: Math.floor(s / 86_400), hours: Math.floor((s % 86_400) / 3_600), minutes: Math.floor((s % 3_600) / 60), seconds: s % 60 }
}

export const MAX_LINES = 8
/** A fiado this old turns its notice orange. */
export const OLD_DEBT_DAYS = 30

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const ago = (days: number) => (days <= 0 ? 'hoy' : days === 1 ? 'ayer' : `hace ${days} días`)
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'es')

export function duePhrase(daysLeft: number): string {
  if (daysLeft < -1) return `Venció hace ${-daysLeft} días`
  if (daysLeft === -1) return 'Venció ayer'
  if (daysLeft === 0) return 'Vence hoy'
  if (daysLeft === 1) return 'Vence mañana'
  return `Vence en ${daysLeft} días`
}

function capped(lines: NoticeLine[]): Pick<Notice, 'lines' | 'more'> {
  return { lines: lines.slice(0, MAX_LINES), more: Math.max(0, lines.length - MAX_LINES) }
}

const LINE_TONE: Partial<Record<PayableStatus, NoticeTone>> = { vencida: 'red', hoy: 'red', proxima: 'orange' }

function mensualidad(today: string, paid: string | undefined): Notice | null {
  const due = nextServiceDue(today)
  const days = daysBetween(today, due)
  if (days > SERVICE_REMINDER_DAYS || paid === due) return null
  const noon = new Date(`${due}T12:00:00`)
  const date = `${noon.toLocaleDateString('es-CO', { weekday: 'long' })} ${noon.toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })}`
  return {
    id: 'mensualidad',
    tone: 'red',
    title: 'Pago mensual del sistema',
    detail: `${duePhrase(days)} (el ${date}). Si ya pagaste, omite este mensaje.`,
    deadline: endOfDayMs(due),
    dismissKey: due,
    lines: [],
    more: 0,
  }
}

function pagos(payables: Payable[], today: string): Notice | null {
  const rows = sortPayables(
    buildPayableRows(payables, today).filter((r) => r.status !== 'pagada'),
    DEFAULT_PAYABLE_SORT,
  )
  if (!rows.length) return null
  const sum = summarizePayables(rows)
  const figures: Notice['figures'] = []
  if (sum.overdue > 0) figures.push({ label: 'Vencido', amount: sum.overdue, tone: 'red' })
  if (sum.soon > 0) figures.push({ label: 'Vence en los próximos 7 días', amount: sum.soon, tone: 'orange' })
  return {
    id: 'pagos',
    tone: rows.some((r) => r.status === 'vencida' || r.status === 'hoy') ? 'red' : rows.some((r) => r.status === 'proxima') ? 'orange' : 'blue',
    title: 'Pagos a proveedores',
    detail: [plural(sum.open, 'cuenta por pagar', 'cuentas por pagar'), ...figures.map((f) => `${f.label.toLowerCase()} ${formatMoney(f.amount)}`)].join(' · '),
    amount: sum.owed,
    figures,
    to: '/proveedores?tab=porpagar',
    ...capped(rows.map((r) => ({ label: r.supplier, detail: `${r.orderNumber} · ${duePhrase(r.daysLeft)}`, amount: r.balance, tone: LINE_TONE[r.status] }))),
  }
}

function caja(state: CajaState | null, today: string): Notice | null {
  if (!state?.open || !state.dayKey || state.dayKey >= today) return null
  return {
    id: 'caja',
    tone: 'red',
    title: 'Caja sin cerrar',
    detail: `La Caja Menor sigue abierta desde el ${formatDayKey(state.dayKey)}: falta el Cierre Z de ese día (menú de tu usuario → Cerrar caja)`,
    to: '/cajas',
    lines: [],
    more: 0,
  }
}

function sinInternet({ pending, rejected }: NoticeInput['outbox']): Notice | null {
  if (rejected > 0) {
    return {
      id: 'sinInternet',
      tone: 'red',
      title: 'Ventas rechazadas',
      detail: `${plural(rejected, 'venta hecha', 'ventas hechas')} sin internet que el servidor no aceptó: revísalas en el aviso rojo de arriba${pending > 0 ? ` · ${pending} más por enviar` : ''}`,
      lines: [],
      more: 0,
    }
  }
  if (pending > 0) {
    return {
      id: 'sinInternet',
      tone: 'orange',
      title: 'Ventas sin enviar',
      detail: `${plural(pending, 'venta espera', 'ventas esperan')} a que vuelva el internet: no borres los datos de este equipo`,
      lines: [],
      more: 0,
    }
  }
  return null
}

function agotados(products: Product[]): Notice | null {
  // The Stock page's "sin stock" rule; the ones with a minimum set (what the store means to keep) first.
  const out = products.filter((p) => p.stock <= 0).sort((a, b) => Number(b.min > 0) - Number(a.min > 0) || byName(a, b))
  if (!out.length) return null
  return {
    id: 'agotados',
    tone: 'red',
    title: 'Productos agotados',
    detail: `${plural(out.length, 'producto', 'productos')} sin unidades`,
    to: '/inventario',
    ...capped(out.map((p) => ({ label: p.name, detail: p.min > 0 ? `Mínimo ${formatQty(p.min)}` : p.code, tone: 'red' as const }))),
  }
}

function stockBajo(products: Product[]): Notice | null {
  const low = products.filter(isLowStock).sort((a, b) => a.stock / a.min - b.stock / b.min || byName(a, b))
  if (!low.length) return null
  return {
    id: 'stockBajo',
    tone: 'orange',
    title: 'Stock bajo',
    detail: `${plural(low.length, 'producto llegó', 'productos llegaron')} a su mínimo`,
    to: '/inventario',
    ...capped(low.map((p) => ({ label: p.name, detail: `Quedan ${formatQty(p.stock)} · mínimo ${formatQty(p.min)}`, tone: 'orange' as const }))),
  }
}

function fiados(debtors: NonNullable<NoticeInput['debtors']>, today: string): Notice | null {
  const owing = debtors
    .filter((d) => d.debt > 0)
    .map((d) => ({ ...d, days: daysBetween(d.since, today) }))
    .sort((a, b) => b.debt - a.debt || byName(a, b))
  if (!owing.length) return null
  const oldest = Math.max(...owing.map((d) => d.days))
  return {
    id: 'fiados',
    tone: oldest >= OLD_DEBT_DAYS ? 'orange' : 'blue',
    title: 'Fiados por cobrar',
    detail: plural(owing.length, 'cliente debe', 'clientes deben') + (oldest >= OLD_DEBT_DAYS ? ` · la deuda más vieja es de hace ${oldest} días` : ''),
    amount: round2(owing.reduce((t, d) => t + d.debt, 0)),
    to: '/fiados',
    ...capped(owing.map((d) => ({ label: d.name, detail: `Debe desde ${ago(d.days)}`, amount: d.debt, tone: d.days >= OLD_DEBT_DAYS ? ('orange' as const) : undefined }))),
  }
}

function pedidos(orders: PurchaseOrder[], today: string): Notice | null {
  const sent = orders
    .filter((o) => o.status === 'pedido')
    .map((o) => ({ o, day: dayKeyOf(o.orderedAt ?? o.createdAt) }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : (a.o.id ?? 0) - (b.o.id ?? 0)))
  if (!sent.length) return null
  return {
    id: 'pedidos',
    tone: 'blue',
    title: 'Pedidos por recibir',
    detail: `${plural(sent.length, 'pedido enviado', 'pedidos enviados')} a proveedores, sin recibir`,
    amount: round2(sent.reduce((t, s) => t + s.o.total, 0)),
    to: '/proveedores',
    ...capped(sent.map(({ o, day }) => ({ label: o.supplierName, detail: `${formatOrderId(o.id)} · pedido ${ago(daysBetween(day, today))}`, amount: o.total }))),
  }
}

const TONE_RANK: Record<NoticeTone, number> = { red: 0, orange: 1, blue: 2 }

/** Every notice for this person, the most serious first (red, orange, blue; among equals the system's monthly payment,
 * then the payables). */
export function buildNotices(input: NoticeInput): Notice[] {
  const { today } = input
  const all = [
    input.servicePayment && mensualidad(today, input.servicePayment.paid),
    input.payables && pagos(input.payables, today),
    input.caja !== undefined ? caja(input.caja, today) : null,
    sinInternet(input.outbox),
    input.products && agotados(input.products),
    input.products && stockBajo(input.products),
    input.debtors && fiados(input.debtors, today),
    input.orders && pedidos(input.orders, today),
  ].filter((n): n is Notice => !!n)
  return all.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone])
}

/** What the bell counts: what asks for action (red or orange). */
export const urgentCount = (notices: Notice[]): number => notices.filter((n) => n.tone !== 'blue').length

/** When the phone notifications go out, in Colombia — the schedules of functions/index.js say the same. */
export const PUSH_HOURS_LABEL = '7:00 a. m., 12:20 p. m., 5:00 p. m., 6:00 p. m. y 8:00 p. m.'

/** Notices a push lists; the rest are counted. */
const PUSH_NOTICES = 4

/** The phone notification sent at fixed hours (the Function, server/domain/push.ts): the most urgent notices, one per
 * line — or nothing when none asks for action (no "todo al día" five times a day). */
export function pushMessage(notices: Notice[]): { title: string; body: string } | null {
  const urgent = urgentCount(notices)
  if (!urgent) return null
  const shown = notices.slice(0, PUSH_NOTICES)
  const lines = shown.map((n) => `${n.title}${n.amount !== undefined ? ` (${formatMoney(n.amount)})` : ''}: ${n.detail}`)
  if (notices.length > shown.length) lines.push(`…y ${notices.length - shown.length} más`)
  return { title: notices[0].id === 'mensualidad' ? 'Recordatorio: pago mensual del sistema' : `Pendientes: ${plural(urgent, 'asunto por atender', 'asuntos por atender')}`, body: lines.join('\n') }
}
