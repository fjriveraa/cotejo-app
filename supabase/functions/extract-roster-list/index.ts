import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

// Lee una foto o captura de pantalla de una lista de personas (papás de una
// escuela, inquilinos de un edificio, jugadores de un equipo, etc.) y la
// convierte en una lista estructurada de {name, identifier, amount} para
// importar al roster de un grupo de cobro. Mismo patrón de autenticación
// que analyze-payment-evidence: usuario autenticado + membresía activa en
// la organización dueña del archivo (no es un endpoint público de invitado).

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"

function buildExtractionPrompt() {
  return `Eres un asistente que lee fotos o capturas de pantalla de listas de personas para armar el roster de un cobro periódico (ej. lista de papás de una escuela con el nombre de su hijo/salón, inquilinos de un edificio con su número de apartamento y renta, jugadores de un equipo, vendedores de una flota). La imagen puede ser una lista escrita a mano, una tabla impresa, o una captura de un Excel/Google Sheets.

Extrae CADA persona/fila que aparezca, con estos campos:
{
  "members": [
    { "name": string, "identifier": string o null, "amount": number o null }
  ]
}

Reglas:
- "name" es el nombre de la persona. Es el único campo obligatorio -- si una fila no tiene nombre legible, no la incluyas.
- "identifier" es cualquier dato que ayude a identificar a esa persona dentro del grupo (ej. "Depto 4B", "Local 12", "Grado 3 - Juan Pérez hijo", "Equipo A"). Si no hay nada así en la imagen, usa null.
- "amount" es un monto esperado de pago para esa persona, SOLO si aparece un número claramente asociado a esa fila (ej. columna de "Renta", "Cuota", "Monto"). Si no aparece monto, usa null -- nunca inventes ni asumas un monto igual para todos si no está escrito.
- Si la imagen trae una fila de encabezados (ej. "Nombre", "Depto", "Renta"), úsala solo para entender qué columna es cuál -- no la incluyas como una persona.
- Ignora filas totalmente vacías o que claramente no son personas (títulos, totales, notas).
- Responde ÚNICAMENTE con el objeto JSON de arriba, sin texto antes ni después.`
}

function mimeFromPath(path: string) {
  const ext = path.split(".").pop()?.toLowerCase()
  if (ext === "png") return "image/png"
  if (ext === "webp") return "image/webp"
  if (ext === "gif") return "image/gif"
  if (ext === "pdf") return "application/pdf"
  return "image/jpeg"
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = ""
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

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

  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY no está configurado en este proyecto." }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" }
    })
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? ""
    const { path } = await req.json()

    if (!path || typeof path !== "string") {
      return new Response(JSON.stringify({ error: "Falta el parámetro path" }), {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" }
      })
    }

    // Cliente autenticado como el usuario que llama, solo para verificar identidad y membresía.
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

    const orgIdFromPath = path.split("/")[0]
    const { data: membership } = await callerClient
      .from("memberships")
      .select("id, organization_id")
      .eq("user_id", userData.user.id)
      .eq("organization_id", orgIdFromPath)
      .eq("status", "active")
      .maybeSingle()

    if (!membership) {
      return new Response(JSON.stringify({ error: "No tienes acceso a esta organización" }), {
        status: 403,
        headers: { ...corsHeaders, "content-type": "application/json" }
      })
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { data: fileData, error: fileErr } = await adminClient.storage.from("guest-evidence").download(path)
    if (fileErr || !fileData) {
      return new Response(JSON.stringify({ error: "No se pudo leer el archivo subido" }), {
        status: 404,
        headers: { ...corsHeaders, "content-type": "application/json" }
      })
    }

    const mediaType = mimeFromPath(path)
    if (mediaType === "application/pdf") {
      return new Response(JSON.stringify({ error: "Por ahora solo se pueden leer imágenes (foto o captura), no PDF." }), {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" }
      })
    }

    const arrayBuffer = await fileData.arrayBuffer()
    const base64 = arrayBufferToBase64(arrayBuffer)

    const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: buildExtractionPrompt() }
            ]
          }
        ]
      })
    })

    if (!aiResp.ok) {
      const errText = await aiResp.text()
      console.error("Anthropic API error:", errText)
      return new Response(JSON.stringify({ error: "Error al leer la imagen con IA" }), {
        status: 502,
        headers: { ...corsHeaders, "content-type": "application/json" }
      })
    }

    const aiJson = await aiResp.json()
    const textBlock = (aiJson.content || []).find((b: { type: string }) => b.type === "text")

    let members = []
    try {
      const raw = textBlock?.text ?? "{}"
      const jsonStart = raw.indexOf("{")
      const jsonEnd = raw.lastIndexOf("}")
      const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
      members = Array.isArray(parsed.members) ? parsed.members : []
    } catch (parseErr) {
      console.error("No se pudo interpretar la respuesta de IA:", textBlock?.text)
      return new Response(JSON.stringify({ error: "La IA no devolvió un resultado interpretable" }), {
        status: 502,
        headers: { ...corsHeaders, "content-type": "application/json" }
      })
    }

    // Filtro final de sanidad: nunca dejar pasar una fila sin nombre, sin importar qué haya
    // devuelto el modelo -- el nombre es el único dato que hace falta para poder usarla.
    members = members
      .filter((m: { name?: unknown }) => m && typeof m.name === "string" && m.name.trim())
      .map((m: { name: string; identifier?: unknown; amount?: unknown }) => ({
        name: m.name.trim(),
        identifier: typeof m.identifier === "string" && m.identifier.trim() ? m.identifier.trim() : null,
        amount: typeof m.amount === "number" && Number.isFinite(m.amount) && m.amount > 0 ? m.amount : null
      }))

    return new Response(JSON.stringify({ members }), {
      headers: { ...corsHeaders, "content-type": "application/json" }
    })
  } catch (err) {
    console.error("extract-roster-list error:", err)
    return new Response(JSON.stringify({ error: "Error interno al leer la lista" }), {
      status: 500,
      headers: { "content-type": "application/json" }
    })
  }
})
