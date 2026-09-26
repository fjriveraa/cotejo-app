import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { IconDoc, IconCheckCircle, IconInbox, IconShield } from '../components/icons'

// Mensajes de verificación: solo se muestran cuando hace falta actuar
// (pendiente o rechazada). Una vez verificada, esta alerta desaparece sola.
const VERIFICATION_ALERTS = {
  pending: { text: 'Tu empresa está en revisión. Te avisamos apenas quede verificada.', color: '#B45309', bg: '#FEF3C7' },
  rejected: { text: 'La verificación de tu empresa fue rechazada. Revisa los documentos y vuelve a enviarlos.', color: '#B91C1C', bg: '#FEE2E2' }
}

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Buenos días'
  if (hour < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

// Punto de partida real al entrar a Cotejo: un vistazo de la situación
// antes de meterse a trabajar, en vez de aterrizar directo en una bandeja
// de pendientes sin contexto.
export default function Dashboard() {
  const { membership } = useAuth()
  const [counts, setCounts] = useState({ payments: 0, guests: 0, confirmedToday: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!membership) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)

      const [{ count: payments }, { count: guests }, { count: confirmedToday }] = await Promise.all([
        supabase
          .from('payment_records')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', membership.organization_id)
          .in('verification_status', ['pending', 'under_review']),
        supabase
          .from('guest_submissions')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', membership.organization_id)
          .eq('status', 'pending'),
        supabase
          .from('payment_records')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', membership.organization_id)
          .eq('verification_status', 'confirmed_manual')
          .gte('verified_at', todayStart.toISOString())
      ])

      if (!cancelled) {
        setCounts({ payments: payments || 0, guests: guests || 0, confirmedToday: confirmedToday || 0 })
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [membership?.organization_id])

  const verificationStatus = membership?.organizations?.verification_status
  const verificationAlert = VERIFICATION_ALERTS[verificationStatus]
  const totalPending = counts.payments + counts.guests

  return (
    <div className="container">
      <h2 style={{ marginTop: 0, marginBottom: 4 }}>{greeting()}</h2>
      <p style={{ opacity: 0.65, fontSize: 14, marginTop: 0, marginBottom: 24 }}>
        Esto es lo que pasa hoy en {membership?.organizations?.name || 'tu empresa'}.
      </p>

      {verificationAlert && (
        <div
          className="card"
          style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, background: verificationAlert.bg, borderColor: 'transparent' }}
        >
          <IconShield width={20} height={20} style={{ color: verificationAlert.color, flexShrink: 0 }} />
          <span style={{ fontSize: 13.5, fontWeight: 600, color: verificationAlert.color }}>{verificationAlert.text}</span>
        </div>
      )}

      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-value">{loading ? '—' : counts.payments}</div>
          <div className="stat-label">Pagos por confirmar</div>
        </div>
        <div className="stat-tile">
          <div className="stat-value">{loading ? '—' : counts.guests}</div>
          <div className="stat-label">Comprobantes de invitados</div>
        </div>
        <div className="stat-tile stat-tile-accent">
          <div className="stat-value">{loading ? '—' : counts.confirmedToday}</div>
          <div className="stat-label">Confirmados hoy</div>
        </div>
      </div>

      {!loading && totalPending === 0 && (
        <p style={{ fontSize: 13.5, opacity: 0.65, marginTop: -6, marginBottom: 24 }}>
          Todo al día — no hay nada pendiente de revisar en este momento.
        </p>
      )}

      <div className="group-header" style={{ marginTop: 8 }}>Accesos directos</div>
      <div className="quick-actions">
        <Link to="/registrar" className="quick-action quick-action-primary">
          <IconDoc width={22} height={22} />
          <span>Registrar pago</span>
        </Link>
        <Link to="/cola" className="quick-action">
          <IconCheckCircle width={22} height={22} />
          <span>Cola de confirmación</span>
          {counts.payments > 0 && <span className="nav-count">{counts.payments > 99 ? '99+' : counts.payments}</span>}
        </Link>
        <Link to="/comprobantes-invitados" className="quick-action">
          <IconInbox width={22} height={22} />
          <span>Comprobantes de invitados</span>
          {counts.guests > 0 && <span className="nav-count">{counts.guests > 99 ? '99+' : counts.guests}</span>}
        </Link>
      </div>
    </div>
  )
}
