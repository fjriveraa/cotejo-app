import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)
const PENDING_ACTION_KEY = 'cotejo_pending_action'

export function readPendingAction() {
  try {
    const raw = localStorage.getItem(PENDING_ACTION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function writePendingAction(action) {
  try {
    localStorage.setItem(PENDING_ACTION_KEY, JSON.stringify(action))
  } catch {
    // localStorage no disponible; la acción simplemente no se recordará
  }
}

export function clearPendingAction() {
  try {
    localStorage.removeItem(PENDING_ACTION_KEY)
  } catch {
    // no-op
  }
}

async function runPendingAction(action) {
  if (!action) return { error: null }
  if (action.type === 'create_org') {
    const { error } = await supabase.rpc('create_organization_and_owner', {
      p_org_name: action.orgName,
      p_branch_name: action.branchName || 'Principal'
    })
    return { error }
  }
  if (action.type === 'join_invite') {
    const { error } = await supabase.rpc('join_via_invite', { p_token: action.token })
    return { error }
  }
  return { error: null }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = loading, null = signed out
  const [membership, setMembership] = useState(null) // { role, organization_id, branch_id, ... }
  const [loadingMembership, setLoadingMembership] = useState(false)
  const [membershipError, setMembershipError] = useState(null)

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

    async function loadMembership({ afterPendingAction = false } = {}) {
      if (!session?.user) {
        setMembership(null)
        setMembershipError(null)
        return
      }
      setLoadingMembership(true)
      setMembershipError(null)
      const { data, error } = await supabase
        .from('memberships')
        .select('id, role, user_id, organization_id, branch_scope, organizations(name, country)')
        .eq('user_id', session.user.id)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle()

      if (cancelled) return

      if (error) {
        console.error('Error cargando membership:', error)
        setMembership(null)
        setMembershipError(error.message || 'Error desconocido al cargar tu cuenta.')
        setLoadingMembership(false)
        return
      }

      if (!data) {
        // Sin membresía todavía: si venimos de un signup (crear empresa o unirse
        // por invitación), completamos ese paso automáticamente ahora que ya hay sesión.
        if (!afterPendingAction) {
          const pending = readPendingAction()
          if (pending) {
            const { error: pendingError } = await runPendingAction(pending)
            if (cancelled) return
            if (pendingError) {
              console.error('Error ejecutando acción pendiente:', pendingError)
              clearPendingAction()
              setMembership(null)
              setMembershipError(pendingError.message || 'No se pudo completar tu registro.')
              setLoadingMembership(false)
              return
            }
            clearPendingAction()
            await loadMembership({ afterPendingAction: true })
            return
          }
        }
        setMembership(null)
        setMembershipError('Tu usuario no tiene una membresía activa en ninguna organización.')
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

  async function signUpWithPassword(email, password) {
    const { data, error } = await supabase.auth.signUp({ email, password })
    return { data, error }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  const value = {
    session,
    user: session?.user ?? null,
    membership,
    loadingMembership,
    membershipError,
    isLoading: session === undefined || (session && loadingMembership),
    signInWithPassword,
    signUpWithPassword,
    signOut
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
