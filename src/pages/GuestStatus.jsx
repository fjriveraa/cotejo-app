import { useEffect, useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import PublicPageHeader from '../components/PublicPageHeader'

const STATUS_INFO = {
  pending: {
    label: '✓ Comprobante recibido',
    color: '#B45309',
    message: 'Ya llegó y está siendo revisado. Guarda este enlace para ver aquí mismo cuando quede confirmado.'
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
  const [searchParams] = useSearchParams()
  const alreadySent = searchParams.get('ya_enviado') === '1'
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
        <div className="card login-card">
          <PublicPageHeader />
          <p style={{ opacity: 0.6 }}>Cargando...</p>
        </div>
      </div>
    )
  }

  if (info === null) {
    return (
      <div className="login-wrap">
        <div className="card login-card">
          <PublicPageHeader />
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
        <PublicPageHeader />
        <h1>{info.organization_name}</h1>
        {alreadySent && (
          <p style={{ fontSize: 13, background: '#FEF3C7', color: '#92400E', padding: '8px 12px', borderRadius: 8, marginTop: -8 }}>
            Ya habíamos recibido este mismo comprobante antes — aquí está su estado.
          </p>
        )}
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

        {/* Quien llega hasta acá ya vio lo que necesitaba (el estado de su
            pago) -- este bloque no interrumpe eso, solo deja la puerta
            abierta por si le interesa tener su propio control de pagos. */}
        <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border, #e5e0d8)', textAlign: 'center' }}>
          <p style={{ fontSize: 13, opacity: 0.75, margin: '0 0 10px' }}>
            ¿Quieres llevar tus propios pagos así de claro?
          </p>
          <Link
            to="/signup"
            className="btn btn-primary"
            style={{ display: 'inline-block', width: '100%', textDecoration: 'none', textAlign: 'center' }}
          >
            Crea tu cuenta gratis en Cotejo
          </Link>
        </div>
      </div>
    </div>
  )
}
