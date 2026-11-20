import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { IconInbox } from '../components/icons'
import { getCanonicalOrigin } from '../lib/appUrl'
import { SkeletonPaymentList } from '../components/Skeleton'
import { isPlausibleTransactionDate, parseLocalDate } from '../lib/dateSanity'
import EvidenceViewer from '../components/EvidenceViewer'
import { canonicalBank, bankColor, NO_BANK } from '../lib/bankGroups'

function ViewEvidence({ path }) {
  const [open, setOpen] = useState(false)
  if (!path) return null
  return (
    <span>
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)} style={{ fontSize: 13 }}>
        Ver comprobante
      </button>
      {open && <EvidenceViewer bucket="guest-evidence" path={path} onClose={() => setOpen(false)} />}
    </span>
  )
}

const FORENSICS_LABELS = {
  posible_ia: { text: '🚨 Posible imagen generada por IA', color: '#7C2D12', bg: '#FEE2E2' },
  revisar: { text: '⚠ Revisar — señales de manipulación', color: '#92400E', bg: '#FEF3C7' },
  limpio: { text: '✓ Sin señales de manipulación', color: '#2B6459', bg: '#E6F4F1' },
  sin_datos: { text: 'Sin resultado claro', color: '#6B7280', bg: '#F3F4F6' }
}

function ForensicsCheck({ submissionId, existingScore, existingLabel, onChecked }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function run() {
    setLoading(true)
    setError(null)
    const { data, error: fnError } = await supabase.functions.invoke('analyze-image-forensics', {
      body: { submission_id: submissionId }
    })
    setLoading(false)
    if (fnError || data?.error) {
      setError(data?.error || fnError?.message || 'No se pudo analizar el comprobante.')
      return
    }
    onChecked?.(data)
  }

  if (existingLabel && FORENSICS_LABELS[existingLabel]) {
    const info = FORENSICS_LABELS[existingLabel]
    return (
      <span style={{ fontSize: 12, fontWeight: 700, color: info.color, background: info.bg, padding: '2px 8px', borderRadius: 6 }}>
        {info.text}{typeof existingScore === 'number' ? ` (${Math.round(existingScore * 100)}%)` : ''}
      </span>
    )
  }

  return (
    <span>
      <button type="button" className="btn btn-secondary" onClick={run} disabled={loading} style={{ fontSize: 12, padding: '4px 10px' }}>
        {loading ? 'Analizando...' : '🔍 Analizar con forensia'}
      </button>
      {error && <span style={{ marginLeft: 8, fontSize: 12, color: '#B91C1C' }}>{error}</span>}
    </span>
  )
}

function LinkRow({ label, hint, link }) {
  const [copied, setCopied] = useState(false)
  function copyLink() {
    navigator.clipboard?.writeText(link).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{label}</div>
      <p style={{ fontSize: 12, opacity: 0.7, margin: '2px 0 6px' }}>{hint}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input readOnly value={link} onFocus={(e) => e.target.select()} style={{ flex: '1 1 220px', fontSize: 13 }} />
        <button type="button" className="btn btn-secondary" onClick={copyLink}>
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
    </div>
  )
}

