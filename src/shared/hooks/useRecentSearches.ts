import { useCallback, useState } from 'react'
import { addRecent, loadRecent, removeRecent, saveRecent } from '../lib/searchHistory'

/** The recent searches of one search box (`key`, which also names its list on the device). Without a
 * key the box keeps none. The stored list is the source of truth — read again whenever the box gets
 * the focus — so two boxes sharing a key, or two windows, never overwrite each other with a stale copy. */
export function useRecentSearches(key: string | undefined) {
  const [recent, setRecent] = useState<string[]>(() => (key ? loadRecent(key) : []))

  const refresh = useCallback(() => {
    if (key) setRecent(loadRecent(key))
  }, [key])

  /** Puts a search at the front of the list (a repeat moves up instead of piling up). */
  const remember = useCallback(
    (term: string) => {
      if (!key) return
      const next = addRecent(loadRecent(key), term)
      saveRecent(key, next)
      setRecent(next)
    },
    [key],
  )

  const forget = useCallback(
    (term: string) => {
      if (!key) return
      const next = removeRecent(loadRecent(key), term)
      saveRecent(key, next)
      setRecent(next)
    },
    [key],
  )

  const clear = useCallback(() => {
    if (!key) return
    saveRecent(key, [])
    setRecent([])
  }, [key])

  return { recent, refresh, remember, forget, clear }
}
