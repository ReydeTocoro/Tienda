/** Shared by every "set a PIN" form (store security PIN, per-usuario PIN) and by the server, so the
 * same weak PINs are rejected everywhere. PINs themselves are only ever hashed by the server. */
export const WEAK_PINS = new Set([
  '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  '1234', '4321', '1122', '2211', '1212', '2121', '0101', '1010',
  '000000', '111111', '123456', '654321', '112233',
])

/** What's wrong with a new PIN, or null if it can be saved: the store's length, digits only, typed
 * the same twice, and not one of the obvious ones. Shared by every "set a PIN" form. */
export function newPinProblem(pin: string, confirm: string, length: number): string | null {
  if (pin.length !== length || !/^\d+$/.test(pin)) return `El PIN debe tener ${length} dígitos`
  if (pin !== confirm) return 'Los dos PIN no coinciden'
  if (WEAK_PINS.has(pin)) return 'Ese PIN es muy fácil de adivinar: elige otro'
  return null
}
