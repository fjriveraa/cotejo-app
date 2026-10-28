import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { formatDateLong } from '../lib/attendance'

// Importar un horario hecho en cualquier formato (foto, captura, PDF o Excel).
// 1) La función parse-schedule lo lee con IA y devuelve turnos normalizados.
// 2) Aquí se muestran en una vista previa para corregir y asociar nombres.
// 3) Solo al confirmar se guardan (import_attendance_schedule).

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '').trim()

function bestMatch(name, options, getName) {
  const n = norm(name)
  if (!n) return ''
  let hit = options.find((o) => norm(getName(o)) === n)
  if (!hit) hit = options.find((o) => norm(getName(o)).startsWith(n) || n.startsWith(norm(getName(o)).split(' ')[0]) && norm(getName(o)).split(' ')[0].length >= 3)
  return hit ? hit.key : ''
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1])
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

async function buildPayload(file) {
  const name = file.name.toLowerCase()
  if (/\.(xlsx|xls|csv)$/.test(name)) {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const text = wb.SheetNames.map((n) => `### Hoja: ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false })}`).join('\n\n')
    return { kind: 'text', text }
  }
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    return { kind: 'pdf', data: await fileToBase64(file) }
  }
  return { kind: 'image', media_type: file.type || 'image/jpeg', data: await fileToBase64(file) }
}

