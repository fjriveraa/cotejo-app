import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { isPlausibleTransactionDate, parseLocalDate } from '../lib/dateSanity'
import { EvidenceModal, EvidenceThumb, friendlyRpcError } from './AccountantQueue'

const QUEUE_ROLES = ['contador', 'propietario', 'supervisor', 'admin', 'auditor']

// Antes, ver los pagos pendientes de varias empresas a la vez significaba
// entrar a cada una por separado y revisar su cola una por una. Esta
// pantalla junta los pendientes de TODAS las empresas donde la persona
// puede revisar, agrupados por banco + empresa (ej. "BAC — FARO HN" y
// "BAC — Pazari" como grupos separados, aunque el banco sea el mismo) --
// entrar a una empresa específica sigue mostrando solo la suya, esto es
// nada más para tener la vista de conjunto.
export default function AllCompaniesQueue() {
  const { memberships, switchOrg } = useAuth()
  const navigate = useNavigate()
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [viewingPayment, setViewingPayment] = useState(null)

  const queueMemberships = useMemo(
    () => (memberships || []).filter((m) => QUEUE_ROLES.includes(m.role)),
    [memberships]
  )

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberships])

  async function loadAll() {
    if (queueMemberships.length === 0) {
      setPayments([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const results = await Promise.all(
      queueMemberships.map(async (m) => {
        const { data, error: err } = await supabase
          .from('payment_records')
          .select(`
            id, amount, currency, reference_raw, bank, account_last4, version,
            verification_status, customer_waiting, created_at, evidence_path, extraction,
            transaction_date, origin_bank, origin_account_holder, origin_account_number,
            destination_account_holder
          `)
          .eq('organization_id', m.organization_id)
          .in('verification_status', ['pending', 'under_review'])
        if (err) return { err, rows: [] }
        return {
          err: null,
          rows: (data || []).map((p) => ({
            ...p,
            orgId: m.organization_id,
            orgName: m.organizations?.name || 'Empresa',
            myRole: m.role
          }))
        }
      })
    )
    const firstError = results.find((r) => r.err)
    if (firstError) setError(firstError.err.message)
    setPayments(results.flatMap((r) => r.rows))
    setLoading(false)
  }

  const grouped = useMemo(() => {
    const groups = {}
    for (const p of payments) {
      const key = `${p.bank}${p.account_last4 ? ` (${p.account_last4})` : ''} — ${p.orgName}`
      if (!groups[key]) groups[key] = []
      groups[key].push(p)
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => {
        if (a.customer_waiting !== b.customer_waiting) return a.customer_waiting ? -1 : 1
        return new Date(a.created_at) - new Date(b.created_at)
      })
    }
    return groups
  }, [payments])

  async function handleConfirm(p) {
    setBusyId(p.id)
    setError(null)
    try {
      const { error: err } = await supabase.rpc('confirm_payment', {
        p_payment_id: p.id,
        p_expected_version: p.version
      })
      if (err) throw err
      await loadAll()
    } catch (err) {
      setError(friendlyRpcError(err.message))
    } finally {
      setBusyId(null)
    }
  }

  function goToCompanyQueue(orgId) {
    switchOrg(orgId)
    navigate('/cola')
  }

  if (queueMemberships.length <= 1) {
    return (
      <div className="container">
        <p className="empty-state">Esta vista es para cuando revisas pagos en más de una empresa. Con una sola, usa la cola normal.</p>
      </div>
    )
  }

  if (loading) {
    return <div className="container"><p style={{ opacity: 0.6 }}>Cargando comprobantes de todas tus empresas...</p></div>
  }

  return (
    <div className="container">
      <h2 style={{ marginTop: 0, marginBottom: 4 }}>Todos tus comprobantes</h2>
      <p style={{ opacity: 0.65, fontSize: 14, marginTop: 0, marginBottom: 20 }}>
        Pendientes de revisión en las {queueMemberships.length} empresas donde puedes confirmar pagos.
      </p>
      {error && <p className="error-text">{error}</p>}

      {payments.length === 0 ? (
        <p className="empty-state">Todo al día en todas tus empresas — no hay nada pendiente.</p>
      ) : (
        Object.entries(grouped).map(([groupLabel, items]) => (
          <div key={groupLabel}>
            <div className="group-header">{groupLabel} <span style={{ opacity: 0.5, fontWeight: 400 }}>({items.length})</span></div>
            <div className="payment-list">
              {items.map((p) => (
                <div key={p.id} className="payment-row payment-row-with-thumb" style={{ flexWrap: 'wrap', gap: 12 }}>
                  <EvidenceThumb path={p.evidence_path} onClick={() => setViewingPayment(p)} />
                  <div style={{ flex: '1 1 200px' }}>
                    <div
                      style={{
                        fontSize: 13, fontWeight: 700,
                        color: p.transaction_date && isPlausibleTransactionDate(p.transaction_date) ? '#2B6459' : '#B08900'
                      }}
                    >
                      {!p.transaction_date && '⚠ Fecha no detectada'}
                      {p.transaction_date && isPlausibleTransactionDate(p.transaction_date) &&
                        parseLocalDate(p.transaction_date).toLocaleDateString('es-HN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
                      {p.transaction_date && !isPlausibleTransactionDate(p.transaction_date) && '⚠ Fecha dudosa'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
                      <div className="amount">
                        {p.currency} {Number(p.amount).toLocaleString('es-HN', { minimumFractionDigits: 2 })}
                      </div>
                      {p.customer_waiting && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#A2483A', background: 'rgba(162, 72, 58, 0.12)', padding: '2px 8px', borderRadius: 999 }}>
                          ● cliente esperando
                        </span>
                      )}
                    </div>
                    {p.origin_account_holder && (
                      <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 2 }}>{p.origin_account_holder}</div>
                    )}
                    <div className="meta" style={{ marginTop: 2 }}>
                      {p.reference_raw && `ref: ${p.reference_raw}`}
                    </div>
                  </div>
                  <div className="actions-row actions-row-tiered">
                    <button className="btn btn-primary" disabled={busyId === p.id} onClick={() => handleConfirm(p)}>
                      Confirmar
                    </button>
                    <div className="actions-secondary">
                      <button className="btn btn-secondary" onClick={() => goToCompanyQueue(p.orgId)}>
                        Ver cola de {p.orgName}
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
