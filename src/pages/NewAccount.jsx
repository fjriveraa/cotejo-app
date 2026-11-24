import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import BackButton from '../components/BackButton'
import { IconBuilding, IconBriefcase } from '../components/icons'

// Quien ya tiene una cuenta puede crear otra (personal o de empresa) sin
// cerrar sesión. Antes el mensaje decía "puedes agregar la otra después"
// pero no existía ningún camino para hacerlo.
export default function NewAccount() {
  const { switchOrg, refreshMemberships } = useAuth()
  const navigate = useNavigate()
  const [kind, setKind] = useState(null) // 'autonomo' | 'empresa'
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) { setError('Escribe el nombre.'); return }
    setLoading(true)
    const { data, error: err } = await supabase.rpc('create_organization_and_owner', {
      p_org_name: name.trim(),
      p_branch_name: 'Principal',
      p_org_type: kind
    })
    setLoading(false)
    if (err) { setError(err.message || 'No se pudo crear la cuenta.'); return }
    await refreshMemberships()
    if (data?.organization_id) switchOrg(data.organization_id)
    navigate('/')
  }

  return (
    <div className="container">
      <BackButton />
      <h2 style={{ marginTop: 0 }}>Crear otra cuenta</h2>
      <p style={{ opacity: 0.7, fontSize: 14, marginTop: -8, marginBottom: 20 }}>
        Puedes tener varias cuentas con el mismo usuario y cambiar entre ellas desde el menú.
      </p>
      {!kind ? (
        <div className="choice-row">
          <button type="button" className="choice-card" onClick={() => setKind('autonomo')}>
            <IconBriefcase width={26} height={26} />
            <span className="choice-title">Personal</span>
            <span className="choice-subtitle">Para mí, o para mi negocio propio</span>
          </button>
          <button type="button" className="choice-card" onClick={() => setKind('empresa')}>
            <IconBuilding width={26} height={26} />
            <span className="choice-title">Empresa</span>
            <span className="choice-subtitle">Una empresa con varias personas usando Cotejo juntas</span>
          </button>
        </div>
      ) : (
        <div className="card">
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="newName">{kind === 'empresa' ? 'Nombre de la empresa' : 'Tu nombre o el nombre de tu negocio'}</label>
              <input id="newName" type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>
            {error && <p className="error-text">{error}</p>}
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
              {loading ? 'Creando...' : 'Crear cuenta'}
            </button>
            <button type="button" className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => setKind(null)}>
              Cambiar tipo
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
