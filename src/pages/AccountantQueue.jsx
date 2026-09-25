import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

export default function AccountantQueue() {
  const { membership } = useAuth()
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)

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
        verification_status, processing_status, customer_waiting, version, created_at
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
                    <span className={`status-pill status-${p.verification_status}`} style={{ marginTop: 6 }}>
                      {p.verification_status}
                    </span>
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
    </div>
  )
}
