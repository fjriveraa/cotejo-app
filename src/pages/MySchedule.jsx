import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { hondurasDateStr, formatDateLong, addDays, mondayOf, weekLabel, formatTime } from '../lib/attendance'

const DAY_NAMES = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const hm = (t) => (t ? t.slice(0, 5) : '')

function profileText(pr) {
  if (!pr) return 'Tu horario lo define tu empleador semana a semana.'
  if (pr.mode === 'variable') return `Horario variable: se cuentan las horas desde que entras hasta que sales${pr.daily_hours ? ` (referencia ${pr.daily_hours} h por día)` : ''}.`
  return `Horario fijo: entras a las ${hm(pr.start_time)} los días ${(pr.work_days || []).map((d) => DAY_NAMES[d - 1]).join(' ')}.`
}

export default function MySchedule() {
  const { membership } = useAuth()
  const orgId = membership?.organization_id
  const [monday, setMonday] = useState(() => mondayOf(hondurasDateStr()))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!orgId) return
    setLoading(true)
    supabase.rpc('my_schedule', { p_organization_id: orgId, p_from: monday, p_to: addDays(monday, 6) }).then(({ data: d, error: err }) => {
      setLoading(false)
      if (err) { setError(err.message); return }
      setError(null)
      setData(d)
    })
  }, [orgId, monday])

  const today = hondurasDateStr()
  const days = data?.days || []
  const free = days.filter((d) => d.is_off).length

  return (
    <div className="container" style={{ maxWidth: 560 }}>
      <h1 className="page-title">Mi horario</h1>
      <p style={{ opacity: 0.75, marginTop: 0 }}>{loading ? ' ' : profileText(data?.profile)}</p>

      <div className="card" style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'space-between' }}>
        <button type="button" className="btn btn-secondary" onClick={() => setMonday(addDays(monday, -7))}>←</button>
        <strong>{weekLabel(monday)}</strong>
        <button type="button" className="btn btn-secondary" onClick={() => setMonday(addDays(monday, 7))}>→</button>
      </div>

      {error && <p className="error-text">{error}</p>}
      {loading ? <p style={{ opacity: 0.6 }}>Cargando...</p> : (
        <div className="card" style={{ marginTop: 12 }}>
          {days.map((d) => (
            <div key={d.work_date} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '10px 0', borderTop: '1px solid rgba(0,0,0,0.06)', background: d.work_date === today ? 'rgba(43,100,89,0.07)' : undefined }}>
              <div>
                <div style={{ fontWeight: 700, textTransform: 'capitalize' }}>{formatDateLong(d.work_date)}{d.work_date === today && ' · hoy'}</div>
                {d.branch_name && !d.is_off && <div style={{ fontSize: 12, opacity: 0.65 }}>{d.branch_name}</div>}
              </div>
              <div style={{ textAlign: 'right', fontSize: 14 }}>
                {d.is_off ? <strong style={{ color: '#A2483A' }}>Día libre</strong> : d.start_time ? (
                  <>
                    <div>Entrada <strong>{formatTime(`${d.work_date}T${d.start_time}-06:00`)}</strong>{d.end_time && <> · Salida <strong>{formatTime(`${d.work_date}T${d.end_time}-06:00`)}</strong></>}</div>
                    {d.lunch_start && <div style={{ fontSize: 12, opacity: 0.75 }}>Almuerzo {formatTime(`${d.work_date}T${d.lunch_start}-06:00`)}</div>}
                  </>
                ) : <span style={{ opacity: 0.4 }}>{data?.profile?.mode === 'variable' ? 'Horario variable' : 'Sin turno'}</span>}
              </div>
            </div>
          ))}
          {free > 0 && <p style={{ margin: '8px 0 0', fontSize: 12, opacity: 0.65 }}>Esta semana tienes {free} día{free > 1 ? 's' : ''} libre{free > 1 ? 's' : ''}.</p>}
        </div>
      )}
      <p style={{ marginTop: 12 }}><Link to="/mi-asistencia">← Mi asistencia</Link></p>
    </div>
  )
}
