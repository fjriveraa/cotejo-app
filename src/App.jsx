import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Join from './pages/Join'
import EmployeeDashboard from './pages/EmployeeDashboard'
import AccountantQueue from './pages/AccountantQueue'
import InviteTeam from './pages/InviteTeam'
import TopBar from './components/TopBar'

const OWNER_ROLES = ['propietario', 'admin']

function LoadingScreen() {
  return (
    <div className="login-wrap">
      <p style={{ opacity: 0.6 }}>Cargando...</p>
    </div>
  )
}

function RoleHome() {
  const { membership } = useAuth()
  if (!membership) return <LoadingScreen />
  if (membership.role === 'empleado') return <Navigate to="/registrar" replace />
  if (['contador', 'propietario', 'supervisor', 'admin', 'auditor'].includes(membership.role)) {
    return <Navigate to="/cola" replace />
  }
  return <Navigate to="/registrar" replace />
}

function ErrorScreen({ message }) {
  const { signOut } = useAuth()
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1>No se pudo cargar tu cuenta</h1>
        <p className="error-text" style={{ marginBottom: 16 }}>{message}</p>
        <button className="btn btn-secondary" onClick={signOut}>Cerrar sesión e intentar de nuevo</button>
      </div>
    </div>
  )
}

function ProtectedLayout({ children }) {
  const { session, membership, isLoading, membershipError } = useAuth()

  if (session === undefined) return <LoadingScreen />
  if (session === null) return <Navigate to="/login" replace />
  if (isLoading) return <LoadingScreen />
  if (membershipError) return <ErrorScreen message={membershipError} />
  if (!membership) return <ErrorScreen message="No se encontró tu cuenta." />

  return (
    <div className="app-shell">
      <TopBar />
      {children}
    </div>
  )
}

function RequireOwner({ children }) {
  const { membership } = useAuth()
  if (!membership || !OWNER_ROLES.includes(membership.role)) {
    return <Navigate to="/" replace />
  }
  return children
}

export default function App() {
  const { session } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/signup" element={session ? <Navigate to="/" replace /> : <Signup />} />
      <Route path="/join/:token" element={<Join />} />
      <Route
        path="/"
        element={
          <ProtectedLayout>
            <RoleHome />
          </ProtectedLayout>
        }
      />
      <Route
        path="/registrar"
        element={
          <ProtectedLayout>
            <EmployeeDashboard />
          </ProtectedLayout>
        }
      />
      <Route
        path="/cola"
        element={
          <ProtectedLayout>
            <AccountantQueue />
          </ProtectedLayout>
        }
      />
      <Route
        path="/invitar"
        element={
          <ProtectedLayout>
            <RequireOwner>
              <InviteTeam />
            </RequireOwner>
          </ProtectedLayout>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
