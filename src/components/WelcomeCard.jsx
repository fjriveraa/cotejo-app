import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { isPushSupported, needsInstallForPush, getExistingPushSubscription, subscribeToPush } from '../lib/push'
import { isNativePushSupported, getNativePushStatus, registerNativePush } from '../lib/nativePush'

const DISMISS_KEY = 'cotejo_welcome_dismissed_at'
const HOURS_QUIET = 24
const IS_NATIVE = Capacitor.isNativePlatform()
const isIOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)

// Tarjeta de bienvenida con los dos pasos para sacarle provecho a Cotejo:
// 1) agregarlo a la pantalla de inicio, 2) activar las notificaciones.
// Cada paso desaparece al cumplirse; con ambos hechos la tarjeta no vuelve a salir.
export default function WelcomeCard() {
  const [ready, setReady] = useState(false)
  const [installed, setInstalled] = useState(true)
  const [pushOn, setPushOn] = useState(true)
  const [pushUnsupported, setPushUnsupported] = useState(false)
  const [installEvent, setInstallEvent] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [hidden, setHidden] = useState(false)
  const native = isNativePushSupported()

  useEffect(() => {
    try {
      const t = Number(localStorage.getItem(DISMISS_KEY) || 0)
      if (t && Date.now() - t < HOURS_QUIET * 3600 * 1000) { setHidden(true); return }
    } catch { /* sin almacenamiento */ }
    const standalone = IS_NATIVE || window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
    setInstalled(standalone)
    const onPrompt = (e) => { e.preventDefault(); setInstallEvent(e) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    let cancelled = false
    ;(async () => {
      let on = true
      try {
        if (native) on = (await getNativePushStatus()) === 'granted'
        else if (isPushSupported()) on = Boolean(await getExistingPushSubscription())
        else if (needsInstallForPush()) on = false
        else if (!cancelled) setPushUnsupported(true)
      } catch { /* se asume activado para no molestar */ }
      if (!cancelled) { setPushOn(on); setReady(true) }
    })()
    return () => { cancelled = true; window.removeEventListener('beforeinstallprompt', onPrompt) }
  }, [native])

  async function install() {
    if (!installEvent) return
    installEvent.prompt()
    try { await installEvent.userChoice } catch { /* no-op */ }
    setInstallEvent(null)
    setInstalled(true)
  }

  async function activate() {
    setBusy(true); setMsg(null)
    try {
      if (native) await registerNativePush()
      else if (needsInstallForPush()) { setMsg('Primero agrega Cotejo a la pantalla de inicio (paso 1) y ábrelo desde ahí.'); setBusy(false); return }
      else await subscribeToPush()
      setPushOn(true)
    } catch (err) {
      setMsg(err?.message === 'permission_denied'
        ? 'Tienes bloqueadas las notificaciones: actívalas desde los Ajustes del teléfono o del navegador.'
        : 'No se pudo activar. Inténtalo de nuevo.')
    }
    setBusy(false)
  }

  function later() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* no-op */ }
    setHidden(true)
  }

  const needInstall = !installed
  const needPush = !pushOn && !pushUnsupported
  if (hidden || !ready || (!needInstall && !needPush)) return null

  const step = { display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 0', borderTop: '1px solid rgba(0,0,0,0.08)' }
  const num = { flex: 'none', width: 28, height: 28, borderRadius: 14, background: '#2B6459', color: '#fff', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }
  let n = 0
  return (
    <div className="card" style={{ marginBottom: 20, borderLeft: '4px solid #2B6459' }}>
      <strong style={{ fontSize: 17 }}>👋 Bienvenido a Cotejo</strong>
      <p style={{ margin: '4px 0 6px', fontSize: 14, opacity: 0.8 }}>Dos pasos para que no se te pase nada:</p>

      {needInstall && (
        <div style={step}>
          <div style={num}>{++n}</div>
          <div style={{ flex: 1 }}>
            <strong>Agrega Cotejo a tu pantalla de inicio</strong>
            <p style={{ margin: '4px 0 8px', fontSize: 14, opacity: 0.8 }}>
              {isIOS
                ? 'Toca el botón Compartir (el cuadro con la flecha hacia arriba) y elige "Agregar a inicio". Luego ábrelo desde ese ícono.'
                : installEvent ? 'Se abre como una app, sin escribir la dirección.' : 'En el menú del navegador (⋮) elige "Instalar app" o "Agregar a pantalla de inicio".'}
            </p>
            {installEvent && <button type="button" className="btn" onClick={install}>Instalar ahora</button>}
          </div>
        </div>
      )}

      {needPush && (
        <div style={step}>
          <div style={num}>{++n}</div>
          <div style={{ flex: 1 }}>
            <strong>Activa las notificaciones</strong>
            <p style={{ margin: '4px 0 8px', fontSize: 14, opacity: 0.8 }}>
              Así te avisamos al teléfono de comprobantes nuevos, recordatorios y novedades de tu equipo.
            </p>
            {msg && <p className="error-text" style={{ margin: '0 0 8px', fontSize: 13 }}>{msg}</p>}
            <button type="button" className="btn" disabled={busy} onClick={activate}>{busy ? 'Activando...' : 'Activar ahora'}</button>
          </div>
        </div>
      )}

      <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 10 }}>
        <button type="button" className="btn btn-secondary" style={{ fontSize: 13, padding: '4px 12px' }} onClick={later}>Más tarde</button>
      </div>
    </div>
  )
}
