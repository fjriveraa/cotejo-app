import { Capacitor } from '@capacitor/core'

const STORAGE_KEY = 'cotejo_biometric_lock_enabled'

// Bloqueo con Face ID / Touch ID / huella al abrir la app. Es una capa extra
// sobre la sesión de Supabase (que ya exige haber iniciado sesión) -- pensada
// para que, si alguien deja el teléfono desbloqueado con Cotejo abierto, no
// cualquiera que lo tome pueda ver comprobantes y montos. No guarda
// contraseñas ni usa la huella/Face ID para nada más que confirmar presencia
// -- es "activado o no" por dispositivo, guardado en localStorage (nunca
// sincroniza entre dispositivos, que es justo lo que se quiere: cada
// teléfono decide su propio bloqueo).
//
// Todo esto solo tiene efecto dentro de la app nativa empacada con
// Capacitor. En la web (Vercel/PWA) isBiometricSupported() siempre resuelve
// false y el resto de las funciones no hacen nada -- así este archivo se
// puede importar sin problema también en la versión web, sin necesitar el
// plugin nativo instalado ahí.

async function loadPlugin() {
  const mod = await import('@capgo/capacitor-native-biometric')
  return mod.NativeBiometric
}

export async function isBiometricSupported() {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const NativeBiometric = await loadPlugin()
    const result = await NativeBiometric.isAvailable()
    return Boolean(result?.isAvailable)
  } catch (err) {
    console.error('biometric isAvailable error', err)
    return false
  }
}

export function isBiometricEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export async function enableBiometricLock() {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const NativeBiometric = await loadPlugin()
    await NativeBiometric.verifyIdentity({
      reason: 'Confirma tu identidad para activar el bloqueo de Cotejo',
      title: 'Activar bloqueo biométrico'
    })
    localStorage.setItem(STORAGE_KEY, '1')
    return true
  } catch (err) {
    console.error('biometric enable error', err)
    return false
  }
}

export function disableBiometricLock() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // no-op
  }
}

export async function verifyBiometricUnlock() {
  if (!Capacitor.isNativePlatform() || !isBiometricEnabled()) return true
  try {
    const NativeBiometric = await loadPlugin()
    await NativeBiometric.verifyIdentity({
      reason: 'Confirma tu identidad para abrir Cotejo',
      title: 'Cotejo'
    })
    return true
  } catch {
    return false
  }
}
