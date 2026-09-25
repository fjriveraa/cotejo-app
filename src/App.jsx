import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import Login from './pages/Login'
import EmployeeDashboard from './pages/EmployeeDashboard'
import AccountantQueue from './pages/AccountantQueue'
import TopBar from './components/TopBar'

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

function ProtectedLayout({ children }) {
  const { session, membership, isLoading } = useAuth()

  if (session === undefined) return <LoadingScreen />
  if (session === null) return <Navigate to="/login" replace />
  if (isLoading || !membership) return <LoadingScreen />

  return (
    <div className="app-shell">
      <TopBar />
      {children}
    </div>
  )
}

export default function App() {
  const { session } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
