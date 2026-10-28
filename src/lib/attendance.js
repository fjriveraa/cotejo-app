// Utilidades compartidas del control de asistencia. Todo se muestra en hora
// de Honduras sin importar la zona del dispositivo.

export const TZ = 'America/Tegucigalpa'

export const EVENT_LABELS = {
  entrada: 'Entrada',
  almuerzo_inicio: 'Salida a almuerzo',
  almuerzo_fin: 'Regreso de almuerzo',
  salida: 'Salida'
}

export function hondurasDateStr(date = new Date()) {
  // en-CA da AAAA-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

export function formatTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('es-HN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(value))
}

export function formatDateLong(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Intl.DateTimeFormat('es-HN', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(Date.UTC(y, m - 1, d)))
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}

// Lunes de la semana que contiene dateStr.
export function mondayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = domingo
  return addDays(dateStr, -((dow + 6) % 7))
}

export function monthKey(dateStr) {
  return dateStr.slice(0, 7)
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

// "2 h 05 min"
export function formatMinutes(min) {
  if (!min || min <= 0) return '0 min'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} min`
  return `${h} h ${String(m).padStart(2, '0')} min`
}

// Semana ISO sencilla: agrupa por el lunes que la abre.
export function weekKey(dateStr) {
  return mondayOf(dateStr)
}

export function weekLabel(mondayStr) {
  const sunday = addDays(mondayStr, 6)
  const fmt = (s) => {
    const [, m, d] = s.split('-').map(Number)
    return `${d} ${MONTHS[m - 1].slice(0, 3)}`
  }
  return `Semana ${fmt(mondayStr)} – ${fmt(sunday)}`
}

// Suma las filas del reporte por empleado: totales para encabezados de carpeta.
export function summarize(rows) {
  const s = { days: 0, worked: 0, late: 0, lateDays: 0, overtime: 0, absences: 0, incomplete: 0, lunchOver: 0 }
  for (const r of rows) {
    if (r.absent) {
      s.absences += 1
      continue
    }
    s.days += 1
    s.worked += r.worked_minutes || 0
    s.late += r.late_minutes || 0
    if ((r.late_minutes || 0) > 0) s.lateDays += 1
    s.overtime += r.overtime_minutes || 0
    s.lunchOver += r.lunch_over_minutes || 0
    if (r.incomplete) s.incomplete += 1
  }
  return s
}
