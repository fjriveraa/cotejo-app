import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const FIELD_LABELS = {
  amount: 'Monto',
  bank: 'Banco destino',
  account_last4: 'Últimos 4 dígitos',
  reference_raw: 'Referencia',
  transaction_date: 'Fecha',
  origin_bank: 'Banco origen',
  origin_account_holder: 'Cuenta origen (nombre)',
  origin_account_number: 'Cuenta origen (número)',
  destination_account_holder: 'Cuenta destino (nombre)'
}

function EvidenceModal({ payment, onClose }) {
  const [signedUrl, setSignedUrl] = useState(null)
  const [loadingUrl, setLoadingUrl] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function loadUrl() {
      if (!payment.evidence_path) {
        setLoadingUrl(false)
        return
      }
      const { data, error } = await supabase.storage
        .from('evidence')
        .createSignedUrl(payment.evidence_path, 300)
      if (!cancelled) {
        if (!error) setSignedUrl(data?.signedUrl ?? null)
        setLoadingUrl(false)
      }
    }
    loadUrl()
    return () => { cancelled = true }
  }, [payment.evidence_path])

  const extraction = payment.extraction

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
          <div style={{ flex: '1 1 280px', minWidth: 240 }}>
            {loadingUrl && <p style={{ opacity: 0.6 }}>Cargando imagen...</p>}
            {!loadingUrl && !signedUrl && <p className="empty-state">Sin comprobante adjunto.</p>}
            {signedUrl && (
              <img
                src={signedUrl}
                alt="Comprobante"
                style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #e5e0d8' }}
              />
            )}
          </div>

          <div style={{ flex: '1 1 240px', minWidth: 220 }}>
            <h4 style={{ marginTop: 0 }}>Datos detectados por IA</h4>
            {!extraction && <p className="empty-state">Este pago no tiene datos de IA (registrado manualmente).</p>}
            {extraction && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Object.entries(FIELD_LABELS).map(([key, label]) => {
                  const value = extraction[key]
                  const confidence = extraction.confidence?.[key]
                  return (
                    <div key={key} style={{ fontSize: 13 }}>
                      <span style={{ opacity: 0.6 }}>{label}: </span>
                      <strong>{value ?? '—'}</strong>
                      {typeof confidence === 'number' && (
                        <span style={{
                          marginLeft: 6, fontSize: 11,
                          color: confidence >= 0.7 ? '#2B6459' : confidence > 0 ? '#B08900' : '#A2483A'
                        }}>
                          ({Math.round(confidence * 100)}% confianza)
                        </span>
                      )}
                    </div>
                  )
                })}
                {extraction.notes && (
                  <p style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>Nota IA: {extraction.notes}</p>
                )}
              </div>
            )}

            <h4 style={{ marginTop: 20 }}>Datos registrados</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
              <div><span style={{ opacity: 0.6 }}>Monto: </span><strong>{payment.currency} {Number(payment.amount).toLocaleString('es-HN', { minimumFractionDigits: 2 })}</strong></div>
              <div><span style={{ opacity: 0.6 }}>Banco destino: </span><strong>{payment.bank}{payment.account_last4 ? ` (${payment.account_last4})` : ''}</strong></div>
              <div><span style={{ opacity: 0.6 }}>Referencia: </span><strong>{payment.reference_raw || '—'}</strong></div>
              {payment.transaction_date && (
                <div><span style={{ opacity: 0.6 }}>Fecha: </span><strong>{payment.transaction_date}</strong></div>
              )}
              {(payment.origin_account_holder || payment.origin_account_number || payment.origin_bank) && (
                <div>
                  <span style={{ opacity: 0.6 }}>Cuenta origen: </span>
                  <strong>
                    {payment.origin_account_holder || '—'}
                    {payment.origin_account_number ? ` · ${payment.origin_account_number}` : ''}
                    {payment.origin_bank ? ` (${payment.origin_bank})` : ''}
                  </strong>
                </div>
              )}
              {payment.destination_account_holder && (
                <div><span style={{ opacity: 0.6 }}>Cuenta destino: </span><strong>{payment.destination_account_holder}</strong></div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
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
        <p className="empty-state">No hay pagos pendientes de revisión.</p>
      ) : (
        Object.entries(grouped).map(([bankLabel, items]) => (
          <div key={bankLabel}>
            <div className="group-header">{bankLabel} <span style={{ opacity: 0.5, fontWeight: 400 }}>({items.length})</span></div>
            <div className="payment-list">
              {items.map((p) => (
                <div key={p.id} className="payment-row" style={{ flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div className="amount">
                      {p.currency} {Number(p.amount).toLocaleString('es-HN', { minimumFractionDigits: 2 })}
                      {p.customer_waiting && <span style={{ color: '#A2483A', fontSize: 12, marginLeft: 8 }}>● cliente esperando</span>}
                    </div>
                    <div className="meta">
                      {new Date(p.created_at).toLocaleString('es-HN')} {p.reference_raw ? `· ref: ${p.reference_raw}` : ''}
                    </div>
                    {p.notes && <div className="meta" style={{ marginTop: 2 }}>{p.notes}</div>}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                      <span className={`status-pill status-${p.verification_status}`}>
                        {p.verification_status}
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
                  <div className="actions-row">
                    <button
                      className="btn btn-primary"
                      disabled={busyId === p.id}
                      onClick={() => handleConfirm(p)}
                    >
                      Confirmar
                    </button>
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
