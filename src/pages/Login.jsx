import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function Login() {
  const { signInWithPassword, signInWithOAuth } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await signInWithPassword(email, password)
    setLoading(false)
    if (error) {
      setError('Correo o contraseña incorrectos.')
    }
  }

  async function handleGoogle() {
    setError(null)
    setOauthLoading(true)
    const { error } = await signInWithOAuth('google', `${window.location.origin}/`)
    if (error) {
      setOauthLoading(false)
      setError('No se pudo continuar con Google.')
    }
    // Si no hay error, el navegador redirige a Google y vuelve solo.
  }

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1>Cotejo</h1>
        <p>Control de comprobantes de pago</p>
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
              autoComplete="current-password"
            />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Ingresando...' : 'Ingresar'}
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
        <p style={{ marginTop: 16, fontSize: 13, opacity: 0.7 }}>
          ¿Tu empresa no tiene cuenta todavía? <Link to="/signup">Créala aquí</Link>
        </p>
      </div>
    </div>
  )
}
