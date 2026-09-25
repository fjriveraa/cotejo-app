import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const ROLE_LABELS = {
  empleado: 'Empleado',
  contador: 'Contador',
  supervisor: 'Supervisor',
  propietario: 'Dueño',
  admin: 'Admin',
  auditor: 'Auditor'
}

export default function Team() {
  const { membership: myMembership, refreshMemberships } = useAuth()
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [visibilityBusy, setVisibilityBusy] = useState(false)

  useEffect(() => {
    loadMembers()
  }, [])

  async function handleToggleVisibility() {
    if (!myMembership) return
    const nextValue = !myMembership.organizations?.is_public
    setVisibilityBusy(true)
    setError(null)
    const { error } = await supabase.rpc('set_organization_visibility', {
      p_organization_id: myMembership.organization_id,
      p_is_public: nextValue
    })
    setVisibilityBusy(false)
    if (error) setError(error.message)
    else refreshMemberships()
  }

  async function loadMembers() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase.rpc('list_team_members')
    if (error) setError(error.message)
    else setMembers(data || [])
    setLoading(false)
  }

  async function handleRemove(m) {
    if (!window.confirm(`¿Quitar a ${m.email} del equipo? Va a perder acceso, pero puedes reactivarlo después.`)) return
    setBusyId(m.membership_id)
    setError(null)
    const { error } = await supabase.rpc('remove_team_member', { p_membership_id: m.membership_id })
    setBusyId(null)
    if (error) setError(error.message)
    else loadMembers()
  }

  async function handleReactivate(m) {
    setBusyId(m.membership_id)
    setError(null)
    const { error } = await supabase.rpc('reactivate_team_member', { p_membership_id: m.membership_id })
    setBusyId(null)
    if (error) setError(error.message)
    else loadMembers()
  }

  if (loading) {
    return <div className="container"><p style={{ opacity: 0.6 }}>Cargando equipo...</p></div>
  }

  return (
    <div className="container">
      <h2 style={{ marginTop: 0 }}>Mi equipo</h2>
      <p style={{ opacity: 0.7, fontSize: 14, marginTop: -8, marginBottom: 24 }}>
        Todas las personas vinculadas a tu empresa. Puedes quitar a alguien sin borrar su cuenta — solo pierde
        acceso, y lo puedes reactivar cuando quieras.
      </p>

      {error && <p className="error-text">{error}</p>}

      <div className="card" style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Visible en el directorio de Cotejo</div>
          <div style={{ fontSize: 13, opacity: 0.7 }}>
            {myMembership?.organizations?.is_public === false
              ? 'Tu empresa está oculta. Nadie puede encontrarla buscando; solo entra quien tenga un enlace de invitación.'
              : 'Cualquier usuario de Cotejo puede encontrar tu empresa buscando y pedir unirse.'}
          </div>
        </div>
        <button className="btn btn-secondary" disabled={visibilityBusy} onClick={handleToggleVisibility}>
          {visibilityBusy
            ? 'Un momento...'
            : myMembership?.organizations?.is_public === false
              ? 'Hacer visible'
              : 'Ocultar del directorio'}
        </button>
      </div>

      {members.length === 0 ? (
        <p className="empty-state">Todavía no hay nadie en tu equipo.</p>
      ) : (
        <div className="payment-list">
          {members.map((m) => (
            <div key={m.membership_id} className="payment-row" style={{ flexWrap: 'wrap', gap: 12, opacity: m.status === 'disabled' ? 0.5 : 1 }}>
              <div>
                <div className="amount" style={{ fontSize: 14 }}>
                  {m.email}
                  {m.membership_id === myMembership?.id && <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>(tú)</span>}
                </div>
                <div className="meta">
                  {ROLE_LABELS[m.role] || m.role}
                  {m.status === 'disabled' && <span style={{ marginLeft: 8 }}>· fuera del equipo</span>}
                  {' · desde '}{new Date(m.created_at).toLocaleDateString('es-HN')}
                </div>
              </div>
              {m.membership_id !== myMembership?.id && (
                <div className="actions-row">
                  {m.status === 'disabled' ? (
                    <button className="btn btn-secondary" disabled={busyId === m.membership_id} onClick={() => handleReactivate(m)}>
                      {busyId === m.membership_id ? 'Un momento...' : 'Reactivar'}
                    </button>
                  ) : (
                    <button className="btn btn-amber" disabled={busyId === m.membership_id} onClick={() => handleRemove(m)}>
                      {busyId === m.membership_id ? 'Un momento...' : 'Quitar del equipo'}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
