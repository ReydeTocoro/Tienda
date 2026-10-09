/** Profile photos — a user's, or the owner's. The browser makes a small square JPEG (see
 * src/shared/lib/image.ts) and it's kept inline as a data URL in the user's row (or in
 * `settings.owner`), so it travels to every device with the rest of the data and needs no file
 * storage. Shared by the forms and the server, which accepts nothing else: a JPEG (the `/9j/` of its
 * first bytes, in base64) and small — never an SVG or any other format that could carry scripts. */

export const MAX_PHOTO_CHARS = 60_000

const PHOTO = /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/

/** The photo if it's one this app would make (a JPEG data URL, not too big), else undefined. */
export function cleanPhoto(input: unknown): string | undefined {
  return typeof input === 'string' && input.length <= MAX_PHOTO_CHARS && PHOTO.test(input) ? input : undefined
}
