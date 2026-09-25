import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const ROLE_LABELS = {
  empleado: 'Empleado',
  contador: 'Contador',
  supervisor: 'Supervisor'
}

export default function JoinRequests() {
  const { refreshMemberships } = useAuth()
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [roleById, setRoleById] = useState({})

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase.rpc('list_join_requests')
    setLoading(false)
    if (error) setError(error.message)
    else setRequests(data || [])
  }

  async function decide(request, approve) {
    setBusyId(request.request_id)
    setError(null)
    const chosenRole = roleById[request.request_id] || request.role
    const { error } = await supabase.rpc('decide_join_request', {
      p_request_id: request.request_id,
      p_approve: approve,
      p_role: approve ? chosenRole : null
    })
    setBusyId(null)
    if (error) {
      setError(error.message)
      return
    }
    load()
    refreshMemberships()
  }

  if (loading) {
    return <div className="container"><p style={{ opacity: 0.6 }}>Cargando...</p></div>
  }

  return (
    <div className="container">
      <h2 style={{ marginTop: 0 }}>Solicitudes de unión</h2>
      <p style={{ opacity: 0.7, fontSize: 14, marginTop: -8, marginBottom: 24 }}>
        Personas que te encontraron en el directorio de Cotejo y pidieron unirse a alguna de tus empresas.
        Revisa el rol antes de aprobar — puedes cambiarlo si no es el que quieres darle.
      </p>

      {error && <p className="error-text">{error}</p>}

      {requests.length === 0 ? (
        <p className="empty-state">No hay solicitudes pendientes.</p>
      ) : (
        <div className="payment-list">
          {requests.map((r) => (
            <div key={r.request_id} className="payment-row" style={{ flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div className="amount" style={{ fontSize: 14 }}>{r.email}</div>
                <div className="meta">
                  {r.organization_name} · pidió rol de {ROLE_LABELS[r.role] || r.role} · {new Date(r.created_at).toLocaleDateString('es-HN')}
                </div>
              </div>
              <div className="actions-row" style={{ alignItems: 'center' }}>
                <select
                  value={roleById[r.request_id] || r.role}
                  onChange={(e) => setRoleById((prev) => ({ ...prev, [r.request_id]: e.target.value }))}
                  style={{ fontSize: 13 }}
                  disabled={busyId === r.request_id}
                >
                  {Object.entries(ROLE_LABELS).map(([role, label]) => (
                    <option key={role} value={role}>{label}</option>
                  ))}
                </select>
                <button className="btn btn-primary" disabled={busyId === r.request_id} onClick={() => decide(r, true)}>
                  {busyId === r.request_id ? 'Un momento...' : 'Aprobar'}
                </button>
                <button className="btn btn-amber" disabled={busyId === r.request_id} onClick={() => decide(r, false)}>
                  Rechazar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
