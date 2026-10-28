import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

// Lee un horario de trabajo (foto, captura, PDF o texto de Excel) y lo devuelve
// como una lista de turnos normalizada. NO guarda nada: la app muestra una vista
// previa y el usuario confirma antes de guardar.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
const ANTHROPIC_MODEL = "claude-sonnet-5-5"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } })
}

function todayInHonduras() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tegucigalpa", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date())
  const g = (t: string) => parts.find((p) => p.type === t)?.value
  return `${g("year")}-${g("month")}-${g("day")}`
}

function buildPrompt(today: string, employees: string[], branches: string[], hint: string) {
  return `Eres un asistente que lee horarios de trabajo de negocios (tiendas, restaurantes, oficinas) en cualquier formato: cuadrículas de Excel, fotos de pizarras, capturas, PDF o texto. Los formatos varían mucho: puede haber una sección por sucursal, columnas por día, una columna "ingreso/entrada" a la izquierda con la hora que aplica a esa fila, horarios de almuerzo por turnos (ej. 11:00, 12:00, 1:00 PM), una columna "cierre", y una sección de días libres.

Hoy es ${today} (hora de Honduras). Úsalo para deducir el año cuando el horario solo trae día y mes.

Colaboradores registrados en Cotejo (usa estos nombres EXACTOS cuando reconozcas a la persona; si el horario trae un nombre que no está en la lista, devuélvelo tal cual lo lees): ${employees.length ? employees.join(", ") : "(ninguno)"}.
Sucursales registradas en Cotejo (usa estos nombres exactos cuando coincidan): ${branches.length ? branches.join(", ") : "(ninguna)"}.
${hint ? `Indicación del usuario sobre el archivo: ${hint}\n` : ""}
Devuelve ÚNICAMENTE un objeto JSON válido, sin texto antes ni después:
{
  "shifts": [
    {
      "employee": "nombre del colaborador",
      "date": "YYYY-MM-DD",
      "branch": "sucursal o null",
      "start_time": "HH:MM" (24 h) o null,
      "lunch_start": "HH:MM" (24 h) o null,
      "end_time": "HH:MM" (24 h) o null,
      "confidence": 0-1,
      "note": "texto corto si hay algo dudoso, o null"
    }
  ],
  "days_off": [ { "employee": "...", "date": "YYYY-MM-DD" } ],
  "warnings": [ "cosas ambiguas que el usuario debe revisar" ]
}

Reglas:
- Un turno por persona por día en el que trabaja. Los días marcados como libre/descanso van en "days_off", no en "shifts".
- Convierte todas las horas a formato 24 h (1:00 PM = 13:00; 9:00 a. m. = 09:00).
- "start_time" es la hora de ingreso de ESA persona ese día. Si la hora de ingreso está en una columna o fila aparte, asócia la con la persona de forma lógica y, si no es claro a quién corresponde, baja "confidence" a 0.5 o menos y explícalo en "note" y en "warnings".
- "lunch_start" es la hora a la que ESA persona sale a almorzar, si el horario la asigna.
- "end_time" es la hora de salida/cierre solo si el horario la asigna a esa persona o si es la hora de cierre de su sucursal ese día; si no, null.
- Las fechas deben ser reales: deduce cada fecha de los encabezados (día de la semana + número). Verifica que el día de la semana coincida con la fecha.
- Nunca inventes turnos que no estén en el archivo. Si algo no se lee, omítelo y avísalo en "warnings".
- Si el mismo nombre aparece escrito distinto (Lizeth/Lizet), unifícalo con el colaborador registrado más parecido.`
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)
  if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY no está configurado en este proyecto." }, 500)

  try {
    const authHeader = req.headers.get("Authorization") ?? ""
    const body = await req.json()
    const { organization_id, kind, media_type, data, text, hint, employees, branches } = body

    if (!organization_id || typeof organization_id !== "string") return json({ error: "Falta organization_id" }, 400)
    if (!["image", "pdf", "text"].includes(kind)) return json({ error: "Tipo de archivo no válido" }, 400)

    const caller = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, { global: { headers: { Authorization: authHeader } } })
    const { data: userData, error: userErr } = await caller.auth.getUser()
    if (userErr || !userData?.user) return json({ error: "No autorizado" }, 401)

    const { data: membership } = await caller
      .from("memberships")
      .select("id, role")
      .eq("user_id", userData.user.id)
      .eq("organization_id", organization_id)
      .eq("status", "active")
      .maybeSingle()
    if (!membership || !["propietario", "admin", "supervisor"].includes(membership.role)) {
      return json({ error: "No tienes permiso para importar horarios" }, 403)
    }

    const prompt = buildPrompt(
      todayInHonduras(),
      Array.isArray(employees) ? employees.slice(0, 200).map(String) : [],
      Array.isArray(branches) ? branches.slice(0, 50).map(String) : [],
      typeof hint === "string" ? hint.slice(0, 500) : ""
    )

    let content: unknown[]
    if (kind === "text") {
      if (typeof text !== "string" || !text.trim()) return json({ error: "El archivo no tiene texto" }, 400)
      content = [{ type: "text", text: `Contenido del horario (tal como salió del Excel):\n\n${text.slice(0, 60000)}\n\n${prompt}` }]
    } else {
      if (typeof data !== "string" || data.length < 100) return json({ error: "Archivo vacío" }, 400)
      if (data.length > 14_000_000) return json({ error: "El archivo es demasiado grande" }, 413)
      const block = kind === "pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
        : { type: "image", source: { type: "base64", media_type: ["image/png", "image/webp", "image/gif"].includes(media_type) ? media_type : "image/jpeg", data } }
      content = [block, { type: "text", text: prompt }]
    }

    const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 16000, messages: [{ role: "user", content }] })
    })

    if (!aiResp.ok) {
      console.error("Anthropic API error:", await aiResp.text())
      return json({ error: "Error al leer el horario con IA" }, 502)
    }

    const aiJson = await aiResp.json()
    const textBlock = (aiJson.content || []).find((b: { type: string }) => b.type === "text")
    let parsed
    try {
      const raw = textBlock?.text ?? "{}"
      parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1))
    } catch (_e) {
      console.error("Respuesta no interpretable:", textBlock?.text?.slice(0, 500))
      return json({ error: "La IA no devolvió un resultado interpretable. Prueba con una imagen más nítida o por partes." }, 502)
    }

    return json({
      shifts: Array.isArray(parsed.shifts) ? parsed.shifts : [],
      days_off: Array.isArray(parsed.days_off) ? parsed.days_off : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      truncated: aiJson.stop_reason === "max_tokens"
    })
  } catch (err) {
    console.error("parse-schedule error:", err)
    return json({ error: "Error interno al leer el horario" }, 500)
  }
})
