import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getCanonicalOrigin } from '../lib/appUrl'
import Spinner from '../components/Spinner'
import SocialButtons from '../components/SocialButtons'

// Paso 1 del registro: solo la cuenta (correo y contraseña, Google o Apple).
// El tipo de uso (personal o empresarial) se elige justo después, en la
// pantalla "¿Cómo vas a usar Cotejo?" que ya aparece al entrar sin empresa.
export default function CreateAccount() {
  const { signUpWithPassword, signInWithOAuth } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)
  const [error, setError] = useState(null)
  const [needsConfirmation, setNeedsConfirmation] = useState(false)

  useEffect(() => {
    const reset = () => setOauthLoading(false)
    window.addEventListener('pageshow', reset)
    return () => window.removeEventListener('pageshow', reset)
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.')
      return
    }
    setLoading(true)
    const { data, error: signUpError } = await signUpWithPassword(email, password)
    setLoading(false)
    if (signUpError) {
      setError(signUpError.message || 'No se pudo crear la cuenta.')
      return
    }
    // Con sesión activa, la app muestra sola la pantalla de tipo de uso.
    if (!data?.session) setNeedsConfirmation(true)
  }

  async function handleSocial(provider) {
    setError(null)
    setOauthLoading(true)
    const { error: oErr, cancelled } = await signInWithOAuth(provider, `${getCanonicalOrigin()}/`)
    if (oErr || cancelled) {
      setOauthLoading(false)
      if (oErr) setError(`No se pudo continuar con ${provider === 'apple' ? 'Apple' : 'Google'}.${oErr.message ? ' (' + oErr.message + ')' : ''}`)
    }
  }

  if (needsConfirmation) {
    return (
      <div className="login-wrap">
        <div className="card login-card">
          <h1>Revisa tu correo</h1>
          <p>
            Te enviamos un enlace de confirmación a <strong>{email}</strong>. Ábrelo y luego{' '}
            <Link to="/login">inicia sesión aquí</Link> para elegir cómo vas a usar Cotejo.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1>Crea tu cuenta</h1>
        <p>Es gratis y toma un minuto. Después eliges si es para uso personal o empresarial.</p>
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
              autoComplete="new-password"
              minLength={6}
            />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading && <Spinner />}{loading ? 'Creando...' : 'Crear cuenta'}
          </button>
        </form>
        <SocialButtons
          onGoogle={() => handleSocial('google')}
          onApple={() => handleSocial('apple')}
          loading={oauthLoading}
          googleLabel="Crear cuenta con Google"
          appleLabel="Crear cuenta con Apple"
        />
        <p style={{ marginTop: 16, fontSize: 13, opacity: 0.7 }}>
          ¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link>
        </p>
      </div>
    </div>
  )
}
