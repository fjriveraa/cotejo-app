import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const STATUS_INFO = {
  pending: {
    label: 'En revisión',
    color: '#B45309',
    message: 'La empresa todavía está revisando tu comprobante. Vuelve a esta página más tarde para ver el resultado.'
  },
  confirmed: {
    label: '✓ Comprobante confirmado',
    color: '#2B6459',
    message: 'Tu pago quedó confirmado. No necesitas hacer nada más.'
  },
  not_confirmed: {
    label: 'No pudimos confirmarlo',
    color: '#B91C1C',
    message: 'La empresa no pudo confirmar este comprobante con la información que tiene. Te recomendamos contactarla directamente para resolverlo.'
  }
}

export default function GuestStatus() {
  const { token } = useParams()
  const [info, setInfo] = useState(undefined) // undefined = cargando, null = no encontrado
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase.rpc('get_guest_submission_status', { p_tracking_token: token }).then(({ data, error }) => {
      if (cancelled) return
      if (error || !data || data.length === 0) setInfo(null)
      else setInfo(data[0])
    })
    return () => { cancelled = true }
  }, [token])

  function copyLink() {
    navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (info === undefined) {
    return (
      <div className="login-wrap">
        <p style={{ opacity: 0.6 }}>Cargando...</p>
      </div>
    )
  }

  if (info === null) {
    return (
      <div className="login-wrap">
        <div className="card login-card">
          <h1>No encontramos ese comprobante</h1>
          <p>Revisa que copiaste bien el enlace, o <Link to="/comprobante">envía uno nuevo aquí</Link>.</p>
        </div>
      </div>
    )
  }

  const status = STATUS_INFO[info.status] || STATUS_INFO.pending

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1>{info.organization_name}</h1>
        <div style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 999, background: status.color, color: '#fff', fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
          {status.label}
        </div>
        <p>{status.message}</p>

        {info.status === 'not_confirmed' && info.review_notes && (
          <p style={{ fontSize: 13, opacity: 0.8, marginTop: -8 }}>Nota de la empresa: {info.review_notes}</p>
        )}

        <div style={{ fontSize: 13, opacity: 0.7, marginTop: 16 }}>
          <div>Monto: {info.currency} {Number(info.amount).toLocaleString('es-HN', { minimumFractionDigits: 2 })}</div>
          {info.reference_raw && <div>Referencia: {info.reference_raw}</div>}
          <div>Enviado: {new Date(info.created_at).toLocaleString('es-HN')}</div>
        </div>

        <button type="button" className="btn btn-secondary" style={{ width: '100%', marginTop: 20 }} onClick={copyLink}>
          {copied ? 'Enlace copiado' : 'Copiar este enlace para volver después'}
        </button>
      </div>
    </div>
  )
}
