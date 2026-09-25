import { NavLink } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

const QUEUE_ROLES = ['contador', 'propietario', 'supervisor', 'admin', 'auditor']

const navLinkStyle = ({ isActive }) => ({
  color: isActive ? '#2B6459' : 'inherit',
  fontWeight: isActive ? 600 : 400,
  textDecoration: 'none',
  fontSize: 14
})

export default function TopBar() {
  const { membership, signOut, user } = useAuth()
  const canSeeQueue = membership && QUEUE_ROLES.includes(membership.role)

  return (
    <header className="topbar">
      <div className="brand">Cotejo</div>
      <nav style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <NavLink to="/registrar" style={navLinkStyle}>Registrar pago</NavLink>
        {canSeeQueue && <NavLink to="/cola" style={navLinkStyle}>Cola de confirmación</NavLink>}
      </nav>
      <div className="user-info">
        <span>{user?.email}</span>
        {membership && (
          <span className={`badge badge-${membership.role}`}>{membership.role}</span>
        )}
        {membership?.organizations?.name && (
          <span style={{ opacity: 0.6 }}>{membership.organizations.name}</span>
        )}
        {membership?.branch_name && (
          <span style={{ opacity: 0.6 }}>· {membership.branch_name}</span>
        )}
        <button className="btn btn-ghost" onClick={signOut}>Salir</button>
      </div>
    </header>
  )
}
