/** Where the API lives. In a browser the app and the API share an address (Hosting rewrites /api to the
 * Function), so this is empty and '/api/sales/offline' is a relative path. An installed app — the Windows
 * .exe, the Android .apk — is a bundle on the device, not a page served from that address, so it is given
 * the real one when it is built (VITE_API_URL=https://plastimax-fr.web.app) and every call goes there. */
const API_URL = String(import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')

export const apiUrl = (path: string): string => API_URL + path

/** The public address of the site, for links a customer opens (a receipt on WhatsApp): the address of the
 * page in a browser, the one given at build time (VITE_PUBLIC_URL) in an installed app, whose own address
 * means nothing to a customer. */
export const publicOrigin = (): string => String(import.meta.env.VITE_PUBLIC_URL ?? '').replace(/\/+$/, '') || window.location.origin
