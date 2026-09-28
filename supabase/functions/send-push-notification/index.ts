import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import webpush from "npm:web-push@3.6.7"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
const INTERNAL_WEBHOOK_SECRET = Deno.env.get("INTERNAL_WEBHOOK_SECRET")
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:notificaciones@cotejo.net"

// Espejo de TYPE_ROUTE en NotificationBell.jsx / send-notification-email --
// a qué pantalla debería llevar un tap sobre la notificación push.
const TYPE_ROUTE: Record<string, string> = {
  payment_pending: "/cola",
  payment_confirmed: "/registrar",
  confirmation_reversed: "/cola",
  risk_flag: "/cola",
  guest_submission: "/comprobantes-invitados",
}

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  if (!INTERNAL_WEBHOOK_SECRET || req.headers.get("x-internal-secret") !== INTERNAL_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401 })
  }

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.error("Llaves VAPID no configuradas")
    return new Response(JSON.stringify({ error: "VAPID no configurado" }), { status: 500 })
  }

  let notificationId: string | null = null
  try {
    const payload = await req.json()
    notificationId = payload?.notification_id ?? null
  } catch {
    return new Response(JSON.stringify({ error: "Body inválido" }), { status: 400 })
  }

  if (!notificationId) {
    return new Response(JSON.stringify({ error: "notification_id requerido" }), { status: 400 })
  }

  const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!)

  const { data: notification, error: notifError } = await supabase
    .from("notifications")
    .select("id, membership_id, type, title, body")
    .eq("id", notificationId)
    .single()

  if (notifError || !notification) {
    console.error("Notificación no encontrada", notifError)
    return new Response(JSON.stringify({ error: "Notificación no encontrada" }), { status: 404 })
  }

  const { data: membership } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("id", notification.membership_id)
    .single()

  if (!membership?.user_id) {
    return new Response(JSON.stringify({ error: "Membresía sin usuario" }), { status: 404 })
  }

  const { data: subscriptions, error: subError } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", membership.user_id)

  if (subError) {
    console.error("Error cargando suscripciones", subError)
    return new Response(JSON.stringify({ error: "Error cargando suscripciones" }), { status: 500 })
  }

  // Sin suscripciones no es un error -- la mayoría de notificaciones van a
  // caer aquí para alguien que nunca activó push desde el menú, y esta
  // función se llama para TODAS las notificaciones sin distinción.
  if (!subscriptions || subscriptions.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 })
  }

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body ?? "",
    url: TYPE_ROUTE[notification.type] ?? "/cola",
  })

  let sent = 0
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload
        )
        sent += 1
      } catch (err) {
        const statusCode = err?.statusCode
        // 404/410 = el navegador invalidó esta suscripción (desinstaló la
        // app, borró datos del sitio, etc.) -- limpiarla evita reintentar
        // para siempre contra un endpoint muerto.
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id)
        } else {
          console.error("Error enviando push", statusCode, err?.body || err)
        }
      }
    })
  )

  return new Response(JSON.stringify({ sent }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
})
