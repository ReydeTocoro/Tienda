import { Modal } from './Modal'
import { useConfirmStore } from '../../store/useConfirmStore'

/** Built on the shared `Modal` instead of reimplementing its own backdrop/click-outside skeleton
 * (ponytail-audit: three components were hand-rolling the same overlay). */
export function ConfirmDialog() {
  const { request, settle } = useConfirmStore()

  return (
    <Modal open={!!request} onClose={() => settle(false)} maxWidthClass="max-w-[360px]">
      {request && (
        <>
          {request.title && (
            <div className="mb-1 font-display text-[18px] font-bold text-txt">{request.title}</div>
          )}
          <div className="mb-5 text-[13px] leading-relaxed text-txt2">{request.message}</div>
          <div className="flex gap-2">
            <button
              className="flex-1 rounded-[10px] border border-br2 bg-transparent px-4 py-2.5 text-[13px] font-semibold text-txt2 active:scale-[0.96]"
              onClick={() => settle(false)}
            >
              {request.cancelLabel || 'Cancelar'}
            </button>
            <button
              className={`flex-[2] rounded-[10px] px-4 py-2.5 text-[13px] font-bold text-on-solid active:scale-[0.96] ${
                request.danger ? 'bg-red' : 'bg-lime'
              }`}
              onClick={() => settle(true)}
            >
              {request.confirmLabel || 'Confirmar'}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
