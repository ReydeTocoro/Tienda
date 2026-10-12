import { useNavigate } from 'react-router-dom'
import { updateSettings } from '../../db/repositories/settings'
import { BottomSheet } from '../../shared/components/BottomSheet'
import { formatMoney } from '../../shared/lib/currency'
import { useConfirm } from '../../store/useConfirmStore'
import { useNoticesStore } from '../../store/useNoticesStore'
import { usePermission } from '../pin/usePermission'
import { Countdown } from './Countdown'
import { PushRow } from './PushRow'
import type { Notice } from './lib/notices'
import { longDate, TONE_BOX, TONE_TEXT, useCanOpen } from './noticeUi'

/** "Pendientes de hoy": every notice of whoever is working, in detail — opened by itself once a day per person
 * (`NotificationCenter`) and by the bell. */
export function NoticesSheet() {
  const open = useNoticesStore((s) => s.sheetOpen)
  const notices = useNoticesStore((s) => s.notices)
  const close = () => useNoticesStore.getState().setSheetOpen(false)
  const navigate = useNavigate()
  const canOpen = useCanOpen()
  const { isAdmin } = usePermission()

  return (
    <BottomSheet open={open} onClose={close} maxWidthClass="max-w-[620px]">
      <h2 className="font-display text-[18px] font-bold">Pendientes de hoy</h2>
      <p className="mt-0.5 text-[12px] text-txt2 first-letter:uppercase">{longDate()}</p>

      {notices.length === 0 ? (
        <p className="mt-4 rounded-lg bg-s2 px-3 py-3 text-center text-[13px] text-muted">Todo al día: no hay pendientes.</p>
      ) : (
        <ul className="mt-3 max-h-[min(56vh,430px)] space-y-2.5 overflow-y-auto pr-0.5">
          {notices.map((n) => (
            <NoticeItem
              key={n.id}
              notice={n}
              onOpen={
                n.to && canOpen(n.to)
                  ? () => {
                      close()
                      navigate(n.to!)
                    }
                  : undefined
              }
            />
          ))}
        </ul>
      )}

      {isAdmin && <PushRow />}

      <button data-enter onClick={close} className="mt-4 w-full rounded-[10px] bg-lime py-2.5 text-[13px] font-semibold text-on-solid">
        Entendido
      </button>
    </BottomSheet>
  )
}

function NoticeItem({ notice: n, onOpen }: { notice: Notice; onOpen?: () => void }) {
  const confirm = useConfirm()
  const dismissKey = n.dismissKey
  async function dismiss() {
    if (!dismissKey) return
    const ok = await confirm({ title: '¿Ya hiciste el pago de este mes?', message: 'El recordatorio se quita en todos los equipos y en los avisos del celular hasta el próximo mes.', confirmLabel: 'Sí, ya pagué' })
    if (ok) await updateSettings({ servicePaid: dismissKey })
  }
  return (
    <li className={`rounded-lg border px-3 py-2.5 ${TONE_BOX[n.tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-[14px] font-bold ${TONE_TEXT[n.tone]}`}>{n.title}</div>
          <div className="text-[12px] leading-snug text-txt2">{n.detail}</div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {n.amount !== undefined && <span className="font-mono text-[15px] font-bold">{formatMoney(n.amount)}</span>}
          {onOpen && (
            <button onClick={onOpen} className="rounded-lg border border-br2 bg-s1 px-2.5 py-1 text-[12px] font-semibold">
              Ver
            </button>
          )}
          {dismissKey && (
            <button onClick={() => void dismiss()} className="rounded-lg border border-br2 bg-s1 px-2.5 py-1 text-[12px] font-semibold">
              Ya pagué
            </button>
          )}
        </div>
      </div>
      {n.deadline !== undefined && (
        <div className="mt-2">
          <Countdown deadline={n.deadline} />
        </div>
      )}
      {n.lines.length > 0 && (
        <ul className="mt-1.5 divide-y divide-br border-t border-br">
          {n.lines.map((l, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3 py-1 text-[12px]">
              <span className="min-w-0 truncate">
                <span className="font-semibold">{l.label}</span>
                {l.detail && <span className={l.tone ? ` ${TONE_TEXT[l.tone]}` : ' text-muted'}> · {l.detail}</span>}
              </span>
              {l.amount !== undefined && <span className="flex-shrink-0 font-mono font-semibold">{formatMoney(l.amount)}</span>}
            </li>
          ))}
          {n.more > 0 && <li className="py-1 text-[11px] text-muted">y {n.more} más…</li>}
        </ul>
      )}
    </li>
  )
}
