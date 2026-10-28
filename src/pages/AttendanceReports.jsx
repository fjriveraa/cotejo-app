import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import EvidenceViewer from '../components/EvidenceViewer'
import {
  EVENT_LABELS, hondurasDateStr, formatTime, formatDateLong, addDays, mondayOf,
  monthKey, monthLabel, weekKey, weekLabel, formatMinutes, summarize
} from '../lib/attendance'

const OWNER_ROLES = ['propietario', 'admin']
const SUPERVISE_ROLES = ['propietario', 'admin', 'supervisor']

const TABS = [
  { id: 'reporte', label: 'Reportes' },
  { id: 'horarios', label: 'Horarios' },
  { id: 'correcciones', label: 'Correcciones' },
  { id: 'config', label: 'Dispositivos y reglas' }
]

export default function AttendanceReports() {
  const { membership } = useAuth()
  const orgId = membership?.organization_id
  const canSupervise = SUPERVISE_ROLES.includes(membership?.role)
  const isOwner = OWNER_ROLES.includes(membership?.role)
  const [tab, setTab] = useState('reporte')
  const [employees, setEmployees] = useState([])
  const [branches, setBranches] = useState([])

  useEffect(() => {
    if (!orgId) return
    supabase.rpc('list_attendance_employees', { p_organization_id: orgId }).then(({ data }) => setEmployees(data || []))
    supabase.from('branches').select('id, name').eq('organization_id', orgId).eq('active', true).then(({ data }) => setBranches(data || []))
  }, [orgId])

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h1 className="page-title" style={{ margin: 0 }}>Asistencia</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {isOwner && <Link to="/invitar" className="btn btn-secondary">+ Invitar empleado</Link>}
          {canSupervise && <Link to="/asistencia/marcar" className="btn btn-secondary">Abrir modo marcación</Link>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, margin: '16px 0', flexWrap: 'wrap' }}>
        {TABS.filter((t) => t.id !== 'config' || isOwner).map((t) => (
          <button key={t.id} type="button" className={`btn ${tab === t.id ? '' : 'btn-secondary'}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab === 'reporte' && <ReportTab orgId={orgId} employees={employees} branches={branches} canSupervise={canSupervise} />}
      {tab === 'horarios' && <ScheduleTab orgId={orgId} employees={employees} branches={branches} canEdit={canSupervise} />}
      {tab === 'correcciones' && <CorrectionsTab orgId={orgId} canReview={canSupervise} />}
      {tab === 'config' && isOwner && <ConfigTab orgId={orgId} branches={branches} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Reportes                                                           */
/* ------------------------------------------------------------------ */

function periodRange(kind, customFrom, customTo) {
  const today = hondurasDateStr()
  if (kind === 'hoy') return [today, today]
  if (kind === 'semana') return [mondayOf(today), addDays(mondayOf(today), 6)]
  if (kind === 'mes') return [`${today.slice(0, 7)}-01`, today]
  if (kind === 'anio') return [`${today.slice(0, 4)}-01-01`, today]
  return [customFrom || today, customTo || today]
}

function groupKeyFor(view, dateStr) {
  if (view === 'dia') return dateStr
  if (view === 'semana') return weekKey(dateStr)
  if (view === 'mes') return monthKey(dateStr)
  return dateStr.slice(0, 4)
}

function groupLabel(view, key) {
  if (view === 'dia') return formatDateLong(key)
  if (view === 'semana') return weekLabel(key)
  if (view === 'mes') return monthLabel(key)
  return `Año ${key}`
}

function ReportTab({ orgId, employees, branches, canSupervise }) {
  const [period, setPeriod] = useState('semana')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [view, setView] = useState('dia')
  const [employeeId, setEmployeeId] = useState('')
  const [branchId, setBranchId] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [detail, setDetail] = useState(null)

  const [from, to] = periodRange(period, customFrom, customTo)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('attendance_report', {
      p_organization_id: orgId, p_from: from, p_to: to,
      p_membership_id: employeeId || null, p_branch_id: branchId || null
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    setRows(data || [])
  }, [orgId, from, to, employeeId, branchId])

  useEffect(() => { load() }, [load])

  const groups = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      const k = groupKeyFor(view, r.work_date)
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(r)
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [rows, view])

  function exportExcel() {
    const detailRows = [...rows].sort((a, b) => (a.work_date < b.work_date ? -1 : 1)).map((r) => ({
      Fecha: r.work_date,
      Empleado: r.employee_name,
      Sucursal: r.branch_name || '',
      'Hora de entrada asignada': r.scheduled_start ? r.scheduled_start.slice(0, 5) : '',
      'Entrada real': r.first_in ? formatTime(r.first_in) : '',
      'Salida real': r.last_out ? formatTime(r.last_out) : '',
      'Almuerzo (min)': r.lunch_minutes,
      'Almuerzo excedido (min)': r.lunch_over_minutes,
      'Horas trabajadas': Number(((r.worked_minutes || 0) / 60).toFixed(2)),
      'Minutos tarde': r.late_minutes,
      'Horas extra': Number(((r.overtime_minutes || 0) / 60).toFixed(2)),
      Estado: r.absent ? 'Ausente' : r.incomplete ? 'Incompleto' : 'Completo'
    }))
    const byEmp = new Map()
    for (const r of rows) {
      if (!byEmp.has(r.membership_id)) byEmp.set(r.membership_id, { name: r.employee_name, rows: [] })
      byEmp.get(r.membership_id).rows.push(r)
    }
    const summaryRows = [...byEmp.values()].map(({ name, rows: rs }) => {
      const s = summarize(rs)
      return {
        Empleado: name,
        'Días trabajados': s.days,
        'Horas trabajadas': Number((s.worked / 60).toFixed(2)),
        'Minutos tarde (total)': s.late,
        'Días con tardanza': s.lateDays,
        'Horas extra': Number((s.overtime / 60).toFixed(2)),
        Ausencias: s.absences,
        'Días incompletos': s.incomplete
      }
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Resumen')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), 'Detalle')
    XLSX.writeFile(wb, `asistencia_${from}_a_${to}.xlsx`)
  }

  return (
    <div>
      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[['hoy', 'Hoy'], ['semana', 'Esta semana'], ['mes', 'Este mes'], ['anio', 'Este año'], ['custom', 'Personalizado']].map(([id, label]) => (
            <button key={id} type="button" className={`btn ${period === id ? '' : 'btn-secondary'}`} style={{ fontSize: 13 }} onClick={() => setPeriod(id)}>{label}</button>
          ))}
        </div>
        {period === 'custom' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label>Desde <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></label>
            <label>Hasta <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></label>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
          <label>Agrupar por
            <select value={view} onChange={(e) => setView(e.target.value)}>
              <option value="dia">Día</option>
              <option value="semana">Semana</option>
              <option value="mes">Mes</option>
              <option value="anio">Año</option>
            </select>
          </label>
          <label>Empleado
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Todos</option>
              {employees.map((e) => <option key={e.membership_id} value={e.membership_id}>{e.display_name}</option>)}
            </select>
          </label>
          <label>Sucursal
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">Todas</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-secondary" onClick={exportExcel} disabled={rows.length === 0}>Descargar Excel</button>
        </div>
        <div style={{ fontSize: 12, opacity: 0.6 }}>Del {from} al {to}</div>
      </div>

      {error && <p className="error-text">{error}</p>}
      {loading ? (
        <p style={{ opacity: 0.6 }}>Cargando...</p>
      ) : groups.length === 0 ? (
        <p style={{ opacity: 0.6, marginTop: 16 }}>No hay marcas en este período.</p>
      ) : (
        <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
          {groups.map(([key, groupRows], i) => (
            <GroupFolder key={key} view={view} gkey={key} rows={groupRows} defaultOpen={i === 0} onOpenDetail={setDetail} />
          ))}
        </div>
      )}

      {detail && (
        <DayDetail
          orgId={orgId}
          row={detail}
          canEdit={canSupervise}
          onClose={() => setDetail(null)}
          onChanged={load}
        />
      )}
    </div>
  )
}

function Totals({ s }) {
  return (
    <span style={{ fontSize: 12, opacity: 0.75, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <span>{formatMinutes(s.worked)} trabajadas</span>
      <span style={{ color: s.late > 0 ? '#A2483A' : undefined }}>{s.late} min tarde{s.lateDays ? ` (${s.lateDays} d)` : ''}</span>
      {s.overtime > 0 && <span>{formatMinutes(s.overtime)} extra</span>}
      {s.absences > 0 && <span style={{ color: '#A2483A' }}>{s.absences} ausencia{s.absences > 1 ? 's' : ''}</span>}
      {s.incomplete > 0 && <span>{s.incomplete} incompleto{s.incomplete > 1 ? 's' : ''}</span>}
    </span>
  )
}

function GroupFolder({ view, gkey, rows, defaultOpen, onOpenDetail }) {
  const s = summarize(rows)
  return (
    <details open={defaultOpen} className="card" style={{ padding: 0 }}>
      <summary style={{ cursor: 'pointer', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <strong style={{ textTransform: 'capitalize' }}>{groupLabel(view, gkey)}</strong>
        <Totals s={s} />
      </summary>
      <div style={{ padding: '0 16px 12px', overflowX: 'auto' }}>
        {view === 'dia' ? <DayRows rows={rows} onOpenDetail={onOpenDetail} /> : <EmployeeRows rows={rows} view={view} onOpenDetail={onOpenDetail} />}
      </div>
    </details>
  )
}

const th = { textAlign: 'left', fontSize: 12, opacity: 0.6, padding: '4px 8px', whiteSpace: 'nowrap' }
const td = { padding: '6px 8px', fontSize: 14, whiteSpace: 'nowrap' }

function DayRows({ rows, onOpenDetail }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr><th style={th}>Empleado</th><th style={th}>Entrada</th><th style={th}>Salida</th><th style={th}>Almuerzo</th><th style={th}>Trabajadas</th><th style={th}>Tarde</th><th style={th}>Extra</th><th style={th}></th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.membership_id}-${r.work_date}`} style={{ borderTop: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer' }} onClick={() => onOpenDetail?.(r)}>
            <td style={td}><strong>{r.employee_name}</strong>{r.branch_name && <span style={{ opacity: 0.55 }}> · {r.branch_name}</span>}</td>
            {r.absent ? (
              <td style={{ ...td, color: '#A2483A' }} colSpan={6}>Ausente{r.scheduled_start ? ` (entraba ${r.scheduled_start.slice(0, 5)})` : ''}</td>
            ) : (
              <>
                <td style={td}>{formatTime(r.first_in)}{r.scheduled_start && <span style={{ opacity: 0.5 }}> / {r.scheduled_start.slice(0, 5)}</span>}</td>
                <td style={td}>{r.last_out ? formatTime(r.last_out) : <span style={{ color: '#A2483A' }}>sin salida</span>}</td>
                <td style={td}>{r.lunch_minutes ? `${r.lunch_minutes} min` : '—'}{r.lunch_over_minutes > 0 && <span style={{ color: '#A2483A' }}> (+{r.lunch_over_minutes})</span>}</td>
                <td style={td}>{formatMinutes(r.worked_minutes)}</td>
                <td style={{ ...td, color: r.late_minutes > 0 ? '#A2483A' : undefined, fontWeight: r.late_minutes > 0 ? 700 : 400 }}>{r.late_minutes > 0 ? `${r.late_minutes} min` : '—'}</td>
                <td style={td}>{r.overtime_minutes > 0 ? formatMinutes(r.overtime_minutes) : '—'}</td>
                <td style={td}>{r.incomplete ? <span title="Marcas incompletas" style={{ color: '#92400E' }}>⚠</span> : ''}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function EmployeeRows({ rows, onOpenDetail }) {
  const byEmp = new Map()
  for (const r of rows) {
    if (!byEmp.has(r.membership_id)) byEmp.set(r.membership_id, { name: r.employee_name, rows: [] })
    byEmp.get(r.membership_id).rows.push(r)
  }
  const list = [...byEmp.values()].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr><th style={th}>Empleado</th><th style={th}>Días</th><th style={th}>Trabajadas</th><th style={th}>Min. tarde</th><th style={th}>Días tarde</th><th style={th}>Extra</th><th style={th}>Ausencias</th></tr>
      </thead>
      <tbody>
        {list.map(({ name, rows: rs }) => {
          const s = summarize(rs)
          return (
            <tr key={name} style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
              <td style={td}><strong>{name}</strong></td>
              <td style={td}>{s.days}</td>
              <td style={td}>{formatMinutes(s.worked)}</td>
              <td style={{ ...td, color: s.late > 0 ? '#A2483A' : undefined, fontWeight: s.late > 0 ? 700 : 400 }}>{s.late}</td>
              <td style={td}>{s.lateDays}</td>
              <td style={td}>{s.overtime > 0 ? formatMinutes(s.overtime) : '—'}</td>
              <td style={{ ...td, color: s.absences > 0 ? '#A2483A' : undefined }}>{s.absences}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function DayDetail({ orgId, row, canEdit, onClose, onChanged }) {
  const [punches, setPunches] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [photo, setPhoto] = useState(null)
  const [showAdd, setShowAdd] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: err } = await supabase.rpc('list_attendance_punches', {
      p_organization_id: orgId, p_membership_id: row.membership_id, p_work_date: row.work_date
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    setPunches(data || [])
  }, [orgId, row])

  useEffect(() => { load() }, [load])

  async function voidPunch(p) {
    const reason = window.prompt('Motivo para anular esta marca (queda en el historial):')
    if (!reason || !reason.trim()) return
    const { error: err } = await supabase.rpc('void_attendance_punch', { p_punch_id: p.punch_id, p_reason: reason })
    if (err) { setError(err.message); return }
    await load()
    onChanged()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 50, display: 'grid', placeItems: 'center', padding: 12 }} onClick={onClose}>
      <div className="card" style={{ width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>{row.employee_name}</h2>
            <div style={{ opacity: 0.65, textTransform: 'capitalize' }}>{formatDateLong(row.work_date)}</div>
          </div>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cerrar</button>
        </div>
        {error && <p className="error-text">{error}</p>}
        {loading ? <p style={{ opacity: 0.6 }}>Cargando...</p> : punches.length === 0 ? <p style={{ opacity: 0.6 }}>Sin marcas este día.</p> : (
          <div style={{ marginTop: 12 }}>
            {punches.map((p) => (
              <div key={p.punch_id} style={{ padding: '8px 0', borderTop: '1px solid rgba(0,0,0,0.06)', opacity: p.voided_at ? 0.5 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ textDecoration: p.voided_at ? 'line-through' : 'none' }}>
                    <strong>{EVENT_LABELS[p.event_type]}</strong> · {formatTime(p.punched_at)}
                    {p.branch_name && <span style={{ opacity: 0.6 }}> · {p.branch_name}</span>}
                  </span>
                  <span style={{ display: 'flex', gap: 6 }}>
                    {p.photo_path && <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: '2px 8px' }} onClick={() => setPhoto(p.photo_path)}>Foto</button>}
                    {canEdit && !p.voided_at && <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: '2px 8px' }} onClick={() => voidPunch(p)}>Anular</button>}
                  </span>
                </div>
                {p.source === 'correccion' && <div style={{ fontSize: 12, opacity: 0.65 }}>{p.note}</div>}
                {p.source === 'telefono' && (
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    Marcada desde teléfono
                    {p.geo?.lat != null ? (
                      <> · <a href={`https://www.google.com/maps?q=${p.geo.lat},${p.geo.lng}`} target="_blank" rel="noreferrer">ver ubicación</a>{p.geo.accuracy ? ` (±${Math.round(p.geo.accuracy)} m)` : ''}</>
                    ) : ' · sin ubicación'}
                  </div>
                )}
                {p.voided_at && <div style={{ fontSize: 12, color: '#A2483A' }}>Anulada: {p.void_reason}</div>}
              </div>
            ))}
          </div>
        )}
        {canEdit && (
          <div style={{ marginTop: 12 }}>
            {showAdd ? (
              <AddPunch orgId={orgId} row={row} onDone={async () => { setShowAdd(false); await load(); onChanged() }} />
            ) : (
              <button type="button" className="btn btn-secondary" onClick={() => setShowAdd(true)}>Agregar marca olvidada</button>
            )}
          </div>
        )}
        {photo && <EvidenceViewer bucket="attendance-photos" path={photo} onClose={() => setPhoto(null)} />}
      </div>
    </div>
  )
}

function AddPunch({ orgId, row, onDone }) {
  const [type, setType] = useState('entrada')
  const [time, setTime] = useState('08:00')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.rpc('add_manual_attendance_punch', {
      p_organization_id: orgId, p_membership_id: row.membership_id, p_work_date: row.work_date,
      p_event_type: type, p_time: time, p_reason: reason
    })
    setBusy(false)
    if (err) { setError(err.message); return }
    onDone()
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 8 }}>
      <select value={type} onChange={(e) => setType(e.target.value)}>
        {Object.entries(EVENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (obligatorio)" required />
      {error && <p className="error-text" style={{ margin: 0 }}>{error}</p>}
      <button className="btn" disabled={busy}>{busy ? 'Guardando...' : 'Guardar marca'}</button>
    </form>
  )
}

/* ------------------------------------------------------------------ */
/* Horarios                                                           */
/* ------------------------------------------------------------------ */

function ScheduleTab({ orgId, employees, branches, canEdit }) {
  const [monday, setMonday] = useState(() => mondayOf(hondurasDateStr()))
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [edit, setEdit] = useState(null) // { membership_id, name, date, current }
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    const { data, error: err } = await supabase.rpc('list_attendance_schedule', {
      p_organization_id: orgId, p_from: monday, p_to: addDays(monday, 6)
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    setItems(data || [])
  }, [orgId, monday])

  useEffect(() => { load() }, [load])

  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const cell = (mid, d) => items.find((x) => x.membership_id === mid && x.work_date === d)

  async function copyPrevious() {
    setMsg(null)
    const { data, error: err } = await supabase.rpc('copy_attendance_week', {
      p_organization_id: orgId, p_from_monday: addDays(monday, -7), p_to_monday: monday
    })
    if (err) { setError(err.message); return }
    setMsg(`Se copiaron ${data} turnos de la semana anterior (lo que ya estaba asignado no se tocó).`)
    load()
  }

  return (
    <div>
      <div className="card" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setMonday(addDays(monday, -7))}>←</button>
          <strong>{weekLabel(monday)}</strong>
          <button type="button" className="btn btn-secondary" onClick={() => setMonday(addDays(monday, 7))}>→</button>
        </div>
        {canEdit && <button type="button" className="btn btn-secondary" onClick={copyPrevious}>Copiar semana anterior</button>}
      </div>
      {msg && <p style={{ color: '#2B6459' }}>{msg}</p>}
      {error && <p className="error-text">{error}</p>}
      {loading ? <p style={{ opacity: 0.6 }}>Cargando...</p> : (
        <div className="card" style={{ marginTop: 12, overflowX: 'auto', padding: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr>
                <th style={th}>Empleado</th>
                {days.map((d) => <th key={d} style={th}>{formatDateLong(d).split(' ')[0]} {d.slice(8)}</th>)}
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.membership_id} style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                  <td style={td}><strong>{e.display_name}</strong></td>
                  {days.map((d) => {
                    const c = cell(e.membership_id, d)
                    return (
                      <td key={d} style={{ ...td, padding: 2 }}>
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => setEdit({ membership_id: e.membership_id, name: e.display_name, date: d, current: c })}
                          style={{ width: '100%', minHeight: 44, border: '1px dashed rgba(0,0,0,0.15)', borderRadius: 6, background: c ? 'rgba(43,100,89,0.08)' : 'transparent', fontSize: 12, lineHeight: 1.3, cursor: canEdit ? 'pointer' : 'default' }}
                        >
                          {c ? (<><strong>{c.start_time.slice(0, 5)}</strong>{c.end_time ? `–${c.end_time.slice(0, 5)}` : ''}<br /><span style={{ opacity: 0.6 }}>{c.branch_name || ''}</span></>) : <span style={{ opacity: 0.35 }}>libre</span>}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <ScheduleEditor orgId={orgId} branches={branches} edit={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
    </div>
  )
}

function ScheduleEditor({ orgId, branches, edit, onClose, onSaved }) {
  const cur = edit.current
  const [start, setStart] = useState(cur?.start_time?.slice(0, 5) || '08:00')
  const [end, setEnd] = useState(cur?.end_time?.slice(0, 5) || '')
  const [branchId, setBranchId] = useState(cur?.branch_id || branches[0]?.id || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    const { error: err } = await supabase.rpc('set_attendance_schedule', {
      p_organization_id: orgId, p_membership_id: edit.membership_id, p_work_date: edit.date,
      p_branch_id: branchId || null, p_start_time: start, p_end_time: end || null
    })
    setBusy(false)
    if (err) { setError(err.message); return }
    onSaved()
  }

  async function clear() {
    setBusy(true)
    const { error: err } = await supabase.rpc('clear_attendance_schedule', {
      p_organization_id: orgId, p_membership_id: edit.membership_id, p_work_date: edit.date
    })
    setBusy(false)
    if (err) { setError(err.message); return }
    onSaved()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 50, display: 'grid', placeItems: 'center', padding: 12 }} onClick={onClose}>
      <form className="card" onSubmit={save} onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 380, display: 'grid', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{edit.name}</h2>
        <div style={{ opacity: 0.65, textTransform: 'capitalize' }}>{formatDateLong(edit.date)}</div>
        <label>Hora de entrada <input type="time" value={start} onChange={(e) => setStart(e.target.value)} required /></label>
        <label>Hora de salida (opcional) <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <label>Sucursal
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        {error && <p className="error-text" style={{ margin: 0 }}>{error}</p>}
        <button className="btn" disabled={busy}>Guardar</button>
        {cur && <button type="button" className="btn btn-secondary" disabled={busy} onClick={clear}>Dejar libre</button>}
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
      </form>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Correcciones                                                       */
/* ------------------------------------------------------------------ */

function CorrectionsTab({ orgId, canReview }) {
  const [status, setStatus] = useState('pending')
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    const { data, error: err } = await supabase.rpc('list_attendance_corrections', { p_organization_id: orgId, p_status: status })
    setLoading(false)
    if (err) { setError(err.message); return }
    setList(data || [])
  }, [orgId, status])

  useEffect(() => { load() }, [load])

  async function review(c, approve) {
    let notes = null
    if (!approve) {
      notes = window.prompt('Motivo del rechazo (opcional):') || null
    }
    setBusyId(c.correction_id)
    const { error: err } = await supabase.rpc('review_attendance_correction', { p_correction_id: c.correction_id, p_approve: approve, p_notes: notes })
    setBusyId(null)
    if (err) { setError(err.message); return }
    load()
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {[['pending', 'Pendientes'], ['approved', 'Aprobadas'], ['rejected', 'Rechazadas']].map(([id, label]) => (
          <button key={id} type="button" className={`btn ${status === id ? '' : 'btn-secondary'}`} style={{ fontSize: 13 }} onClick={() => setStatus(id)}>{label}</button>
        ))}
      </div>
      {error && <p className="error-text">{error}</p>}
      {loading ? <p style={{ opacity: 0.6 }}>Cargando...</p> : list.length === 0 ? <p style={{ opacity: 0.6 }}>No hay solicitudes.</p> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {list.map((c) => (
            <div key={c.correction_id} className="card">
              <div><strong>{c.employee_name}</strong> · {EVENT_LABELS[c.event_type]} a las {c.requested_time.slice(0, 5)}</div>
              <div style={{ opacity: 0.65, textTransform: 'capitalize' }}>{formatDateLong(c.work_date)}</div>
              <div style={{ marginTop: 4 }}>“{c.reason}”</div>
              {c.review_notes && <div style={{ fontSize: 13, opacity: 0.7 }}>Nota: {c.review_notes}</div>}
              {canReview && c.status === 'pending' && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button type="button" className="btn" disabled={busyId === c.correction_id} onClick={() => review(c, true)}>Aprobar</button>
                  <button type="button" className="btn btn-secondary" disabled={busyId === c.correction_id} onClick={() => review(c, false)}>Rechazar</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Dispositivos y reglas                                              */
/* ------------------------------------------------------------------ */

function ConfigTab({ orgId, branches }) {
  const [settings, setSettings] = useState(null)
  const [devices, setDevices] = useState([])
  const [error, setError] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [s, d] = await Promise.all([
      supabase.rpc('get_attendance_settings', { p_organization_id: orgId }),
      supabase.rpc('list_attendance_devices', { p_organization_id: orgId })
    ])
    if (s.error) setError(s.error.message); else setSettings(s.data)
    if (!d.error) setDevices(d.data || [])
  }, [orgId])

  useEffect(() => { if (orgId) load() }, [orgId, load])

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const { error: err } = await supabase.rpc('set_attendance_settings', {
      p_organization_id: orgId,
      p_tolerance_minutes: Number(settings.tolerance_minutes),
      p_daily_hours_cap: Number(settings.daily_hours_cap),
      p_lunch_max_minutes: Number(settings.lunch_max_minutes),
      p_allow_self_punch: !!settings.allow_self_punch
    })
    setBusy(false)
    if (err) { setError(err.message); return }
    setError(null)
    setMsg('Reglas guardadas. Aplican a los reportes desde ahora (también a los días anteriores al consultarlos).')
  }

  async function deactivate(d) {
    if (!window.confirm(`¿Desactivar "${d.name}"? Dejará de poder registrar marcas.`)) return
    const { error: err } = await supabase.rpc('deactivate_attendance_device', { p_device_id: d.device_id })
    if (err) { setError(err.message); return }
    load()
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {error && <p className="error-text">{error}</p>}
      {settings && (
        <form onSubmit={save} className="card" style={{ display: 'grid', gap: 8, maxWidth: 480 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Reglas de cálculo</h2>
          <label>Tolerancia de entrada (minutos)
            <input type="number" min="0" max="120" value={settings.tolerance_minutes} onChange={(e) => setSettings({ ...settings, tolerance_minutes: e.target.value })} />
          </label>
          <small style={{ opacity: 0.65, marginTop: -4 }}>Si llega dentro de la tolerancia no cuenta como tarde; si la pasa, se cuentan todos los minutos desde la hora de entrada.</small>
          <label>Horas por día antes de horas extra
            <input type="number" min="1" max="24" step="0.5" value={settings.daily_hours_cap} onChange={(e) => setSettings({ ...settings, daily_hours_cap: e.target.value })} />
          </label>
          <label>Máximo de almuerzo (minutos)
            <input type="number" min="0" max="240" value={settings.lunch_max_minutes} onChange={(e) => setSettings({ ...settings, lunch_max_minutes: e.target.value })} />
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={!!settings.allow_self_punch} onChange={(e) => setSettings({ ...settings, allow_self_punch: e.target.checked })} style={{ marginTop: 4 }} />
            <span>
              Permitir que los empleados marquen desde su teléfono
              <small style={{ display: 'block', opacity: 0.65 }}>Piden foto selfie y guardan la ubicación como evidencia; quedan etiquetadas “desde teléfono” para que las revises. Apagado: solo marcan con QR en el dispositivo de la sucursal.</small>
            </span>
          </label>
          {msg && <p style={{ color: '#2B6459', margin: 0 }}>{msg}</p>}
          <button className="btn" disabled={busy}>Guardar reglas</button>
        </form>
      )}

      <div className="card" style={{ maxWidth: 480 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Dispositivos de marcación</h2>
        {devices.filter((d) => d.active).length === 0 ? (
          <p style={{ opacity: 0.65 }}>Aún no hay dispositivos. Abre “modo marcación” en la tableta de la sucursal para registrarla.</p>
        ) : devices.filter((d) => d.active).map((d) => (
          <div key={d.device_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
            <span><strong>{d.name}</strong> <span style={{ opacity: 0.6 }}>· {d.branch_name}</span></span>
            <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => deactivate(d)}>Desactivar</button>
          </div>
        ))}
      </div>
    </div>
  )
}
