import { Link } from 'react-router-dom'
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
  const { membership } = useAuth()
  const orgName = membership?.organizations?.name || 'tu empresa'
  const verificationStatus = membership?.organizations?.verification_status
  const verificationBadge = VERIFICATION_BADGE[verificationStatus]
  const canInvite = OWNER_ROLES.includes(membership?.role)

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
    </div>
  )
}
