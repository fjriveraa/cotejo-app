import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)
const PENDING_ACTION_KEY = 'cotejo_pending_action'
const ACTIVE_ORG_KEY = 'cotejo_active_org_id'

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

function readActiveOrgId() {
  try {
    return localStorage.getItem(ACTIVE_ORG_KEY)
  } catch {
    return null
  }
}

function writeActiveOrgId(orgId) {
  try {
    if (orgId) localStorage.setItem(ACTIVE_ORG_KEY, orgId)
    else localStorage.removeItem(ACTIVE_ORG_KEY)
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
  const [memberships, setMemberships] = useState([]) // todas las empresas activas de este usuario
  const [activeOrgId, setActiveOrgId] = useState(readActiveOrgId())
  const [loadingMembership, setLoadingMembership] = useState(false)
  const [membershipError, setMembershipError] = useState(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  const [loadingPlatformAdmin, setLoadingPlatformAdmin] = useState(false)

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
    if (!session?.user) {
      setIsPlatformAdmin(false)
      setLoadingPlatformAdmin(false)
      return
    }
    let cancelled = false
    setLoadingPlatformAdmin(true)
    supabase.rpc('am_i_platform_admin').then(({ data }) => {
      if (cancelled) return
      setIsPlatformAdmin(Boolean(data))
      setLoadingPlatformAdmin(false)
    })
    return () => { cancelled = true }
  }, [session])

  useEffect(() => {
    let cancelled = false

    async function loadMemberships({ afterPendingAction = false } = {}) {
      if (!session?.user) {
        setMemberships([])
        setMembershipError(null)
        return
      }
      setLoadingMembership(true)
      setMembershipError(null)
      const { data, error } = await supabase
        .from('memberships')
        .select('id, role, user_id, organization_id, branch_scope, organizations(name, country, is_public, org_type, verification_status)')
        .eq('user_id', session.user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: true })

      if (cancelled) return

      if (error) {
        console.error('Error cargando membresías:', error)
        setMemberships([])
        setMembershipError(error.message || 'Error desconocido al cargar tu cuenta.')
        setLoadingMembership(false)
        return
      }

      if (!data || data.length === 0) {
        // Sin ninguna empresa todavía: si venimos de un signup (crear empresa o
        // unirse por invitación), completamos ese paso automáticamente ahora que
        // ya hay sesión.
        if (!afterPendingAction) {
          const pending = readPendingAction()
          if (pending) {
            const { error: pendingError } = await runPendingAction(pending)
            if (cancelled) return
            if (pendingError) {
              console.error('Error ejecutando acción pendiente:', pendingError)
              clearPendingAction()
              setMemberships([])
              setMembershipError(pendingError.message || 'No se pudo completar tu registro.')
              setLoadingMembership(false)
              return
            }
            clearPendingAction()
            await loadMemberships({ afterPendingAction: true })
            return
          }
        }
        setMemberships([])
        setMembershipError('Tu usuario no tiene una membresía activa en ninguna organización.')
        setLoadingMembership(false)
        return
      }

      // Trae el nombre de la primera sucursal de cada membresía (para mostrarla).
      const withBranchNames = await Promise.all(
        data.map(async (m) => {
          const firstBranchId = m?.branch_scope?.[0]
          if (!firstBranchId) return { ...m, branch_name: null }
          const { data: branch } = await supabase
            .from('branches')
            .select('name')
            .eq('id', firstBranchId)
            .maybeSingle()
          return { ...m, branch_name: branch?.name ?? null }
        })
      )

      if (!cancelled) {
        setMemberships(withBranchNames)
        setLoadingMembership(false)
      }
    }

    loadMemberships()
    return () => { cancelled = true }
  }, [session, reloadTick])

  function refreshMemberships() {
    setReloadTick((t) => t + 1)
  }

  // La empresa "activa" es la que el usuario eligió (guardada en el
  // teléfono) si todavía pertenece a ella, o la primera que tenga.
  const membership =
    memberships.find((m) => m.organization_id === activeOrgId) || memberships[0] || null

  function switchOrg(orgId) {
    setActiveOrgId(orgId)
    writeActiveOrgId(orgId)
  }

  async function signInWithPassword(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  async function signUpWithPassword(email, password) {
    const { data, error } = await supabase.auth.signUp({ email, password })
    return { data, error }
  }

  async function signOut() {
    writeActiveOrgId(null)
    await supabase.auth.signOut()
  }

  // Google (y en el futuro Apple) reemplazan la sesión con un redirect de ida y
  // vuelta, no devuelven un error/data como el login por contraseña. Por eso
  // quien llama debe guardar la acción pendiente (writePendingAction) ANTES de
  // invocar esto, igual que con signUpWithPassword.
  async function signInWithOAuth(provider, redirectTo) {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: redirectTo || window.location.href }
    })
    return { error }
  }

  const value = {
    session,
    user: session?.user ?? null,
    memberships,
    membership,
    switchOrg,
    refreshMemberships,
    loadingMembership,
    membershipError,
    isPlatformAdmin,
    loadingPlatformAdmin,
    isLoading: session === undefined || (session && loadingMembership),
    signInWithPassword,
    signUpWithPassword,
    signInWithOAuth,
    signOut
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
