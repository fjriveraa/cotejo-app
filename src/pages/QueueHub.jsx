import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import AccountantQueue from './AccountantQueue'
import GuestQueue from './GuestQueue'

// Una sola bandeja para lo que hay que confirmar: pagos registrados por el
// equipo y comprobantes enviados por clientes sin cuenta. Antes eran dos
// pantallas separadas con el mismo trabajo (revisar y confirmar).
//
// Qué pestaña se abre: la que se pidió (/comprobantes-invitados abre
// "Invitados", p. ej. desde una notificación); si no se pidió ninguna, la que
// tenga cosas pendientes, empezando por pagos.
export default function QueueHub() {
  const { membership } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const orgId = membership?.organization_id
  const explicit = location.pathname.startsWith('/comprobantes-invitados') ? 'invitados' : null
  const [tab, setTab] = useState(explicit)
  const [counts, setCounts] = useState({ pagos: null, invitados: null })

  async function loadCounts() {
    if (!orgId) return
    const [{ count: p }, { count: g }] = await Promise.all([
      supabase.from('payment_records').select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId).in('verification_status', ['pending', 'under_review']),
      supabase.from('guest_submissions').select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId).eq('status', 'pending')
    ])
    setCounts({ pagos: p || 0, invitados: g || 0 })
    return { pagos: p || 0, invitados: g || 0 }
  }

  useEffect(() => {
    setTab(explicit)
    loadCounts().then((c) => {
      if (!explicit && c) setTab(c.pagos === 0 && c.invitados > 0 ? 'invitados' : 'pagos')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, explicit])

  function choose(next) {
    setTab(next)
    navigate(next === 'invitados' ? '/comprobantes-invitados' : '/cola', { replace: true })
    loadCounts()
  }

  const Seg = ({ id, label, count }) => (
    <button
      type="button"
      onClick={() => choose(id)}
      className={`btn ${tab === id ? '' : 'btn-secondary'}`}
      style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6 }}
    >
      {label}
      {count > 0 && <span className="nav-count" style={{ position: 'static' }}>{count}</span>}
    </button>
  )

  return (
    <>
      <div className="container" style={{ paddingBottom: 0 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Seg id="pagos" label="Pagos del equipo" count={counts.pagos} />
          <Seg id="invitados" label="De clientes (invitados)" count={counts.invitados} />
        </div>
      </div>
      {tab === 'invitados' ? <GuestQueue /> : tab === 'pagos' ? <AccountantQueue /> : null}
    </>
  )
}
