import { useEffect, useState } from 'react'
import { supabase } from '../../api/supabase'

/** The email of the account signed in on this device. */
export function useAccountEmail(): string | undefined {
  const [email, setEmail] = useState<string>()
  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setEmail(data.session?.user.email)
    })
    return () => {
      alive = false
    }
  }, [])
  return email
}
