import type { ReactNode } from 'react'
import { initials } from '../lib/text'

/** A person's round picture: their photo when they have one, else their initials (or `fallback`).
 * `className` sets the size, the text size and the colors of the fallback, as the plain initials
 * circles it replaces did. */
export function Avatar({ name, photo, className = '', fallback }: { name: string; photo?: string; className?: string; fallback?: ReactNode }) {
  if (photo) return <img src={photo} alt="" draggable={false} className={`flex-shrink-0 select-none rounded-full object-cover ${className}`} />
  return <span className={`flex flex-shrink-0 items-center justify-center rounded-full ${className}`}>{fallback ?? initials(name)}</span>
}
