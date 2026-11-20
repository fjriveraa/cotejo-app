import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import AccountantQueue from './AccountantQueue'
import GuestQueue from './GuestQueue'
import RecentActivity from './RecentActivity'

// "Actividad": una sola sección con dos partes.
//  - Por hacer: lo que espera confirmación (pagos del equipo y comprobantes de
//    clientes sin cuenta), cada cosa desaparece sola al resolverse.
//  - Reciente: lo que ya pasó en los últimos 7 días (antes vivía en la campana).
// Se abre en "Por hacer" si hay algo pendiente; si todo está al día, en
// "Reciente", para que la pantalla siempre tenga algo útil que mostrar.
export default function QueueHub() {
  const { membership } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const orgId = membership?.organization_id
  const explicitGuests = location.pathname.startsWith('/comprobantes-invitados')
  const [tab, setTab] = useState(explicitGuests ? 'hacer' : null)
  const [sub, setSub] = useState(explicitGuests ? 'invitados' : null)
  const [counts, setCounts] = useState({ pagos: null, invitados: null })
  const [unseen, setUnseen] = useState(0)

  async function loadCounts() {
    if (!orgId) return null
    const [{ count: p }, { count: g }, { count: u }] = await Promise.all([
      supabase.from('payment_records').select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId).in('verification_status', ['pending', 'under_review']),
      supabase.from('guest_submissions').select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId).eq('status', 'pending'),
      supabase.from('notifications').select('id', { count: 'exact', head: true })
        .eq('membership_id', membership.id).eq('read', false)
        .not('type', 'in', '(payment_pending,guest_submission)')
    ])
    const c = { pagos: p || 0, invitados: g || 0 }
    setCounts(c)
    setUnseen(u || 0)
    return c
  }

  useEffect(() => {
    loadCounts().then((c) => {
      if (!c) return
      if (!sub) setSub(c.pagos === 0 && c.invitados > 0 ? 'invitados' : 'pagos')
      if (!tab) setTab(c.pagos + c.invitados > 0 ? 'hacer' : 'reciente')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  useEffect(() => {
    const h = () => loadCounts()
    window.addEventListener('cotejo:queue-changed', h)
    return () => window.removeEventListener('cotejo:queue-changed', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  const pending = (counts.pagos || 0) + (counts.invitados || 0)

  function chooseSub(next) {
    setSub(next)
    navigate(next === 'invitados' ? '/comprobantes-invitados' : '/cola', { replace: true })
    loadCounts()
  }

  const Seg = ({ id, label, count, dot }) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`seg-item${tab === id ? ' active' : ''}`}
      aria-pressed={tab === id}
    >
      {label}
      {count > 0 && <span className="seg-count">{count}</span>}
      {dot && <span className="seg-dot" aria-label="Novedades" />}
    </button>
  )

  return (
    <>
      <div className="container seg-container">
        <div className="seg-control">
          <Seg id="hacer" label="Por hacer" count={pending} />
          <Seg id="reciente" label="Reciente" dot={unseen > 0 && tab !== 'reciente'} />
        </div>
        {tab === 'hacer' && (
          <div className="sub-pills">
            <button type="button" className={`sub-pill${sub === 'pagos' ? ' active' : ''}`} onClick={() => chooseSub('pagos')}>
              Pagos del equipo{counts.pagos > 0 && <b>{counts.pagos}</b>}
            </button>
            <button type="button" className={`sub-pill${sub === 'invitados' ? ' active' : ''}`} onClick={() => chooseSub('invitados')}>
              Clientes invitados{counts.invitados > 0 && <b>{counts.invitados}</b>}
            </button>
          </div>
        )}
      </div>
      {tab === 'reciente' && <RecentActivity onSeen={() => setUnseen(0)} />}
      {tab === 'hacer' && (sub === 'invitados' ? <GuestQueue embedded /> : <AccountantQueue embedded />)}
    </>
  )
}
