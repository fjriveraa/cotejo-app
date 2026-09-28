import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { IconBell } from './icons'
import { SkeletonListRow } from './Skeleton'

const TYPE_ROUTE = {
  payment_pending: '/cola',
  payment_confirmed: '/registrar',
  confirmation_reversed: '/cola',
  risk_flag: '/cola',
  guest_submission: '/comprobantes-invitados'
}

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'ahora'
  if (mins < 60) return `hace ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.floor(hours / 24)
  return `hace ${days} d`
}

// Esto ya existía a medias en la base de datos: un trigger
// (fanout_payment_notification) escribe una fila cada vez que hay un pago
// nuevo por confirmar, se confirma uno, o se revierte una confirmación —
// pero nada en la app lo mostraba nunca. Este componente es la pieza que
// faltaba: leerlas, mostrar cuántas hay sin leer, y marcarlas como leídas.
export default function NotificationBell() {
  const { membership } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!membership) return
    loadUnreadCount()
    const interval = setInterval(loadUnreadCount, 45000)
    return () => clearInterval(interval)
  }, [membership?.id])

  // Cerrar al hacer clic afuera, como cualquier dropdown — si no, se queda
  // abierto tapando la pantalla hasta que alguien note el botón de nuevo.
  useEffect(() => {
    if (!open) return
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  async function loadUnreadCount() {
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('membership_id', membership.id)
      .eq('read', false)
    if (!error) setUnreadCount(count || 0)
  }

  async function loadList() {
    setLoading(true)
    const { data, error } = await supabase
      .from('notifications')
      .select('id, type, title, body, read, created_at, payment_id')
      .eq('membership_id', membership.id)
      .order('created_at', { ascending: false })
      .limit(20)
    setLoading(false)
    if (!error) setNotifications(data || [])
  }

  function toggleOpen() {
    const next = !open
    setOpen(next)
    if (next) loadList()
  }

  async function markRead(notification) {
    if (notification.read) return
    setNotifications((prev) => prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n)))
    setUnreadCount((c) => Math.max(0, c - 1))
    await supabase.from('notifications').update({ read: true }).eq('id', notification.id)
  }

  async function handleNotificationClick(notification) {
    await markRead(notification)
    setOpen(false)
    const route = TYPE_ROUTE[notification.type] || '/cola'
    navigate(route)
  }

  async function markAllRead() {
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id)
    if (unreadIds.length === 0) return
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    setUnreadCount(0)
    await supabase.from('notifications').update({ read: true }).in('id', unreadIds)
  }

  if (!membership) return null

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={toggleOpen}
        aria-label="Notificaciones"
        style={{
          position: 'relative', background: 'none', border: '1px solid var(--border, #e5e0d8)',
          borderRadius: 8, padding: '6px 9px', cursor: 'pointer', display: 'flex', alignItems: 'center'
        }}
      >
        <IconBell width={19} height={19} />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute', top: -5, right: -5, background: '#A2483A', color: 'white',
              fontSize: 10, fontWeight: 700, borderRadius: 999, minWidth: 16, height: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px'
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 320, maxWidth: '90vw',
            maxHeight: 420, overflow: 'auto', background: 'white', zIndex: 60, padding: 12
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ fontSize: 14 }}>Notificaciones</strong>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                style={{ fontSize: 12, background: 'none', border: 'none', color: '#2B6459', cursor: 'pointer', padding: 0 }}
              >
                Marcar todas como leídas
              </button>
            )}
          </div>

          {loading && (
            <div>
              <SkeletonListRow />
              <SkeletonListRow />
              <SkeletonListRow />
            </div>
          )}

          {!loading && notifications.length === 0 && (
            <p className="empty-state" style={{ fontSize: 13 }}>Todavía no tienes notificaciones.</p>
          )}

          {!loading && notifications.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => handleNotificationClick(n)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', background: n.read ? 'transparent' : 'rgba(43, 100, 89, 0.06)',
                border: 'none', borderBottom: '1px solid #eee6da', padding: '8px 6px', cursor: 'pointer'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {!n.read && <span style={{ width: 6, height: 6, borderRadius: 999, background: '#A2483A', flexShrink: 0 }} />}
                <span style={{ fontSize: 13, fontWeight: n.read ? 500 : 700 }}>{n.title}</span>
              </div>
              {n.body && <div style={{ fontSize: 12.5, opacity: 0.75, marginTop: 2 }}>{n.body}</div>}
              <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>{timeAgo(n.created_at)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
