import { Routes, Route, Navigate, Link } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Join from './pages/Join'
import EmployeeDashboard from './pages/EmployeeDashboard'
import AccountantQueue from './pages/AccountantQueue'
import InviteTeam from './pages/InviteTeam'
import Team from './pages/Team'
import JoinManual from './pages/JoinManual'
import Directory from './pages/Directory'
import JoinRequests from './pages/JoinRequests'
import Autonomo from './pages/Autonomo'
import Verify from './pages/Verify'
import AdminVerifications from './pages/AdminVerifications'
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
  const isNoMembership = message === 'Tu usuario no tiene una membresía activa en ninguna organización.'

  if (isNoMembership) {
    return (
      <div className="login-wrap">
        <div className="card login-card">
          <h1>Todavía no tienes empresa en Cotejo</h1>
          <p style={{ marginBottom: 20 }}>Elige una opción para continuar:</p>
          <Link to="/signup" className="btn btn-primary" style={{ width: '100%', display: 'block', textAlign: 'center', marginBottom: 12, textDecoration: 'none' }}>
            Crear mi empresa
          </Link>
          <Link to="/unirme" className="btn btn-secondary" style={{ width: '100%', display: 'block', textAlign: 'center', marginBottom: 12, textDecoration: 'none' }}>
            Unirme a una empresa con un enlace
          </Link>
          <Link to="/empresas" className="btn btn-secondary" style={{ width: '100%', display: 'block', textAlign: 'center', marginBottom: 12, textDecoration: 'none' }}>
            Buscar una empresa registrada
          </Link>
          <Link to="/autonomo" className="btn btn-secondary" style={{ width: '100%', display: 'block', textAlign: 'center', marginBottom: 20, textDecoration: 'none' }}>
            Trabajar como autónomo / comerciante individual
          </Link>
          <button className="btn btn-secondary" style={{ width: '100%' }} onClick={signOut}>Cerrar sesión e intentar de nuevo</button>
        </div>
      </div>
    )
  }

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

function RequirePlatformAdmin({ children }) {
  const { isPlatformAdmin, loadingPlatformAdmin } = useAuth()
  if (loadingPlatformAdmin) return <LoadingScreen />
  if (!isPlatformAdmin) {
    return <Navigate to="/" replace />
  }
  return children
}

// A diferencia de ProtectedLayout, no exige ya tener una empresa — sirve
// tanto para alguien que ya tiene una y quiere sumarse a otra, como para
// alguien que todavía no tiene ninguna.
function RequireSessionLayout({ children }) {
  const { session, isLoading } = useAuth()
  if (session === undefined) return <LoadingScreen />
  if (session === null) return <Navigate to="/login" replace />
  if (isLoading) return <LoadingScreen />
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
      {/* /signup decide por sí mismo qué mostrar: si hay sesión pero sin
          empresa (por ejemplo, entró con Google), tiene que poder abrirse
          igual. Solo Login se cierra automáticamente con sesión. */}
      <Route path="/signup" element={<Signup />} />
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
      <Route
        path="/equipo"
        element={
          <ProtectedLayout>
            <RequireOwner>
              <Team />
            </RequireOwner>
          </ProtectedLayout>
        }
      />
      <Route
        path="/unirme"
        element={
          <RequireSessionLayout>
            <JoinManual />
          </RequireSessionLayout>
        }
      />
      <Route
        path="/empresas"
        element={
          <RequireSessionLayout>
            <Directory />
          </RequireSessionLayout>
        }
      />
      <Route
        path="/solicitudes"
        element={
          <ProtectedLayout>
            <RequireOwner>
              <JoinRequests />
            </RequireOwner>
          </ProtectedLayout>
        }
      />
      <Route
        path="/autonomo"
        element={
          <RequireSessionLayout>
            <Autonomo />
          </RequireSessionLayout>
        }
      />
      <Route
        path="/verificar"
        element={
          <ProtectedLayout>
            <RequireOwner>
              <Verify />
            </RequireOwner>
          </ProtectedLayout>
        }
      />
      <Route
        path="/admin/verificaciones"
        element={
          <ProtectedLayout>
            <RequirePlatformAdmin>
              <AdminVerifications />
            </RequirePlatformAdmin>
          </ProtectedLayout>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
