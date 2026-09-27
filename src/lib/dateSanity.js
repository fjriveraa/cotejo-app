// La IA a veces lee mal el año de un comprobante (ej. detectó 2024 en un
// comprobante real de 2026) — probablemente por cómo el banco abrevia la
// fecha en su interfaz, que además cambia con el tiempo entre apps. Una
// fecha así de equivocada es peor que no tener fecha: si se usa para
// ordenar la cola, entierra el pago donde nadie lo va a buscar; si se
// muestra tal cual, manda a alguien al día incorrecto en la app del banco.
//
// No intentamos "adivinar" el año correcto (eso sería inventar un dato) —
// solo detectamos cuándo la fecha es implausible para no confiar en ella
// silenciosamente, y dejamos que un humano la corrija.

const FUTURE_SLACK_DAYS = 2 // hoy + 2 días, por husos horarios / relojes desincronizados
const PAST_SLACK_DAYS = 60 // más de 2 meses de "atraso" en un comprobante recién subido es raro

// "2026-09-21" sin hora se interpreta distinto según cómo se parsee: con
// new Date("2026-09-21") a secas, JS lo toma como medianoche UTC, y en
// Honduras (UTC-6) eso cae el día ANTERIOR a las 6pm — la fecha se muestra
// un día corrida sin que la IA ni la base de datos se hayan equivocado en
// nada. Agregar "T00:00:00" (sin offset) hace que JS lo tome como
// medianoche LOCAL en vez de UTC, que es lo que realmente se quiere mostrar
// para una fecha que no trae hora.
export function parseLocalDate(dateStr) {
  if (!dateStr) return null
  const d = new Date(`${dateStr}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

export function isPlausibleTransactionDate(dateStr, referenceDate = new Date()) {
  const d = parseLocalDate(dateStr)
  if (!d) return false

  const ref = new Date(referenceDate)
  ref.setHours(0, 0, 0, 0)

  const diffDays = (d.getTime() - ref.getTime()) / (1000 * 60 * 60 * 24)
  if (diffDays > FUTURE_SLACK_DAYS) return false
  if (diffDays < -PAST_SLACK_DAYS) return false
  return true
}
