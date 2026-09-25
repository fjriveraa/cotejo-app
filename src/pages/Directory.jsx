import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const ROLE_LABELS = {
  empleado: 'Empleado',
  contador: 'Contador',
  supervisor: 'Supervisor'
}

export default function Directory() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [roleByOrg, setRoleByOrg] = useState({})
  const [busyOrgId, setBusyOrgId] = useState(null)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    search()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function search(e) {
    e?.preventDefault()
    setLoading(true)
    setError(null)
    const { data, error } = await supabase.rpc('search_organizations', { p_query: query })
    setLoading(false)
    if (error) setError(error.message)
    else setResults(data || [])
  }

  async function handleRequest(org) {
    setBusyOrgId(org.organization_id)
    setError(null)
    setMessage(null)
    const role = roleByOrg[org.organization_id] || 'empleado'
    const { error } = await supabase.rpc('request_to_join', { p_organization_id: org.organization_id, p_role: role })
    setBusyOrgId(null)
    if (error) {
      setError(error.message || 'No se pudo enviar la solicitud.')
      return
    }
    setMessage(`Solicitud enviada a ${org.name}. El dueño la tiene que aprobar.`)
    search()
  }

  return (
    <div className="container">
      <h2 style={{ marginTop: 0 }}>Buscar empresas en Cotejo</h2>
      <p style={{ opacity: 0.7, fontSize: 14, marginTop: -8, marginBottom: 24 }}>
        Busca una empresa ya registrada y pide unirte, sin necesitar un enlace. El dueño de esa empresa aprueba
        o rechaza tu solicitud.
      </p>

      <form onSubmit={search} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nombre de la empresa..."
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn btn-secondary" disabled={loading}>
          {loading ? 'Buscando...' : 'Buscar'}
        </button>
      </form>

      {error && <p className="error-text">{error}</p>}
      {message && <p style={{ color: '#2B6459', fontSize: 13, marginBottom: 12 }}>{message}</p>}

      {results.length === 0 && !loading ? (
        <p className="empty-state">No se encontraron empresas con ese nombre.</p>
      ) : (
        <div className="payment-list">
          {results.map((org) => (
            <div key={org.organization_id} className="payment-row" style={{ flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div className="amount" style={{ fontSize: 14 }}>{org.name}</div>
                <div className="meta">{org.country || 'HN'}</div>
              </div>
              <div className="actions-row" style={{ alignItems: 'center' }}>
                {org.already_member ? (
                  <span style={{ fontSize: 13, opacity: 0.7 }}>Ya perteneces aquí</span>
                ) : org.pending_request ? (
                  <span style={{ fontSize: 13, opacity: 0.7 }}>Solicitud pendiente</span>
                ) : (
                  <>
                    <select
                      value={roleByOrg[org.organization_id] || 'empleado'}
                      onChange={(e) => setRoleByOrg((prev) => ({ ...prev, [org.organization_id]: e.target.value }))}
                      style={{ fontSize: 13 }}
                    >
                      {Object.entries(ROLE_LABELS).map(([role, label]) => (
                        <option key={role} value={role}>{label}</option>
                      ))}
                    </select>
                    <button
                      className="btn btn-primary"
                      disabled={busyOrgId === org.organization_id}
                      onClick={() => handleRequest(org)}
                    >
                      {busyOrgId === org.organization_id ? 'Enviando...' : 'Solicitar unirme'}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
