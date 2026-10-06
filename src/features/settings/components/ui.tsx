import type { ReactNode } from 'react'

/** Building blocks shared by the Configuración sections, so every section reads the same: a
 * header (title + one sentence), then cards whose rows put the label and its explanation on the
 * left and the control on the right — stacking on a phone. */

export function SectionHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 max-w-2xl">
        <h2 className="font-display text-[19px] font-bold leading-tight md:text-[21px]">{title}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-txt2">{description}</p>
      </div>
      {action}
    </div>
  )
}

export function Card({ title, description, children, className = '', footer }: { title?: string; description?: string; children: ReactNode; className?: string; footer?: ReactNode }) {
  return (
    <section className={`mb-4 overflow-hidden rounded-2xl border border-br bg-s1 shadow-xs ${className}`}>
      {title && (
        <div className="border-b border-br px-4 py-3 md:px-5">
          <h3 className="text-[14px] font-bold">{title}</h3>
          {description && <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{description}</p>}
        </div>
      )}
      <div className="divide-y divide-br">{children}</div>
      {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-br bg-s2 px-4 py-3 md:px-5">{footer}</div>}
    </section>
  )
}

export function Row({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-2.5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 md:px-5">
      <div className="min-w-0 sm:max-w-[55%]">
        <label htmlFor={htmlFor} className="block text-[13px] font-semibold">
          {label}
        </label>
        {hint && <div className="mt-0.5 text-[12px] leading-relaxed text-muted">{hint}</div>}
      </div>
      <div className="flex min-w-0 flex-shrink-0 items-center gap-2 sm:justify-end">{children}</div>
    </div>
  )
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'border-lime bg-lime' : 'border-br2 bg-s3'
      }`}
    >
      <span className={`inline-block h-[18px] w-[18px] rounded-full bg-s1 shadow-sm transition-transform ${checked ? 'translate-x-[21px]' : 'translate-x-[2px]'}`} />
    </button>
  )
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[10px] border border-br2 bg-s2 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${value === o.value ? 'bg-s1 text-lime shadow-xs' : 'text-txt2 hover:text-txt'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'lime' | 'blue' | 'purple' | 'green' | 'orange' | 'red' }) {
  const cls = {
    neutral: 'border-br2 bg-s2 text-txt2',
    lime: 'border-lime/30 bg-lime/10 text-lime',
    blue: 'border-blue/30 bg-blue/10 text-blue',
    purple: 'border-purple/30 bg-purple/10 text-purple',
    green: 'border-green/30 bg-green/10 text-green',
    orange: 'border-orange/30 bg-orange/10 text-orange',
    red: 'border-red/30 bg-red/10 text-red',
  }[tone]
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>
}

export const primaryButton = 'rounded-[10px] bg-lime px-4 py-2 text-[13px] font-bold text-on-solid transition hover:brightness-110 disabled:opacity-50'
export const secondaryButton = 'rounded-[10px] border border-br2 bg-s1 px-4 py-2 text-[13px] font-semibold text-txt2 transition-colors hover:bg-s2 hover:text-txt disabled:opacity-50'
export const dangerButton = 'rounded-[10px] border border-red/30 bg-red/10 px-4 py-2 text-[13px] font-semibold text-red transition-colors hover:bg-red/15 disabled:opacity-50'
