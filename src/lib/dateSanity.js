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

export function isPlausibleTransactionDate(dateStr, referenceDate = new Date()) {
  if (!dateStr) return false
  const d = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(d.getTime())) return false

  const ref = new Date(referenceDate)
  ref.setHours(0, 0, 0, 0)

  const diffDays = (d.getTime() - ref.getTime()) / (1000 * 60 * 60 * 24)
  if (diffDays > FUTURE_SLACK_DAYS) return false
  if (diffDays < -PAST_SLACK_DAYS) return false
  return true
}
