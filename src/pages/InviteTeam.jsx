import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const ROLE_LABELS = {
  empleado: 'Empleado',
  contador: 'Contador',
  supervisor: 'Supervisor'
}

function buildJoinUrl(token) {
  return `${window.location.origin}/join/${token}`
}

export default function InviteTeam() {
  const { membership } = useAuth()
  const [links, setLinks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [creatingRole, setCreatingRole] = useState(null)
  const [copiedId, setCopiedId] = useState(null)

  useEffect(() => {
    if (!membership) return
    loadLinks()
  }, [membership])

  async function loadLinks() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('invite_links')
      .select('id, token, role, branch_id, active, max_uses, use_count, created_at')
      .eq('organization_id', membership.organization_id)
      .order('created_at', { ascending: false })

    if (error) setError(error.message)
    else setLinks(data || [])
    setLoading(false)
  }

  async function handleCreate(role) {
    setCreatingRole(role)
    setError(null)
    const { error } = await supabase.from('invite_links').insert({
      organization_id: membership.organization_id,
      role,
      created_by: membership.id
    })
    setCreatingRole(null)
    if (error) {
      setError(error.message)
      return
    }
    loadLinks()
  }

  async function toggleActive(link) {
    setError(null)
    const { error } = await supabase
      .from('invite_links')
      .update({ active: !link.active })
      .eq('id', link.id)
    if (error) setError(error.message)
    else loadLinks()
  }

  function copyLink(link) {
    const url = buildJoinUrl(link.token)
    navigator.clipboard?.writeText(url)
    setCopiedId(link.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  function whatsappShareUrl(link) {
    const url = buildJoinUrl(link.token)
    const text = `Únete a nuestro equipo en Cotejo (${membership?.organizations?.name || ''}) como ${ROLE_LABELS[link.role] || link.role}: ${url}`
    return `https://wa.me/?text=${encodeURIComponent(text)}`
  }

  const activeByRole = links.reduce((acc, l) => {
    if (l.active) acc[l.role] = (acc[l.role] || 0) + 1
    return acc
  }, {})

  if (loading) {
    return <div className="container"><p style={{ opacity: 0.6 }}>Cargando...</p></div>
  }

  return (
    <div className="container">
      <h2 style={{ marginTop: 0 }}>Invitar equipo</h2>
      <p style={{ opacity: 0.7, fontSize: 14, marginTop: -8, marginBottom: 24 }}>
        Comparte un enlace por rol — como el link de una Comunidad de WhatsApp. Cualquiera que lo abra crea su
        cuenta (o inicia sesión) y queda vinculado automáticamente con ese rol. Puedes desactivar un enlace en
        cualquier momento sin afectar a quienes ya se unieron.
      </p>

      {error && <p className="error-text">{error}</p>}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 32 }}>
        {Object.entries(ROLE_LABELS).map(([role, label]) => (
          <button
            key={role}
            className="btn btn-secondary"
            disabled={creatingRole === role}
            onClick={() => handleCreate(role)}
          >
            {creatingRole === role ? 'Creando...' : `+ Nuevo enlace de ${label}`}
          </button>
        ))}
      </div>

      {links.length === 0 ? (
        <p className="empty-state">Todavía no has creado ningún enlace de invitación.</p>
      ) : (
        <div className="payment-list">
          {links.map((link) => (
            <div key={link.id} className="payment-row" style={{ flexWrap: 'wrap', gap: 12, opacity: link.active ? 1 : 0.5 }}>
              <div>
                <div className="amount" style={{ fontSize: 14 }}>
                  {ROLE_LABELS[link.role] || link.role}
                  {!link.active && <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>(desactivado)</span>}
                </div>
                <div className="meta mono" style={{ wordBreak: 'break-all' }}>{buildJoinUrl(link.token)}</div>
                <div className="meta">
                  Usado {link.use_count} {link.use_count === 1 ? 'vez' : 'veces'}
                  {link.max_uses ? ` de ${link.max_uses}` : ''} · creado {new Date(link.created_at).toLocaleDateString('es-HN')}
                </div>
              </div>
              <div className="actions-row">
                <button className="btn btn-primary" onClick={() => copyLink(link)}>
                  {copiedId === link.id ? '¡Copiado!' : 'Copiar link'}
                </button>
                <a
                  className="btn btn-secondary"
                  href={whatsappShareUrl(link)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ textDecoration: 'none', textAlign: 'center' }}
                >
                  Enviar por WhatsApp
                </a>
                <button className="btn btn-amber" onClick={() => toggleActive(link)}>
                  {link.active ? 'Desactivar' : 'Reactivar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {Object.keys(activeByRole).length > 0 && (
        <p style={{ fontSize: 12, opacity: 0.6, marginTop: 24 }}>
          Enlaces activos: {Object.entries(activeByRole).map(([role, count]) => `${ROLE_LABELS[role] || role} (${count})`).join(', ')}
        </p>
      )}
    </div>
  )
}
