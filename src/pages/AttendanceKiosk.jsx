import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import jsQR from 'jsqr'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { EVENT_LABELS, BUTTON_LABELS, formatTime, hondurasDateStr, formatMinutes } from '../lib/attendance'

// Pantalla del dispositivo de la sucursal (tableta o teléfono fijo). El
// empleado muestra su QR frente a la cámara; en el mismo instante se guarda
// una foto como evidencia. El empleado nunca marca desde su propio teléfono:
// así no se puede marcar a distancia.

const CODE_RE = /^[A-F0-9]{10}$/
const OWNER_ROLES = ['propietario', 'admin']

// Barra de salida del modo marcador: ir atrás y salir. Un propietario vuelve a
// la app; la cuenta de reloj (que no tiene otra pantalla) cierra sesión.
function KioskBar({ dark, onBack, backLabel = '← Atrás' }) {
  const { membership, signOut } = useAuth()
  const navigate = useNavigate()
  const isReloj = membership?.role === 'marcador'
  const style = {
    background: dark ? 'rgba(255,255,255,0.12)' : 'transparent',
    color: dark ? '#fff' : 'inherit',
    border: dark ? 'none' : '1px solid rgba(0,0,0,0.2)',
    borderRadius: 10, padding: '8px 14px', fontSize: 14, fontWeight: 600, cursor: 'pointer'
  }
  function exit() {
    if (isReloj) {
      if (window.confirm('¿Cerrar sesión de este reloj? Dejará de detectar entradas hasta que vuelvan a entrar.')) signOut()
    } else {
      navigate('/')
    }
  }
  return (
    <div style={{ width: '100%', maxWidth: 720, display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
      {onBack || !isReloj ? (
        <button type="button" style={style} onClick={onBack || (() => (window.history.length > 1 ? navigate(-1) : navigate('/asistencia')))}>{backLabel}</button>
      ) : <span />}
      <button type="button" style={style} onClick={exit}>{isReloj ? 'Salir (cerrar sesión)' : 'Salir del modo marcador'}</button>
    </div>
  )
}

function deviceKey(orgId) {
  return `cotejo_att_device_${orgId}`
}

export default function AttendanceKiosk() {
  const { membership } = useAuth()
  const orgId = membership?.organization_id
  const isOwner = OWNER_ROLES.includes(membership?.role)

  const [devices, setDevices] = useState([])
  const [branches, setBranches] = useState([])
  const [deviceId, setDeviceId] = useState(() => {
    try { return localStorage.getItem(deviceKey(membership?.organization_id)) } catch { return null }
  })
  const [loadingDevices, setLoadingDevices] = useState(true)
  const [setupError, setSetupError] = useState(null)
  const [settings, setSettings] = useState({ method_qr: true, photo_kiosk: true })

  const loadDevices = useCallback(async () => {
    if (!orgId) return
    const { data, error } = await supabase.rpc('list_attendance_devices', { p_organization_id: orgId })
    setLoadingDevices(false)
    if (error) { setSetupError(error.message); return }
    // Un reloj de sucursal solo ve los dispositivos de su propia sucursal.
    const scope = membership?.role === 'marcador' ? membership?.branch_scope : null
    setDevices((data || []).filter((d) => d.active && (!scope?.length || scope.includes(d.branch_id))))
    // El marcador (cuenta del reloj) solo puede leer los ajustes del modo marcador.
    let { data: st, error: stErr } = await supabase.rpc('get_kiosk_settings', { p_organization_id: orgId })
    if (stErr) ({ data: st } = await supabase.rpc('get_attendance_settings', { p_organization_id: orgId }))
    if (st) setSettings(st)
    const { data: br } = await supabase.from('branches').select('id, name').eq('organization_id', orgId).eq('active', true)
    setBranches(br || [])
  }, [orgId])

  useEffect(() => { loadDevices() }, [loadDevices])

  function chooseDevice(id) {
    try { localStorage.setItem(deviceKey(orgId), id) } catch { /* sin localStorage: se pregunta cada vez */ }
    setDeviceId(id)
  }

  function forgetDevice() {
    try { localStorage.removeItem(deviceKey(orgId)) } catch { /* no-op */ }
    setDeviceId(null)
  }

  const device = devices.find((d) => d.device_id === deviceId)

  if (loadingDevices) return <div className="container"><p style={{ opacity: 0.6 }}>Cargando...</p></div>

  if (setupError) {
    return (
      <div className="container">
        <KioskBar />
        <h1 className="page-title">Marcación</h1>
        <p className="error-text">{setupError}</p>
      </div>
    )
  }

  if (!device) {
    return <DeviceSetup orgId={orgId} devices={devices} branches={branches} isOwner={isOwner} onChoose={chooseDevice} onCreated={loadDevices} />
  }

  if (settings.method_qr === false) {
    return (
      <div className="container" style={{ maxWidth: 520 }}>
        <KioskBar />
        <h1 className="page-title">Marcación</h1>
        <p>La empresa tiene desactivada la marcación con QR. Puedes activarla en Asistencia → Dispositivos y reglas.</p>
      </div>
    )
  }

  return <Scanner orgId={orgId} device={device} settings={settings} onChangeDevice={forgetDevice} />
}

function DeviceSetup({ orgId, devices, branches, isOwner, onChoose, onCreated }) {
  const [name, setName] = useState('')
  const [branchId, setBranchId] = useState(branches[0]?.id || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { if (!branchId && branches[0]) setBranchId(branches[0].id) }, [branches, branchId])

  async function create(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('register_attendance_device', {
      p_organization_id: orgId, p_branch_id: branchId, p_name: name
    })
    setBusy(false)
    if (err) { setError(err.message); return }
    await onCreated()
    onChoose(data)
  }

  return (
    <div className="container" style={{ maxWidth: 520 }}>
      <KioskBar />
      <h1 className="page-title">Dispositivo de marcación</h1>
      <p style={{ opacity: 0.7, marginTop: 0 }}>Elige qué dispositivo es este (queda guardado en este equipo).</p>

      {devices.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          {devices.map((d) => (
            <button key={d.device_id} type="button" className="btn btn-secondary" style={{ display: 'block', width: '100%', marginBottom: 8, textAlign: 'left' }} onClick={() => onChoose(d.device_id)}>
              <strong>{d.name}</strong> <span style={{ opacity: 0.6 }}>· {d.branch_name}</span>
            </button>
          ))}
        </div>
      )}

      {isOwner ? (
        <form onSubmit={create} className="card" style={{ display: 'grid', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Registrar un dispositivo nuevo</h2>
          <label>Nombre
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Ej. Tableta entrada" />
          </label>
          <label>Sucursal
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} required>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          {error && <p className="error-text" style={{ margin: 0 }}>{error}</p>}
          <button className="btn" disabled={busy || !branchId}>{busy ? 'Registrando...' : 'Registrar y usar este equipo'}</button>
        </form>
      ) : (
        devices.length === 0 && <p>Pide a un administrador que registre un dispositivo para tu sucursal.</p>
      )}
    </div>
  )
}

function Scanner({ orgId, device, settings, onChangeDevice }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const stateRef = useRef('scanning')
  const [state, setStateRaw] = useState('scanning') // scanning | choose | saving | done | error
  const [camError, setCamError] = useState(null)
  const [pending, setPending] = useState(null) // { code, name, allowed, photo }
  const [result, setResult] = useState(null)
  const [message, setMessage] = useState(null)
  const [now, setNow] = useState(new Date())
  // Frontal: lee el QR y toma la foto con la cara del empleado (evidencia).
  // Trasera: lee el QR, pero la foto no mostrará a la persona.
  const [facing, setFacing] = useState(() => {
    try { return localStorage.getItem('cotejo_att_camera') === 'environment' ? 'environment' : 'user' } catch { return 'user' }
  })

  function setState(s) {
    stateRef.current = s
    setStateRaw(s)
  }

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
      } catch (e) {
        setCamError('No se pudo abrir la cámara. Permite el acceso a la cámara en el navegador.')
      }
    }
    setCamError(null)
    start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [facing])

  function chooseFacing(next) {
    try { localStorage.setItem('cotejo_att_camera', next) } catch { /* no-op */ }
    setFacing(next)
  }

  const grabPhoto = useCallback(() => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return Promise.resolve(null)
    const c = document.createElement('canvas')
    const scale = Math.min(1, 640 / video.videoWidth)
    c.width = Math.round(video.videoWidth * scale)
    c.height = Math.round(video.videoHeight * scale)
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height)
    return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/jpeg', 0.7))
  }, [])

  const reset = useCallback(() => {
    setPending(null)
    setResult(null)
    setMessage(null)
    setState('scanning')
  }, [])

  const commit = useCallback(async (code, eventType, photoBlob) => {
    setState('saving')
    let photoPath = null
    if (photoBlob) {
      const path = `${orgId}/${hondurasDateStr()}/${crypto.randomUUID()}.jpg`
      const { error: upErr } = await supabase.storage.from('attendance-photos').upload(path, photoBlob, { contentType: 'image/jpeg' })
      if (!upErr) photoPath = path
    }
    const { data, error } = await supabase.rpc('record_attendance', {
      p_device_id: device.device_id, p_code: code, p_event_type: eventType, p_photo_path: photoPath
    })
    if (error) {
      setMessage(error.message)
      setState('error')
      setTimeout(reset, 4500)
      return
    }
    setResult({ ...data, noPhoto: settings?.photo_kiosk !== false && !photoPath })
    setState('done')
    setTimeout(reset, 4000)
  }, [orgId, device.device_id, reset, settings])

  const handleCode = useCallback(async (code) => {
    setState('saving')
    const photo = settings?.photo_kiosk === false ? null : await grabPhoto()
    const { data, error } = await supabase.rpc('peek_attendance_code', { p_device_id: device.device_id, p_code: code })
    if (error) {
      setMessage(error.message)
      setState('error')
      setTimeout(reset, 4000)
      return
    }
    const allowed = data.allowed || []
    if (allowed.length === 1) {
      // Solo hay una marca posible: se registra directo, sin tocar nada más.
      commit(code, allowed[0], photo)
      return
    }
    setPending({ code, name: data.employee_name, allowed, photo })
    setState('choose')
    // El código vive 45 s: si nadie elige, se descarta antes de que venza.
    setTimeout(() => { if (stateRef.current === 'choose') reset() }, 35000)
  }, [device.device_id, grabPhoto, commit, reset, settings])

  // Bucle de lectura del QR (~4 veces por segundo).
  useEffect(() => {
    const id = setInterval(() => {
      if (stateRef.current !== 'scanning') return
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || !video.videoWidth) return
      const w = 480
      const h = Math.round((video.videoHeight / video.videoWidth) * w)
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(video, 0, 0, w, h)
      const img = ctx.getImageData(0, 0, w, h)
      const qr = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' })
      const text = qr?.data?.trim().toUpperCase()
      if (text && CODE_RE.test(text)) handleCode(text)
    }, 250)
    return () => clearInterval(id)
  }, [handleCode])

  const lateText = result && result.event_type === 'entrada' && result.late_minutes > 0
    ? `Llegaste ${formatMinutes(result.late_minutes)} tarde`
    : null

  return (
    <div style={{ minHeight: '100vh', background: '#14211e', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 16 }}>
      <KioskBar dark onBack={onChangeDevice} backLabel="← Cambiar dispositivo" />
      <div style={{ width: '100%', maxWidth: 720, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', opacity: 0.7 }}>Cotejo · Marcación</div>
          <div style={{ fontSize: 15, opacity: 0.85 }}>{device.name} · {device.branch_name}</div>
        </div>
        <div style={{ fontSize: 40, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatTime(now)}</div>
      </div>

      <div style={{ position: 'relative', width: '100%', maxWidth: 720, marginTop: 12, borderRadius: 16, overflow: 'hidden', background: '#000', aspectRatio: '4 / 3' }}>
        <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: facing === 'user' ? 'scaleX(-1)' : 'none' }} />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        {camError && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>{camError}</div>}

        {state === 'scanning' && !camError && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, textAlign: 'center', background: 'linear-gradient(transparent, rgba(0,0,0,0.7))', fontSize: 18 }}>
            Muestra tu código QR a la cámara
          </div>
        )}
        {state === 'saving' && <Overlay>Registrando...</Overlay>}
        {state === 'error' && <Overlay bg="rgba(162,72,58,0.94)"><div style={{ fontSize: 20, fontWeight: 700 }}>No se registró</div><div style={{ marginTop: 8 }}>{message}</div></Overlay>}
        {state === 'done' && result && (
          <Overlay bg="rgba(43,100,89,0.95)">
            <div style={{ fontSize: 28, fontWeight: 700 }}>{result.employee_name}</div>
            <div style={{ fontSize: 22, marginTop: 6 }}>{EVENT_LABELS[result.event_type]} · {formatTime(result.punched_at)}</div>
            {lateText && <div style={{ marginTop: 10, fontSize: 18, color: '#ffd9a8' }}>{lateText}</div>}
            {result.noPhoto && <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>(sin foto: revisa la conexión)</div>}
          </Overlay>
        )}
        {state === 'choose' && pending && (
          <Overlay bg="rgba(20,33,30,0.92)">
            <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 14 }}>Hola, {pending.name}</div>
            <div style={{ display: 'grid', gap: 10, width: '100%', maxWidth: 360 }}>
              {pending.allowed.map((ev) => (
                <button key={ev} type="button" className="btn" style={{ fontSize: 20, padding: '16px 12px' }} onClick={() => commit(pending.code, ev, pending.photo)}>
                  {BUTTON_LABELS[ev]}
                </button>
              ))}
              <button type="button" className="btn btn-secondary" onClick={reset}>Cancelar</button>
            </div>
          </Overlay>
        )}
      </div>

      <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
        <span style={{ opacity: 0.7 }}>Cámara:</span>
        {[['user', 'Frontal (con foto)'], ['environment', 'Trasera']].map(([id, label]) => (
          <button key={id} type="button" onClick={() => chooseFacing(id)} className={`btn ${facing === id ? '' : 'btn-secondary'}`} style={{ fontSize: 13, padding: '4px 10px' }}>{label}</button>
        ))}
      </div>
      {facing === 'environment' && (
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.6, textAlign: 'center' }}>Con la cámara trasera la foto no mostrará la cara del empleado.</div>
      )}

      <button type="button" onClick={onChangeDevice} style={{ marginTop: 16, background: 'transparent', border: 'none', color: '#fff', opacity: 0.45, fontSize: 12, textDecoration: 'underline' }}>
        Cambiar dispositivo
      </button>
    </div>
  )
}

function Overlay({ children, bg = 'rgba(0,0,0,0.65)' }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center' }}>
      {children}
    </div>
  )
}
