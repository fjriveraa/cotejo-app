import { useAuth } from '../hooks/useAuth'

export default function TopBar() {
  const { membership, signOut, user } = useAuth()

  return (
    <header className="topbar">
      <div className="brand">Cotejo</div>
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
