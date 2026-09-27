import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")
const INTERNAL_WEBHOOK_SECRET = Deno.env.get("INTERNAL_WEBHOOK_SECRET")

const FROM_ADDRESS = "Cotejo <notificaciones@cotejo.net>"
const APP_URL = "https://cotejo.net"

// A qué ruta de la app manda el botón del correo, según el tipo de
// notificación -- espejo de TYPE_ROUTE en NotificationBell.jsx.
const TYPE_ROUTE: Record<string, string> = {
  payment_pending: "/cola",
  payment_confirmed: "/registrar",
  confirmation_reversed: "/cola",
  risk_flag: "/cola",
  guest_submission: "/comprobantes-invitados",
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function buildEmailHtml(opts: {
  orgName: string
  title: string
  body: string
  ctaPath: string
  isAlert: boolean
}) {
  const { orgName, title, body, ctaPath, isAlert } = opts
  const accent = isAlert ? "#A2483A" : "#2B6459"
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f1e8;font-family:-apple-system,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f1e8;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e5e0d8;">
            <tr>
              <td style="background:${accent};padding:18px 24px;">
                <span style="color:#ffffff;font-size:15px;font-weight:700;letter-spacing:0.3px;">Cotejo</span>
                <span style="color:rgba(255,255,255,0.85);font-size:13px;display:block;margin-top:2px;">${escapeHtml(orgName)}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 24px 8px;">
                <h1 style="margin:0 0 10px;font-size:18px;color:#1f1b14;">${escapeHtml(title)}</h1>
                <p style="margin:0;font-size:14px;line-height:1.55;color:#4a4438;">${escapeHtml(body)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 24px 26px;">
                <a href="${APP_URL}${ctaPath}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 18px;border-radius:6px;">Ver en Cotejo</a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 22px;">
                <p style="margin:0;font-size:11.5px;color:#9a9384;">Recibes esto porque tu rol en ${escapeHtml(orgName)} está autorizado para revisar pagos en Cotejo.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  if (!INTERNAL_WEBHOOK_SECRET || req.headers.get("x-internal-secret") !== INTERNAL_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401 })
  }

  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY no configurado")
    return new Response(JSON.stringify({ error: "RESEND_API_KEY no configurado" }), { status: 500 })
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
    .select("id, organization_id, membership_id, type, title, body")
    .eq("id", notificationId)
    .single()

  if (notifError || !notification) {
    console.error("Notificación no encontrada", notifError)
    return new Response(JSON.stringify({ error: "Notificación no encontrada" }), { status: 404 })
  }

  const [{ data: membership }, { data: org }] = await Promise.all([
    supabase.from("memberships").select("user_id").eq("id", notification.membership_id).single(),
    supabase.from("organizations").select("name").eq("id", notification.organization_id).single(),
  ])

  if (!membership?.user_id) {
    return new Response(JSON.stringify({ error: "Membresía sin usuario" }), { status: 404 })
  }

  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(membership.user_id)
  const email = userData?.user?.email

  if (userError || !email) {
    console.error("No se pudo obtener el correo del usuario", userError)
    return new Response(JSON.stringify({ error: "Usuario sin correo" }), { status: 404 })
  }

  const isAlert = notification.title?.includes("🚨") ?? false
  const ctaPath = TYPE_ROUTE[notification.type] ?? "/cola"
  const html = buildEmailHtml({
    orgName: org?.name ?? "tu empresa",
    title: notification.title,
    body: notification.body ?? "",
    ctaPath,
    isAlert,
  })

  const resendResp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [email],
      subject: notification.title,
      html,
    }),
  })

  if (!resendResp.ok) {
    const errText = await resendResp.text()
    console.error("Error enviando por Resend", resendResp.status, errText)
    return new Response(JSON.stringify({ error: "Fallo el envío", detail: errText }), { status: 502 })
  }

  return new Response(JSON.stringify({ sent: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
})
