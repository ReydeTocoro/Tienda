import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings } from '../../db/repositories/settings'
import { toast } from '../../store/useToastStore'
import { counterSignIn } from './counterSession'
import { OwnerPinRecovery } from './OwnerPinRecovery'
import { PinPad } from './PinPad'
import logo from '../../assets/logo.png'

/** PIN mode with nobody signed in: everyone starts here, with their own PIN — the owner's master
 * PIN or a user's, checked by the server. Nothing of the store is rendered behind it. */
export function LockScreen() {
  const settings = useLiveQuery(() => getSettings())
  const [shake, setShake] = useState(false)
  const [recoverOpen, setRecoverOpen] = useState(false)

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-bg p-5">
      <div className={`w-full max-w-[340px] rounded-[24px] border border-br bg-s1 px-[26px] pb-[22px] pt-6 text-center shadow-lg ${shake ? 'animate-[pinShake_0.45s_ease]' : ''}`}>
        <img src={logo} alt="" width={350} height={240} draggable={false} className="mx-auto mb-2 h-16 w-auto select-none" />
        <h1 className="font-display text-[19px] font-bold leading-tight">¿Quién atiende?</h1>
        <p className="mb-4 text-[12px] text-muted">{settings?.storeName ? `${settings.storeName} · ` : ''}Ingresa tu PIN para empezar</p>

        <PinPad
          active={!recoverOpen}
          onSubmit={(pin) => counterSignIn(pin)}
          onSuccess={(result) => toast(`Hola, ${result.operator!.name}`, 'lime')}
          onWrong={() => {
            setShake(true)
            setTimeout(() => setShake(false), 450)
          }}
        />

        <button type="button" onClick={() => setRecoverOpen(true)} className="w-full py-1 text-[12px] text-muted underline-offset-2 hover:text-txt2 hover:underline">
          ¿Olvidaste el PIN del propietario?
        </button>
      </div>
      <OwnerPinRecovery open={recoverOpen} onClose={() => setRecoverOpen(false)} />
    </div>
  )
}
