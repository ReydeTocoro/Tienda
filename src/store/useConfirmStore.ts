import { create } from 'zustand'

export interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

interface ConfirmState {
  request: PendingConfirm | null
  ask: (opts: ConfirmOptions) => Promise<boolean>
  settle: (ok: boolean) => void
}

/** Replaces every native `confirm()` call in the legacy app (see plan — L1835, L3660, L4166,
 *  L4975-5032, L5188, L6172, etc). Use the `useConfirm()` hook from a component. */
export const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,
  ask: (opts) =>
    new Promise<boolean>((resolve) => {
      set({ request: { ...opts, resolve } })
    }),
  settle: (ok) => {
    const req = get().request
    set({ request: null })
    req?.resolve(ok)
  },
}))

export function useConfirm(): (opts: ConfirmOptions | string) => Promise<boolean> {
  const ask = useConfirmStore((s) => s.ask)
  return (opts) => ask(typeof opts === 'string' ? { message: opts } : opts)
}
