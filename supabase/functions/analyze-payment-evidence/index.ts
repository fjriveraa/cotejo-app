import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"

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

// El prompt se arma en cada solicitud (no una sola vez al arrancar la función)
// con la fecha de HOY en hora de Honduras, para que la IA nunca tenga que
// adivinar el año — antes se le pedía "asume el año actual" sin decirle
// nunca cuál es, y terminaba usando un año viejo de su entrenamiento en vez
// del año real. Esto también le da un ancla para dudar de sí misma si cree
// leer un año que no cuadra con la fecha real, aunque el comprobante sí
// muestre el año completo.
function buildExtractionPrompt(todayLabel: string, todayISO: string) {
  return `Eres un asistente que lee comprobantes de pago centroamericanos (transferencias bancarias, capturas de apps bancarias, transferencias interbancarias, depósitos), principalmente de Honduras y Guatemala.

Hoy es ${todayLabel} (${todayISO}, hora de Honduras). Esta fecha es tu referencia real de "ahora" — no la de tu entrenamiento. Úsala para cualquier fecha que necesites inferir o para dudar de una fecha que creas leer pero que no cuadre con este momento (por ejemplo, un año muy distinto al actual sin que el comprobante lo respalde con más contexto, como un pago vencido con fecha pasada real).

${BANK_CATALOG}

Usa ese catálogo para reconocer el banco por patrones visuales (color del logo, forma, tipografía, estructura del comprobante) además del texto, incluso si el nombre del banco no aparece completo o legible en la imagen. Si el diseño coincide claramente con uno de esos bancos, usa su nombre exacto del catálogo en el campo correspondiente ("bank" u "origin_bank"). Si no coincide con ninguno del catálogo, usa el nombre que sí puedas leer en la imagen. Nunca adivines un banco si no hay ninguna señal visual o textual que lo respalde.

Extrae TODOS los datos que aparezcan en el comprobante de la imagen, con el mayor detalle posible. Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con esta forma exacta:
{
  "amount": number o null,
  "currency": "HNL" o "USD" o null,
  "bank": string o null,
  "bank_country": "HN" o "GT" o null,
  "account_last4": string de 4 dígitos o null,
  "origin_bank": string o null,
  "origin_bank_country": "HN" o "GT" o null,
  "origin_account_holder": string o null,
  "origin_account_number": string o null,
  "destination_account_holder": string o null,
  "reference_raw": string o null,
  "transaction_date": "YYYY-MM-DD" o null,
  "confidence": {
    "amount": 0-1, "bank": 0-1, "account_last4": 0-1, "reference_raw": 0-1,
    "origin_account_holder": 0-1, "origin_account_number": 0-1,
    "destination_account_holder": 0-1, "transaction_date": 0-1
  },
  "notes": string o null
}

Reglas:
- Si un dato no aparece claramente en la imagen, usa null en ese campo y confidence 0 para ese campo. Nunca inventes datos.
- "amount" es el monto de la transacción (el campo "Monto" o "Monto debitado"), como número (sin símbolos de moneda ni comas).
- "bank" es el banco de la cuenta que RECIBE el pago (cuenta destino), usando el catálogo de arriba cuando sea reconocible. "bank_country" es el país de ese banco (HN o GT) si se puede determinar. "account_last4" son los últimos 4 dígitos de esa cuenta destino, si aparecen.
- "origin_bank" es el banco de la cuenta que ENVÍA el pago, si se puede determinar (puede ser el mismo banco que "bank" si es transferencia interna). "origin_bank_country" es su país (HN o GT) si se puede determinar.
- "origin_account_holder" es el nombre completo de la persona o empresa titular de la cuenta ORIGEN (quien envía), tal como aparece en "Cuenta origen".
- "origin_account_number" es el número de cuenta completo de origen, tal como aparece (no solo los últimos 4 dígitos).
- "destination_account_holder" es el nombre o razón social del titular de la cuenta DESTINO (quien recibe), tal como aparece en "Cuenta destino".
- "reference_raw" es el número de referencia, autorización, folio o "N° comprobante" de la transacción, tal como aparece.
- "transaction_date" es la fecha de la transacción en formato YYYY-MM-DD. Si el comprobante muestra el año completo, léelo con cuidado dígito por dígito y verifica que sea razonable comparado con la fecha de hoy (${todayISO}) antes de darlo por bueno — un comprobante reciente casi nunca tiene un año muy distinto al de hoy. Si el comprobante solo trae día y mes sin año (ej. "23 septiembre"), usa el año de hoy (${todayISO.slice(0, 4)}), salvo que el contexto indique claramente otra cosa. Si no estás segura del año, es mejor devolver transaction_date en null con confidence baja que adivinar.
- "notes" puede incluir cualquier detalle relevante que notes pero no encaje en los campos anteriores (ej. "captura borrosa", "parece un comprobante de otro banco", "fecha dudosa, no coincide con el año actual").`
}

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

// Fecha de "hoy" en hora de Honduras, calculada en cada solicitud (no al
// arrancar la función) para que nunca quede desactualizada en una instancia
// que lleve tiempo corriendo.
function todayInHonduras() {
  const isoParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Tegucigalpa",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date())
  const get = (type) => isoParts.find((p) => p.type === type)?.value
  const todayISO = `${get("year")}-${get("month")}-${get("day")}`

  const label = new Intl.DateTimeFormat("es-HN", {
    timeZone: "America/Tegucigalpa",
    day: "numeric", month: "long", year: "numeric"
  }).format(new Date())

  return { todayISO, todayLabel: label }
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

    const { todayISO, todayLabel } = todayInHonduras()
    const extractionPrompt = buildExtractionPrompt(todayLabel, todayISO)

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
              { type: "text", text: extractionPrompt }
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
