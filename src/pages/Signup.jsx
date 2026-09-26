import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth, writePendingAction, clearPendingAction } from '../hooks/useAuth'

export default function Signup() {
  const { session, membership, loadingMembership, signUpWithPassword, signInWithOAuth, switchOrg, refreshMemberships } = useAuth()
  const navigate = useNavigate()
  const [orgName, setOrgName] = useState('')
  const [branchName, setBranchName] = useState('Principal')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [needsConfirmation, setNeedsConfirmation] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)
  const [duplicateWarning, setDuplicateWarning] = useState(null)
  const [confirmedDuplicate, setConfirmedDuplicate] = useState(false)
  // Para el caso "Sistemas/Operaciones da de alta una empresa grande que no
  // es suya": quien registra queda como admin operativo, no como dueño, y el
  // rol de propietario se cede de una vez al correo del dueño real.
  const [setupForOther, setSetupForOther] = useState(false)
  const [ownerEmail, setOwnerEmail] = useState('')

  async function nameIsFreeToUse() {
    if (confirmedDuplicate) return true
    const { data: similar } = await supabase.rpc('check_similar_organization_names', { p_name: orgName.trim() })
    if (similar && similar.length > 0) {
      setDuplicateWarning(similar[0].name)
      setConfirmedDuplicate(true)
      return false
    }
    return true
  }

  // Alguien puede llegar aquí con sesión ya abierta pero sin empresa todavía
  // (por ejemplo, entró con Google desde /login antes de tener una). En ese
  // caso no lo mandamos para "/" — ahí se quedaría atascado — sino que
  // creamos la empresa directo, sin pedirle contraseña de nuevo.
  async function handleSubmitWithSession() {
    setError(null)
    if (!orgName.trim()) {
      setError('Ingresa el nombre de tu empresa.')
      return
    }
    if (setupForOther && !ownerEmail.trim()) {
      setError('Ingresa el correo del dueño o representante legal.')
      return
    }
    if (!(await nameIsFreeToUse())) return
    setLoading(true)
    const { data, error } = await supabase.rpc('create_organization_and_owner', {
      p_org_name: orgName.trim(),
      p_branch_name: branchName.trim() || 'Principal',
      p_setup_for_other: setupForOther,
      p_owner_email: setupForOther ? ownerEmail.trim() : null
    })
    setLoading(false)
    if (error) {
      setError(error.message || 'No se pudo crear la empresa.')
      return
    }
    if (data?.organization_id) switchOrg(data.organization_id)
    refreshMemberships()
    navigate('/')
  }

  async function handleGoogle() {
    if (!orgName.trim()) {
      setError('Primero escribe el nombre de tu empresa, luego continúa con Google.')
      return
    }
    if (session) {
      await handleSubmitWithSession()
      return
    }
    if (setupForOther && !ownerEmail.trim()) {
      setError('Ingresa el correo del dueño o representante legal.')
      return
    }
    if (!(await nameIsFreeToUse())) return
    setError(null)
    setOauthLoading(true)
    writePendingAction({
      type: 'create_org',
      orgName: orgName.trim(),
      branchName: branchName.trim(),
      setupForOther,
      ownerEmail: setupForOther ? ownerEmail.trim() : null
    })
    const { error } = await signInWithOAuth('google', `${window.location.origin}/`)
    if (error) {
      clearPendingAction()
      setOauthLoading(false)
      setError('No se pudo continuar con Google.')
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (!orgName.trim()) {
      setError('Ingresa el nombre de tu empresa.')
      return
    }

    if (session) {
      await handleSubmitWithSession()
      return
    }

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.')
      return
    }

    if (setupForOther && !ownerEmail.trim()) {
      setError('Ingresa el correo del dueño o representante legal.')
      return
    }

    if (!(await nameIsFreeToUse())) return

    setLoading(true)
    // Se guarda antes de crear la cuenta: si el correo requiere confirmación,
    // esta acción se completa sola la primera vez que el dueño inicie sesión.
    writePendingAction({
      type: 'create_org',
      orgName: orgName.trim(),
      branchName: branchName.trim(),
      setupForOther,
      ownerEmail: setupForOther ? ownerEmail.trim() : null
    })

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

  if (session && membership) {
    // Ya tiene sesión Y empresa (por ejemplo, alguien logueado que abre
    // /signup por error). Ahí sí lo mandamos a la app normal.
    navigate('/')
    return null
  }

  if (session && loadingMembership) {
    return (
      <div className="login-wrap">
        <p style={{ opacity: 0.6 }}>Cargando...</p>
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
        <p>
          {session
            ? `Ya iniciaste sesión como ${session.user.email}. Solo falta el nombre de tu empresa.`
            : 'Regístrate como dueño y arma tu equipo después con un enlace de invitación.'}
        </p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="orgName">Nombre de la empresa</label>
            <input
              id="orgName"
              type="text"
              value={orgName}
              onChange={(e) => {
                setOrgName(e.target.value)
                setDuplicateWarning(null)
                setConfirmedDuplicate(false)
              }}
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
            <label>¿Quién eres en esta empresa?</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontWeight: 400, fontSize: 13.5 }}>
                <input
                  type="radio"
                  name="setupFor"
                  checked={!setupForOther}
                  onChange={() => setSetupForOther(false)}
                  style={{ marginTop: 3 }}
                />
                Soy el dueño o representante legal de la empresa
              </label>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontWeight: 400, fontSize: 13.5 }}>
                <input
                  type="radio"
                  name="setupFor"
                  checked={setupForOther}
                  onChange={() => setSetupForOther(true)}
                  style={{ marginTop: 3 }}
                />
                Estoy dando de alta la cuenta para otra persona (ej. Sistemas u Operaciones configurando la empresa)
              </label>
            </div>
          </div>
          {setupForOther && (
            <div className="field">
              <label htmlFor="ownerEmail">Correo del dueño o representante legal</label>
              <input
                id="ownerEmail"
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                placeholder="dueño@empresa.com"
                required={setupForOther}
              />
              <p style={{ fontSize: 12.5, opacity: 0.65, marginTop: 4 }}>
                Vas a quedar como administrador con acceso operativo. Esa persona queda como propietaria de
                inmediato (o en cuanto entre a Cotejo por primera vez) y es quien va a poder certificar la
                empresa con sus documentos legales.
              </p>
            </div>
          )}
          {!session && (
            <>
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
            </>
          )}
          {duplicateWarning && (
            <p style={{ color: '#B45309', fontSize: 13, marginBottom: 12 }}>
              Ya existe un registro llamado "{duplicateWarning}" en Cotejo. Si esa empresa es tuya, mejor pídele
              a quien la creó un enlace de invitación, o búscala en "Buscar empresas" para unirte. Si es otro
              negocio distinto, toca de nuevo para continuar de todas formas.
            </p>
          )}
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Creando...' : duplicateWarning ? 'Continuar de todas formas' : 'Crear mi empresa'}
          </button>
        </form>
        {!session && (
        <>
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
          {oauthLoading ? 'Conectando...' : 'Crear mi empresa con Google'}
        </button>
        </>
        )}
        {!session && (
          <p style={{ marginTop: 16, fontSize: 13, opacity: 0.7 }}>
            ¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link>
          </p>
        )}
      </div>
    </div>
  )
}
