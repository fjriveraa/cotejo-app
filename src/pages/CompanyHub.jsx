import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { IconUsers, IconMail, IconInbox, IconBuilding, IconChart, IconShield } from '../components/icons'

const OWNER_ROLES = ['propietario', 'admin']

const VERIFICATION_BADGE = {
  verified: { label: '✓ Verificada', color: '#2B6459', bg: 'rgba(43, 100, 89, 0.08)' },
  pending: { label: 'Verificación en revisión', color: '#B45309', bg: '#FEF3C7' },
  rejected: { label: 'Verificación rechazada', color: '#B91C1C', bg: '#FEE2E2' }
}

// Antes, administrar la empresa era una lista de links sueltos escondidos
// en el menú (equipo, cuentas, invitar, solicitudes, reportes, verificar) —
// nada los presentaba como partes de un mismo lugar. Esta pantalla los junta
// como lo que en realidad son: todo lo que le pertenece a ESTA empresa.
export default function CompanyHub() {
  const { membership, refreshMemberships } = useAuth()
  const navigate = useNavigate()
  const orgName = membership?.organizations?.name || 'tu empresa'
  const verificationStatus = membership?.organizations?.verification_status
  const verificationBadge = VERIFICATION_BADGE[verificationStatus]
  const canInvite = OWNER_ROLES.includes(membership?.role)
  const isOwner = membership?.role === 'propietario'

  // Borrar una empresa es irreversible, así que se pide escribir el nombre
  // exacto (como en GitHub al borrar un repo) en vez de solo un botón +
  // confirm(). El backend además se niega si tiene comprobantes reales o
  // más gente en el equipo -- esto es a propósito solo para empresas vacías
  // creadas por error.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deletingOrg, setDeletingOrg] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  async function handleDeleteOrg() {
    setDeletingOrg(true)
    setDeleteError(null)
    const { error } = await supabase.rpc('delete_organization', {
      p_organization_id: membership.organization_id,
      p_confirm_name: deleteConfirmText
    })
    setDeletingOrg(false)
    if (error) {
      setDeleteError(error.message)
      return
    }
    refreshMemberships()
    navigate('/')
  }

  // Correo informativo, no una credencial -- a quién contactar por esta
  // empresa. Nunca se usa para iniciar sesión, así que no compromete saber
  // quién hizo cada acción (eso sigue dependiendo del login real de cada
  // persona).
  const [contactEmail, setContactEmail] = useState(membership?.organizations?.contact_email || '')
  const [editingEmail, setEditingEmail] = useState(false)
  const [savingEmail, setSavingEmail] = useState(false)
  const [emailError, setEmailError] = useState(null)

  async function handleSaveContactEmail() {
    setSavingEmail(true)
    setEmailError(null)
    const { error } = await supabase.rpc('update_organization_contact_email', {
      p_organization_id: membership.organization_id,
      p_contact_email: contactEmail
    })
    setSavingEmail(false)
    if (error) {
      setEmailError(error.message)
      return
    }
    setEditingEmail(false)
    refreshMemberships()
  }

  // Reportes lo puede ver cualquiera que llegue a esta pantalla (contador,
  // supervisor, auditor incluidos) -- el resto son cosas de administrar la
  // empresa, solo para quien puede invitar gente o cambiar cuentas.
  const cards = [
    { to: '/reportes', icon: IconChart, title: 'Reportes', subtitle: 'Exportar pagos y comprobantes a Excel', ownerOnly: false },
    { to: '/equipo', icon: IconUsers, title: 'Mi equipo', subtitle: 'Ver colaboradores, roles y desactivar acceso', ownerOnly: true },
    { to: '/invitar', icon: IconMail, title: 'Invitar equipo', subtitle: 'Enlace de invitación o invitación por correo', ownerOnly: true },
    { to: '/solicitudes', icon: IconInbox, title: 'Solicitudes', subtitle: 'Personas que pidieron unirse desde el directorio', ownerOnly: true },
    { to: '/cuentas', icon: IconBuilding, title: 'Cuentas receptoras', subtitle: 'Bancos y cuentas donde recibes pagos', ownerOnly: true }
  ].filter((c) => !c.ownerOnly || canInvite)

  return (
    <div className="container">
      <h2 style={{ marginTop: 0, marginBottom: 4 }}>{orgName}</h2>
      <p style={{ opacity: 0.65, fontSize: 14, marginTop: 0, marginBottom: 16 }}>
        Todo lo que le pertenece a esta empresa, en un solo lugar.
      </p>

      {verificationBadge && (
        <div
          className="card"
          style={{
            marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 10, background: verificationBadge.bg, borderColor: 'transparent', flexWrap: 'wrap'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <IconShield width={20} height={20} style={{ color: verificationBadge.color, flexShrink: 0 }} />
            <span style={{ fontSize: 13.5, fontWeight: 600, color: verificationBadge.color }}>{verificationBadge.label}</span>
          </div>
          {verificationStatus !== 'verified' && membership?.role === 'propietario' && (
            <Link to="/verificar" className="btn btn-secondary" style={{ fontSize: 12.5 }}>Verificar mi empresa</Link>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: editingEmail ? 10 : 0 }}>
          <IconMail width={18} height={18} style={{ opacity: 0.6, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, opacity: 0.6 }}>Correo de contacto de esta empresa</div>
            {!editingEmail && (
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                {membership?.organizations?.contact_email || 'Sin asignar'}
              </div>
            )}
          </div>
          {canInvite && !editingEmail && (
            <button type="button" className="btn btn-secondary" style={{ fontSize: 12.5 }} onClick={() => setEditingEmail(true)}>
              {membership?.organizations?.contact_email ? 'Cambiar' : 'Asignar'}
            </button>
          )}
        </div>
        {editingEmail && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="contacto@empresa.com"
              style={{ flex: '1 1 200px' }}
            />
            <button className="btn btn-primary" disabled={savingEmail} onClick={handleSaveContactEmail}>
              {savingEmail ? 'Guardando...' : 'Guardar'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => { setEditingEmail(false); setContactEmail(membership?.organizations?.contact_email || ''); setEmailError(null) }}
            >
              Cancelar
            </button>
          </div>
        )}
        {emailError && <p className="error-text" style={{ marginTop: 8, marginBottom: 0 }}>{emailError}</p>}
      </div>

      <div className="quick-actions">
        {cards.map((c) => (
          <Link key={c.to} to={c.to} className="quick-action">
            <c.icon width={22} height={22} />
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
              <span>{c.title}</span>
              <span style={{ fontSize: 11.5, opacity: 0.6, fontWeight: 400 }}>{c.subtitle}</span>
            </span>
          </Link>
        ))}
      </div>

      {isOwner && (
        <div className="card" style={{ marginTop: 32, borderColor: 'rgba(185, 28, 28, 0.3)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#B91C1C', marginBottom: 4 }}>Zona de peligro</div>
          {!confirmingDelete ? (
            <>
              <p style={{ fontSize: 13, opacity: 0.7, marginTop: 0, marginBottom: 12 }}>
                Borrar esta empresa es permanente. Solo funciona si no tiene comprobantes registrados ni otras
                personas en el equipo -- pensado para empresas creadas por error.
              </p>
              <button className="btn btn-secondary" style={{ color: '#B91C1C', borderColor: 'rgba(185, 28, 28, 0.4)' }} onClick={() => setConfirmingDelete(true)}>
                Borrar empresa
              </button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 13, marginTop: 0, marginBottom: 8 }}>
                Para confirmar, escribe el nombre exacto: <strong>{orgName}</strong>
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={orgName}
                  style={{ flex: '1 1 200px' }}
                />
                <button
                  className="btn btn-amber"
                  disabled={deletingOrg || deleteConfirmText.trim().toLowerCase() !== orgName.trim().toLowerCase()}
                  onClick={handleDeleteOrg}
                >
                  {deletingOrg ? 'Borrando...' : 'Borrar definitivamente'}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => { setConfirmingDelete(false); setDeleteConfirmText(''); setDeleteError(null) }}
                >
                  Cancelar
                </button>
              </div>
              {deleteError && <p className="error-text" style={{ marginTop: 8, marginBottom: 0 }}>{deleteError}</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
