import { NAV_ITEMS } from '../../app/navConfig'
import { usePermission } from '../pin/usePermission'
import type { NoticeTone } from './lib/notices'

export const TONE_TEXT: Record<NoticeTone, string> = { red: 'text-red', orange: 'text-orange', blue: 'text-blue' }
export const TONE_BOX: Record<NoticeTone, string> = { red: 'border-red/40 bg-red/10', orange: 'border-orange/40 bg-orange/10', blue: 'border-blue/30 bg-blue/5' }
export const TONE_BORDER: Record<NoticeTone, string> = { red: 'border-red/60', orange: 'border-orange/60', blue: 'border-blue/40' }
export const TONE_SOLID: Record<NoticeTone, string> = { red: 'bg-red text-on-solid', orange: 'bg-orange text-on-solid', blue: 'bg-blue text-on-solid' }

/** "lunes, 13 de octubre". */
export const longDate = (d = new Date()) => d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })

/** Whether whoever is working may open a notice's route: the need of that module's nav item. */
export function useCanOpen(): (to?: string) => boolean {
  const { can } = usePermission()
  return (to) => {
    const item = to ? NAV_ITEMS.find((i) => i.to === to.split('?')[0]) : undefined
    return !!item && (!item.need || can(item.need))
  }
}
