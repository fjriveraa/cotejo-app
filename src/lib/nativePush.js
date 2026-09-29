import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase'

const TOKEN_STORAGE_KEY = 'cotejo_native_push_token'

// Contraparte nativa de push.js (Web Push/VAPID), para cuando la app corre
// empacada con Capacitor -- ahí no existe Service Worker ni PushManager, así
// que se usa @capacitor/push-notifications en su lugar. El token que devuelve
// Apple/Google se guarda en push_device_tokens (nueva tabla, separada de
// push_subscriptions que es solo para Web Push) para que
// send-push-notification pueda mandarle también por APNs.
//
// Guardamos el último token en localStorage solo para poder borrar
// exactamente esa fila al desactivar -- sin eso, "desactivar" tendría que
// adivinar cuál token pertenece a este teléfono.

export function isNativePushSupported() {
  return Capacitor.isNativePlatform()
}

export async function getNativePushStatus() {
  if (!Capacitor.isNativePlatform()) return 'unsupported'
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    const status = await PushNotifications.checkPermissions()
    return status.receive // 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale'
  } catch (err) {
    console.error('push checkPermissions error', err)
    return 'unsupported'
  }
}

async function saveToken(tokenValue) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('sin_sesion')

  const platform = Capacitor.getPlatform()
  const { error } = await supabase.from('push_device_tokens').upsert(
    { user_id: user.id, platform, token: tokenValue, updated_at: new Date().toISOString() },
    { onConflict: 'token' }
  )
  if (error) throw error

  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, tokenValue)
  } catch {
    // no-op -- si localStorage falla, "desactivar" simplemente no podrá
    // borrar la fila exacta, pero el registro ya quedó guardado
  }
}

// Pide permiso (si hace falta) y registra el dispositivo. Si el permiso ya
// estaba concedido de antes, register() no vuelve a mostrar ningún diálogo
// -- por eso también se puede llamar "en silencio" al abrir la app, para
// mantener el token fresco sin molestar a nadie.
export async function registerNativePush() {
  if (!Capacitor.isNativePlatform()) return false
  const { PushNotifications } = await import('@capacitor/push-notifications')

  const permStatus = await PushNotifications.checkPermissions()
  let granted = permStatus.receive === 'granted'
  if (!granted && permStatus.receive !== 'denied') {
    const req = await PushNotifications.requestPermissions()
    granted = req.receive === 'granted'
  }
  if (!granted) throw new Error('permission_denied')

  return new Promise((resolve, reject) => {
    let settled = false
    const regListener = PushNotifications.addListener('registration', async (token) => {
      if (settled) return
      settled = true
      regListener.then((h) => h.remove())
      errListener.then((h) => h.remove())
      try {
        await saveToken(token.value)
        resolve(true)
      } catch (err) {
        reject(err)
      }
    })
    const errListener = PushNotifications.addListener('registrationError', (err) => {
      if (settled) return
      settled = true
      regListener.then((h) => h.remove())
      errListener.then((h) => h.remove())
      reject(new Error(err?.error || 'registration_error'))
    })
    PushNotifications.register()
  })
}

export async function unregisterNativePush() {
  if (!Capacitor.isNativePlatform()) return
  let tokenValue = null
  try {
    tokenValue = localStorage.getItem(TOKEN_STORAGE_KEY)
  } catch {
    // sin acceso a localStorage, no hay token específico que borrar
  }
  if (tokenValue) {
    await supabase.from('push_device_tokens').delete().eq('token', tokenValue)
    try {
      localStorage.removeItem(TOKEN_STORAGE_KEY)
    } catch {
      // no-op
    }
  }
}

// Se llama una sola vez, apenas arranca la app nativa -- registra el
// listener que traduce un tap sobre la notificación en una navegación
// dentro de la app (el payload trae `url`, armado en send-push-notification
// a partir del tipo de notificación, igual que ya hace el Web Push).
export function listenForNativePushTaps(onNavigate) {
  if (!Capacitor.isNativePlatform()) return () => {}
  let handle
  import('@capacitor/push-notifications').then(({ PushNotifications }) => {
    handle = PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const url = action?.notification?.data?.url
      if (url) onNavigate(url)
    })
  })
  return () => { handle?.then?.((h) => h.remove()) }
}
