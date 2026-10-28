import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'

// QR de un solo uso (vale 45 s). Se renueva solo ANTES de vencer (8 s antes) y,
// si por cualquier motivo llegara a vencer o la pantalla estuvo en segundo
// plano, se genera otro de inmediato: el empleado puede tener el teléfono
// listo sin tocar nada.
const RENEW_BEFORE_MS = 8000

export default function AttendanceQr({ orgId, size = 260 }) {
  const canvasRef = useRef(null)
  const timerRef = useRef(null)
  const busyRef = useRef(false)
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(null)
  const [secondsLeft, setSecondsLeft] = useState(0)

  const issue = useCallback(async () => {
    if (!orgId || busyRef.current) return
    busyRef.current = true
    const { data, error: err } = await supabase.rpc('issue_attendance_code', { p_organization_id: orgId })
    busyRef.current = false
    if (err) {
      setError(err.message)
      // Reintenta en 5 s (por ejemplo, si se cayó la señal un momento).
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(issue, 5000)
      return
    }
    setError(null)
    setInfo(data)
    clearTimeout(timerRef.current)
    const wait = Math.max(2000, new Date(data.expires_at).getTime() - Date.now() - RENEW_BEFORE_MS)
    timerRef.current = setTimeout(issue, wait)
  }, [orgId])

  useEffect(() => {
    issue()
    const onVisible = () => { if (document.visibilityState === 'visible') issue() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timerRef.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [issue])

  useEffect(() => {
    if (!info?.code || !canvasRef.current) return
    QRCode.toCanvas(canvasRef.current, info.code, { width: size, margin: 1, errorCorrectionLevel: 'M' }, () => {})
  }, [info, size])

  useEffect(() => {
    if (!info?.expires_at) return
    const id = setInterval(() => {
      const left = Math.max(0, Math.round((new Date(info.expires_at).getTime() - Date.now()) / 1000))
      setSecondsLeft(left)
      if (left === 0) issue() // venció: se genera otro automáticamente
    }, 1000)
    setSecondsLeft(Math.max(0, Math.round((new Date(info.expires_at).getTime() - Date.now()) / 1000)))
    return () => clearInterval(id)
  }, [info, issue])

  if (error && !info) return <p className="error-text">{error}</p>

  return (
    <div style={{ textAlign: 'center' }}>
      <canvas ref={canvasRef} width={size} height={size} style={{ width: size, height: size, maxWidth: '100%', background: '#fff', borderRadius: 8 }} />
      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.65 }}>
        {secondsLeft > 0 ? `Se renueva solo · ${secondsLeft} s` : 'Generando código nuevo...'}
      </div>
    </div>
  )
}
