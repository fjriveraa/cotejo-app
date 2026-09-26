import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
const SIGHTENGINE_API_USER = Deno.env.get("SIGHTENGINE_API_USER")
const SIGHTENGINE_API_SECRET = Deno.env.get("SIGHTENGINE_API_SECRET")

// Complemento pago "Escudo Anti-Fraude": análisis forense de la imagen del
// comprobante con Sightengine, principalmente para detectar contenido
// generado por IA (una captura de comprobante fabricada desde cero, no solo
// editada). Tiene costo real por verificación, así que:
//   1. Solo se ejecuta si la empresa activó el complemento (forensics_addon_enabled).
//   2. Lo dispara el equipo manualmente desde la cola, un comprobante a la vez —
//      nunca corre automático sobre todos los envíos.
Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "content-type": "application/json" }
    })
  }

  if (!SIGHTENGINE_API_USER || !SIGHTENGINE_API_SECRET) {
    return new Response(JSON.stringify({ error: "El complemento de forensia no está configurado en este proyecto (faltan credenciales de Sightengine)." }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" }
    })
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? ""
    const { submission_id } = await req.json()

    if (!submission_id || typeof submission_id !== "string") {
      return new Response(JSON.stringify({ error: "Falta el parámetro submission_id" }), {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" }
      })
    }

    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: userData, error: userErr } = await callerClient.auth.getUser()
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "content-type": "application/json" }
      })
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const { data: submission, error: subErr } = await adminClient
      .from("guest_submissions")
      .select("id, organization_id, evidence_path")
      .eq("id", submission_id)
      .maybeSingle()

    if (subErr || !submission) {
      return new Response(JSON.stringify({ error: "Comprobante no encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "content-type": "application/json" }
      })
    }

    const { data: membership } = await callerClient
      .from("memberships")
      .select("id, role")
      .eq("user_id", userData.user.id)
      .eq("organization_id", submission.organization_id)
      .eq("status", "active")
      .maybeSingle()

    if (!membership || !["propietario", "admin", "contador", "supervisor", "auditor"].includes(membership.role)) {
      return new Response(JSON.stringify({ error: "No tienes acceso a esta organización" }), {
        status: 403,
        headers: { ...corsHeaders, "content-type": "application/json" }
      })
    }

    const { data: org } = await adminClient
      .from("organizations")
      .select("forensics_addon_enabled")
      .eq("id", submission.organization_id)
      .maybeSingle()

    if (!org?.forensics_addon_enabled) {
      return new Response(JSON.stringify({ error: "El complemento de forensia no está activado para tu empresa." }), {
        status: 403,
        headers: { ...corsHeaders, "content-type": "application/json" }
      })
    }

    if (!submission.evidence_path) {
      return new Response(JSON.stringify({ error: "Este comprobante no tiene un archivo asociado." }), {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" }
      })
    }

    const { data: signedUrlData, error: signedUrlErr } = await adminClient.storage
      .from("guest-evidence")
      .createSignedUrl(submission.evidence_path, 120)

    if (signedUrlErr || !signedUrlData?.signedUrl) {
      return new Response(JSON.stringify({ error: "No se pudo leer el comprobante subido" }), {
        status: 404,
        headers: { ...corsHeaders, "content-type": "application/json" }
      })
    }

    // Modelo "genai": probabilidad de que la imagen haya sido generada o
    // alterada por IA (el vector de fraude más relevante hoy — comprobantes
    // fabricados desde cero, no solo una edición manual en Photoshop).
    const sightengineUrl = new URL("https://api.sightengine.com/1.0/check.json")
    sightengineUrl.searchParams.set("url", signedUrlData.signedUrl)
    sightengineUrl.searchParams.set("models", "genai")
    sightengineUrl.searchParams.set("api_user", SIGHTENGINE_API_USER)
    sightengineUrl.searchParams.set("api_secret", SIGHTENGINE_API_SECRET)

    const seResp = await fetch(sightengineUrl.toString())
    if (!seResp.ok) {
      const errText = await seResp.text()
      console.error("Sightengine error:", errText)
      return new Response(JSON.stringify({ error: "Error al analizar la imagen con el servicio de forensia" }), {
        status: 502,
        headers: { ...corsHeaders, "content-type": "application/json" }
      })
    }

    const seJson = await seResp.json()
    const aiScore = typeof seJson?.type?.ai_generated === "number" ? seJson.type.ai_generated : null

    let label = "sin_datos"
    if (aiScore !== null) {
      label = aiScore >= 0.6 ? "posible_ia" : aiScore >= 0.3 ? "revisar" : "limpio"
    }

    const { error: updateErr } = await adminClient
      .from("guest_submissions")
      .update({
        forensics_score: aiScore,
        forensics_label: label,
        forensics_checked_at: new Date().toISOString()
      })
      .eq("id", submission_id)

    if (updateErr) {
      console.error("No se pudo guardar el resultado de forensia:", updateErr)
    }

    return new Response(JSON.stringify({ forensics_score: aiScore, forensics_label: label }), {
      headers: { ...corsHeaders, "content-type": "application/json" }
    })
  } catch (err) {
    console.error("analyze-image-forensics error:", err)
    return new Response(JSON.stringify({ error: "Error interno al analizar el comprobante" }), {
      status: 500,
      headers: { "content-type": "application/json" }
    })
  }
})
