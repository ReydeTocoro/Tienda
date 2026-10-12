import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleCheck } from 'lucide-react'
import logo from '../../assets/logo-sm.png'
import { formatMoney } from '../../shared/lib/currency'
import { Countdown } from './Countdown'
import type { Notice } from './lib/notices'
import { longDate, TONE_BORDER, TONE_SOLID, TONE_TEXT } from './noticeUi'

/** Accounts the payables panel lists; the rest are counted. */
const HERO_LINES = 6
/** Lines each of the other cards lists. */
const CARD_LINES = 3

/** "2:25" and "p. m." apart, so the clock reads big and the period small. */
function clockParts(now: Date): { time: string; period: string } {
  const parts = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit' }).formatToParts(now)
  return {
    time: parts
      .filter((p) => p.type !== 'dayPeriod')
      .map((p) => p.value)
      .join('')
      .trim(),
    period: parts.find((p) => p.type === 'dayPeriod')?.value ?? '',
  }
}

/** The rest screen (`NotificationCenter` shows it after a while without use): the clock, and what is pending — the
 * payables to suppliers first and big, readable from a few steps away. Not a <dialog> on purpose: an idle till must
 * still update itself (`safeToReload` looks for open dialogs). A click (not a press: the click that follows must not
 * land on what is behind), the wheel or moving the mouse wakes it; keys are `NotificationCenter`'s. */
