import { useConfirmStore } from '../../store/useConfirmStore'

export function ConfirmDialog() {
  const { request, settle } = useConfirmStore()
  if (!request) return null

  return (
    <div
      className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/80 p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) settle(false)
      }}
    >
      <div className="w-full max-w-[360px] rounded-[18px] border border-br2 bg-s1 p-[22px] shadow-[var(--shadow-md)]">
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
            className={`flex-[2] rounded-[10px] px-4 py-2.5 text-[13px] font-bold text-black active:scale-[0.96] ${
              request.danger ? 'bg-red text-white' : 'bg-lime'
            }`}
            onClick={() => settle(true)}
          >
            {request.confirmLabel || 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
