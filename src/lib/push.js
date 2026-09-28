import { supabase } from './supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

// El navegador espera la llave VAPID como Uint8Array, pero se distribuye
// como base64url -- esta es la conversión estándar que usan todos los
// ejemplos de Web Push.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export function isPushSupported() {
  return Boolean(
    VAPID_PUBLIC_KEY &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

// iOS/Safari solo permite Web Push dentro de una PWA instalada (Agregar a
// inicio) -- en una pestaña normal de Safari, PushManager.subscribe rechaza
// silenciosamente. Detectarlo de antemano evita ofrecer un botón que va a
// fallar sin explicación.
export function needsInstallForPush() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
  return isIOS && !isStandalone
}

export async function getExistingPushSubscription() {
  if (!isPushSupported()) return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

export async function subscribeToPush() {
  const registration = await navigator.serviceWorker.ready
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('permission_denied')
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
  })

  const { endpoint } = subscription
  const { p256dh, auth } = subscription.toJSON().keys

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('sin_sesion')

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: navigator.userAgent
    },
    { onConflict: 'endpoint' }
  )
  if (error) throw error

  return subscription
}

export async function unsubscribeFromPush() {
  const subscription = await getExistingPushSubscription()
  if (!subscription) return
  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
}
