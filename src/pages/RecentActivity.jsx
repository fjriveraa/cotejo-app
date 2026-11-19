import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { SkeletonListRow } from '../components/Skeleton'
import { IconBell } from '../components/icons'

// Lo que ya pasó, de los últimos 7 días: pagos confirmados, confirmaciones
// revertidas, alertas. Los avisos de "hay algo por confirmar" no se muestran
// aquí porque ya viven (y desaparecen solos al resolverse) en "Por hacer".
const HIDDEN_TYPES = ['payment_pending', 'guest_submission']
const TYPE_LOOK = {
  payment_confirmed: { icon: '✓', bg: 'rgba(43,100,89,0.14)', fg: '#2B6459' },
  confirmation_reversed: { icon: '↺', bg: 'rgba(185,129,47,0.18)', fg: '#8A5A00' },
  risk_flag: { icon: '!', bg: 'rgba(162,72,58,0.14)', fg: '#A2483A' },
  attendance_reminder: { icon: '⏱', bg: 'rgba(42,38,32,0.08)', fg: 'inherit' }
}

function timeLabel(dateStr) {
  return new Date(dateStr).toLocaleTimeString('es-HN', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Tegucigalpa' })
}
function dayKey(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-CA', { timeZone: 'America/Tegucigalpa' })
}
function dayTitle(key, todayKey, yesterdayKey) {
  if (key === todayKey) return 'Hoy'
  if (key === yesterdayKey) return 'Ayer'
  return new Date(`${key}T12:00:00`).toLocaleDateString('es-HN', { weekday: 'long', day: 'numeric', month: 'short' })
}

export default function RecentActivity({ onSeen }) {
  const { membership } = useAuth()
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!membership) return
    let cancelled = false
    ;(async () => {
      const since = new Date(Date.now() - 7 * 86400000).toISOString()
      const { data, error: err } = await supabase
        .from('notifications')
        .select('id, type, title, body, read, created_at')
        .eq('membership_id', membership.id)
        .not('type', 'in', `(${HIDDEN_TYPES.join(',')})`)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(100)
      if (cancelled) return
      if (err) { setError('No se pudo cargar la actividad. Revisa tu conexión.'); setItems([]); return }
      setItems(data || [])
      // Al abrir la sección, lo informativo se da por visto.
      const unread = (data || []).filter((n) => !n.read).map((n) => n.id)
      if (unread.length) {
        await supabase.from('notifications').update({ read: true }).in('id', unread)
        onSeen && onSeen()
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membership?.id])

  const todayKey = dayKey(new Date().toISOString())
  const yesterdayKey = dayKey(new Date(Date.now() - 86400000).toISOString())

  if (items === null) {
    return <div className="container"><SkeletonListRow /><SkeletonListRow /><SkeletonListRow /></div>
  }

  const groups = []
  items.forEach((n) => {
    const k = dayKey(n.created_at)
    const last = groups[groups.length - 1]
    if (last && last.key === k) last.rows.push(n)
    else groups.push({ key: k, rows: [n] })
  })

  return (
    <div className="container">
      {error && <p className="error-text">{error}</p>}
      {!error && items.length === 0 && (
        <div className="empty-state-friendly">
          <IconBell width={34} height={34} />
          <div className="title">Todo tranquilo</div>
          <div className="subtitle">Aquí verás los pagos confirmados, revertidos y las alertas de los últimos 7 días.</div>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.key} style={{ marginBottom: 18 }}>
          <div className="activity-day">{dayTitle(g.key, todayKey, yesterdayKey)}</div>
          <div className="card activity-card">
            {g.rows.map((n) => {
              const look = TYPE_LOOK[n.type] || { icon: '•', bg: 'rgba(42,38,32,0.08)', fg: 'inherit' }
              return (
                <div key={n.id} className="activity-row">
                  <span className="activity-icon" style={{ background: look.bg, color: look.fg }}>{look.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{n.title}</div>
                    {n.body && <div style={{ fontSize: 12.5, opacity: 0.7, marginTop: 2 }}>{n.body}</div>}
                  </div>
                  <span style={{ fontSize: 11.5, opacity: 0.55, whiteSpace: 'nowrap' }}>{timeLabel(n.created_at)}</span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
