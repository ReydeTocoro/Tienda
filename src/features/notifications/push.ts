import { apiDelete, apiPost } from '../../api/client'

/** The Administrador's phone notifications ("Pendientes de hoy" at fixed hours, even with the app closed): this device
 * gets a Firebase Cloud Messaging token through the app's own service worker (which shows them: public/push-sw.js), and
 * the API keeps it (server/domain/push.ts). The Firebase SDK is loaded only here, on demand — Supabase does everything
 * else. The config below is public by design, like the Supabase publishable key. */
const FIREBASE = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
}
const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined
/** The token this device gave the server (a convenience: what to remove when turning them off). */
const TOKEN_KEY = 'mtp-push-token'

export type PushState = 'unsupported' | 'blocked' | 'off' | 'on'

function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function storeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Storage blocked: the server keeps the token until the browser drops it.
  }
}

/** An iPhone only gets them from the app added to the home screen (Safari → Compartir → Agregar a inicio). */
export const isIosBrowser = (): boolean => /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches

export function pushState(): PushState {
  // The installed .exe/.apk have no service worker; development has none either.
  if (import.meta.env.VITE_PACKAGED === '1' || import.meta.env.DEV || !VAPID_KEY || !FIREBASE.apiKey) return 'unsupported'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  return Notification.permission === 'granted' && storedToken() ? 'on' : 'off'
}

async function messaging() {
  const [{ getApps, initializeApp }, fcm] = await Promise.all([import('firebase/app'), import('firebase/messaging')])
  return { fcm, messaging: fcm.getMessaging(getApps()[0] ?? initializeApp(FIREBASE)) }
}

async function currentToken(): Promise<string> {
  const registration = await navigator.serviceWorker.ready
  const { fcm, messaging: m } = await messaging()
  return fcm.getToken(m, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration })
}

/** Asks the browser's permission and registers this device. Resolves whether the test notification went out. */
export async function enablePush(): Promise<boolean> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(permission === 'denied' ? 'El navegador bloqueó las notificaciones de esta página: actívalas en los ajustes del sitio' : 'No se dio permiso para mostrar notificaciones')
  }
  const token = await currentToken()
  const { tested } = await apiPost<{ tested: boolean }>('/api/push/token', { token })
  storeToken(token)
  return tested
}

/** Stops them on this device: the browser drops its subscription and the server forgets the token. */
export async function disablePush(): Promise<void> {
  const token = storedToken()
  if (!token) return
  storeToken(null)
  try {
    const { fcm, messaging: m } = await messaging()
    await fcm.deleteToken(m)
  } catch {
    // Offline: the server's copy goes below, or the next send finds the token gone.
  }
  await apiDelete(`/api/push/token/${encodeURIComponent(token)}`)
}

/** As the app starts, for an Administrador with them on: the browser can renew its subscription (a new token), so the
 * server's copy is brought up to date. */
export async function refreshPush(): Promise<void> {
  if (pushState() !== 'on') return
  const token = await currentToken()
  if (token === storedToken()) return
  await apiPost('/api/push/token', { token })
  storeToken(token)
}
