// El dominio real de Cotejo es cotejo.net, pero cotejo-app-two.vercel.app
// sigue funcionando (Vercel nunca lo desconecta) y cualquiera puede
// terminar navegando ahí -- un bookmark viejo, un link compartido antes de
// tener el dominio, etc. Si generamos links para invitados o para invitar
// al equipo usando window.location.origin, esos links heredan el dominio
// feo de Vercel en vez de cotejo.net. Por eso los links que salen de la
// app hacia afuera siempre usan este origen fijo -- excepto en desarrollo
// local, donde no existe cotejo.net.
export function getCanonicalOrigin() {
  if (typeof window === 'undefined') return 'https://cotejo.net'
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1') return window.location.origin
  return 'https://cotejo.net'
}
