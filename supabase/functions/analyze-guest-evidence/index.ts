import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"

// Misma lógica de lectura que analyze-payment-evidence, pero para el flujo
// de invitados: aquí no hay usuario autenticado ni membresía que revisar,
// así que en vez de eso se valida que el path realmente pertenezca a la
// organización indicada y que el archivo exista en el bucket público de
// evidencia de invitados. El nombre del archivo es un UUID aleatorio
// generado por el navegador del invitado justo antes de subirlo, así que
// adivinar un path ajeno no es viable.
const BANK_CATALOG = `Bancos conocidos de Honduras (HN) y sus rasgos visuales típicos (logo/colores), útiles para reconocer el banco aunque el texto no sea perfectamente legible:
- Banco Atlántida: logo rojo, texto "Banco Atlántida"
- Ficohsa: logo azul/turquesa, texto "Ficohsa"
- BAC Credomatic: logo rojo y azul, texto "BAC"
- Banco de Occidente: logo verde, texto "Occidente"
- Banpaís: logo naranja, texto "Banpaís"
- Davivienda Honduras: logo rojo, texto "Davivienda"
- Lafise Honduras: logo azul oscuro, texto "Lafise"
- Banco Promerica: logo verde y azul, texto "Promerica"
- Banco Azteca Honduras: logo verde, texto "Azteca"
- Banco Popular Honduras: texto "Banco Popular"
- BANHCAFE: texto "Banhcafe"

Bancos conocidos de Guatemala (GT) y sus rasgos visuales típicos:
- Banrural: logo verde, texto "Banrural"
- Banco Industrial: logo rojo, texto "Industrial" o "BI"
- G&T Continental: logo azul/dorado, texto "G&T Continental"
- BAC Credomatic Guatemala: logo rojo y azul, texto "BAC"
- Banco Agromercantil (BAM): logo verde, texto "BAM" o "Agromercantil"
- Banco Promerica Guatemala: logo verde y azul, texto "Promerica"
- Bantrab: logo azul, texto "Bantrab"
- Vivibanco: logo morado, texto "Vivibanco"
- CHN: texto "CHN" o "Crédito Hipotecario Nacional"
- Interbanco: texto "Interbanco"`

const EXTRACTION_PROMPT = `Eres un asistente que lee comprobantes de pago centroamericanos (transferencias bancarias, capturas de apps bancarias, transferencias interbancarias, depósitos) que un cliente está enviando como prueba de pago a un comercio, principalmente de Honduras y Guatemala.

${BANK_CATALOG}

Usa ese catálogo para reconocer el banco por patrones visuales (color del logo, forma, tipografía, estructura del comprobante) además del texto, incluso si el nombre del banco no aparece completo o legible en la imagen. Si el diseño coincide claramente con uno de esos bancos, usa su nombre exacto del catálogo en el campo correspondiente. Nunca adivines un banco si no hay ninguna señal visual o textual que lo respalde.

Extrae TODOS los datos que aparezcan en el comprobante de la imagen, con el mayor detalle posible. Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con esta forma exacta:
{
  "amount": number o null,
  "currency": "HNL" o "USD" o null,
  "origin_bank": string o null,
  "origin_account_holder": string o null,
  "origin_account_number": string o null,
  "reference_raw": string o null,
  "transaction_date": "YYYY-MM-DD" o null,
  "confidence": {
    "amount": 0-1, "reference_raw": 0-1,
    "origin_account_holder": 0-1, "origin_account_number": 0-1,
    "transaction_date": 0-1
  },
  "notes": string o null
}

Reglas:
- Si un dato no aparece claramente en la imagen, usa null en ese campo y confidence 0 para ese campo. Nunca inventes datos.
- "amount" es el monto de la transacción (el campo "Monto" o "Monto debitado"), como número (sin símbolos de moneda ni comas).
- "origin_bank" es el banco de la cuenta que ENVÍA el pago (la cuenta del cliente), si se puede determinar.
- "origin_account_holder" es el nombre completo de la persona o empresa titular de la cuenta ORIGEN (quien envía), tal como aparece en "Cuenta origen".
- "origin_account_number" es el número de cuenta completo de origen, tal como aparece (no solo los últimos 4 dígitos).
- "reference_raw" es el número de referencia, autorización, folio o "N° comprobante" de la transacción, tal como aparece.
- "transaction_date" es la fecha de la transacción en formato YYYY-MM-DD. Si el comprobante solo trae día y mes (ej. "23 septiembre") sin año, asume el año actual.
- "notes" puede incluir cualquier detalle relevante que notes pero no encaje en los campos anteriores (ej. "captura borrosa").`

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
    const { path, organization_id } = await req.json()

    if (!path || typeof path !== "string" || !organization_id || typeof organization_id !== "string") {
      return new Response(JSON.stringify({ error: "Faltan parámetros" }), {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" }
      })
    }

    if (path.split("/")[0] !== organization_id) {
      return new Response(JSON.stringify({ error: "El archivo no corresponde a esta empresa" }), {
        status: 403,
        headers: { ...corsHeaders, "content-type": "application/json" }
      })
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const { data: org } = await adminClient
      .from("organizations")
      .select("id")
      .eq("id", organization_id)
      .maybeSingle()

    if (!org) {
      return new Response(JSON.stringify({ error: "Empresa no encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "content-type": "application/json" }
      })
    }

    const { data: fileData, error: fileErr } = await adminClient.storage.from("guest-evidence").download(path)
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
    console.error("analyze-guest-evidence error:", err)
    return new Response(JSON.stringify({ error: "Error interno al analizar el comprobante" }), {
      status: 500,
      headers: { "content-type": "application/json" }
    })
  }
})