export function RestScreen({ notices, onWake }: { notices: Notice[]; onWake: () => void }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // A mouse moved on purpose — not the zero-length move a browser fires when the page under it changes.
  useEffect(() => {
    let moved = 0
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      moved += Math.abs(e.movementX) + Math.abs(e.movementY)
      if (moved > 12) onWake()
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [onWake])

  const { time, period } = clockParts(now)
  const mensualidad = notices.find((n) => n.id === 'mensualidad')
  const pagos = notices.find((n) => n.id === 'pagos')
  const others = notices.filter((n) => n !== pagos && n !== mensualidad)

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pantalla de reposo"
      onClick={onWake}
      onWheel={onWake}
      className="fixed inset-0 z-[90] flex animate-[fadeInPage_0.4s_ease] cursor-pointer select-none flex-col overflow-y-auto bg-bg text-txt"
    >
      <header className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-nav-line bg-nav px-4 py-3 text-nav-fg md:px-8">
        <img src={logo} alt="" width={163} height={112} draggable={false} className="h-11 w-auto md:h-14" />
        <div className="text-right">
          <div className="font-mono font-bold leading-none">
            <span className="text-[38px] md:text-[54px]">{time}</span>
            <span className="ml-1.5 text-[15px] text-nav-fg-dim md:text-[20px]">{period}</span>
          </div>
          <div className="mt-1 text-[13px] text-nav-fg-dim first-letter:uppercase md:text-[16px]">{longDate(now)}</div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-4 md:px-8 md:py-6">
        {mensualidad && (
          <section className="mb-4 flex flex-col gap-3 rounded-2xl border-2 border-red/60 bg-s1 p-4 shadow-xs md:flex-row md:items-center md:justify-between md:p-5">
            <div className="min-w-0">
              <h2 className="text-[17px] font-bold uppercase tracking-wide text-red md:text-[20px]">{mensualidad.title}</h2>
              <p className="mt-0.5 text-[14px] leading-snug text-txt2 md:text-[16px]">{mensualidad.detail}</p>
            </div>
            {mensualidad.deadline !== undefined && <Countdown deadline={mensualidad.deadline} now={now} large />}
          </section>
        )}
        {!pagos && others.length === 0 ? (
          <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 text-center">
            <CircleCheck size={64} className="text-green" />
            <div className="font-display text-[28px] font-bold md:text-[36px]">Todo al día</div>
            <div className="text-[15px] text-txt2">{mensualidad ? 'No hay otros pendientes.' : 'No hay pendientes.'}</div>
          </div>
        ) : (
          <div className={pagos ? 'grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]' : ''}>
            {pagos && <PagosPanel notice={pagos} />}
            {others.length > 0 && (
              <div className={`grid content-start gap-3 ${pagos ? '' : 'sm:grid-cols-2 xl:grid-cols-3'}`}>
                {others.map((n) => (
                  <NoticeCard key={n.id} notice={n} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="flex-shrink-0 px-4 pb-4 text-center text-[13px] font-semibold text-muted md:text-[14px]">Toca la pantalla o presiona una tecla para continuar</footer>
    </div>,
    document.body,
  )
}

function PagosPanel({ notice: n }: { notice: Notice }) {
  const lines = n.lines.slice(0, HERO_LINES)
  const left = n.more + n.lines.length - lines.length
  return (
    <section className={`rounded-2xl border-2 bg-s1 p-5 shadow-xs md:p-7 ${TONE_BORDER[n.tone]}`}>
      <h2 className="text-[15px] font-bold uppercase tracking-wide text-txt2 md:text-[17px]">Pendientes por pagar a proveedores</h2>
      <div className={`mt-1 font-mono text-[40px] font-bold leading-tight md:text-[60px] ${TONE_TEXT[n.tone]}`}>{formatMoney(n.amount)}</div>
      {n.figures && n.figures.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2.5">
          {n.figures.map((f) => (
            <div key={f.label} className={`rounded-xl px-4 py-2 ${TONE_SOLID[f.tone]}`}>
              <div className="text-[12px] font-semibold md:text-[14px]">{f.label}</div>
              <div className="font-mono text-[24px] font-bold leading-tight md:text-[30px]">{formatMoney(f.amount)}</div>
            </div>
          ))}
        </div>
      )}
      <ul className="mt-4 divide-y divide-br border-t border-br">
        {lines.map((l, i) => (
          <li key={i} className="flex items-center justify-between gap-4 py-2">
            <div className="min-w-0">
              <div className="truncate text-[17px] font-bold md:text-[20px]">{l.label}</div>
              <div className={`text-[13px] font-semibold md:text-[15px] ${l.tone ? TONE_TEXT[l.tone] : 'text-txt2'}`}>{l.detail}</div>
            </div>
            <div className="flex-shrink-0 font-mono text-[18px] font-bold md:text-[22px]">{formatMoney(l.amount)}</div>
          </li>
        ))}
      </ul>
      {left > 0 && <div className="mt-1 text-[13px] font-semibold text-txt2 md:text-[15px]">y {left === 1 ? 'otra cuenta' : `${left} cuentas más`}</div>}
    </section>
  )
}

function NoticeCard({ notice: n }: { notice: Notice }) {
  const lines = n.lines.slice(0, CARD_LINES)
  const left = n.more + n.lines.length - lines.length
  return (
    <section className={`rounded-xl border-2 bg-s1 px-4 py-3 shadow-xs ${TONE_BORDER[n.tone]}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className={`text-[17px] font-bold md:text-[19px] ${TONE_TEXT[n.tone]}`}>{n.title}</h3>
        {n.amount !== undefined && <span className="flex-shrink-0 font-mono text-[17px] font-bold md:text-[19px]">{formatMoney(n.amount)}</span>}
      </div>
      <p className="text-[13px] leading-snug text-txt2 md:text-[14px]">{n.detail}</p>
      {lines.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {lines.map((l, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3 text-[13px] md:text-[14px]">
              <span className="min-w-0 truncate">
                <span className="font-semibold">{l.label}</span>
                {l.detail && <span className="text-muted"> · {l.detail}</span>}
              </span>
              {l.amount !== undefined && <span className="flex-shrink-0 font-mono font-semibold">{formatMoney(l.amount)}</span>}
            </li>
          ))}
          {left > 0 && <li className="text-[12px] text-muted">y {left} más</li>}
        </ul>
      )}
    </section>
  )
}
