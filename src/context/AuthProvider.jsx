import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { AuthContext } from './auth-context'

/**
 * Holds the Supabase session and the logged-in user's `profiles` row.
 *
 * NOTE: this is a starter shell. The permission model (page x action, role +
 * user overrides) is not built yet - `can()` currently returns true for any
 * authenticated, active user. Wire it up once the data model is decided.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId) => {
    const { data: prof, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (error || !prof) {
      // No profile row yet (table may not exist in this starter). Keep the
      // session so the app still renders; treat the user as a bare account.
      setProfile(null)
      return
    }
    setProfile(prof)
  }, [])

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session) await loadProfile(data.session.user.id)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      if (nextSession) {
        // Defer: calling supabase inside this callback synchronously can deadlock.
        setTimeout(() => {
          if (active) loadProfile(nextSession.user.id)
        }, 0)
      } else {
        setProfile(null)
      }
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signIn = useCallback(
    (email, password) => supabase.auth.signInWithPassword({ email, password }),
    [],
  )
  const signOut = useCallback(() => supabase.auth.signOut(), [])

  const isActive = profile ? Boolean(profile.is_active) : true

  const can = useCallback(
    () => Boolean(session) && isActive,
    [session, isActive],
  )

  const value = useMemo(
    () => ({
      session,
      profile,
      loading,
      isAuthenticated: Boolean(session),
      isActive,
      can,
      signIn,
      signOut,
      reloadProfile: () => (session ? loadProfile(session.user.id) : undefined),
    }),
    [session, profile, loading, isActive, can, signIn, signOut, loadProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
