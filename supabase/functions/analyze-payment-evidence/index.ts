import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"

const EXTRACTION_PROMPT = `Eres un asistente que lee comprobantes de pago hondureños (transferencias bancarias, capturas de apps bancarias como BAC, Ficohsa, Atlántida, Banpais, transferencias interbancarias, depósitos).

Extrae los datos del comprobante en la imagen. Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con esta forma exacta:
{
  "amount": number o null,
  "currency": "HNL" o "USD" o null,
  "bank": string o null,
  "account_last4": string de 4 dígitos o null,
  "reference_raw": string o null,
  "transaction_date": "YYYY-MM-DD" o null,
  "confidence": { "amount": 0-1, "bank": 0-1, "account_last4": 0-1, "reference_raw": 0-1 },
  "notes": string o null
}

Reglas:
- Si un dato no aparece claramente en la imagen, usa null en ese campo y confidence 0 para ese campo. Nunca inventes datos.
- "amount" es el monto de la transacción, como número (sin símbolos de moneda ni comas).
- "account_last4" son los últimos 4 dígitos de la cuenta que RECIBE el pago, si aparecen.
- "reference_raw" es el número de referencia, autorización o folio de la transacción, tal como aparece.
- "notes" puede incluir cualquier detalle relevante que notes pero no encaje en los campos anteriores (ej. "captura borrosa", "parece un comprobante de otro banco").`

function mimeFromPath(path) {
  const ext = path.split(".").pop()?.toLowerCase()
  if (ext === "png") return "image/png"
  if (ext === "webp") return "image/webp"
  if (ext === "gif") return "image/gif"
  if (ext === "pdf") return "application/pdf"
  return "image/jpeg"
}

function arrayBufferToBase64(buffer) {
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

    // Cliente con service role para leer el archivo privado del bucket.
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { data: fileData, error: fileErr } = await adminClient.storage.from("evidence").download(path)
    if (fileErr || !fileData) {
      return new Response(JSON.stringify({ error: "No se pudo leer el comprobante subido" }), {
        status: 404,
        headers: { ...corsHeaders, "content-type": "application/json" }
      })
    }

    const mediaType = mimeFromPath(path)
    if (mediaType === "application/pdf") {
      // El modelo de visión solo procesa imágenes por ahora; se omite el análisis para PDFs.
      return new Response(JSON.stringify({ extraction: null, skipped: "pdf" }), {
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
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: EXTRACTION_PROMPT }
            ]
          }
        ]
      })
    })

    if (!aiResp.ok) {
      const errText = await aiResp.text()
      console.error("Anthropic API error:", errText)
      return new Response(JSON.stringify({ error: "Error al analizar la imagen con IA" }), {
        status: 502,
        headers: { ...corsHeaders, "content-type": "application/json" }
      })
    }

    const aiJson = await aiResp.json()
    const textBlock = (aiJson.content || []).find((b) => b.type === "text")

    let extraction = null
    try {
      const raw = textBlock?.text ?? "{}"
      const jsonStart = raw.indexOf("{")
      const jsonEnd = raw.lastIndexOf("}")
      extraction = JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
    } catch (parseErr) {
      console.error("No se pudo interpretar la respuesta de IA:", textBlock?.text)
      return new Response(JSON.stringify({ error: "La IA no devolvió un resultado interpretable" }), {
        status: 502,
        headers: { ...corsHeaders, "content-type": "application/json" }
      })
    }

    return new Response(JSON.stringify({ extraction }), {
      headers: { ...corsHeaders, "content-type": "application/json" }
    })
  } catch (err) {
    console.error("analyze-payment-evidence error:", err)
    return new Response(JSON.stringify({ error: "Error interno al analizar el comprobante" }), {
      status: 500,
      headers: { "content-type": "application/json" }
    })
  }
})
