import { useCallback, useEffect, useState } from 'react'
import AttendanceQr from '../components/AttendanceQr'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { EVENT_LABELS, TZ, hondurasDateStr, formatTime, formatDateLong, addDays } from '../lib/attendance'

export default function MyAttendance() {
  const { membership } = useAuth()
  const orgId = membership?.organization_id
  const [punches, setPunches] = useState([])
  const [loadingPunches, setLoadingPunches] = useState(true)
  const [showCorrection, setShowCorrection] = useState(false)

  const loadPunches = useCallback(async () => {
    if (!orgId) return
    const today = hondurasDateStr()
    const { data, error } = await supabase.rpc('my_attendance', {
      p_organization_id: orgId,
      p_from: addDays(today, -6),
      p_to: today
    })
    setLoadingPunches(false)
    if (!error) setPunches(data || [])
  }, [orgId])

  useEffect(() => {
    loadPunches()
    const onVisible = () => { if (document.visibilityState === 'visible') loadPunches() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [loadPunches])

  const byDay = {}
  for (const p of punches) {
    if (p.voided) continue
    const d = hondurasDateStr(new Date(p.punched_at))
    if (!byDay[d]) byDay[d] = []
    byDay[d].push(p)
  }
  const days = Object.keys(byDay).sort().reverse()

  return (
    <div className="container" style={{ maxWidth: 560 }}>
      <h1 className="page-title">Mi asistencia</h1>
      <p style={{ opacity: 0.7, marginTop: 0 }}>
        Muestra este código en el dispositivo de tu sucursal para marcar entrada, almuerzo o salida.
      </p>

      <div className="card" style={{ textAlign: 'center' }}>
        <AttendanceQr orgId={orgId} />
        <p style={{ fontSize: 12, opacity: 0.55, margin: '12px 0 0' }}>
          Es de un solo uso y dura menos de un minuto: no sirve compartirlo ni tomarle captura.
        </p>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Mis marcas (últimos 7 días)</h2>
          <button type="button" className="btn btn-secondary" style={{ fontSize: 13 }} onClick={() => setShowCorrection((v) => !v)}>
            {showCorrection ? 'Cerrar' : 'Olvidé marcar'}
          </button>
        </div>

        {showCorrection && (
          <CorrectionForm
            orgId={orgId}
            onDone={() => {
              setShowCorrection(false)
            }}
          />
        )}

        {loadingPunches ? (
          <p style={{ opacity: 0.6 }}>Cargando...</p>
        ) : days.length === 0 ? (
          <p style={{ opacity: 0.6 }}>Todavía no hay marcas esta semana.</p>
        ) : (
          days.map((d) => (
            <div key={d} style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14, textTransform: 'capitalize' }}>{formatDateLong(d)}</div>
              {[...byDay[d]].reverse().map((p) => (
                <div key={p.punch_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 14 }}>
                  <span>
                    {EVENT_LABELS[p.event_type]}
                    {p.source === 'correccion' && <span style={{ opacity: 0.6 }}> · corregida</span>}
                    {p.branch_name && <span style={{ opacity: 0.6 }}> · {p.branch_name}</span>}
                  </span>
                  <strong>{formatTime(p.punched_at)}</strong>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function CorrectionForm({ orgId, onDone }) {
  const today = hondurasDateStr()
  const [date, setDate] = useState(today)
  const [type, setType] = useState('entrada')
  const [time, setTime] = useState('08:00')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.rpc('request_attendance_correction', {
      p_organization_id: orgId,
      p_work_date: date,
      p_event_type: type,
      p_time: time,
      p_reason: reason
    })
    setBusy(false)
    if (error) {
      setMsg({ ok: false, text: error.message })
      return
    }
    setMsg({ ok: true, text: 'Solicitud enviada. Tu supervisor la revisará.' })
    setTimeout(onDone, 1500)
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 8, margin: '12px 0', padding: 12, background: 'rgba(43,100,89,0.05)', borderRadius: 8 }}>
      <label>Día
        <input type="date" value={date} min={addDays(today, -45)} max={today} onChange={(e) => setDate(e.target.value)} required />
      </label>
      <label>Qué olvidaste marcar
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(EVENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label>Hora real ({TZ === 'America/Tegucigalpa' ? 'hora de Honduras' : TZ})
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
      </label>
      <label>Motivo
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} required placeholder="Ej. se me agotó la batería del teléfono" />
      </label>
      {msg && <p className={msg.ok ? '' : 'error-text'} style={{ margin: 0 }}>{msg.text}</p>}
      <button className="btn" disabled={busy}>{busy ? 'Enviando...' : 'Enviar solicitud'}</button>
    </form>
  )
}
