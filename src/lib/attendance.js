// Utilidades compartidas del control de asistencia. Todo se muestra en hora
// de Honduras sin importar la zona del dispositivo.

export const TZ = 'America/Tegucigalpa'

// Nombre de cada marca ya registrada.
export const EVENT_LABELS = {
  entrada: 'Entrada',
  almuerzo_inicio: 'Inicio de almuerzo',
  almuerzo_pausa: 'Pausa del almuerzo',
  almuerzo_reanuda: 'Almuerzo reanudado',
  almuerzo_fin: 'Reingreso de labores',
  salida: 'Salida'
}

// Texto de los botones que ve el empleado.
export const BUTTON_LABELS = {
  entrada: 'Marcar entrada',
  almuerzo_inicio: 'Marcar almuerzo',
  almuerzo_pausa: 'Pausar almuerzo',
  almuerzo_reanuda: 'Continuar almuerzo',
  almuerzo_fin: 'Marcar reingreso de labores',
  salida: 'Marcar salida'
}

// Las pausas no llevan foto: son interrupciones dentro del almuerzo.
export const NO_PHOTO_EVENTS = ['almuerzo_pausa', 'almuerzo_reanuda']

// Marcas que se pueden olvidar y pedir corregir.
export const CORRECTABLE_EVENTS = ['entrada', 'almuerzo_inicio', 'almuerzo_fin', 'salida']

// Segundos que le quedan al almuerzo (negativo = excedido). lunch viene de my_attendance_status.
export function lunchRemainingSeconds(lunch, nowMs = Date.now()) {
  if (!lunch) return 0
  const start = new Date(lunch.started_at).getTime()
  let paused = (lunch.paused_seconds || 0) * 1000
  if (lunch.paused_since) paused += nowMs - new Date(lunch.paused_since).getTime()
  const used = nowMs - start - paused
  return Math.round((lunch.stipulated_minutes * 60000 - used) / 1000)
}

export function formatClock(totalSeconds) {
  const sign = totalSeconds < 0 ? '-' : ''
  const t = Math.abs(totalSeconds)
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
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
  const s = { days: 0, worked: 0, late: 0, lateDays: 0, overtime: 0, absences: 0, incomplete: 0, lunchOver: 0, pauses: 0, lunchFlags: 0 }
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
    s.pauses += r.lunch_pause_minutes || 0
    if (r.lunch_flag) s.lunchFlags += 1
    if (r.incomplete) s.incomplete += 1
  }
  return s
}
