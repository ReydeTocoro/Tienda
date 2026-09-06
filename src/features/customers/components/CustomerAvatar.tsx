import { tier } from '../../../shared/lib/loyalty'
import { initials } from '../../../shared/lib/text'

interface CustomerAvatarProps {
  name: string
  spent: number
  size?: number
}

export function CustomerAvatar({ name, spent, size = 44 }: CustomerAvatarProps) {
  const t = tier(spent)
  return (
    <div
      className={`flex flex-shrink-0 items-center justify-center rounded-full border-2 font-display font-bold ${t.avatarClass}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
    >
      {initials(name)}
    </div>
  )
}
