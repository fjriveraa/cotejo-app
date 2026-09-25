import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, writePendingAction, clearPendingAction } from '../hooks/useAuth'

export default function Signup() {
  const { session, signUpWithPassword } = useAuth()
  const navigate = useNavigate()
  const [orgName, setOrgName] = useState('')
  const [branchName, setBranchName] = useState('Principal')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [needsConfirmation, setNeedsConfirmation] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (!orgName.trim()) {
      setError('Ingresa el nombre de tu empresa.')
      return
    }
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.')
      return
    }

    setLoading(true)
    // Se guarda antes de crear la cuenta: si el correo requiere confirmación,
    // esta acción se completa sola la primera vez que el dueño inicie sesión.
    writePendingAction({ type: 'create_org', orgName: orgName.trim(), branchName: branchName.trim() })

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

    // Ya hay sesión activa: el efecto de useAuth va a detectar que no hay
    // membresía y va a ejecutar la creación de la empresa automáticamente.
    navigate('/')
  }

  if (session && !needsConfirmation) {
    // Ya hay una sesión (por ejemplo, alguien logueado que abre /signup por error).
    // Dejamos que el flujo normal de la app decida a dónde va.
    navigate('/')
    return null
  }

  if (needsConfirmation) {
    return (
      <div className="login-wrap">
        <div className="card login-card">
          <h1>Revisa tu correo</h1>
          <p>
            Te enviamos un enlace de confirmación a <strong>{email}</strong>. Ábrelo y luego{' '}
            <Link to="/login">inicia sesión aquí</Link> — tu empresa "{orgName}" se va a crear automáticamente
            en ese momento.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1>Crear tu empresa en Cotejo</h1>
        <p>Regístrate como dueño y arma tu equipo después con un enlace de invitación.</p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="orgName">Nombre de la empresa</label>
            <input
              id="orgName"
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="ej. FARO HN"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="branchName">Primera sucursal (opcional)</label>
            <input
              id="branchName"
              type="text"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="Principal"
            />
          </div>
          <div className="field">
            <label htmlFor="email">Tu correo</label>
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
              autoComplete="new-password"
              minLength={6}
            />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Creando...' : 'Crear mi empresa'}
          </button>
        </form>
        <p style={{ marginTop: 16, fontSize: 13, opacity: 0.7 }}>
          ¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link>
        </p>
      </div>
    </div>
  )
}
