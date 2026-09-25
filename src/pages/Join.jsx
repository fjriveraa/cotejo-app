import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth, writePendingAction, clearPendingAction } from '../hooks/useAuth'

const ROLE_LABELS = {
  empleado: 'Empleado',
  contador: 'Contador',
  supervisor: 'Supervisor'
}

export default function Join() {
  const { token } = useParams()
  const { session, signInWithPassword, signUpWithPassword, signInWithOAuth, switchOrg, refreshMemberships } = useAuth()
  const navigate = useNavigate()

  const [info, setInfo] = useState(undefined) // undefined = cargando, null = inválido
  const [mode, setMode] = useState('signup') // 'signup' | 'login'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [needsConfirmation, setNeedsConfirmation] = useState(false)
  const [joining, setJoining] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)

  async function handleGoogle() {
    setError(null)
    setOauthLoading(true)
    writePendingAction({ type: 'join_invite', token })
    const { error } = await signInWithOAuth('google', window.location.href)
    if (error) {
      clearPendingAction()
      setOauthLoading(false)
      setError('No se pudo continuar con Google.')
    }
  }

  useEffect(() => {
    let cancelled = false
    supabase.rpc('get_invite_info', { p_token: token }).then(({ data, error }) => {
      if (cancelled) return
      if (error || !data?.valid) {
        setInfo(null)
      } else {
        setInfo(data)
      }
    })
    return () => { cancelled = true }
  }, [token])

  async function handleJoinNow() {
    setJoining(true)
    setError(null)
    const { data, error: joinError } = await supabase.rpc('join_via_invite', { p_token: token })
    setJoining(false)
    if (joinError) {
      setError(joinError.message || 'No se pudo completar la vinculación.')
      return
    }
    // Deja esta empresa (a la que se acaba de unir, pudiendo ya tener otras)
    // como la activa, y vuelve al inicio.
    if (data?.organization_id) switchOrg(data.organization_id)
    refreshMemberships()
    navigate('/')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    if (mode === 'signup') {
      writePendingAction({ type: 'join_invite', token })
      const { data, error: signUpError } = await signUpWithPassword(email, password)
      setLoading(false)
      if (signUpError) {
        clearPendingAction()
        setError(signUpError.message || 'No se pudo crear la cuenta.')
        return
      }
      if (!data?.session) {
        setNeedsConfirmation(true)
        return
      }
      navigate('/')
      return
    }

    writePendingAction({ type: 'join_invite', token })
    const { error: loginError } = await signInWithPassword(email, password)
    setLoading(false)
    if (loginError) {
      clearPendingAction()
      setError('Correo o contraseña incorrectos.')
      return
    }
    navigate('/')
  }

  if (info === undefined) {
    return (
      <div className="login-wrap">
        <p style={{ opacity: 0.6 }}>Cargando invitación...</p>
      </div>
    )
  }

  if (info === null) {
    return (
      <div className="login-wrap">
        <div className="card login-card">
          <h1>Enlace no válido</h1>
          <p>Este enlace de invitación no existe, fue desactivado, o ya alcanzó su límite de usos. Pide un enlace nuevo a quien te invitó.</p>
          <p style={{ marginTop: 16, fontSize: 13 }}><Link to="/login">Ir al inicio de sesión</Link></p>
        </div>
      </div>
    )
  }

  if (needsConfirmation) {
    return (
      <div className="login-wrap">
        <div className="card login-card">
          <h1>Revisa tu correo</h1>
          <p>
            Te enviamos un enlace de confirmación a <strong>{email}</strong>. Ábrelo y luego{' '}
            <Link to="/login">inicia sesión aquí</Link> — vas a quedar vinculado a{' '}
            <strong>{info.organization_name}</strong> automáticamente.
          </p>
        </div>
      </div>
    )
  }

  if (session) {
    return (
      <div className="login-wrap">
        <div className="card login-card">
          <h1>Únete a {info.organization_name}</h1>
          <p>
            Te están invitando como <strong>{ROLE_LABELS[info.role] || info.role}</strong>
            {info.branch_name ? <> en la sucursal <strong>{info.branch_name}</strong></> : null}.
          </p>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleJoinNow} disabled={joining}>
            {joining ? 'Vinculando...' : `Unirme a ${info.organization_name}`}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1>Únete a {info.organization_name}</h1>
        <p>
          Te están invitando como <strong>{ROLE_LABELS[info.role] || info.role}</strong>
          {info.branch_name ? <> en la sucursal <strong>{info.branch_name}</strong></> : null}. Crea tu cuenta o inicia sesión para continuar.
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            className={mode === 'signup' ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => setMode('signup')}
            style={{ flex: 1 }}
          >
            Crear cuenta
          </button>
          <button
            type="button"
            className={mode === 'login' ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => setMode('login')}
            style={{ flex: 1 }}
          >
            Ya tengo cuenta
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Correo</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="field">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              minLength={6}
            />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Un momento...' : mode === 'signup' ? 'Crear cuenta y unirme' : 'Iniciar sesión y unirme'}
          </button>
        </form>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0', fontSize: 12, opacity: 0.6 }}>
          <div style={{ flex: 1, height: 1, background: 'currentColor', opacity: 0.3 }} />
          o
          <div style={{ flex: 1, height: 1, background: 'currentColor', opacity: 0.3 }} />
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ width: '100%' }}
          onClick={handleGoogle}
          disabled={oauthLoading}
        >
          {oauthLoading ? 'Conectando...' : 'Continuar con Google'}
        </button>
      </div>
    </div>
  )
}
