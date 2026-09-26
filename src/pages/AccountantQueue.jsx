import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { IconCheckCircle } from '../components/icons'

const STATUS_LABELS = {
  pending: 'Pendiente',
  under_review: 'En revisión',
  confirmed_manual: 'Confirmado',
  not_found: 'No encontrado',
  rejected: 'Rechazado',
  voided: 'Anulado'
}

// Orden pensado como se coteja un comprobante en la práctica: primero lo que
// descarta rápido si no cuadra (monto, fecha), luego a quién le llegó — lo
// más importante para detectar que el pago fue a la cuenta correcta — y por
// último quién lo envió, que sirve más para identificar al cliente que para
// validar el pago en sí.
const FIELD_LABELS = {
  amount: 'Monto',
  transaction_date: 'Fecha',
  bank: 'Banco destino',
  account_last4: 'Últimos 4 dígitos',
  destination_account_holder: 'Cuenta destino (nombre)',
  reference_raw: 'Referencia',
  origin_bank: 'Banco origen',
  origin_account_holder: 'Cuenta origen (nombre)',
  origin_account_number: 'Cuenta origen (número)'
}

function EvidenceModal({ payment, onClose }) {
  const [signedUrl, setSignedUrl] = useState(null)
  const [loadingUrl, setLoadingUrl] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [retryTick, setRetryTick] = useState(0)

  useEffect(() => {
    if (!payment.evidence_path) {
      setLoadingUrl(false)
      return
    }
    let cancelled = false
    async function loadUrl() {
      setLoadingUrl(true)
      setLoadError(null)
      const { data, error } = await supabase.storage
        .from('evidence')
        .createSignedUrl(payment.evidence_path, 300)
      if (!cancelled) {
        // Antes, cualquier error (conexión débil, permiso, lo que sea) se
        // mostraba igual que "nunca se adjuntó un comprobante" — un mensaje
        // engañoso cuando el archivo sí existe. Ahora se distingue: sin
        // ruta guardada vs. error al cargarlo (con opción de reintentar).
        if (error) setLoadError(error.message || 'No se pudo cargar el comprobante.')
        else setSignedUrl(data?.signedUrl ?? null)
        setLoadingUrl(false)
      }
    }
    loadUrl()
    return () => { cancelled = true }
  }, [payment.evidence_path, retryTick])

  const extraction = payment.extraction

  // Compara lo que la IA detectó contra lo que quedó registrado, campo por
  // campo, para que un desajuste salte a la vista en vez de tener que leer
  // dos listas por separado y comparar de memoria.
  const compareRows = Object.entries(FIELD_LABELS).map(([key, label]) => {
    const iaValue = extraction?.[key] ?? null
    const registeredValue = payment[key] ?? null
    const iaStr = iaValue === null || iaValue === undefined ? '' : String(iaValue).trim().toLowerCase()
    const regStr = registeredValue === null || registeredValue === undefined ? '' : String(registeredValue).trim().toLowerCase()
    const mismatch = Boolean(iaStr) && Boolean(regStr) && iaStr !== regStr
    return {
      key, label, iaValue, registeredValue, mismatch,
      confidence: extraction?.confidence?.[key]
    }
  })

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ maxWidth: 720, width: '100%', maxHeight: '90vh', overflow: 'auto', background: 'white' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Comprobante</h3>
          <button className="btn btn-secondary" onClick={onClose}>Cerrar</button>
        </div>

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px', minWidth: 220 }}>
            {loadingUrl && <p style={{ opacity: 0.6 }}>Cargando imagen...</p>}
            {!loadingUrl && !payment.evidence_path && <p className="empty-state">Este pago no tiene comprobante adjunto.</p>}
            {!loadingUrl && payment.evidence_path && loadError && (
              <div className="empty-state" style={{ textAlign: 'left' }}>
                <p style={{ margin: '0 0 8px', color: '#A2483A' }}>No se pudo cargar la imagen ({loadError}). El archivo sigue guardado, solo falló mostrarlo — puede ser la conexión.</p>
                <button type="button" className="btn btn-secondary" onClick={() => setRetryTick((t) => t + 1)}>Reintentar</button>
              </div>
            )}
            {signedUrl && (
              <img
                src={signedUrl}
                alt="Comprobante"
                style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #e5e0d8' }}
              />
            )}
          </div>

          <div style={{ flex: '2 1 320px', minWidth: 280 }}>
            <h4 style={{ marginTop: 0 }}>
              {extraction ? 'Detectado por IA vs. registrado' : 'Datos registrados'}
            </h4>
            {!extraction && <p style={{ fontSize: 12.5, opacity: 0.6, marginTop: -6 }}>Este pago se registró manualmente, sin lectura automática.</p>}

            <table className="compare-table">
              <thead>
                {extraction && <tr><th>Campo</th><th>IA</th><th>Registrado</th></tr>}
              </thead>
              <tbody>
                {compareRows.map((row) => {
                  const isAmount = row.key === 'amount'
                  const registeredDisplay = isAmount
                    ? `${payment.currency} ${Number(payment.amount).toLocaleString('es-HN', { minimumFractionDigits: 2 })}`
                    : (row.registeredValue ?? '—')
                  return (
                    <tr key={row.key} className={row.mismatch ? 'compare-mismatch' : ''}>
                      <td className="compare-label">{row.label}</td>
                      {extraction && (
                        <td>
                          {row.iaValue ?? '—'}
                          {typeof row.confidence === 'number' && (
                            <span
                              className="confidence-dot"
                              style={{ background: row.confidence >= 0.7 ? '#2B6459' : row.confidence > 0 ? '#B08900' : '#A2483A' }}
                              title={`${Math.round(row.confidence * 100)}% confianza`}
                            />
                          )}
                        </td>
                      )}
                      <td><strong>{registeredDisplay}</strong></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {extraction?.notes && (
              <p style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>Nota IA: {extraction.notes}</p>
            )}
            {compareRows.some((r) => r.mismatch) && (
              <p style={{ fontSize: 12, color: '#B08900', marginTop: 6, fontWeight: 600 }}>
                ⚠ Hay campos donde la IA detectó algo distinto a lo registrado — revísalos antes de confirmar.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function EvidenceThumb({ path, onClick }) {
  const [url, setUrl] = useState(null)

  useEffect(() => {
    if (!path) return
    let cancelled = false
    supabase.storage.from('evidence').createSignedUrl(path, 300).then(({ data, error }) => {
      if (!cancelled && !error) setUrl(data?.signedUrl ?? null)
    })
    return () => { cancelled = true }
  }, [path])

  if (!path) return null

  return (
    <button type="button" onClick={onClick} className="evidence-thumb" aria-label="Ver comprobante">
      {url ? <img src={url} alt="" /> : <span className="evidence-thumb-placeholder">📄</span>}
    </button>
  )
}

export default function AccountantQueue() {
  const { membership } = useAuth()
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [viewingPayment, setViewingPayment] = useState(null)

  useEffect(() => {
    if (!membership) return
    loadQueue()
  }, [membership])

  async function loadQueue() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('payment_records')
      .select(`
        id, amount, currency, reference_raw, notes, bank, account_last4,
        verification_status, processing_status, customer_waiting, version, created_at,
        evidence_path, extraction, transaction_date, origin_bank,
        origin_account_holder, origin_account_number, destination_account_holder
      `)
      .eq('organization_id', membership.organization_id)
      .in('verification_status', ['pending', 'under_review'])
      .order('customer_waiting', { ascending: false })
      .order('created_at', { ascending: true })

    if (error) {
      setError(error.message)
    } else {
      setPayments(data || [])
    }
    setLoading(false)
  }

  const grouped = useMemo(() => {
    const groups = {}
    for (const p of payments) {
      const key = `${p.bank}${p.account_last4 ? ` (${p.account_last4})` : ''}`
      if (!groups[key]) groups[key] = []
      groups[key].push(p)
    }
    return groups
  }, [payments])

  // La referencia es lo que la IA puede comparar mejor para detectar que el
  // mismo comprobante entró dos veces (o dos personas subieron el mismo pago
  // por error) — si dos pagos pendientes del mismo banco comparten
  // referencia, es señal fuerte de duplicado y merece una alerta visible,
  // no que el contador tenga que notarlo leyendo una por una.
  const duplicateRefCounts = useMemo(() => {
    const counts = {}
    for (const p of payments) {
      if (!p.reference_raw) continue
      const key = `${p.bank}::${p.reference_raw.trim().toLowerCase()}`
      counts[key] = (counts[key] || 0) + 1
    }
    return counts
  }, [payments])

  function isDuplicateRef(p) {
    if (!p.reference_raw) return false
    const key = `${p.bank}::${p.reference_raw.trim().toLowerCase()}`
    return duplicateRefCounts[key] > 1
  }

  async function callRpc(fnName, payment, extraParams = {}) {
    setBusyId(payment.id)
    setError(null)
    try {
      const { error } = await supabase.rpc(fnName, {
        p_payment_id: payment.id,
        p_expected_version: payment.version,
        ...extraParams
      })
      if (error) throw error
      await loadQueue()
    } catch (err) {
      console.error(err)
      setError(err.message || 'No se pudo completar la acción.')
    } finally {
      setBusyId(null)
    }
  }

  const handleConfirm = (p) => callRpc('confirm_payment', p)
  const handleUnderReview = (p) => callRpc('mark_under_review', p)

  function handleNotFound(p) {
    const reason = window.prompt('¿Por qué no aparece este pago? (motivo breve)')
    if (reason === null) return
    callRpc('mark_not_found', p, { p_reason: reason })
  }

  function handleDuplicate(p) {
    const originalId = window.prompt('Pega el ID del pago original del que este es duplicado:')
    if (!originalId) return
    callRpc('void_as_duplicate', p, { p_original_payment_id: originalId.trim() })
  }

  if (loading) {
    return <div className="container"><p style={{ opacity: 0.6 }}>Cargando cola...</p></div>
  }

  return (
    <div className="container">
      <h2 style={{ marginTop: 0 }}>Cola de confirmación</h2>
      {error && <p className="error-text">{error}</p>}

      {payments.length === 0 ? (
        <div className="empty-state-friendly">
          <IconCheckCircle width={36} height={36} />
          <div className="title">¡Todo al día!</div>
          <div className="subtitle">No hay pagos pendientes de revisión en este momento.</div>
        </div>
      ) : (
        Object.entries(grouped).map(([bankLabel, items]) => (
          <div key={bankLabel}>
            <div className="group-header">{bankLabel} <span style={{ opacity: 0.5, fontWeight: 400 }}>({items.length})</span></div>
            <div className="payment-list">
              {items.map((p) => (
                <div key={p.id} className="payment-row payment-row-with-thumb" style={{ flexWrap: 'wrap', gap: 12 }}>
                  <EvidenceThumb path={p.evidence_path} onClick={() => setViewingPayment(p)} />
                  <div style={{ flex: '1 1 200px' }}>
                    {/* Lo primero que hace falta para cotejar es a qué día ir en la app
                        del banco — no la hora en que esto se registró en Cotejo (eso va
                        abajo, en gris). Sin fecha detectada se avisa en vez de callar. */}
                    <div
                      style={{
                        fontSize: 13, fontWeight: 700, letterSpacing: 0.2,
                        color: p.transaction_date ? '#2B6459' : '#B08900'
                      }}
                    >
                      {p.transaction_date
                        ? new Date(p.transaction_date).toLocaleDateString('es-HN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
                        : '⚠ Fecha no detectada'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
                      <div className="amount">
                        {p.currency} {Number(p.amount).toLocaleString('es-HN', { minimumFractionDigits: 2 })}
                      </div>
                      {p.customer_waiting && (
                        <span
                          style={{
                            fontSize: 11, fontWeight: 700, color: '#A2483A', background: 'rgba(162, 72, 58, 0.12)',
                            padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap'
                          }}
                        >
                          ● cliente esperando
                        </span>
                      )}
                    </div>
                    {/* El monto solo no alcanza para distinguir pagos — si hay varios
                        comprobantes pendientes por el mismo monto, el nombre de quien
                        envía es lo que realmente los diferencia de un vistazo. */}
                    {p.origin_account_holder && (
                      <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 2 }}>
                        {p.origin_account_holder}
                      </div>
                    )}
                    <div className="meta" style={{ marginTop: 2 }}>
                      Registrado {new Date(p.created_at).toLocaleString('es-HN')}
                      {p.reference_raw && ` · ref: ${p.reference_raw}`}
                    </div>
                    {isDuplicateRef(p) && (
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#A2483A', marginTop: 3 }}>
                        ⚠ Misma referencia que otro pago pendiente — revisa si es el mismo comprobante repetido
                      </div>
                    )}
                    {p.notes && <div className="meta" style={{ marginTop: 2 }}>{p.notes}</div>}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                      <span className={`status-pill status-${p.verification_status}`}>
                        {STATUS_LABELS[p.verification_status] || p.verification_status}
                      </span>
                      {p.extraction && (
                        <span style={{ fontSize: 11, opacity: 0.6 }}>✓ leído por IA</span>
                      )}
                      {p.evidence_path && (
                        <button
                          type="button"
                          onClick={() => setViewingPayment(p)}
                          style={{
                            fontSize: 12, background: 'none', border: 'none', textDecoration: 'underline',
                            cursor: 'pointer', color: '#2B6459', padding: 0
                          }}
                        >
                          Ver comprobante
                        </button>
                      )}
                    </div>
                  </div>
                  {/* "Confirmar" es, por lejos, la acción más común — se le da todo el
                      peso visual arriba; las otras tres son excepciones y viven más
                      pequeñas debajo, para que la vista no se sienta como 4 opciones
                      igual de probables cuando en la práctica no lo son. */}
                  <div className="actions-row actions-row-tiered">
                    <button
                      className="btn btn-primary"
                      disabled={busyId === p.id}
                      onClick={() => handleConfirm(p)}
                    >
                      Confirmar
                    </button>
                    <div className="actions-secondary">
                      <button
                        className="btn btn-secondary"
                        disabled={busyId === p.id}
                        onClick={() => handleUnderReview(p)}
                      >
                        En revisión
                      </button>
                      <button
                        className="btn btn-amber"
                        disabled={busyId === p.id}
                        onClick={() => handleNotFound(p)}
                      >
                        No encontrado
                      </button>
                      <button
                        className="btn btn-rust"
                        disabled={busyId === p.id}
                        onClick={() => handleDuplicate(p)}
                      >
                        Duplicado
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {viewingPayment && (
        <EvidenceModal payment={viewingPayment} onClose={() => setViewingPayment(null)} />
      )}
    </div>
  )
}
