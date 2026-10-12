import { useEffect, useState } from 'react'
import { countdownParts } from './lib/notices'

const pad = (n: number) => String(n).padStart(2, '0')

/** Days, hours, minutes and seconds left until `deadline`, as red boxes that tick every second. `now` comes from a
 * parent that already ticks (the rest screen's clock); without it the countdown keeps its own time. */
export function Countdown({ deadline, now, large = false }: { deadline: number; now?: Date; large?: boolean }) {
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    if (now) return
    const t = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [now])

  const { days, hours, minutes, seconds } = countdownParts(deadline, now ? now.getTime() : tick)
  const units: Array<[number, string]> = [
    [days, days === 1 ? 'día' : 'días'],
    [hours, 'horas'],
    [minutes, 'min'],
    [seconds, 'seg'],
  ]
  return (
    <div role="timer" aria-label={`Faltan ${days} días, ${hours} horas y ${minutes} minutos`} className={`flex ${large ? 'gap-2' : 'gap-1.5'}`}>
      {units.map(([value, label]) => (
        <div key={label} className={`rounded-lg bg-red text-center text-on-solid ${large ? 'min-w-[68px] px-2.5 py-2 md:min-w-[84px]' : 'min-w-[46px] px-1.5 py-1'}`}>
          <div className={`font-mono font-bold leading-none ${large ? 'text-[32px] md:text-[42px]' : 'text-[18px]'}`}>{pad(value)}</div>
          <div className={`mt-0.5 font-semibold uppercase ${large ? 'text-[11px] md:text-[13px]' : 'text-[9px]'}`}>{label}</div>
        </div>
      ))}
    </div>
  )
}
