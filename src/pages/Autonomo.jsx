import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

export default function Autonomo() {
  const { session, switchOrg, refreshMemberships } = useAuth()
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [duplicateWarning, setDuplicateWarning] = useState(null)
  const [confirmedDuplicate, setConfirmedDuplicate] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (!displayName.trim()) {
      setError('Ingresa tu nombre o el nombre con el que trabajas.')
      return
    }

    if (!confirmedDuplicate) {
      const { data: similar } = await supabase.rpc('check_similar_organization_names', { p_name: displayName.trim() })
      if (similar && similar.length > 0) {
        setDuplicateWarning(similar[0].name)
        setConfirmedDuplicate(true)
        return
      }
    }

    setLoading(true)
    const { data, error } = await supabase.rpc('create_organization_and_owner', {
      p_org_name: displayName.trim(),
      p_branch_name: 'Principal',
      p_org_type: 'autonomo'
    })
    setLoading(false)
    if (error) {
      setError(error.message || 'No se pudo crear tu perfil.')
      return
    }
    if (data?.organization_id) switchOrg(data.organization_id)
    refreshMemberships()
    navigate('/')
  }

  return (
    <div className="container">
      <h2 style={{ marginTop: 0 }}>Trabajar como comerciante individual</h2>
      <p style={{ opacity: 0.7, fontSize: 14, marginTop: -8, marginBottom: 24 }}>
        Si trabajas por tu cuenta — formal o informal — registra tu negocio con tu nombre o el
        nombre con el que te conocen tus clientes. Vas a poder registrar y confirmar pagos igual
        que una empresa, y más adelante también podrás unirte a otras empresas sin perder este
        perfil.
      </p>
      <div className="card">
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="displayName">Tu nombre o el nombre de tu negocio</label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value)
                setDuplicateWarning(null)
                setConfirmedDuplicate(false)
              }}
              placeholder="ej. Andrea Osorio, o Repostería Andrea"
              required
            />
          </div>
          {duplicateWarning && (
            <p style={{ color: '#B45309', fontSize: 13, marginBottom: 12 }}>
              Ya existe un registro llamado "{duplicateWarning}" en Cotejo. Si es tuyo, mejor pídele a esa persona
              un enlace de invitación o búscalo en "Buscar empresas". Si es otro negocio, toca de nuevo para
              continuar de todas formas.
            </p>
          )}
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Creando...' : duplicateWarning ? 'Continuar de todas formas' : 'Empezar a usar Cotejo'}
          </button>
        </form>
      </div>
    </div>
  )
}
