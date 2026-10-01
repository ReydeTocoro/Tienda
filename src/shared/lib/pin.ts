export async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Shared by every "set a PIN" form (store security PIN, per-usuario PIN) so the same weak
 * PINs are rejected everywhere. */
export const WEAK_PINS = new Set([
  '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  '1234', '4321', '1122', '2211', '1212', '2121', '0101', '1010',
  '000000', '111111', '123456', '654321', '112233',
])