export default function ScheduleImport({ orgId, employees, branches, onClose, onSaved }) {
  const [step, setStep] = useState('pick') // pick | reading | review | saving | done
  const [file, setFile] = useState(null)
  const [hint, setHint] = useState('')
  const [error, setError] = useState(null)
  const [shifts, setShifts] = useState([])
  const [daysOff, setDaysOff] = useState([]) // { employee, date, use }
  const [warnings, setWarnings] = useState([])
  const [truncated, setTruncated] = useState(false)
  const [empMap, setEmpMap] = useState({}) // nombre leído -> membership_id
  const [brMap, setBrMap] = useState({}) // sucursal leída -> branch_id
  const [savedCount, setSavedCount] = useState(0)

  const empOptions = useMemo(() => employees.map((e) => ({ key: e.membership_id, name: e.display_name })), [employees])
  const brOptions = useMemo(() => branches.map((b) => ({ key: b.id, name: b.name })), [branches])

  async function read() {
    if (!file) return
    setError(null)
    setStep('reading')
    try {
      const payload = await buildPayload(file)
      const { data, error: err } = await supabase.functions.invoke('parse-schedule', {
        body: {
          organization_id: orgId, hint: hint.trim() || undefined,
          employees: employees.map((e) => e.display_name), branches: branches.map((b) => b.name), ...payload
        }
      })
      if (err) {
        let msg = err.message
        try { const j = await err.context?.json?.(); if (j?.error) msg = j.error } catch { /* sin detalle */ }
        throw new Error(msg)
      }
      if (data?.error) throw new Error(data.error)
      const list = (data.shifts || []).filter((s) => s.employee && s.date).map((s, i) => ({ ...s, id: i, use: !!s.start_time }))
      if (list.length === 0 && !(data.days_off || []).length) throw new Error('No encontré turnos en ese archivo. Prueba con una imagen más nítida o indica de qué semana es.')
      const em = {}
      const bm = {}
      for (const s of list) {
        if (!(s.employee in em)) em[s.employee] = bestMatch(s.employee, empOptions, (o) => o.name)
        if (s.branch && !(s.branch in bm)) bm[s.branch] = bestMatch(s.branch, brOptions, (o) => o.name)
      }
      setEmpMap(em)
      setBrMap(bm)
      setShifts(list)
      const offList = (data.days_off || []).filter((d) => d.employee && d.date).map((d, i) => ({ ...d, id: i, use: true }))
      for (const d of offList) if (!(d.employee in em)) em[d.employee] = bestMatch(d.employee, empOptions, (o) => o.name)
      setEmpMap(em)
      setDaysOff(offList)
      setWarnings(data.warnings || [])
      setTruncated(!!data.truncated)
      setStep('review')
    } catch (e) {
      setError(e.message || 'No se pudo leer el archivo')
      setStep('pick')
    }
  }

  const update = (id, patch) => setShifts((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  const names = Object.keys(empMap)
  const ready = shifts.filter((s) => s.use && empMap[s.employee] && s.start_time)
  const offReady = daysOff.filter((d) => d.use && empMap[d.employee])
  const unmatched = names.filter((n) => !empMap[n] && shifts.some((s) => s.employee === n && s.use))

  async function save() {
    setStep('saving')
    setError(null)
    const rows = ready.map((s) => ({
      membership_id: empMap[s.employee], work_date: s.date, branch_id: (s.branch && brMap[s.branch]) || null,
      start_time: s.start_time, lunch_start: s.lunch_start || null, end_time: s.end_time || null
    }))
    const offRows = offReady.map((d) => ({ membership_id: empMap[d.employee], work_date: d.date }))
    const { data, error: err } = await supabase.rpc('import_attendance_schedule', { p_organization_id: orgId, p_rows: rows, p_days_off: offRows })
    if (err) { setError(err.message); setStep('review'); return }
    setSavedCount(data)
    setStep('done')
  }

  const cellInput = { width: 92, padding: '4px 6px', fontSize: 13 }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 55, display: 'grid', placeItems: 'center', padding: 12 }} onClick={step === 'reading' || step === 'saving' ? undefined : onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: step === 'review' ? 880 : 440, maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Importar horario</h2>
          {step !== 'reading' && step !== 'saving' && <button type="button" className="btn btn-secondary" onClick={onClose}>Cerrar</button>}
        </div>

        {step === 'pick' && (
          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            <p style={{ margin: 0, opacity: 0.75, fontSize: 14 }}>
              Sube tu horario tal como lo haces: foto, captura, PDF o Excel. Cotejo lo lee y te muestra lo que entendió para que lo revises antes de guardar.
            </p>
            <input type="file" accept="image/*,application/pdf,.xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <label>Ayuda opcional
              <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="Ej. es la semana del 26 al 1 de noviembre" />
            </label>
            {error && <p className="error-text" style={{ margin: 0 }}>{error}</p>}
            <button type="button" className="btn" disabled={!file} onClick={read}>Leer horario</button>
          </div>
        )}

        {step === 'reading' && <p style={{ margin: '24px 0', textAlign: 'center' }}>Leyendo el horario… puede tardar hasta un minuto.</p>}
        {step === 'saving' && <p style={{ margin: '24px 0', textAlign: 'center' }}>Guardando…</p>}

        {step === 'review' && (
          <div style={{ marginTop: 10 }}>
            {truncated && <p className="error-text">El horario es muy largo y la lectura quedó incompleta. Importa por semanas.</p>}
            {warnings.length > 0 && (
              <div style={{ background: 'rgba(146,64,14,0.1)', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 13 }}>
                <strong>Revisa esto:</strong>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </div>
            )}

            <h3 style={{ margin: '4px 0', fontSize: 15 }}>1. ¿Quién es quién?</h3>
            <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
              {names.map((n) => (
                <div key={n} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ minWidth: 120 }}>«{n}» →</span>
                  <select value={empMap[n]} onChange={(e) => setEmpMap({ ...empMap, [n]: e.target.value })} style={{ borderColor: empMap[n] ? undefined : '#A2483A' }}>
                    <option value="">— sin asignar (se omite) —</option>
                    {empOptions.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
                  </select>
                </div>
              ))}
              {Object.keys(brMap).map((n) => (
                <div key={n} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ minWidth: 120 }}>Sucursal «{n}» →</span>
                  <select value={brMap[n]} onChange={(e) => setBrMap({ ...brMap, [n]: e.target.value })}>
                    <option value="">— ninguna —</option>
                    {brOptions.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
                  </select>
                </div>
              ))}
            </div>

            <h3 style={{ margin: '4px 0', fontSize: 15 }}>2. Turnos que voy a guardar</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr><th></th><th style={{ textAlign: 'left' }}>Día</th><th style={{ textAlign: 'left' }}>Colaborador</th><th style={{ textAlign: 'left' }}>Sucursal</th><th>Entrada</th><th>Almuerzo</th><th>Salida/cierre</th></tr>
                </thead>
                <tbody>
                  {[...shifts].sort((a, b) => (a.date + a.employee < b.date + b.employee ? -1 : 1)).map((s) => (
                    <tr key={s.id} style={{ borderTop: '1px solid rgba(0,0,0,0.06)', opacity: s.use ? 1 : 0.45, background: s.confidence != null && s.confidence < 0.6 ? 'rgba(146,64,14,0.08)' : undefined }}>
                      <td><input type="checkbox" checked={s.use} onChange={(e) => update(s.id, { use: e.target.checked })} /></td>
                      <td style={{ textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{formatDateLong(s.date)}</td>
                      <td>{s.employee}{s.note && <div style={{ fontSize: 11, color: '#92400E' }}>{s.note}</div>}</td>
                      <td>{s.branch || '—'}</td>
                      <td><input type="time" style={cellInput} value={s.start_time || ''} onChange={(e) => update(s.id, { start_time: e.target.value })} /></td>
                      <td><input type="time" style={cellInput} value={s.lunch_start || ''} onChange={(e) => update(s.id, { lunch_start: e.target.value })} /></td>
                      <td><input type="time" style={cellInput} value={s.end_time || ''} onChange={(e) => update(s.id, { end_time: e.target.value })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {daysOff.length > 0 && (
              <>
                <h3 style={{ margin: '12px 0 4px', fontSize: 15 }}>3. Días libres</h3>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {[...daysOff].sort((a, b) => (a.date + a.employee < b.date + b.employee ? -1 : 1)).map((d) => (
                    <label key={d.id} style={{ display: 'flex', gap: 4, alignItems: 'center', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 16, padding: '2px 10px', fontSize: 13, opacity: d.use ? 1 : 0.45 }}>
                      <input type="checkbox" checked={d.use} onChange={(e) => setDaysOff((prev) => prev.map((x) => (x.id === d.id ? { ...x, use: e.target.checked } : x)))} />
                      <span style={{ textTransform: 'capitalize' }}>{d.employee} · {formatDateLong(d.date)}</span>
                    </label>
                  ))}
                </div>
                <p style={{ fontSize: 12, opacity: 0.7 }}>Un día libre no cuenta como ausencia, aunque el colaborador tenga horario fijo.</p>
              </>
            )}
            {unmatched.length > 0 && <p className="error-text" style={{ fontSize: 13 }}>Sin asignar: {unmatched.join(', ')}. Sus turnos se omitirán.</p>}
            {error && <p className="error-text">{error}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn" disabled={ready.length + offReady.length === 0} onClick={save}>Guardar {ready.length} turno{ready.length === 1 ? '' : 's'}{offReady.length > 0 ? ` y ${offReady.length} día${offReady.length === 1 ? '' : 's'} libre${offReady.length === 1 ? '' : 's'}` : ''}</button>
              <button type="button" className="btn btn-secondary" onClick={() => setStep('pick')}>Subir otro archivo</button>
            </div>
            <p style={{ fontSize: 12, opacity: 0.65 }}>Si ya había un turno ese día para la misma persona, se reemplaza.</p>
          </div>
        )}

        {step === 'done' && (
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <div style={{ fontSize: 40 }}>✓</div>
            <p>Se guardaron {savedCount} registros (turnos y días libres).</p>
            <button type="button" className="btn" onClick={onSaved}>Ver horarios</button>
          </div>
        )}
      </div>
    </div>
  )
}
