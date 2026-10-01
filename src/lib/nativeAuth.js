// Inicio de sesión nativo con Google y Apple para la app de iOS (Capacitor).
// Se abre la hoja nativa del sistema, se obtiene un id_token y se canjea en
// Supabase con signInWithIdToken: el usuario nunca sale de la app.
import { SocialLogin } from '@capgo/capacitor-social-login'
import { supabase } from './supabase'

// ID de cliente OAuth de tipo "iOS" (Google Cloud -> Credentials). No es secreto.
const GOOGLE_IOS_CLIENT_ID =
  '586447784686-skt0bs8i37gaicpuci7a6eqp3v70nt7b.apps.googleusercontent.com'

let initPromise = null
function init() {
  if (!initPromise) {
    initPromise = SocialLogin.initialize({
      google: { iOSClientId: GOOGLE_IOS_CLIENT_ID },
      apple: {}
    }).catch((e) => {
      initPromise = null
      throw e
    })
  }
  return initPromise
}

function isCancel(e) {
  const msg = String(e?.message || e || '').toLowerCase()
  return msg.includes('cancel') || msg.includes('1001') || msg.includes('dismiss')
}

function randomNonce() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

// Devuelve { error, cancelled }. Si todo sale bien, Supabase deja la sesión
// activa y onAuthStateChange (useAuth) hace el resto, igual que con el
// redirect de Google en la web.
export async function nativeSignIn(provider) {
  try {
    await init()

    if (provider === 'google') {
      const res = await SocialLogin.login({
        provider: 'google',
        options: { scopes: ['email', 'profile'] }
      })
      const token = res?.result?.idToken
      if (!token) return { error: new Error('Google no devolvió idToken') }
      const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token })
      return { error }
    }

    if (provider === 'apple') {
      // Apple recibe el hash del nonce; Supabase recibe el nonce original y
      // compara que coincidan.
      const rawNonce = randomNonce()
      const hashedNonce = await sha256Hex(rawNonce)
      const res = await SocialLogin.login({
        provider: 'apple',
        options: { scopes: ['email', 'name'], nonce: hashedNonce }
      })
      const token = res?.result?.idToken
      if (!token) return { error: new Error('Apple no devolvió idToken') }
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token,
        nonce: rawNonce
      })
      return { error }
    }

    return { error: new Error('Proveedor no soportado') }
  } catch (e) {
    if (isCancel(e)) return { error: null, cancelled: true }
    console.error('nativeSignIn', provider, e)
    return { error: e }
  }
}
