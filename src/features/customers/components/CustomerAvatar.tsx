import { initials } from '../../../shared/lib/text'

interface CustomerAvatarProps {
  name: string
  size?: number
}

export function CustomerAvatar({ name, size = 44 }: CustomerAvatarProps) {
  return (
    <div
      className="flex flex-shrink-0 items-center justify-center rounded-full border-2 border-blue/35 bg-blue/10 font-display font-bold text-blue"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
    >
      {initials(name)}
    </div>
  )
}
