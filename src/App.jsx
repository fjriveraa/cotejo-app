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
import MyIdentification from './pages/MyIdentification'
import AdminVerifications from './pages/AdminVerifications'
import GuestSubmit from './pages/GuestSubmit'
import GuestStatus from './pages/GuestStatus'
import GuestQueue from './pages/GuestQueue'
import Reports from './pages/Reports'
import Landing from './pages/Landing'
import TopBar from './components/TopBar'
import { IconBuilding, IconBriefcase, IconLink, IconSearch } from './components/icons'

const OWNER_ROLES = ['propietario', 'admin']
const QUEUE_ROLES = ['contador', 'propietario', 'supervisor', 'admin', 'auditor']

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
        <div className="card login-card" style={{ maxWidth: 440 }}>
          <h1>¿Cómo vas a usar Cotejo?</h1>
          <p style={{ marginBottom: 20 }}>Elige la opción que mejor te describe.</p>

          <div className="choice-row">
            <Link to="/signup" className="choice-card">
              <IconBuilding width={26} height={26} />
              <span className="choice-title">Tengo una empresa</span>
              <span className="choice-subtitle">Varias personas van a usar Cotejo juntas</span>
            </Link>
            <Link to="/autonomo" className="choice-card">
              <IconBriefcase width={26} height={26} />
              <span className="choice-title">Trabajo por mi cuenta</span>
              <span className="choice-subtitle">Autónomo o comerciante individual</span>
            </Link>
          </div>

          <p style={{ marginTop: 24, marginBottom: 10, fontSize: 13, opacity: 0.65 }}>¿Ya deberías estar en una empresa registrada?</p>
          <Link to="/unirme" className="menu-link" style={{ border: '1px solid var(--border)', borderRadius: 8, marginBottom: 8 }}>
            <IconLink /> Unirme con un enlace de invitación
          </Link>
          <Link to="/empresas" className="menu-link" style={{ border: '1px solid var(--border)', borderRadius: 8, marginBottom: 20 }}>
            <IconSearch /> Buscar una empresa registrada
          </Link>

          <button className="btn btn-ghost" style={{ width: '100%' }} onClick={signOut}>Cerrar sesión e intentar de nuevo</button>
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

function RequireQueueAccess({ children }) {
  const { membership } = useAuth()
  if (!membership || !QUEUE_ROLES.includes(membership.role)) {
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
      {/* La raíz es pública: quien no tiene sesión elige primero qué
          necesita (enviar un comprobante o entrar a su negocio) antes de
          que se le pida cuenta. Con sesión, sigue al flujo normal. */}
      <Route
        path="/"
        element={
          session === undefined ? (
            <LoadingScreen />
          ) : session === null ? (
            <Landing />
          ) : (
            <ProtectedLayout>
              <RoleHome />
            </ProtectedLayout>
          )
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
      <Route
        path="/mi-identificacion"
        element={
          <ProtectedLayout>
            <MyIdentification />
          </ProtectedLayout>
        }
      />
      <Route path="/comprobante" element={<GuestSubmit />} />
      <Route path="/comprobante/estado/:token" element={<GuestStatus />} />
      <Route path="/comprobante/:organizationId" element={<GuestSubmit />} />
      <Route
        path="/comprobantes-invitados"
        element={
          <ProtectedLayout>
            <RequireQueueAccess>
              <GuestQueue />
            </RequireQueueAccess>
          </ProtectedLayout>
        }
      />
      <Route
        path="/reportes"
        element={
          <ProtectedLayout>
            <RequireQueueAccess>
              <Reports />
            </RequireQueueAccess>
          </ProtectedLayout>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
