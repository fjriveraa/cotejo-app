import { NavLink } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

const QUEUE_ROLES = ['contador', 'propietario', 'supervisor', 'admin', 'auditor']
const OWNER_ROLES = ['propietario', 'admin']

const navLinkStyle = ({ isActive }) => ({
  color: isActive ? '#2B6459' : 'inherit',
  fontWeight: isActive ? 600 : 400,
  textDecoration: 'none',
  fontSize: 14
})

const VERIFICATION_BADGE = {
  verified: { label: '✓ Verificada', color: '#2B6459' },
  pending: { label: 'Verificación en revisión', color: '#B45309' },
  rejected: { label: 'Verificación rechazada', color: '#B91C1C' }
}

export default function TopBar() {
  const { membership, memberships, switchOrg, signOut, user, isPlatformAdmin } = useAuth()
  const canSeeQueue = membership && QUEUE_ROLES.includes(membership.role)
  const canInvite = membership && OWNER_ROLES.includes(membership.role)
  const verificationStatus = membership?.organizations?.verification_status
  const verificationBadge = VERIFICATION_BADGE[verificationStatus]

  return (
    <header className="topbar">
      <div className="brand">Cotejo</div>
      <nav style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <NavLink to="/registrar" style={navLinkStyle}>Registrar pago</NavLink>
        {canSeeQueue && <NavLink to="/cola" style={navLinkStyle}>Cola de confirmación</NavLink>}
        {canSeeQueue && <NavLink to="/comprobantes-invitados" style={navLinkStyle}>Comprobantes de invitados</NavLink>}
        {canSeeQueue && <NavLink to="/reportes" style={navLinkStyle}>Reportes</NavLink>}
        {canInvite && <NavLink to="/invitar" style={navLinkStyle}>Invitar equipo</NavLink>}
        {canInvite && <NavLink to="/equipo" style={navLinkStyle}>Mi equipo</NavLink>}
        {canInvite && <NavLink to="/solicitudes" style={navLinkStyle}>Solicitudes</NavLink>}
        {canInvite && <NavLink to="/verificar" style={navLinkStyle}>Verificar mi empresa</NavLink>}
        {isPlatformAdmin && <NavLink to="/admin/verificaciones" style={navLinkStyle}>Verificaciones (admin)</NavLink>}
        <NavLink to="/unirme" style={navLinkStyle}>Unirme a otra empresa</NavLink>
        <NavLink to="/empresas" style={navLinkStyle}>Buscar empresas</NavLink>
        <NavLink to="/autonomo" style={navLinkStyle}>Trabajar como autónomo</NavLink>
        <NavLink to="/mi-identificacion" style={navLinkStyle}>Mi identificación</NavLink>
      </nav>
      <div className="user-info">
        <span>{user?.email}</span>
        {membership && (
          <span className={`badge badge-${membership.role}`}>{membership.role}</span>
        )}
        {verificationBadge && (
          <span style={{ fontSize: 12, fontWeight: 600, color: verificationBadge.color }}>{verificationBadge.label}</span>
        )}
        {memberships.length > 1 ? (
          <select
            value={membership?.organization_id || ''}
            onChange={(e) => switchOrg(e.target.value)}
            style={{ fontSize: 13, padding: '2px 4px' }}
          >
            {memberships.map((m) => (
              <option key={m.organization_id} value={m.organization_id}>
                {m.organizations?.name || 'Empresa'}
              </option>
            ))}
          </select>
        ) : (
          membership?.organizations?.name && (
            <span style={{ opacity: 0.6 }}>{membership.organizations.name}</span>
          )
        )}
        {membership?.branch_name && (
          <span style={{ opacity: 0.6 }}>· {membership.branch_name}</span>
        )}
        <button className="btn btn-ghost" onClick={signOut}>Salir</button>
      </div>
    </header>
  )
}
