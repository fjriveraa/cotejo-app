import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { isPlausibleTransactionDate, parseLocalDate } from '../lib/dateSanity'
import { EvidenceModal, EvidenceThumb, friendlyRpcError } from './AccountantQueue'
import { SkeletonPaymentList } from '../components/Skeleton'
import { IconCheckCircle, IconDoc, IconSearch, IconClose } from '../components/icons'

const QUEUE_ROLES = ['contador', 'propietario', 'supervisor', 'admin', 'auditor']

// Antes, ver los pagos pendientes de varias empresas a la vez significaba
// entrar a cada una por separado y revisar su cola una por una. Esta
// pantalla junta los pendientes de TODAS las empresas donde la persona
// puede revisar, agrupados por banco + empresa (ej. "BAC — FARO HN" y
// "BAC — Pazari" como grupos separados, aunque el banco sea el mismo) --
// entrar a una empresa específica sigue mostrando solo la suya, esto es
// nada más para tener la vista de conjunto.
const CONFIRMED_LOOKBACK_DAYS = 60

export default function AllCompaniesQueue() {
  const { membership, memberships, switchOrg } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState('pending')
  const [payments, setPayments] = useState([])
  const [confirmedPayments, setConfirmedPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingConfirmed, setLoadingConfirmed] = useState(false)
  const [confirmedLoaded, setConfirmedLoaded] = useState(false)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [viewingPayment, setViewingPayment] = useState(null)
  const [flashId, setFlashId] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')

  const queueMemberships = useMemo(
    () => (memberships || []).filter((m) => QUEUE_ROLES.includes(m.role)),
    [memberships]
  )

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberships])

  useEffect(() => {
    if (tab === 'confirmed' && !confirmedLoaded) loadConfirmed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

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

  // Los confirmados se cargan aparte (y solo al pedirlos) porque son un
  // historial que puede crecer mucho -- se limita a los últimos
  // CONFIRMED_LOOKBACK_DAYS días para no traer todo el historial de golpe.
  async function loadConfirmed() {
    if (queueMemberships.length === 0) {
      setConfirmedPayments([])
      setLoadingConfirmed(false)
      setConfirmedLoaded(true)
      return
    }
    setLoadingConfirmed(true)
    setError(null)
    const since = new Date()
    since.setDate(since.getDate() - CONFIRMED_LOOKBACK_DAYS)
    const results = await Promise.all(
      queueMemberships.map(async (m) => {
        const { data, error: err } = await supabase
          .from('payment_records')
          .select(`
            id, amount, currency, reference_raw, bank, account_last4,
            verification_status, customer_waiting, created_at, evidence_path,
            transaction_date, origin_account_holder, verified_at, self_confirmed
          `)
          .eq('organization_id', m.organization_id)
          .eq('verification_status', 'confirmed_manual')
          .gte('verified_at', since.toISOString())
          .order('verified_at', { ascending: false })
        if (err) return { err, rows: [] }
        return {
          err: null,
          rows: (data || []).map((p) => ({
            ...p,
            orgId: m.organization_id,
            orgName: m.organizations?.name || 'Empresa'
          }))
        }
      })
    )
    const firstError = results.find((r) => r.err)
    if (firstError) setError(firstError.err.message)
    const merged = results.flatMap((r) => r.rows).sort((a, b) => new Date(b.verified_at) - new Date(a.verified_at))
    setConfirmedPayments(merged)
    setLoadingConfirmed(false)
    setConfirmedLoaded(true)
  }

  const filteredPayments = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return payments
    return payments.filter((p) => {
      const haystack = [
        p.origin_account_holder,
        p.destination_account_holder,
        p.reference_raw,
        p.bank,
        p.account_last4,
        p.orgName,
        Number(p.amount).toFixed(2)
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(term)
    })
  }, [payments, searchTerm])

  const grouped = useMemo(() => {
    const groups = {}
    for (const p of filteredPayments) {
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
  }, [filteredPayments])

  async function handleConfirm(p) {
    setBusyId(p.id)
    setError(null)
    try {
      const { error: err } = await supabase.rpc('confirm_payment', {
        p_payment_id: p.id,
        p_expected_version: p.version
      })
      if (err) throw err
      setFlashId(p.id)
      await new Promise((resolve) => setTimeout(resolve, 650))
      await loadAll()
    } catch (err) {
      setError(friendlyRpcError(err.message))
    } finally {
      setBusyId(null)
      setFlashId(null)
    }
  }

  function goToCompanyQueue(orgId) {
    switchOrg(orgId)
    navigate('/cola')
  }

  if (membership?.organizations?.org_type !== 'autonomo') {
    return (
      <div className="container">
        <p className="empty-state">Esta vista solo está disponible desde tu cuenta personal -- entra desde ahí para ver todo junto.</p>
      </div>
    )
  }

  if (queueMemberships.length <= 1) {
    return (
      <div className="container">
        <p className="empty-state">Esta vista es para cuando revisas pagos en más de una empresa. Con una sola, usa la cola normal.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="container">
        <h2 style={{ marginTop: 0 }}>Todos tus comprobantes</h2>
        <SkeletonPaymentList rows={5} />
      </div>
    )
  }

  return (
    <div className="container">
      <h2 style={{ marginTop: 0, marginBottom: 4 }}>Todos tus comprobantes</h2>
      <p style={{ opacity: 0.65, fontSize: 14, marginTop: 0, marginBottom: 16 }}>
        De las {queueMemberships.length} empresas donde puedes confirmar pagos.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button
          type="button"
          className={tab === 'pending' ? 'btn btn-primary' : 'btn btn-secondary'}
          onClick={() => setTab('pending')}
        >
          Pendientes {payments.length > 0 && `(${payments.length})`}
        </button>
        <button
          type="button"
          className={tab === 'confirmed' ? 'btn btn-primary' : 'btn btn-secondary'}
          onClick={() => setTab('confirmed')}
        >
          Confirmados
        </button>
      </div>

      {tab === 'pending' && payments.length > 0 && (
        <div style={{ position: 'relative', margin: '0 0 20px' }}>
          <IconSearch
            width={16} height={16}
            style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }}
          />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por nombre, monto, referencia, banco o empresa..."
            style={{ width: '100%', padding: '9px 34px', fontSize: 13.5 }}
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              aria-label="Limpiar búsqueda"
              style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', padding: 4, opacity: 0.5, display: 'flex'
              }}
            >
              <IconClose width={14} height={14} />
            </button>
          )}
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      {tab === 'confirmed' ? (
        loadingConfirmed ? (
          <SkeletonPaymentList rows={4} />
        ) : confirmedPayments.length === 0 ? (
          <div className="empty-state-friendly">
            <IconDoc width={36} height={36} />
            <div className="title">Sin confirmados recientes</div>
            <div className="subtitle">No hay comprobantes confirmados en los últimos {CONFIRMED_LOOKBACK_DAYS} días.</div>
          </div>
        ) : (
          <div className="payment-list">
            {confirmedPayments.map((p) => (
              <div key={p.id} className="payment-row payment-row-with-thumb" style={{ flexWrap: 'wrap', gap: 12 }}>
                <EvidenceThumb path={p.evidence_path} onClick={() => setViewingPayment(p)} />
                <div style={{ flex: '1 1 200px' }}>
                  <div style={{ fontSize: 12, opacity: 0.6, fontWeight: 600 }}>{p.orgName}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
                    <div className="amount">
                      {p.currency} {Number(p.amount).toLocaleString('es-HN', { minimumFractionDigits: 2 })}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#2B6459', background: 'rgba(43, 100, 89, 0.08)', padding: '2px 8px', borderRadius: 999 }}>
                      ✓ confirmado
                    </span>
                    {p.self_confirmed && (
                      <span style={{ fontSize: 11, opacity: 0.6 }}>· autoconfirmado</span>
                    )}
                  </div>
                  {p.origin_account_holder && (
                    <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 2 }}>{p.origin_account_holder}</div>
                  )}
                  <div className="meta" style={{ marginTop: 2 }}>
                    {p.bank}{p.account_last4 ? ` (${p.account_last4})` : ''}
                    {p.reference_raw && ` · ref: ${p.reference_raw}`}
                    {p.verified_at && ` · confirmado ${new Date(p.verified_at).toLocaleDateString('es-HN', { day: '2-digit', month: 'short', year: 'numeric' })}`}
                  </div>
                </div>
                <div className="actions-row">
                  <button className="btn btn-secondary" onClick={() => goToCompanyQueue(p.orgId)}>
                    Ver {p.orgName}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : payments.length === 0 ? (
        <div className="empty-state-friendly">
          <IconCheckCircle width={36} height={36} />
          <div className="title">¡Todo al día!</div>
          <div className="subtitle">No hay nada pendiente en ninguna de tus empresas.</div>
        </div>
      ) : filteredPayments.length === 0 ? (
        <div className="empty-state-friendly">
          <IconSearch width={36} height={36} />
          <div className="title">Sin resultados</div>
          <div className="subtitle">Nada coincide con "{searchTerm}" — probá con otro nombre, monto o referencia.</div>
        </div>
      ) : (
        Object.entries(grouped).map(([groupLabel, items]) => (
          <div key={groupLabel}>
            <div className="group-header">{groupLabel} <span style={{ opacity: 0.5, fontWeight: 400 }}>({items.length})</span></div>
            <div className="payment-list">
              {items.map((p) => (
                <div
                  key={p.id}
                  className={`payment-row payment-row-with-thumb${flashId === p.id ? ' payment-row-confirmed-flash' : ''}`}
                  style={{ flexWrap: 'wrap', gap: 12 }}
                >
                  {flashId === p.id && (
                    <div className="confirm-flash-overlay">
                      <IconCheckCircle width={40} height={40} />
                    </div>
                  )}
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
