import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { safeToReload } from '../../app/appUpdate'
import { ADMIN_ROLE_ID } from '../../shared/lib/permissions'
import { todayKey } from '../../shared/lib/currency'
import { useBusyStore } from '../../store/useBusyStore'
import { useNoticesStore } from '../../store/useNoticesStore'
import { useSessionStore } from '../../store/useSessionStore'
import { hasSynced } from '../../sync'
import { NoticesSheet } from './NoticesSheet'
import { refreshPush } from './push'
import { RestScreen } from './RestScreen'
import { useNotices } from './useNotices'

/** Without any use for this long, the rest screen comes up. */
const REST_AFTER_MS = 3 * 60_000
/** After the key that woke the rest screen, keys keep being swallowed until this long passes without one: a barcode
 * reader's burst (digits + Enter, well under this) is dropped whole — half a code could be another product's. */
const KEY_QUIET_MS = 400
/** The daily sheet waits for the hands to be off the keyboard this long, so it never takes the cursor mid-word. */
const QUIET_MS = 3_000
const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const
const KEY_EVENTS = ['keydown', 'keypress', 'keyup'] as const

/** The day each person last got the "Pendientes de hoy" sheet on this device: `{ [operatorId]: 'YYYY-MM-DD' }` (a
 * convenience; blocked storage = it shows on every start). */
const DAILY_KEY = 'mtp-daily-notices'

function dailyMarks(): Record<string, string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(DAILY_KEY) ?? '{}')
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function markDaily(operatorId: string, day: string): void {
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify({ ...dailyMarks(), [operatorId]: day }))
  } catch {
    // Storage blocked: nothing to remember it with.
  }
}

/** Nobody is in the middle of something the rest screen would cover: a form (an open dialog — the PIN pad is one), a
 * save. A cart with products doesn't stop it: carts stay as they were. */
const canRest = () => document.visibilityState === 'visible' && !document.querySelector('dialog[open]') && useBusyStore.getState().pending === 0

/** The notices of whoever is working (mounted once, from AppShell): works them out for the bell, opens "Pendientes de
 * hoy" by itself the first time each person uses this device each day, and puts up the rest screen after
 * `REST_AFTER_MS` without use. The input that wakes the rest screen only wakes it — it never reaches the page. */
export function NotificationCenter() {
  const { notices, ready } = useNotices()
  const operatorId = useSessionStore((s) => s.operator?.id)
  const [resting, setResting] = useState(false)
  const restingRef = useRef(false)
  const lastInput = useRef(0)
  const swallowUntil = useRef(0)

  useEffect(() => {
    useNoticesStore.getState().setNotices(notices)
  }, [notices])

  // A phone notification tapped: the app opens on "Pendientes de hoy" (a new window: `?avisos=1`; one already open:
  // the service worker's message — public/push-sw.js — so a sale in progress isn't lost to a reload).
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    if (!params.has('avisos')) return
    useNoticesStore.getState().setSheetOpen(true)
    setParams(
      (p) => {
        p.delete('avisos')
        return p
      },
      { replace: true },
    )
  }, [params, setParams])
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: unknown } | null)?.type === 'avisos') useNoticesStore.getState().setSheetOpen(true)
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
  }, [])

  // The Administrador's device keeps its notifications token current (the browser may renew it).
  const isAdmin = useSessionStore((s) => s.serverReady && s.operator?.roleId === ADMIN_ROLE_ID)
  useEffect(() => {
    if (isAdmin) void refreshPush().catch(() => {})
  }, [isAdmin])

  const wake = useCallback(() => {
    restingRef.current = false
    lastInput.current = Date.now()
    setResting(false)
  }, [])

  useEffect(() => {
    lastInput.current = Date.now() - QUIET_MS
    const touch = () => {
      lastInput.current = Date.now()
    }
    const onVisible = () => document.visibilityState === 'visible' && touch() // back to the app: not idle
    // Window, capture phase: ahead of every other key handler (the barcode reader and the shortcuts listen on the
    // document), so a swallowed key reaches none of them.
    const onKey = (e: KeyboardEvent) => {
      if (!restingRef.current && Date.now() >= swallowUntil.current) return
      e.preventDefault()
      e.stopPropagation()
      swallowUntil.current = Date.now() + KEY_QUIET_MS
      if (restingRef.current) wake()
    }
    for (const t of ACTIVITY) window.addEventListener(t, touch, { capture: true, passive: true })
    for (const t of KEY_EVENTS) window.addEventListener(t, onKey, true)
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(() => {
      if (restingRef.current || Date.now() - lastInput.current < REST_AFTER_MS || !canRest()) return
      restingRef.current = true
      setResting(true)
    }, 5_000)
    return () => {
      clearInterval(timer)
      for (const t of ACTIVITY) window.removeEventListener(t, touch, { capture: true })
      for (const t of KEY_EVENTS) window.removeEventListener(t, onKey, true)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [wake])

  // Once a day per person: when what they may see is in (a device that never downloaded anything waits for it), and
  // never over a sale, a form, a save or someone typing. Nothing pending = nothing to show that day.
  useEffect(() => {
    if (!ready || !operatorId) return
    const tryOpen = () => {
      const today = todayKey()
      if (dailyMarks()[operatorId] === today || !hasSynced()) return
      if (restingRef.current || !safeToReload() || document.visibilityState !== 'visible' || Date.now() - lastInput.current < QUIET_MS) return
      markDaily(operatorId, today)
      if (notices.length) useNoticesStore.getState().setSheetOpen(true)
    }
    tryOpen()
    const timer = setInterval(tryOpen, 4_000)
    return () => clearInterval(timer)
  }, [ready, operatorId, notices])

  return (
    <>
      <NoticesSheet />
      {resting && <RestScreen notices={notices} onWake={wake} />}
    </>
  )
}
