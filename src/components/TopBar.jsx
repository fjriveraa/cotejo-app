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

export default function TopBar() {
  const { membership, memberships, switchOrg, signOut, user } = useAuth()
  const canSeeQueue = membership && QUEUE_ROLES.includes(membership.role)
  const canInvite = membership && OWNER_ROLES.includes(membership.role)

  return (
    <header className="topbar">
      <div className="brand">Cotejo</div>
      <nav style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <NavLink to="/registrar" style={navLinkStyle}>Registrar pago</NavLink>
        {canSeeQueue && <NavLink to="/cola" style={navLinkStyle}>Cola de confirmación</NavLink>}
        {canInvite && <NavLink to="/invitar" style={navLinkStyle}>Invitar equipo</NavLink>}
        {canInvite && <NavLink to="/equipo" style={navLinkStyle}>Mi equipo</NavLink>}
        <NavLink to="/unirme" style={navLinkStyle}>Unirme a otra empresa</NavLink>
      </nav>
      <div className="user-info">
        <span>{user?.email}</span>
        {membership && (
          <span className={`badge badge-${membership.role}`}>{membership.role}</span>
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
