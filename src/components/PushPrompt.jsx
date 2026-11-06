import { useEffect, useState } from 'react'
import { isPushSupported, needsInstallForPush, getExistingPushSubscription, subscribeToPush } from '../lib/push'
import { isNativePushSupported, getNativePushStatus, registerNativePush } from '../lib/nativePush'

const DISMISS_KEY = 'cotejo_push_prompt_dismissed_at'
const HOURS_QUIET = 12

// Aviso para quien aún no tiene activadas las notificaciones push: sin ellas no le llegan
// los recordatorios de marcar entrada, almuerzo y salida (solo le quedaría el correo).
export default function PushPrompt({ reason = 'los recordatorios de marcar entrada, almuerzo y salida' }) {
  const [needs, setNeeds] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const native = isNativePushSupported()

  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const t = Number(localStorage.getItem(DISMISS_KEY) || 0)
        if (t && Date.now() - t < HOURS_QUIET * 3600 * 1000) return
      } catch { /* sin almacenamiento: se muestra igual */ }
      let enabled = true
      if (native) {
        enabled = (await getNativePushStatus()) === 'granted'
      } else if (isPushSupported()) {
        enabled = Boolean(await getExistingPushSubscription())
      } else if (needsInstallForPush()) {
        enabled = false
      } else {
        return // este navegador no soporta push: no hay nada que ofrecer
      }
      if (!cancelled) setNeeds(!enabled)
    }
    check().catch(() => {})
    return () => { cancelled = true }
  }, [native])

  async function activate() {
    setBusy(true); setMsg(null)
    try {
      if (native) await registerNativePush()
      else if (needsInstallForPush()) { setMsg('Primero agrega Cotejo a la pantalla de inicio (botón Compartir → Agregar a inicio) y ábrelo desde ahí.'); setBusy(false); return }
      else await subscribeToPush()
      setNeeds(false)
    } catch (err) {
      setMsg(err?.message === 'permission_denied'
        ? 'Tienes bloqueadas las notificaciones: actívalas desde los Ajustes del teléfono o del navegador.'
        : 'No se pudo activar. Inténtalo de nuevo.')
    }
    setBusy(false)
  }

  function later() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* no-op */ }
    setNeeds(false)
  }

  if (!needs) return null
  return (
    <div className="card" style={{ marginBottom: 12, borderLeft: '4px solid #C8553D', background: 'rgba(200,85,61,0.07)' }}>
      <strong>🔔 Activa las notificaciones</strong>
      <p style={{ margin: '6px 0 10px', fontSize: 14, opacity: 0.85 }}>
        Sin ellas no te llegan {reason} al teléfono, y se te puede pasar marcar.
      </p>
      {msg && <p className="error-text" style={{ margin: '0 0 8px', fontSize: 13 }}>{msg}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn" disabled={busy} onClick={activate}>{busy ? 'Activando...' : 'Activar ahora'}</button>
        <button type="button" className="btn btn-secondary" onClick={later}>Más tarde</button>
      </div>
    </div>
  )
}
