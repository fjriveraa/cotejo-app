import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { IconCheckCircle } from '../components/icons'
import { SkeletonPaymentList } from '../components/Skeleton'
import OnboardingTour, { hasSeenOnboarding } from '../components/OnboardingTour'
import { isPlausibleTransactionDate, parseLocalDate } from '../lib/dateSanity'

const STATUS_LABELS = {
  pending: 'Pendiente',
  under_review: 'En revisión',
  confirmed_manual: 'Confirmado',
  not_found: 'No encontrado',
  rejected: 'Rechazado',
  voided: 'Anulado'
}

// Las RPCs devuelven errores técnicos en inglés/prefijo (ej.
// "separation_of_duties: ...") pensados para depurar, no para mostrárselos
// tal cual a quien está usando la cola. Esto los traduce a algo que
// cualquiera entiende sin explicación.
export function friendlyRpcError(message) {
  if (!message) return 'No se pudo completar la acción.'
  if (message.startsWith('separation_of_duties')) {
    return 'Quien registró este pago no puede confirmarlo — pídele a otra persona del equipo que lo revise.'
  }
  if (message.startsWith('version_conflict')) {
    return 'Este pago cambió mientras lo revisabas. Se actualizó la lista — inténtalo de nuevo.'
  }
  if (message.startsWith('invalid_state_transition')) {
    return 'Este pago ya no está pendiente de confirmación (alguien más ya lo revisó).'
  }
  if (message.startsWith('revert_window_expired')) {
    return 'Ya pasaron más de 24 horas desde que se confirmó — no se puede revertir desde aquí.'
  }
  if (message.startsWith('forbidden')) {
    return 'Tu rol no tiene permiso para hacer esto.'
  }
  return message
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

export function EvidenceModal({ payment, onClose }) {
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

// Antes, "Duplicado" pedía pegar a mano el UUID del pago original con un
// prompt() del navegador — sin mostrar nombre, monto ni fecha de a qué
// registro te iba a vincular. Un error de copiar/pegar anulaba en silencio
// el pago equivocado. Este modal muestra los candidatos con sus datos
// reales para elegir con un clic, preseleccionando el que ya detectamos por
// referencia repetida cuando existe.
function DuplicateModal({ payment, candidates, onConfirm, onClose, busy }) {
  const preselected = candidates.find((c) => c.sameReference)?.id || candidates[0]?.id || ''
  const [selectedId, setSelectedId] = useState(preselected)

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
        style={{ maxWidth: 480, width: '100%', maxHeight: '85vh', overflow: 'auto', background: 'white' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Marcar como duplicado</h3>
          <button className="btn btn-secondary" onClick={onClose}>Cerrar</button>
        </div>
        <p style={{ fontSize: 13, opacity: 0.75, marginTop: 0 }}>
          Este pago ({payment.currency} {Number(payment.amount).toLocaleString('es-HN', { minimumFractionDigits: 2 })}
          {payment.origin_account_holder ? ` — ${payment.origin_account_holder}` : ''}) va a quedar anulado como
          copia de cuál de estos:
        </p>

        {candidates.length === 0 ? (
          <p className="empty-state">No hay otros pagos pendientes de este banco para comparar.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {candidates.map((c) => (
              <label
                key={c.id}
                style={{
                  display: 'flex', gap: 8, alignItems: 'flex-start', border: '1px solid #e5e0d8',
                  borderRadius: 8, padding: 10, cursor: 'pointer',
                  background: selectedId === c.id ? 'rgba(43, 100, 89, 0.08)' : 'transparent'
                }}
              >
                <input
                  type="radio"
                  name="duplicateCandidate"
                  checked={selectedId === c.id}
                  onChange={() => setSelectedId(c.id)}
                  style={{ marginTop: 3 }}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                    {c.currency} {Number(c.amount).toLocaleString('es-HN', { minimumFractionDigits: 2 })}
                    {c.origin_account_holder ? ` — ${c.origin_account_holder}` : ''}
                    {c.sameReference && (
                      <span style={{ color: '#A2483A', fontWeight: 700, marginLeft: 6 }}>· misma referencia</span>
                    )}
                  </div>
                  <div className="meta">
                    {c.transaction_date ? parseLocalDate(c.transaction_date).toLocaleDateString('es-HN') : 'sin fecha'}
                    {c.reference_raw ? ` · ref: ${c.reference_raw}` : ''}
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}

        <button
          className="btn btn-rust"
          style={{ width: '100%' }}
          disabled={!selectedId || busy}
          onClick={() => onConfirm(selectedId)}
        >
          {busy ? 'Anulando...' : 'Confirmar duplicado'}
        </button>
      </div>
    </div>
  )
}

// Revertir una confirmación no debería ser un botón que la borra sin dejar
// rastro — por eso pide un motivo obligatorio, que queda en la bitácora de
// auditoría junto con quién lo hizo (revert_confirmation en la base de
// datos ya lo exige, esto solo evita el viaje redondo de un error trivial).
function RevertConfirmationModal({ payment, onConfirm, onClose, busy }) {
  const [reason, setReason] = useState('')

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
        style={{ maxWidth: 420, width: '100%', background: 'white' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Revertir confirmación</h3>
          <button className="btn btn-secondary" onClick={onClose}>Cerrar</button>
        </div>
        <p style={{ fontSize: 13, opacity: 0.75, marginTop: 0 }}>
          {payment.currency} {Number(payment.amount).toLocaleString('es-HN', { minimumFractionDigits: 2 })}
          {payment.origin_account_holder ? ` — ${payment.origin_account_holder}` : ''} vuelve a quedar pendiente.
          Esto queda registrado en la bitácora con el motivo que escribas.
        </p>
        <div className="field">
          <label htmlFor="revertReason">Motivo (obligatorio)</label>
          <textarea
            id="revertReason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="ej. confirmé el pago equivocado por error"
          />
        </div>
        <button
          className="btn btn-amber"
          style={{ width: '100%' }}
          disabled={!reason.trim() || busy}
          onClick={() => onConfirm(reason.trim())}
        >
          {busy ? 'Revirtiendo...' : 'Revertir'}
        </button>
      </div>
    </div>
  )
}

export function EvidenceThumb({ path, onClick }) {
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
  const [duplicatePayment, setDuplicatePayment] = useState(null)
  const [confirmedToday, setConfirmedToday] = useState([])
  const [showConfirmed, setShowConfirmed] = useState(false)
  const [revertingPayment, setRevertingPayment] = useState(null)
  const [flashId, setFlashId] = useState(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  // Si la empresa nunca configuró sus cuentas receptoras, todos los pagos
  // aparecerían como "cuenta desconocida" — una alerta que no distingue
  // nada. Solo tiene sentido mostrarla si existe al menos una cuenta
  // conocida contra la cual comparar.
  const [hasKnownAccounts, setHasKnownAccounts] = useState(false)
  // Cada contador cotejea distinto: unos priorizan al cliente que está
  // esperando respuesta, otros van banco por banco desde el comprobante más
  // viejo. No hay un único orden correcto, así que se deja elegir y se
  // recuerda la preferencia entre sesiones.
  const [sortBy, setSortBy] = useState(() => {
    try {
      return localStorage.getItem('cotejo:queueSortBy') || 'customer_waiting'
    } catch {
      return 'customer_waiting'
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('cotejo:queueSortBy', sortBy)
    } catch {
      // almacenamiento no disponible (modo privado, etc.) — no es crítico
    }
  }, [sortBy])

  useEffect(() => {
    if (!membership) return
    loadQueue()
    loadConfirmedToday()
    loadHasKnownAccounts()
  }, [membership])

  useEffect(() => {
    if (!hasSeenOnboarding()) setShowOnboarding(true)
  }, [])

  async function loadHasKnownAccounts() {
    const { count, error } = await supabase
      .from('receiving_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', membership.organization_id)
      .eq('active', true)
    if (!error) setHasKnownAccounts((count || 0) > 0)
  }

  // Honduras no tiene horario de verano — el desfase con UTC es siempre -6,
  // así que se puede calcular el inicio del día local sin librerías de
  // zona horaria.
  function startOfTodayHonduras() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Tegucigalpa', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date())
    const get = (type) => parts.find((p) => p.type === type)?.value
    return `${get('year')}-${get('month')}-${get('day')}T00:00:00-06:00`
  }

  async function loadConfirmedToday() {
    const { data, error } = await supabase.rpc('list_confirmed_today', {
      p_organization_id: membership.organization_id,
      p_since: startOfTodayHonduras()
    })
    if (!error) setConfirmedToday(data || [])
  }

  async function loadQueue() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('payment_records')
      .select(`
        id, amount, currency, reference_raw, notes, bank, account_last4,
        verification_status, processing_status, customer_waiting, version, created_at,
        evidence_path, extraction, transaction_date, origin_bank, receiving_account_id,
        origin_account_holder, origin_account_number, destination_account_holder
      `)
      .eq('organization_id', membership.organization_id)
      .in('verification_status', ['pending', 'under_review'])
      .order('customer_waiting', { ascending: false })
      .order('transaction_date', { ascending: true, nullsFirst: false })

    if (error) {
      setError(error.message)
    } else {
      setPayments(data || [])
    }
    setLoading(false)
  }

  // Fecha del banco confiable primero, sin fecha (o fecha dudosa) al final —
  // un pago sin fecha no debería enterrarse ni tampoco saltar al frente por
  // "vacío"; se trata como el caso menos informativo, no como el más urgente.
  function compareByTransactionDate(a, b) {
    const aOk = a.transaction_date && isPlausibleTransactionDate(a.transaction_date)
    const bOk = b.transaction_date && isPlausibleTransactionDate(b.transaction_date)
    if (aOk && bOk) return new Date(a.transaction_date) - new Date(b.transaction_date)
    if (aOk) return -1
    if (bOk) return 1
    return new Date(a.created_at) - new Date(b.created_at)
  }

  function sortPayments(list) {
    const arr = [...list]
    if (sortBy === 'customer_waiting') {
      arr.sort((a, b) => {
        if (a.customer_waiting !== b.customer_waiting) return a.customer_waiting ? -1 : 1
        return compareByTransactionDate(a, b)
      })
    } else if (sortBy === 'transaction_date') {
      arr.sort(compareByTransactionDate)
    } else if (sortBy === 'amount') {
      arr.sort((a, b) => Number(b.amount) - Number(a.amount))
    }
    return arr
  }

  const grouped = useMemo(() => {
    const groups = {}
    for (const p of payments) {
      const key = `${p.bank}${p.account_last4 ? ` (${p.account_last4})` : ''}`
      if (!groups[key]) groups[key] = []
      groups[key].push(p)
    }
    for (const key of Object.keys(groups)) {
      groups[key] = sortPayments(groups[key])
    }
    return groups
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments, sortBy])

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
      await Promise.all([loadQueue(), loadConfirmedToday()])
    } catch (err) {
      console.error(err)
      setError(friendlyRpcError(err.message))
    } finally {
      setBusyId(null)
    }
  }

  // A diferencia de las otras acciones (que solo recargan la cola), confirmar
  // primero muestra un check animado sobre la fila y espera a que se vea
  // antes de recargar — si se recargara de inmediato, la fila desaparecería
  // sin que la animación llegara a jugarse.
  async function handleConfirm(p) {
    setBusyId(p.id)
    setError(null)
    try {
      const { error } = await supabase.rpc('confirm_payment', {
        p_payment_id: p.id,
        p_expected_version: p.version
      })
      if (error) throw error
      setFlashId(p.id)
      await new Promise((resolve) => setTimeout(resolve, 650))
      await Promise.all([loadQueue(), loadConfirmedToday()])
    } catch (err) {
      console.error(err)
      setError(friendlyRpcError(err.message))
    } finally {
      setBusyId(null)
      setFlashId(null)
    }
  }
  const handleUnderReview = (p) => callRpc('mark_under_review', p)

  function handleNotFound(p) {
    const reason = window.prompt('¿Por qué no aparece este pago? (motivo breve)')
    if (reason === null) return
    callRpc('mark_not_found', p, { p_reason: reason })
  }

  function duplicateCandidatesFor(p) {
    return payments
      .filter((other) => other.id !== p.id && other.bank === p.bank)
      .map((other) => ({ ...other, sameReference: isDuplicateRef(p) && isDuplicateRef(other) }))
      .sort((a, b) => (a.sameReference === b.sameReference ? 0 : a.sameReference ? -1 : 1))
  }

  async function handleConfirmDuplicate(originalId) {
    if (!duplicatePayment) return
    await callRpc('void_as_duplicate', duplicatePayment, { p_original_payment_id: originalId })
    setDuplicatePayment(null)
  }

  async function handleRevertConfirmation(reason) {
    if (!revertingPayment) return
    await callRpc('revert_confirmation', revertingPayment, { p_reason: reason })
    setRevertingPayment(null)
  }

  if (loading) {
    return (
      <div className="container">
        <h2 style={{ marginTop: 0 }}>Cola de confirmación</h2>
        <SkeletonPaymentList rows={5} />
      </div>
    )
  }

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ marginTop: 0, marginBottom: 0 }}>Cola de confirmación</h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
          <span style={{ opacity: 0.6 }}>Ordenar por</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{ fontSize: 12.5, padding: '4px 6px', borderRadius: 6, border: '1px solid #e5e0d8' }}
          >
            <option value="customer_waiting">Cliente esperando primero</option>
            <option value="transaction_date">Fecha del banco (más antigua primero)</option>
            <option value="amount">Monto (mayor primero)</option>
          </select>
        </label>
      </div>
      {error && <p className="error-text">{error}</p>}

      {confirmedToday.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <button
            type="button"
            onClick={() => setShowConfirmed((v) => !v)}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%',
              background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit', color: 'inherit'
            }}
          >
            <strong style={{ fontSize: 14 }}>Confirmados hoy ({confirmedToday.length})</strong>
            <span style={{ fontSize: 12, opacity: 0.6 }}>{showConfirmed ? 'Ocultar ▲' : 'Ver ▼'}</span>
          </button>
          {showConfirmed && (
            <div className="payment-list" style={{ marginTop: 12 }}>
              {confirmedToday.map((c) => (
                <div key={c.id} className="payment-row" style={{ flexWrap: 'wrap', gap: 10 }}>
                  <div>
                    <div className="amount" style={{ fontSize: 13.5 }}>
                      {c.currency} {Number(c.amount).toLocaleString('es-HN', { minimumFractionDigits: 2 })}
                      {c.origin_account_holder ? ` — ${c.origin_account_holder}` : ''}
                    </div>
                    <div className="meta">
                      Confirmado por {c.confirmed_by_email} a las {new Date(c.verified_at).toLocaleTimeString('es-HN')}
                      {c.reference_raw ? ` · ref: ${c.reference_raw}` : ''}
                    </div>
                    {c.self_confirmed && (
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: '#B45309', marginTop: 2 }}>
                        ⚠ Autoconfirmado por el propietario — sin doble revisión
                      </div>
                    )}
                  </div>
                  <button
                    className="btn btn-secondary"
                    disabled={busyId === c.id}
                    onClick={() => setRevertingPayment(c)}
                  >
                    Deshacer
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
                    {/* Lo primero que hace falta para cotejar es a qué día ir en la app
                        del banco — no la hora en que esto se registró en Cotejo (eso va
                        abajo, en gris). Sin fecha detectada se avisa en vez de callar. */}
                    <div
                      style={{
                        fontSize: 13, fontWeight: 700, letterSpacing: 0.2,
                        color: p.transaction_date && isPlausibleTransactionDate(p.transaction_date) ? '#2B6459' : '#B08900'
                      }}
                    >
                      {!p.transaction_date && '⚠ Fecha no detectada'}
                      {p.transaction_date && !isPlausibleTransactionDate(p.transaction_date) && (
                        <span title="La IA detectó esta fecha pero no parece correcta (año/rango implausible) — verifícala contra el comprobante">
                          ⚠ Fecha dudosa: {parseLocalDate(p.transaction_date).toLocaleDateString('es-HN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                      )}
                      {p.transaction_date && isPlausibleTransactionDate(p.transaction_date) &&
                        parseLocalDate(p.transaction_date).toLocaleDateString('es-HN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
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
                    {hasKnownAccounts && !p.receiving_account_id && (
                      <div
                        style={{ fontSize: 12, fontWeight: 700, color: '#A2483A', marginTop: 3 }}
                        title="El banco destino no coincide con ninguna de tus cuentas receptoras registradas — puede ser una cuenta nueva sin agregar, o el cliente pagó a la cuenta equivocada"
                      >
                        ⚠ Cuenta destino desconocida
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
                        onClick={() => setDuplicatePayment(p)}
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

      {duplicatePayment && (
        <DuplicateModal
          payment={duplicatePayment}
          candidates={duplicateCandidatesFor(duplicatePayment)}
          busy={busyId === duplicatePayment.id}
          onConfirm={handleConfirmDuplicate}
          onClose={() => setDuplicatePayment(null)}
        />
      )}

      {revertingPayment && (
        <RevertConfirmationModal
          payment={revertingPayment}
          busy={busyId === revertingPayment.id}
          onConfirm={handleRevertConfirmation}
          onClose={() => setRevertingPayment(null)}
        />
      )}

      {showOnboarding && <OnboardingTour onClose={() => setShowOnboarding(false)} />}
    </div>
  )
}
