import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { isBiometricEnabled, verifyBiometricUnlock } from '../lib/biometric'

// Envuelve cualquier pantalla que ya exige sesión iniciada. Es una segunda
// cerradura sobre el teléfono, no sobre la cuenta -- por eso solo actúa
// dentro de la app nativa (Capacitor) y solo si la persona activó el
// bloqueo desde Ajustes. En la web (Vercel/PWA) nunca bloquea nada.
export default function BiometricLockScreen({ children }) {
  const [locked, setLocked] = useState(() => Capacitor.isNativePlatform() && isBiometricEnabled())
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (locked) attemptUnlock()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Al volver del segundo plano (alguien cambió de app y regresó) se vuelve
  // a pedir -- si no, el bloqueo solo protegería el primer arranque del día,
  // que es exactamente cuando menos hace falta (el teléfono recién se usó).
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !isBiometricEnabled()) return
    let handlePromise
    import('@capacitor/app').then(({ App }) => {
      handlePromise = App.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) setLocked(true)
      })
    })
    return () => { handlePromise?.then?.((h) => h.remove()) }
  }, [])

  async function attemptUnlock() {
    setChecking(true)
    const ok = await verifyBiometricUnlock()
    setChecking(false)
    if (ok) setLocked(false)
  }

  if (!locked) return children

  return (
    <div className="login-wrap">
      <div className="card login-card" style={{ textAlign: 'center' }}>
        <h1>Cotejo bloqueado</h1>
        <p style={{ marginBottom: 20, opacity: 0.7 }}>Confirma tu identidad para continuar.</p>
        <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={attemptUnlock} disabled={checking}>
          {checking ? 'Verificando...' : 'Desbloquear'}
        </button>
      </div>
    </div>
  )
}
