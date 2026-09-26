import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const ROLE_LABELS = {
  empleado: 'Colaborador',
  contador: 'Contador',
  supervisor: 'Supervisor'
}

// El enlace genérico de arriba está bloqueado a nivel de base de datos para
// estos tres roles — cualquiera con el link se activa solo, así que no es
// seguro para un rol de dueño. Para esos, la única vía es invitar a un
// correo puntual, que solo esa persona puede reclamar.
const EMAIL_ROLE_LABELS = {
  empleado: 'Colaborador',
  supervisor: 'Supervisor',
  contador: 'Contador',
  propietario: 'Propietario',
  admin: 'Administrador',
  auditor: 'Auditor'
}

const EMAIL_INVITE_STATUS_LABELS = {
  pending: 'Esperando que entre a Cotejo',
  accepted: 'Activo',
  revoked: 'Revocada'
}

function EmailInviteSection({ organizationId }) {
  const [invites, setInvites] = useState([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('empleado')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    if (!organizationId) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.rpc('list_email_invites', { p_organization_id: organizationId })
    setLoading(false)
    if (error) setError(error.message)
    else setInvites(data || [])
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    if (!email.trim()) return
    setSubmitting(true)
    const { data, error } = await supabase.rpc('invite_by_email', {
      p_organization_id: organizationId,
      p_email: email.trim(),
      p_role: role
    })
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    setMessage(
      data?.activated
        ? `${email.trim()} ya tenía cuenta en Cotejo — quedó activo como ${EMAIL_ROLE_LABELS[role]} de inmediato.`
        : `Invitación guardada para ${email.trim()}. Se activa sola en cuanto esa persona entre a Cotejo con ese correo.`
    )
    setEmail('')
    load()
  }

  async function handleRevoke(invite) {
    setBusyId(invite.invite_id)
    setError(null)
    const { error } = await supabase.rpc('revoke_email_invite', { p_invite_id: invite.invite_id })
    setBusyId(null)
    if (error) {
      setError(error.message)
      return
    }
    load()
  }

  return (
    <div className="card" style={{ marginBottom: 32 }}>
      <h3 style={{ marginTop: 0, fontSize: 16 }}>Invitar por correo</h3>
      <p style={{ fontSize: 13, opacity: 0.7, marginTop: -6, marginBottom: 16 }}>
        Para roles de confianza (propietario, administrador, auditor) que no se pueden repartir por enlace.
        Solo el correo que escribas puede activar esa invitación.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="correo@ejemplo.com"
          required
          style={{ flex: '1 1 220px' }}
        />
        <select value={role} onChange={(e) => setRole(e.target.value)} style={{ flex: '0 0 auto' }}>
          {Object.entries(EMAIL_ROLE_LABELS).map(([r, label]) => (
            <option key={r} value={r}>{label}</option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Enviando...' : 'Invitar'}
        </button>
      </form>

      {error && <p className="error-text">{error}</p>}
      {message && <p style={{ color: '#2B6459', fontSize: 13, marginBottom: 12 }}>{message}</p>}

      {!loading && invites.length > 0 && (
        <div className="payment-list">
          {invites.map((inv) => (
            <div key={inv.invite_id} className="payment-row" style={{ flexWrap: 'wrap', gap: 10, opacity: inv.status === 'revoked' ? 0.5 : 1 }}>
              <div>
                <div className="amount" style={{ fontSize: 13.5 }}>{inv.email}</div>
                <div className="meta">
                  {EMAIL_ROLE_LABELS[inv.role] || inv.role} · {EMAIL_INVITE_STATUS_LABELS[inv.status] || inv.status}
                </div>
              </div>
              {inv.status === 'pending' && (
                <button
                  className="btn btn-amber"
                  disabled={busyId === inv.invite_id}
                  onClick={() => handleRevoke(inv)}
                >
                  {busyId === inv.invite_id ? 'Un momento...' : 'Revocar'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
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

      {membership && <EmailInviteSection organizationId={membership.organization_id} />}

      <h3 style={{ fontSize: 16 }}>Invitar por enlace</h3>
      <p style={{ fontSize: 13, opacity: 0.7, marginTop: -6, marginBottom: 16 }}>
        Para colaborador, contador o supervisor — cualquiera con el enlace se activa solo con ese rol.
      </p>

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
