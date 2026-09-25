import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = loading, null = signed out
  const [membership, setMembership] = useState(null) // { role, organization_id, branch_id, ... }
  const [loadingMembership, setLoadingMembership] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadMembership() {
      if (!session?.user) {
        setMembership(null)
        return
      }
      setLoadingMembership(true)
      const { data, error } = await supabase
        .from('memberships')
        .select('id, role, user_id, organization_id, branch_scope, organizations(name)')
        .eq('user_id', session.user.id)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle()

      if (cancelled) return

      if (error) {
        console.error('Error cargando membership:', error)
        setMembership(null)
        setLoadingMembership(false)
        return
      }

      let branch_name = null
      const firstBranchId = data?.branch_scope?.[0]
      if (data && firstBranchId) {
        const { data: branch } = await supabase
          .from('branches')
          .select('name')
          .eq('id', firstBranchId)
          .maybeSingle()
        branch_name = branch?.name ?? null
      }

      if (!cancelled) {
        setMembership(data ? { ...data, branch_name } : null)
        setLoadingMembership(false)
      }
    }

    loadMembership()
    return () => { cancelled = true }
  }, [session])

  async function signInWithPassword(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  const value = {
    session,
    user: session?.user ?? null,
    membership,
    loadingMembership,
    isLoading: session === undefined || (session && loadingMembership && membership === null),
    signInWithPassword,
    signOut
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