function CustomerLinkCard({ organizationId, organizationName }) {
  const remoteLink = `${getCanonicalOrigin()}/comprobante/${organizationId}`
  const inPersonLink = `${remoteLink}?presencial=1`
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(inPersonLink)}`

  return (
    <div className="card" style={{ marginBottom: 24, display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <img src={qrUrl} alt={`Código QR para enviar comprobantes a ${organizationName} en tienda`} width={120} height={120} style={{ borderRadius: 8 }} />
      <div style={{ flex: '1 1 260px' }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Enlaces para tus clientes (no necesitan cuenta)</div>
        <LinkRow
          label="Código QR / enlace para imprimir en tienda"
          hint="Para cuando el cliente está frente a ti pagando. Queda marcado como 'en tienda' en la cola."
          link={inPersonLink}
        />
        <LinkRow
          label="Enlace para WhatsApp / Instagram"
          hint="Para cuando pides el comprobante a distancia. Queda marcado como 'a distancia' en la cola."
          link={remoteLink}
        />
      </div>
    </div>
  )
}

const MONTH_FORMAT = { month: 'long', year: 'numeric' }
const DAY_FORMAT = { weekday: 'long', day: '2-digit', month: 'long' }

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function formatMoney(currency, amount) {
  return `${currency} ${Number(amount).toLocaleString('es-HN', { minimumFractionDigits: 2 })}`
}

// Totales de lo confirmado por moneda -- "HNL 4,500.00 · USD 20.00". Solo
// cuenta lo confirmado: sumar también lo rechazado inflaría el total del día.
function confirmedTotals(rows) {
  const totals = {}
  for (const r of rows) {
    if (r.status !== 'confirmed') continue
    totals[r.currency] = (totals[r.currency] || 0) + Number(r.amount || 0)
  }
  const parts = Object.entries(totals).map(([cur, total]) => formatMoney(cur, total))
  return parts.length ? parts.join(' · ') : null
}

// Agrupa por mes y, dentro de cada mes, por día, según la fecha en que llegó
// el comprobante (la fecha del comprobante puede faltar o ser dudosa). El
// orden es del más reciente al más antiguo.
function groupByMonthAndDay(rows) {
  const months = new Map()
  for (const r of rows) {
    const d = new Date(r.created_at)
    const monthKey = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
    const dayKey = `${monthKey}-${pad(d.getDate())}`
    if (!months.has(monthKey)) {
      months.set(monthKey, { key: monthKey, label: capitalize(d.toLocaleDateString('es-HN', MONTH_FORMAT)), days: new Map(), rows: [] })
    }
    const month = months.get(monthKey)
    month.rows.push(r)
    if (!month.days.has(dayKey)) {
      month.days.set(dayKey, { key: dayKey, label: capitalize(d.toLocaleDateString('es-HN', DAY_FORMAT)), rows: [] })
    }
    month.days.get(dayKey).rows.push(r)
  }
  return [...months.values()]
    .sort((a, b) => (a.key < b.key ? 1 : -1))
    .map((m) => ({ ...m, days: [...m.days.values()].sort((a, b) => (a.key < b.key ? 1 : -1)) }))
}

const STATUS_BADGE = {
  confirmed: { text: 'Confirmado', color: '#2B6459', bg: '#E6F4F1' },
  not_confirmed: { text: 'No se pudo confirmar', color: '#92400E', bg: '#FEF3C7' }
}

const summaryStyle = { cursor: 'pointer', display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', listStyle: 'revert' }

function GuestArchive({ rows, loading, error }) {
  const months = groupByMonthAndDay(rows)
  const now = new Date()
  const currentMonthKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
  const todayKey = `${currentMonthKey}-${pad(now.getDate())}`

  return (
    <div style={{ marginTop: 32 }}>
      <h3 style={{ margin: '0 0 4px' }}>Archivo de comprobantes</h3>
      <p style={{ opacity: 0.7, fontSize: 13, margin: '0 0 16px' }}>
        Los comprobantes ya revisados, guardados por mes y por día según cuándo llegaron.
      </p>
      {error && <p className="error-text">{error}</p>}
      {loading ? (
        <SkeletonPaymentList rows={2} />
      ) : months.length === 0 ? (
        <p style={{ opacity: 0.6, fontSize: 14 }}>Todavía no hay comprobantes revisados.</p>
      ) : (
        months.map((month) => {
          const monthTotal = confirmedTotals(month.rows)
          return (
            <details key={month.key} open={month.key === currentMonthKey} className="card" style={{ marginBottom: 12, padding: 14 }}>
              <summary style={summaryStyle}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>📁 {month.label}</span>
                <span className="meta">
                  {month.rows.length} comprobante{month.rows.length === 1 ? '' : 's'}
                  {monthTotal ? ` · confirmado: ${monthTotal}` : ''}
                </span>
              </summary>
              <div style={{ marginTop: 12 }}>
                {month.days.map((day) => {
                  const dayTotal = confirmedTotals(day.rows)
                  return (
                    <details key={day.key} open={day.key === todayKey} style={{ marginBottom: 8, paddingLeft: 12, borderLeft: '2px solid #E5E0D8' }}>
                      <summary style={summaryStyle}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{day.label}</span>
                        <span className="meta">
                          {day.rows.length}{dayTotal ? ` · ${dayTotal}` : ''}
                        </span>
                      </summary>
                      <div className="payment-list" style={{ marginTop: 8 }}>
                        {day.rows.map((r) => {
                          const badge = STATUS_BADGE[r.status]
                          return (
                            <div key={r.id} className="payment-row" style={{ flexWrap: 'wrap', gap: 12 }}>
                              <div>
                                <div className="amount">{formatMoney(r.currency, r.amount)}</div>
                                <div className="meta">
                                  {r.submitter_name || 'Sin nombre'}
                                  {r.reference_raw ? ` · ref: ${r.reference_raw}` : ''}
                                  {' · '}
                                  {new Date(r.created_at).toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit' })}
                                </div>
                                {r.review_notes && <div className="meta">Motivo: {r.review_notes}</div>}
                                {badge && (
                                  <span style={{ display: 'inline-block', marginTop: 4, fontSize: 12, fontWeight: 700, color: badge.color, background: badge.bg, padding: '2px 8px', borderRadius: 6 }}>
                                    {badge.text}
                                  </span>
                                )}
                              </div>
                              <div className="actions-row">
                                <ViewEvidence path={r.evidence_path} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </details>
                  )
                })}
              </div>
            </details>
          )
        })
      )}
    </div>
  )
}

export default function GuestQueue() {
  const { membership } = useAuth()
  const [items, setItems] = useState([])
  const [archive, setArchive] = useState([])
  const [archiveLoading, setArchiveLoading] = useState(true)
  const [archiveError, setArchiveError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [bankFilter, setBankFilter] = useState('todos')
  const [branchMatches, setBranchMatches] = useState({}) // submission_id -> pago ya registrado por la sucursal
  const forensicsEnabled = Boolean(membership?.organizations?.forensics_addon_enabled)

  function applyForensicsResult(submissionId, result) {
    setItems((prev) =>
      prev.map((item) =>
        item.submission_id === submissionId
          ? { ...item, forensics_score: result.forensics_score, forensics_label: result.forensics_label }
          : item
      )
    )
  }

  useEffect(() => {
    if (!membership) return
    load()
    loadArchive()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membership?.organization_id])

  // El archivo lee la tabla directo (la política de seguridad ya limita a los
  // roles de revisión de esta empresa). Tope de 1000 para no cargar años de
  // historial de golpe en un teléfono.
  async function loadArchive() {
    setArchiveLoading(true)
    setArchiveError(null)
    const { data, error: archiveFetchError } = await supabase
      .from('guest_submissions')
      .select('id, amount, currency, submitter_name, reference_raw, evidence_path, status, review_notes, created_at')
      .eq('organization_id', membership.organization_id)
      .in('status', ['confirmed', 'not_confirmed'])
      .order('created_at', { ascending: false })
      .limit(1000)
    setArchiveLoading(false)
    if (archiveFetchError) setArchiveError(archiveFetchError.message)
    else setArchive(data || [])
  }

  async function load() {
    setLoading(true)
    setError(null)
    const [{ data, error }, matchRes] = await Promise.all([
      supabase.rpc('list_guest_submissions', { p_organization_id: membership.organization_id }),
      supabase.rpc('guest_branch_matches', { p_organization_id: membership.organization_id })
    ])
    setLoading(false)
    if (error) setError(error.message)
    else setItems(data || [])
    // Si esta consulta falla, simplemente no se muestra el aviso: la lista sigue funcionando.
    const map = {}
    for (const m of matchRes?.data || []) map[m.submission_id] = m
    setBranchMatches(map)
  }

  async function decide(item, approve, presetNotes = null) {
    let reviewNotes = presetNotes
    if (!approve && presetNotes === null) {
      reviewNotes = window.prompt('¿Por qué no se pudo confirmar? (esto lo va a ver la persona que lo envió, sé breve y claro)')
      if (reviewNotes === null) return
    }
    setBusyId(item.submission_id)
    setError(null)
    const { error } = await supabase.rpc('decide_guest_submission', {
      p_submission_id: item.submission_id,
      p_approve: approve,
      p_review_notes: reviewNotes
    })
    setBusyId(null)
    if (error) {
      setError(error.message)
      return
    }
    load()
    loadArchive()
  }

  async function discard(item) {
    const ok = window.confirm('¿Descartar este envío? Se saca de la cola y no cuenta como pago (útil para duplicados o capturas equivocadas). Quien lo envió verá que no se registró.')
    if (!ok) return
    setBusyId(item.submission_id)
    setError(null)
    const { error } = await supabase.rpc('discard_guest_submission', { p_submission_id: item.submission_id, p_reason: null })
    setBusyId(null)
    if (error) {
      setError(error.message)
      return
    }
    load()
  }

  const bankOf = (s) => canonicalBank(s.detected_bank)
  const bankCounts = items.reduce((acc, it) => {
    const b = bankOf(it)
    acc[b] = (acc[b] || 0) + 1
    return acc
  }, {})
  const bankNames = Object.keys(bankCounts).sort((a, b) => (a === NO_BANK) - (b === NO_BANK) || bankCounts[b] - bankCounts[a] || a.localeCompare(b))
  const activeFilter = bankFilter !== 'todos' && !bankCounts[bankFilter] ? 'todos' : bankFilter
  const visibleItems = (activeFilter === 'todos' ? items : items.filter((it) => bankOf(it) === activeFilter))
    .slice()
    .sort((x, y) => {
      if (activeFilter !== 'todos') return 0
      const bx = bankOf(x), by = bankOf(y)
      return bx === by ? 0 : (bx === NO_BANK) - (by === NO_BANK) || bankCounts[by] - bankCounts[bx] || bx.localeCompare(by)
    })

  if (loading) {
    return (
      <div className="container">
        <h2 style={{ marginTop: 0 }}>Comprobantes de invitados</h2>
        <SkeletonPaymentList rows={4} />
      </div>
    )
  }

  return (
    <div className="container">
      <h2 style={{ marginTop: 0 }}>Comprobantes de invitados</h2>
      <p style={{ opacity: 0.7, fontSize: 14, marginTop: -8, marginBottom: 24 }}>
        Comprobantes que clientes enviaron directamente, sin necesitar cuenta en Cotejo. Al confirmar o no poder
        confirmar, la persona ve el resultado en el enlace que le dimos al enviarlo.
      </p>

      {error && <p className="error-text">{error}</p>}

      {items.length === 0 ? (
        <div className="empty-state-friendly">
          <IconInbox width={36} height={36} />
          <div className="title">Bandeja al día</div>
          <div className="subtitle">No hay comprobantes de invitados pendientes de revisar.</div>
        </div>
      ) : (
        <>
        {bankNames.length > 1 && (
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 8 }}>
            {['todos', ...bankNames].map((b) => {
              const selected = activeFilter === b
              const color = b === 'todos' ? '#2B6459' : b === NO_BANK ? '#6B7280' : bankColor(b)
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBankFilter(b)}
                  style={{ flex: '0 0 auto', whiteSpace: 'nowrap', padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: `1.5px solid ${color}`, background: selected ? color : 'transparent', color: selected ? 'white' : color }}
                >
                  {b === 'todos' ? `Todos (${items.length})` : `${b} (${bankCounts[b]})`}
                </button>
              )
            })}
          </div>
        )}
        <div className="payment-list">
          {visibleItems.map((s) => (
            <div key={s.submission_id} className="gq-card">
              <div className="gq-head">
                <div className="gq-amount">
                  {s.currency} {Number(s.amount).toLocaleString('es-HN', { minimumFractionDigits: 2 })}
                </div>
                <span className="gq-bank" style={{ background: bankOf(s) === NO_BANK ? '#6B7280' : bankColor(bankOf(s)) }}>
                  {bankOf(s)}
                </span>
              </div>

              <div className="gq-person">
                <div className="gq-name">{s.submitter_name || 'Sin nombre'}</div>
                {s.submitter_contact && <div className="gq-contact">{s.submitter_contact}</div>}
              </div>

              {s.group_name && (
                <div className="gq-group">
                  <span>📁</span>
                  <span>
                    {s.group_name}
                    {s.group_member_name && s.group_member_name.trim().toLowerCase() !== (s.submitter_name || '').trim().toLowerCase()
                      ? ` · ${s.group_member_name}` : ''}
                  </span>
                </div>
              )}

              <dl className="gq-grid">
                <div>
                  <dt>Referencia</dt>
                  <dd>{s.reference_raw || '—'}</dd>
                </div>
                <div>
                  <dt>Fecha del comprobante</dt>
                  <dd className={s.transaction_date && isPlausibleTransactionDate(s.transaction_date) ? 'gq-ok' : 'gq-warn'}>
                    {s.transaction_date && isPlausibleTransactionDate(s.transaction_date)
                      ? parseLocalDate(s.transaction_date).toLocaleDateString('es-HN', { day: 'numeric', month: 'short', year: 'numeric' })
                      : s.transaction_date
                        ? `⚠ Dudosa: ${parseLocalDate(s.transaction_date).toLocaleDateString('es-HN')}`
                        : '⚠ No detectada'}
                  </dd>
                </div>
                <div>
                  <dt>Enviado</dt>
                  <dd>{new Date(s.created_at).toLocaleString('es-HN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</dd>
                </div>
                {(s.origin_account_holder || s.origin_bank) && (
                  <div>
                    <dt>Cuenta de origen</dt>
                    <dd>{[s.origin_account_holder, s.origin_bank ? `(${s.origin_bank})` : null].filter(Boolean).join(' ')}</dd>
                  </div>
                )}
              </dl>

              <div className="gq-chips">
                <span className={`gq-chip ${s.is_in_person ? 'gq-chip-ok' : ''}`}>
                  {s.is_in_person ? '📍 Enviado en tienda' : 'Enviado a distancia'}
                </span>
              </div>

              {(s.duplicate_reference || s.hash_seen_elsewhere || (!s.hash_seen_elsewhere && s.similar_hash_elsewhere) || s.account_mismatch || (s.edited_fields && s.edited_fields.length > 0) || branchMatches[s.submission_id]) && (
                <div className="gq-alerts">
                  {s.hash_seen_elsewhere && (
                    <div className="gq-alert gq-alert-danger">🚨 Este mismo archivo ya fue enviado a otra empresa — posible comprobante reciclado</div>
                  )}
                  {s.account_mismatch && (
                    <div className="gq-alert gq-alert-danger">🚨 El comprobante muestra {s.detected_bank}, que no coincide con ninguna de tus cuentas registradas — pudo ser un pago a otro negocio</div>
                  )}
                  {s.duplicate_reference && (
                    <div className="gq-alert gq-alert-danger">⚠ Esta referencia ya se usó en otra solicitud — revisa con cuidado</div>
                  )}
                  {!s.hash_seen_elsewhere && s.similar_hash_elsewhere && (
                    <div className="gq-alert gq-alert-warn">⚠ Comprobante muy parecido a uno enviado a otra empresa — verificar con calma</div>
                  )}
                  {s.edited_fields && s.edited_fields.length > 0 && (
                    <div className="gq-alert gq-alert-warn">⚠ El cliente cambió {s.edited_fields.join(' y ')} que la IA leyó de la imagen — compara contra el comprobante antes de confirmar</div>
                  )}
                  {branchMatches[s.submission_id] && (
                    <div className="gq-alert gq-alert-warn">
                      ⚠ Posible doble envío: la sucursal ya registró este pago ({branchMatches[s.submission_id].payment_public_id}) el{' '}
                      {new Date(branchMatches[s.submission_id].payment_created_at).toLocaleString('es-HN')}.
                    </div>
                  )}
                </div>
              )}

              {forensicsEnabled && (
                <div style={{ marginTop: 10 }}>
                  <ForensicsCheck
                    submissionId={s.submission_id}
                    existingScore={s.forensics_score}
                    existingLabel={s.forensics_label}
                    onChecked={(result) => applyForensicsResult(s.submission_id, result)}
                  />
                </div>
              )}
              {s.notes && <div className="gq-note">Nota del cliente: {s.notes}</div>}

              <div className="gq-actions">
                <div className="gq-actions-main">
                  <ViewEvidence path={s.evidence_path} />
                  <button className="btn btn-primary" disabled={busyId === s.submission_id} onClick={() => decide(s, true)}>
                    {busyId === s.submission_id ? 'Un momento...' : 'Confirmar'}
                  </button>
                </div>
                <div className="gq-actions-more">
                  {branchMatches[s.submission_id] && (
                    <button
                      className="gq-link"
                      disabled={busyId === s.submission_id}
                      onClick={() => decide(s, false, `Ya registramos tu pago en la tienda (${branchMatches[s.submission_id].payment_public_id}). No necesitas hacer nada más.`)}
                    >
                      Ya registrado en sucursal
                    </button>
                  )}
                  <button className="gq-link gq-link-amber" disabled={busyId === s.submission_id} onClick={() => decide(s, false)}>
                    No se pudo confirmar
                  </button>
                  <button className="gq-link" disabled={busyId === s.submission_id} onClick={() => discard(s)}>
                    Descartar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        </>
      )}

      <GuestArchive rows={archive} loading={archiveLoading} error={archiveError} />

      {membership && (
        <div style={{ marginTop: 28 }}>
          <CustomerLinkCard organizationId={membership.organization_id} organizationName={membership.organizations?.name} />
        </div>
      )}
    </div>
  )
}
