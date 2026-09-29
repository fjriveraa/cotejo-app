import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import {
  IconMenu, IconClose, IconDoc, IconCheckCircle, IconInbox,
  IconShield, IconIdCard, IconLink, IconSearch, IconLogout,
  IconBuilding, IconShare, IconHome, IconBell, IconUsers, IconSettings
} from './icons'
import NotificationBell from './NotificationBell'
import {
  isPushSupported, needsInstallForPush, getExistingPushSubscription,
  subscribeToPush, unsubscribeFromPush
} from '../lib/push'

const QUEUE_ROLES = ['contador', 'propietario', 'supervisor', 'admin', 'auditor']

const VERIFICATION_BADGE = {
  verified: { label: '✓ Verificada', color: '#2B6459' },
  pending: { label: 'Verificación en revisión', color: '#B45309' },
  rejected: { label: 'Verificación rechazada', color: '#B91C1C' }
}

function CountBadge({ count }) {
  if (!count) return null
  return <span className="nav-count">{count > 99 ? '99+' : count}</span>
}

export default function TopBar() {
  const { membership, memberships, switchOrg, signOut, user, isPlatformAdmin } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const showToast = useToast()

  // Cambiar de empresa no navega a ningún lado por sí solo — si la persona
  // estaba en una pantalla que no depende de la empresa (como "Buscar
  // empresas"), no se ve ningún cambio y parece que el selector no hizo
  // nada. Por eso, al cambiar, la llevamos directo al inicio de la empresa
  // recién elegida, para que el cambio se sienta confirmado.
  function handleSwitchOrg(orgId) {
    switchOrg(orgId)
    navigate('/')
  }
  const [menuOpen, setMenuOpen] = useState(false)
  const [pendingPayments, setPendingPayments] = useState(0)
  const [pendingGuests, setPendingGuests] = useState(0)
  const [orgPendingCounts, setOrgPendingCounts] = useState({})
  const [installPromptEvent, setInstallPromptEvent] = useState(null)
  const [isStandalone, setIsStandalone] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)

  // Chrome/Android avisan con este evento cuando la app cumple los requisitos
  // para instalarse (manifest.json + íconos) -- sin capturarlo, no hay forma
  // de disparar el diálogo nativo de instalación desde un botón propio. Si la
  // persona ya la tiene instalada (abierta en modo standalone), no tiene
  // sentido ofrecerle instalarla de nuevo.
  useEffect(() => {
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
    setIsStandalone(standalone)
    function handleBeforeInstallPrompt(e) {
      e.preventDefault()
      setInstallPromptEvent(e)
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
  }, [])

  // Al abrir la app, se revisa si este navegador ya tiene una suscripción
  // push activa (pudo haberse activado en una sesión anterior) para que el
  // botón del menú muestre el estado correcto desde el primer render.
  useEffect(() => {
    if (!isPushSupported()) return
    let cancelled = false
    getExistingPushSubscription().then((sub) => {
      if (!cancelled) setPushEnabled(Boolean(sub))
    })
    return () => { cancelled = true }
  }, [])

  async function handleTogglePush() {
    if (pushBusy) return
    setPushBusy(true)
    try {
      if (pushEnabled) {
        await unsubscribeFromPush()
        setPushEnabled(false)
        showToast('Notificaciones push desactivadas')
      } else if (needsInstallForPush()) {
        showToast('Primero agrega Cotejo a la pantalla de inicio — en iPhone, push solo funciona así', { duration: 4500 })
      } else {
        await subscribeToPush()
        setPushEnabled(true)
        showToast('Notificaciones push activadas', { tone: 'success' })
      }
    } catch (err) {
      console.error('push subscribe error', err)
      if (err?.message === 'permission_denied') {
        showToast('Bloqueaste los permisos de notificación — actívalos desde los ajustes del navegador', { duration: 4500 })
      } else {
        // Mensaje temporal con el detalle técnico -- ayuda a diagnosticar
        // mientras se activa por primera vez en distintos navegadores; una
        // vez confirmado que funciona en todos lados, esto vuelve a un
        // mensaje genérico.
        showToast(`No se pudo activar: ${err?.name || ''} ${err?.message || 'error desconocido'}`, { tone: 'error', duration: 6000 })
      }
    } finally {
      setPushBusy(false)
    }
  }

  // iOS Safari nunca dispara "beforeinstallprompt" -- no existe un diálogo
  // nativo que se pueda invocar desde código ahí, así que la única opción es
  // guiar a la persona a hacerlo manualmente desde el menú de compartir.
  async function handleAddToHome() {
    if (installPromptEvent) {
      installPromptEvent.prompt()
      await installPromptEvent.userChoice
      setInstallPromptEvent(null)
      return
    }
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    showToast(
      isIOS
        ? 'Toca el ícono de compartir de Safari y elige "Agregar a inicio"'
        : 'Buscá "Instalar app" o "Agregar a inicio" en el menú de tu navegador',
      { duration: 4500 }
    )
  }

  // En el teléfono usamos el selector nativo de compartir (WhatsApp, correo,
  // etc. ya instalados); en escritorio ese selector no existe, así que ahí
  // simplemente copiamos el mensaje al portapapeles.
  //
  // El texto y el link van por separado en navigator.share: si el link va
  // adentro del texto Y también en "url", varias apps (Mensajes de iOS
  // incluido) lo agregan dos veces al mensaje final. El texto tampoco puede
  // asumir que quien comparte es una empresa -- una cuenta autónoma pondría
  // ahí su propio nombre de persona ("el control de pagos de Fernando..."),
  // que suena a error, no a invitación.
  async function handleShareCotejo() {
    const shareBody = 'Te recomiendo Cotejo: verifica cada comprobante de pago automáticamente y detecta duplicados o alteraciones antes de que sean un problema. Me ha ahorrado más de un dolor de cabeza.'
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Cotejo', text: shareBody, url: 'https://cotejo.net' })
      } catch {
        // La persona cerró el selector de compartir -- no es un error real.
      }
      return
    }
    try {
      await navigator.clipboard.writeText(`${shareBody} https://cotejo.net`)
      showToast('Copiado — pégalo donde quieras', { tone: 'success' })
    } catch {
      showToast('No se pudo copiar', { tone: 'error' })
    }
  }

  const canSeeQueue = membership && QUEUE_ROLES.includes(membership.role)
  // Solo el propietario puede certificar legalmente la empresa — un admin
  // que solo la configuró no debería ver esta opción como si pudiera usarla.
  const canVerify = membership && membership.role === 'propietario'
  const verificationStatus = membership?.organizations?.verification_status
  const verificationBadge = VERIFICATION_BADGE[verificationStatus]

  // El menú se cierra solo al cambiar de página, para no dejarlo abierto
  // tapando la pantalla después de que la persona ya eligió a dónde ir.
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!canSeeQueue || !membership) {
      setPendingPayments(0)
      setPendingGuests(0)
      return
    }
    let cancelled = false
    async function loadCounts() {
      const [{ count: paymentsCount }, { count: guestsCount }] = await Promise.all([
        supabase
          .from('payment_records')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', membership.organization_id)
          .in('verification_status', ['pending', 'under_review']),
        supabase
          .from('guest_submissions')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', membership.organization_id)
          .eq('status', 'pending')
      ])
      if (!cancelled) {
        setPendingPayments(paymentsCount || 0)
        setPendingGuests(guestsCount || 0)
      }
    }
    loadCounts()
    const interval = setInterval(loadCounts, 45000)
    return () => { cancelled = true; clearInterval(interval) }
    // location.pathname entra como dependencia para que, al salir de "Cola" o
    // "Invitados" justo después de confirmar/rechazar algo, el número del
    // badge se recalcule de inmediato en vez de esperar hasta 45s.
  }, [canSeeQueue, membership?.organization_id, location.pathname])

  // La persona puede pertenecer a varias empresas a la vez (por ejemplo, un
  // contador que lleva la contabilidad de varios clientes). El contador de
  // "Cola" de arriba solo mira la empresa activa — esto además calcula
  // cuántos comprobantes esperan revisión en CADA empresa donde tiene un rol
  // que puede revisar, para que el menú le muestre dónde falta trabajo sin
  // tener que ir cambiando de empresa una por una para averiguarlo.
  useEffect(() => {
    const queueMemberships = (memberships || []).filter((m) => QUEUE_ROLES.includes(m.role))
    if (queueMemberships.length === 0) {
      setOrgPendingCounts({})
      return
    }
    let cancelled = false
    async function loadAllCounts() {
      const results = await Promise.all(
        queueMemberships.map((m) =>
          supabase
            .from('payment_records')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', m.organization_id)
            .in('verification_status', ['pending', 'under_review'])
            .then(({ count }) => [m.organization_id, count || 0])
        )
      )
      if (!cancelled) setOrgPendingCounts(Object.fromEntries(results))
    }
    loadAllCounts()
    const interval = setInterval(loadAllCounts, 45000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [memberships])

  function handleGoToCompanyQueue(orgId) {
    if (orgId !== membership?.organization_id) switchOrg(orgId)
    navigate('/cola')
    setMenuOpen(false)
  }

  return (
    <header className="topbar">
      <div className="topbar-top">
        <img src="/logo.png" alt="Cotejo" className="brand" style={{ height: 24, width: 'auto' }} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <NotificationBell />
          <button
            type="button"
            className="menu-toggle"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <IconClose /> : <IconMenu />}
            Menú
          </button>
        </div>
      </div>

      {/* Antes esto vivía abajo del todo, como un detalle chico y fácil de
          pasar por alto -- por eso alguien terminó registrando pagos en una
          sucursal pensando que estaba en la empresa principal. Ahora es lo
          primero que se ve, con suficiente peso visual para que el contexto
          (en cuál empresa, con qué rol) nunca quede en duda. */}
      {membership && (
        <div className="working-in-banner">
          <IconBuilding width={15} height={15} style={{ flexShrink: 0, opacity: 0.7 }} />
          <span style={{ opacity: 0.7 }}>Trabajando en</span>
          {memberships.length > 1 ? (
            <select
              value={membership?.organization_id || ''}
              onChange={(e) => handleSwitchOrg(e.target.value)}
              className="org-select"
            >
              {memberships.map((m) => (
                <option key={m.organization_id} value={m.organization_id}>
                  {m.organizations?.name || 'Empresa'}
                </option>
              ))}
            </select>
          ) : (
            <strong className="org-name">{membership.organizations?.name}</strong>
          )}
          <span className={`badge badge-${membership.role}`}>{membership.role}</span>
        </div>
      )}

      <nav className="topbar-primary">
        <NavLink to="/registrar" className={({ isActive }) => `nav-pill nav-pill-primary${isActive ? ' active' : ''}`}>
          <IconDoc /> Registrar pago
        </NavLink>
        {canSeeQueue && (
          <NavLink to="/cola" className={({ isActive }) => `nav-pill${isActive ? ' active' : ''}`}>
            <IconCheckCircle /> Cola de confirmación <CountBadge count={pendingPayments} />
          </NavLink>
        )}
        {canSeeQueue && (
          <NavLink to="/comprobantes-invitados" className={({ isActive }) => `nav-pill${isActive ? ' active' : ''}`}>
            <IconInbox /> Comprobantes de invitados <CountBadge count={pendingGuests} />
          </NavLink>
        )}
        {canSeeQueue && (
          <NavLink to="/grupos" className={({ isActive }) => `nav-pill${isActive ? ' active' : ''}`}>
            <IconUsers /> Grupos
          </NavLink>
        )}
      </nav>

      {menuOpen && (
        <>
          <button type="button" className="menu-overlay" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />
          <div className="menu-drawer">
            <div className="menu-account-card">
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{membership?.organizations?.name}</div>
              {/* El correo de contacto de la empresa (informativo, no una
                  credencial) es lo que identifica a esta empresa de un
                  vistazo -- el correo real con el que entraste queda debajo,
                  más chico, para no perder de vista quién hizo la acción. */}
              <div style={{ fontSize: 12.5, opacity: 0.65, marginTop: 2 }}>
                {membership?.organizations?.contact_email || user?.email}
              </div>
              {membership?.organizations?.contact_email && membership.organizations.contact_email !== user?.email && (
                <div style={{ fontSize: 11, opacity: 0.5, marginTop: 1 }}>conectado como {user?.email}</div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                {membership?.branch_name && (
                  <span style={{ fontSize: 12, opacity: 0.6 }}>{membership.branch_name}</span>
                )}
                {verificationBadge && (
                  <span style={{ fontSize: 12, fontWeight: 600, color: verificationBadge.color }}>{verificationBadge.label}</span>
                )}
              </div>
            </div>

            {memberships.length > 1 && (
              <div className="menu-section">
                <div className="menu-section-title">Mis empresas</div>
                {/* Solo tiene sentido ver todo mezclado desde la cuenta personal
                    (autónomo) -- entrando a una empresa puntual, lo esperado es
                    ver nada más lo de esa empresa. */}
                {membership?.organizations?.org_type === 'autonomo' && memberships.filter((m) => QUEUE_ROLES.includes(m.role)).length > 1 && (
                  <NavLink to="/todos-los-comprobantes" className="menu-link">
                    <IconCheckCircle /> Ver todos los comprobantes juntos
                  </NavLink>
                )}
                {memberships.map((m) => {
                  const isQueueRole = QUEUE_ROLES.includes(m.role)
                  const count = orgPendingCounts[m.organization_id] || 0
                  const isActive = m.organization_id === membership?.organization_id
                  return (
                    <button
                      key={m.organization_id}
                      type="button"
                      className="menu-link"
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        width: '100%', background: isActive ? 'rgba(43, 100, 89, 0.06)' : 'transparent'
                      }}
                      onClick={() => handleGoToCompanyQueue(m.organization_id)}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <IconBuilding width={16} height={16} style={{ flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.organizations?.name || 'Empresa'}
                        </span>
                        <span style={{ fontSize: 11, opacity: 0.6, flexShrink: 0 }}>· {m.role}</span>
                      </span>
                      {isQueueRole && count > 0 && <CountBadge count={count} />}
                    </button>
                  )
                })}
              </div>
            )}

            {canSeeQueue && (
              <div className="menu-section">
                <div className="menu-section-title">Empresa</div>
                {/* Equipo, cuentas, invitaciones, solicitudes y reportes vivían
                    como links sueltos acá -- ahora son una sola pantalla que
                    junta todo lo que le pertenece a esta empresa. */}
                <NavLink to="/empresa" className="menu-link"><IconBuilding /> Mi empresa</NavLink>
                {/* Una vez verificada, este paso ya se hizo — no tiene sentido seguir
                    mostrándolo junto a las tareas recurrentes del día a día. */}
                {canVerify && verificationStatus !== 'verified' && (
                  <NavLink to="/verificar" className="menu-link"><IconShield /> Verificar mi empresa</NavLink>
                )}
              </div>
            )}

            <div className="menu-section">
              <div className="menu-section-title">Cuenta</div>
              <NavLink to="/mi-identificacion" className="menu-link"><IconIdCard /> Mi identificación</NavLink>
              <NavLink to="/unirme" className="menu-link"><IconLink /> Unirme a otra empresa</NavLink>
              <NavLink to="/empresas" className="menu-link"><IconSearch /> Buscar empresas</NavLink>
              <NavLink to="/ajustes" className="menu-link"><IconSettings /> Ajustes</NavLink>
            </div>

            <div className="menu-section">
              <button type="button" className="menu-link" onClick={handleShareCotejo}>
                <IconShare /> Compartir Cotejo
              </button>
              {!isStandalone && (
                <button type="button" className="menu-link" onClick={handleAddToHome}>
                  <IconHome /> Agregar a inicio
                </button>
              )}
              {isPushSupported() && (
                <button type="button" className="menu-link" onClick={handleTogglePush} disabled={pushBusy}>
                  <IconBell /> {pushEnabled ? 'Desactivar notificaciones push' : 'Activar notificaciones push'}
                </button>
              )}
            </div>

            {isPlatformAdmin && (
              <div className="menu-section">
                <div className="menu-section-title">Administración</div>
                <NavLink to="/admin/verificaciones" className="menu-link"><IconShield /> Verificaciones</NavLink>
              </div>
            )}

            <div className="menu-section">
              <button type="button" className="menu-link menu-link-danger" onClick={signOut}>
                <IconLogout /> Cerrar sesión
              </button>
            </div>
          </div>
        </>
      )}

      <nav className="bottom-tabbar">
        <NavLink to="/registrar" className={({ isActive }) => `tabbar-item tabbar-item-primary${isActive ? ' active' : ''}`}>
          <IconDoc width={21} height={21} />
          <span>Registrar</span>
        </NavLink>
        {canSeeQueue && (
          <NavLink to="/cola" className={({ isActive }) => `tabbar-item${isActive ? ' active' : ''}`}>
            <span className="tabbar-icon-wrap">
              <IconCheckCircle width={21} height={21} />
              <CountBadge count={pendingPayments} />
            </span>
            <span>Cola</span>
          </NavLink>
        )}
        {canSeeQueue && (
          <NavLink to="/comprobantes-invitados" className={({ isActive }) => `tabbar-item${isActive ? ' active' : ''}`}>
            <span className="tabbar-icon-wrap">
              <IconInbox width={21} height={21} />
              <CountBadge count={pendingGuests} />
            </span>
            <span>Invitados</span>
          </NavLink>
        )}
        {canSeeQueue && (
          <NavLink to="/grupos" className={({ isActive }) => `tabbar-item${isActive ? ' active' : ''}`}>
            <IconUsers width={21} height={21} />
            <span>Grupos</span>
          </NavLink>
        )}
      </nav>
    </header>
  )
}
