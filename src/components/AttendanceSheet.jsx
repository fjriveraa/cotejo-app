import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import AttendanceQr from './AttendanceQr'
import { EVENT_LABELS, BUTTON_LABELS, NO_PHOTO_EVENTS, lunchRemainingSeconds, formatClock, formatTime, hondurasDateStr, formatMinutes } from '../lib/attendance'

// Hoja inferior del botón "Marcar".
//  - Si la empresa habilitó la marcación directa: botones de lo que toca
//    marcar ahora (Entrada / Almuerzo / Salida). Al tocar uno se toma una
//    selfie (y la ubicación, si el teléfono la da) y queda registrada.
//  - Siempre queda disponible el QR, para marcar en el dispositivo de la sucursal.
export default function AttendanceSheet({ orgId, onClose }) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState('buttons') // buttons | camera | saving | done | qr
  const [pendingEvent, setPendingEvent] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [, setTick] = useState(0)

  // Cuenta regresiva del almuerzo: se refresca cada segundo mientras esté abierto.
  useEffect(() => {
    if (!status?.lunch) return undefined
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [status?.lunch])

  // Pausar y continuar no piden foto: se registran con un toque.
  async function quickPunch(ev) {
    setError(null)
    setMode('saving')
    const { error: err } = await supabase.rpc('self_record_attendance', {
      p_organization_id: orgId, p_event_type: ev, p_photo_path: null
    })
    if (err) { setError(err.message); setMode('buttons'); loadStatus(); return }
    setMode('buttons')
    await loadStatus()
  }

  async function loadStatus() {
    const { data, error: err } = await supabase.rpc('my_attendance_status', { p_organization_id: orgId })
    setLoading(false)
    if (err) {
      // Si la función nueva aún no existe en la base, se cae al QR de siempre.
      setStatus({ allow_self_punch: false, allowed: [] })
      return
    }
    setStatus(data)
  }

  useEffect(() => { loadStatus() }, [orgId])

  const direct = status?.allow_self_punch && (status.allowed || []).length > 0
  const qrOn = status?.method_qr !== false
  const view = loading ? 'loading' : mode === 'buttons' && !direct ? (qrOn ? 'qr' : 'none') : mode

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={view === 'camera' || view === 'saving' ? undefined : onClose}
    >
      <div
        className="card"
        style={{ width: '100%', maxWidth: 420, borderRadius: '20px 20px 0 0', padding: '20px 20px 28px', textAlign: 'center', maxHeight: '92vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        {view === 'loading' && <p style={{ opacity: 0.6 }}>Cargando...</p>}

        {view === 'buttons' && (
          <>
            <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>Marcar asistencia</h2>
            <p style={{ margin: '0 0 14px', opacity: 0.65, fontSize: 14 }}>
              {status.last_event ? `Última marca: ${EVENT_LABELS[status.last_event]} · ${formatTime(status.last_at)}` : 'Aún no has marcado hoy.'}
            </p>
            {status.lunch && <LunchCountdown lunch={status.lunch} />}
            <div style={{ display: 'grid', gap: 10 }}>
              {status.allowed.map((ev, i) => (
                <button
                  key={ev}
                  type="button"
                  className={`btn ${i === 0 ? '' : 'btn-secondary'}`}
                  style={{ fontSize: 20, padding: '16px 12px' }}
                  onClick={() => {
                    if (NO_PHOTO_EVENTS.includes(ev)) { quickPunch(ev); return }
                    setPendingEvent(ev); setError(null); setMode('camera')
                  }}
                >
                  {BUTTON_LABELS[ev]}
                </button>
              ))}
            </div>
            {qrOn && (
              <button type="button" className="btn btn-secondary" style={{ marginTop: 14, fontSize: 13 }} onClick={() => setMode('qr')}>
                Usar código QR en la sucursal
              </button>
            )}
            <button type="button" className="btn btn-secondary" style={{ marginTop: 8, marginLeft: 8, fontSize: 13 }} onClick={onClose}>Cerrar</button>
          </>
        )}

        {view === 'camera' && (
          <SelfieStep
            label={BUTTON_LABELS[pendingEvent]}
            onCancel={() => setMode('buttons')}
            onCaptured={async (blob, geo) => {
              setMode('saving')
              setError(null)
              const { data: u } = await supabase.auth.getUser()
              const uid = u?.user?.id
              const path = `${orgId}/self/${uid}/${hondurasDateStr()}-${crypto.randomUUID()}.jpg`
              const { error: upErr } = await supabase.storage.from('attendance-photos').upload(path, blob, { contentType: 'image/jpeg' })
              if (upErr) { setError('No se pudo subir la foto: ' + upErr.message); setMode('camera'); return }
              const { data, error: err } = await supabase.rpc('self_record_attendance', {
                p_organization_id: orgId, p_event_type: pendingEvent, p_photo_path: path,
                p_lat: geo?.lat ?? null, p_lng: geo?.lng ?? null, p_accuracy: geo?.accuracy ?? null
              })
              if (err) { setError(err.message); setMode('buttons'); loadStatus(); return }
              setResult(data)
              setMode('done')
              loadStatus()
            }}
            error={error}
          />
        )}

        {view === 'none' && (
          <>
            <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>Marcar asistencia</h2>
            <p style={{ opacity: 0.7 }}>
              {status?.allow_self_punch ? 'Ya registraste todo lo que corresponde por ahora.' : 'Tu empresa no tiene un método de marcación disponible. Consulta con tu administrador.'}
            </p>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cerrar</button>
          </>
        )}

        {view === 'saving' && <p style={{ margin: '24px 0' }}>Registrando...</p>}

        {view === 'done' && result && (
          <>
            <div style={{ fontSize: 44 }}>✓</div>
            <h2 style={{ margin: '4px 0', fontSize: 22 }}>Marca registrada</h2>
            <p style={{ margin: 0, fontSize: 16, opacity: 0.75 }}>{EVENT_LABELS[result.event_type]}</p>
            <p style={{ margin: 0, fontSize: 18 }}>{formatTime(result.punched_at)}</p>
            {result.event_type === 'entrada' && result.late_minutes > 0 && (
              <p style={{ color: '#A2483A', fontWeight: 700 }}>Llegaste {formatMinutes(result.late_minutes)} tarde</p>
            )}
            <button type="button" className="btn" style={{ marginTop: 16 }} onClick={onClose}>Listo</button>
          </>
        )}

        {view === 'qr' && (
          <>
            <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>Tu código de asistencia</h2>
            <p style={{ margin: '0 0 12px', opacity: 0.65, fontSize: 14 }}>Muéstralo a la cámara del dispositivo de tu sucursal.</p>
            <AttendanceQr orgId={orgId} size={240} />
            {direct && (
              <button type="button" className="btn btn-secondary" style={{ marginTop: 12, fontSize: 13 }} onClick={() => setMode('buttons')}>
                ← Marcar directo con foto
              </button>
            )}
            <div>
              <button type="button" className="btn btn-secondary" style={{ marginTop: 10 }} onClick={onClose}>Cerrar</button>
            </div>
          </>
        )}

        {error && view === 'buttons' && <p className="error-text" style={{ marginTop: 10 }}>{error}</p>}
      </div>
    </div>
  )
}

function LunchCountdown({ lunch }) {
  const left = lunchRemainingSeconds(lunch)
  const paused = !!lunch.paused_since
  const over = left < 0
  return (
    <div style={{ margin: '0 0 14px', padding: 12, borderRadius: 12, background: over ? 'rgba(162,72,58,0.1)' : 'rgba(43,100,89,0.08)' }}>
      <div style={{ fontSize: 13, opacity: 0.7 }}>
        {paused ? 'Almuerzo en pausa' : over ? 'Tiempo de almuerzo excedido' : 'Te queda de almuerzo'}
      </div>
      <div style={{ fontSize: 40, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: over ? '#A2483A' : 'inherit' }}>{formatClock(left)}</div>
      <div style={{ fontSize: 12, opacity: 0.6 }}>Almuerzo estipulado: {formatMinutes(lunch.stipulated_minutes)}. Si te interrumpen, toca “Pausar”.</div>
    </div>
  )
}

function SelfieStep({ label, onCancel, onCaptured, error }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const geoRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [camError, setCamError] = useState(null)

  useEffect(() => {
    let cancelled = false
    // La ubicación es evidencia opcional: si el teléfono no la da, se marca igual.
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => { geoRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy } },
        () => {},
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
      )
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 } }, audio: false })
      .then(async (stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setReady(true)
      })
      .catch(() => setCamError('No se pudo abrir la cámara. Permite el acceso a la cámara para marcar con foto.'))
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  function capture() {
    const v = videoRef.current
    if (!v?.videoWidth) return
    const c = document.createElement('canvas')
    const scale = Math.min(1, 640 / v.videoWidth)
    c.width = Math.round(v.videoWidth * scale)
    c.height = Math.round(v.videoHeight * scale)
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
    c.toBlob((b) => b && onCaptured(b, geoRef.current), 'image/jpeg', 0.7)
  }

  return (
    <>
      <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>{label}</h2>
      <p style={{ margin: '0 0 10px', opacity: 0.65, fontSize: 14 }}>Mira a la cámara y toca para marcar.</p>
      {camError ? (
        <p className="error-text">{camError}</p>
      ) : (
        <video ref={videoRef} playsInline muted style={{ width: '100%', borderRadius: 12, background: '#000', transform: 'scaleX(-1)', aspectRatio: '4 / 3', objectFit: 'cover' }} />
      )}
      {error && <p className="error-text">{error}</p>}
      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        <button type="button" className="btn" style={{ fontSize: 18, padding: '14px 12px' }} disabled={!ready} onClick={capture}>Marcar ahora</button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancelar</button>
      </div>
    </>
  )
}
