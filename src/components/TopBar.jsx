import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import {
  IconMenu, IconClose, IconDoc, IconCheckCircle, IconInbox, IconChart,
  IconUsers, IconMail, IconShield, IconIdCard, IconLink, IconSearch, IconLogout
} from './icons'

const QUEUE_ROLES = ['contador', 'propietario', 'supervisor', 'admin', 'auditor']
const OWNER_ROLES = ['propietario', 'admin']

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

  const canSeeQueue = membership && QUEUE_ROLES.includes(membership.role)
  const canInvite = membership && OWNER_ROLES.includes(membership.role)
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
  }, [canSeeQueue, membership?.organization_id])

  return (
    <header className="topbar">
      <div className="topbar-top">
        <div className="brand">Cotejo</div>
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
      </nav>

      {menuOpen && (
        <>
          <button type="button" className="menu-overlay" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />
          <div className="menu-drawer">
            <div className="menu-account-card">
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{membership?.organizations?.name}</div>
              <div style={{ fontSize: 12.5, opacity: 0.65, marginTop: 2 }}>{user?.email}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                {membership?.branch_name && (
                  <span style={{ fontSize: 12, opacity: 0.6 }}>{membership.branch_name}</span>
                )}
                {verificationBadge && (
                  <span style={{ fontSize: 12, fontWeight: 600, color: verificationBadge.color }}>{verificationBadge.label}</span>
                )}
              </div>
            </div>

            {canSeeQueue && (
              <div className="menu-section">
                <div className="menu-section-title">Empresa</div>
                <NavLink to="/reportes" className="menu-link"><IconChart /> Reportes</NavLink>
                {canInvite && <NavLink to="/equipo" className="menu-link"><IconUsers /> Mi equipo</NavLink>}
                {canInvite && <NavLink to="/invitar" className="menu-link"><IconMail /> Invitar equipo</NavLink>}
                {canInvite && <NavLink to="/solicitudes" className="menu-link"><IconInbox /> Solicitudes</NavLink>}
                {/* Una vez verificada, este paso ya se hizo — no tiene sentido seguir
                    mostrándolo junto a las tareas recurrentes del día a día. */}
                {canInvite && verificationStatus !== 'verified' && (
                  <NavLink to="/verificar" className="menu-link"><IconShield /> Verificar mi empresa</NavLink>
                )}
              </div>
            )}

            <div className="menu-section">
              <div className="menu-section-title">Cuenta</div>
              <NavLink to="/mi-identificacion" className="menu-link"><IconIdCard /> Mi identificación</NavLink>
              <NavLink to="/unirme" className="menu-link"><IconLink /> Unirme a otra empresa</NavLink>
              <NavLink to="/empresas" className="menu-link"><IconSearch /> Buscar empresas</NavLink>
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

      <div className="user-info">
        {membership?.organizations?.name && (
          memberships.length > 1 ? (
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
            <span className="org-name">{membership.organizations.name}</span>
          )
        )}
        {membership && <span className={`badge badge-${membership.role}`}>{membership.role}</span>}
      </div>

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
      </nav>
    </header>
  )
}
