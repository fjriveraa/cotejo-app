import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getCanonicalOrigin } from '../lib/appUrl'
import { SkeletonPaymentList } from '../components/Skeleton'

const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

// "2026-09" -> "septiembre 2026"
function formatPeriodLabel(period) {
  if (!period) return period
  const [year, month] = period.split('-')
  const name = MONTH_NAMES[Number(month) - 1]
  return name ? `${name} ${year}` : period
}

// Racha de pagos de una persona -- mismo lenguaje visual que las bolitas W/D/L de "forma
// reciente" en FiguSwitch: de un vistazo se ve el patrón (quién falla seguido) sin tener que
// abrir el historial mes por mes. Verde = pagó, rojo = no pagó, gris = todavía no estaba en
// el grupo ese mes (nunca se marca como "no pagó" a alguien que ni existía).
function PaymentStreak({ history }) {
  if (!history || history.length <= 1) return null
  return (
    <div style={{ display: 'flex', gap: 3, marginTop: 4 }} title="Racha de pagos, mes a mes (más reciente a la derecha)">
      {history.map((h) => (
        <span
          key={h.period}
          title={`${formatPeriodLabel(h.period)}${h.paid === null ? ': todavía no estaba en el grupo' : h.paid ? ': pagó' : ': no pagó'}`}
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            display: 'inline-block',
            background: h.paid === null ? '#e5e7eb' : h.paid ? '#2B6459' : '#B91C1C'
          }}
        />
      ))}
    </div>
  )
}

// Sección de un mes anterior en el historial -- colapsada por defecto si ya se completó
// (todos pagaron), abierta si a alguien le falta, igual que las fases del mundial en
// FiguSwitch (una fase se colapsa sola solo cuando ya se jugó completa). La lista de
// integrantes de ese mes se carga solo al abrir la sección, no de una vez con todo lo demás.
function MonthHistorySection({ groupId, period, paidCount, totalCount, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen)
  const [members, setMembers] = useState(null)
  const [loading, setLoading] = useState(false)

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && members === null) {
      setLoading(true)
      const { data } = await supabase.rpc('list_payment_group_members', { p_group_id: groupId, p_period: period })
      setLoading(false)
      setMembers(data || [])
    }
  }

  const complete = totalCount > 0 && paidCount >= totalCount

  return (
    <div style={{ marginBottom: 8, background: '#fff', border: `1px solid ${complete ? '#e5e7eb' : '#f3c9c9'}`, borderRadius: 12, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={toggle}
        style={{ width: '100%', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' }}
      >
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, textTransform: 'capitalize' }}>{formatPeriodLabel(period)}</span>
        <span style={{ fontSize: 12, opacity: 0.65 }}>{paidCount}/{totalCount} pagaron</span>
        <span style={{ fontSize: 11, opacity: 0.5 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 14px 12px' }}>
          {loading && <p style={{ fontSize: 12, opacity: 0.6 }}>Cargando...</p>}
          {members && members.length === 0 && <p style={{ fontSize: 12, opacity: 0.6 }}>Nadie en la lista ese mes.</p>}
          {members && members.map((m) => (
            <div key={m.member_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderTop: '1px solid #f1f1f1' }}>
              <span style={{ fontSize: 13 }}>{m.display_name}{m.identifier ? ` · ${m.identifier}` : ''}</span>
              <span style={{ fontSize: 12, opacity: 0.7 }}>
                {m.paid ? `✓ L ${Number(m.paid_amount).toLocaleString('es-HN', { minimumFractionDigits: 2 })}` : '✗ No pagó'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ViewEvidence({ path }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function open() {
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase.storage.from('guest-evidence').createSignedUrl(path, 300)
    setLoading(false)
    if (fetchError || !data?.signedUrl) {
      setError('No se pudo abrir. Intenta de nuevo.')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  if (!path) return null
  return (
    <span>
      <button type="button" className="btn btn-secondary" onClick={open} disabled={loading} style={{ fontSize: 12, padding: '4px 10px' }}>
        {loading ? 'Abriendo...' : 'Ver comprobante'}
      </button>
      {error && <span style={{ marginLeft: 8, fontSize: 12, color: '#B91C1C' }}>{error}</span>}
    </span>
  )
}

function CopyLink({ link }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard?.writeText(link).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button type="button" className="btn btn-secondary" onClick={copy} style={{ fontSize: 12, padding: '4px 10px' }}>
      {copied ? 'Copiado' : 'Copiar link'}
    </button>
  )
}

function AddMemberForm({ groupId, onAdded }) {
  const [open, setOpen] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [expectedAmount, setExpectedAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (!displayName.trim()) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('add_payment_group_member', {
      p_group_id: groupId,
      p_display_name: displayName.trim(),
      p_identifier: identifier.trim() || null,
      p_expected_amount: expectedAmount ? Number(expectedAmount) : null
    })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    setDisplayName('')
    setIdentifier('')
    setExpectedAmount('')
    setOpen(false)
    onAdded()
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
        + Agregar persona
      </button>
    )
  }

  return (
    <div className="card" style={{ maxWidth: 420, marginBottom: 16 }}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="displayName">Nombre</label>
          <input id="displayName" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="identifier">Identificador (opcional — ej. "Local 4", "Depto 2B")</label>
          <input id="identifier" type="text" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="expectedAmount">Monto esperado (opcional)</label>
          <input id="expectedAmount" type="number" step="0.01" min="0" value={expectedAmount} onChange={(e) => setExpectedAmount(e.target.value)} />
        </div>
        {error && <p className="error-text">{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Agregando...' : 'Agregar'}</button>
          <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancelar</button>
        </div>
      </form>
    </div>
  )
}

// Importa varias personas de un pegado tipo CSV (una por línea:
// nombre,identificador,monto) -- suficientemente simple para pegar desde un
// Excel/Sheets sin tener que subir un archivo.
function ImportMembersForm({ groupId, onImported }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  async function submit(e) {
    e.preventDefault()
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) return
    setBusy(true)
    setError(null)
    setResult(null)
    let ok = 0
    let failed = 0
    for (const line of lines) {
      const [rawName, rawIdentifier, rawAmount] = line.split(',').map((v) => v?.trim())
      if (!rawName) { failed += 1; continue }
      const { error } = await supabase.rpc('add_payment_group_member', {
        p_group_id: groupId,
        p_display_name: rawName,
        p_identifier: rawIdentifier || null,
        p_expected_amount: rawAmount ? Number(rawAmount) : null
      })
      if (error) failed += 1
      else ok += 1
    }
    setBusy(false)
    setResult(`${ok} agregados${failed > 0 ? `, ${failed} con error` : ''}.`)
    setText('')
    onImported()
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
        Importar lista
      </button>
    )
  }

  return (
    <div className="card" style={{ maxWidth: 480, marginBottom: 16 }}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="importText">Una persona por línea: nombre, identificador (opcional), monto esperado (opcional)</label>
          <textarea
            id="importText"
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Juan Pérez, Local 4, 1500\nMaría Gómez, Local 5, 1500'}
            required
          />
        </div>
        {error && <p className="error-text">{error}</p>}
        {result && <p style={{ color: '#2B6459', fontSize: 13 }}>{result}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Importando...' : 'Importar'}</button>
          <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cerrar</button>
        </div>
      </form>
    </div>
  )
}

function RegisterPaymentForm({ groupId, organizationId, member, onDone, onCancel }) {
  const [amount, setAmount] = useState(member.expected_amount || '')
  const [transactionDate, setTransactionDate] = useState('')
  const [notes, setNotes] = useState('')
  const [evidencePath, setEvidencePath] = useState(null)
  const [aiStatus, setAiStatus] = useState('idle') // idle | uploading | analyzing | done | error
  const [aiMessage, setAiMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Para cuando el inquilino/persona le manda la foto del comprobante por
  // WhatsApp u otro medio y quien administra el grupo prefiere subirla
  // directamente aquí, sin tener que ir al formulario público y salir de
  // esta pantalla. La IA intenta leerla igual que en el envío normal, para
  // no tener que copiar los datos a mano si ya se pueden leer solos.
  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setAiStatus('uploading')
    setAiMessage('Subiendo comprobante...')
    try {
      const ext = file.name.split('.').pop()
      const path = `${organizationId}/manual-${crypto.randomUUID()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('guest-evidence').upload(path, file)
      if (uploadError) throw uploadError
      setEvidencePath(path)

      if (!file.type.startsWith('image/')) {
        setAiStatus('done')
        setAiMessage('Comprobante adjunto. Completa el monto a mano.')
        return
      }

      setAiStatus('analyzing')
      setAiMessage('Leyendo comprobante con IA...')
      const { data: fnData, error: fnError } = await supabase.functions.invoke('analyze-guest-evidence', {
        body: { path, organization_id: organizationId }
      })
      if (fnError) throw fnError
      const extraction = fnData?.extraction
      if (extraction) {
        if (extraction.amount && !amount) setAmount(String(extraction.amount))
        if (extraction.transaction_date && !transactionDate) setTransactionDate(extraction.transaction_date)
        setAiStatus('done')
        setAiMessage('✓ Comprobante adjunto. Revisa los datos antes de guardar.')
      } else {
        setAiStatus('done')
        setAiMessage('Comprobante adjunto. No se pudieron leer los datos solos -- complétalos a mano.')
      }
    } catch (err) {
      console.error('Error subiendo/leyendo comprobante:', err)
      setAiStatus('error')
      setAiMessage('No se pudo subir el comprobante. Puedes registrar el pago sin foto.')
    }
  }

  async function submit(e) {
    e.preventDefault()
    if (!amount || Number(amount) <= 0) {
      setError('Ingresa un monto válido.')
      return
    }
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('register_manual_group_payment', {
      p_group_id: groupId,
      p_member_id: member.member_id,
      p_amount: Number(amount),
      p_transaction_date: transactionDate || null,
      p_notes: notes.trim() || null,
      p_evidence_path: evidencePath
    })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    onDone()
  }

  return (
    <div className="card" style={{ marginTop: 8, background: 'rgba(43, 100, 89, 0.05)' }}>
      <form onSubmit={submit}>
        <p style={{ fontSize: 13, marginTop: 0, fontWeight: 600 }}>Registrar pago de {member.display_name}</p>
        <p style={{ fontSize: 12, opacity: 0.65, marginTop: -8, marginBottom: 12 }}>
          Para cuando tú tienes el comprobante (te lo mandó por WhatsApp, por ejemplo) o la persona pagó sin mandar
          nada (efectivo, o ya lo confirmaste por tu cuenta).
        </p>
        <div className="field">
          <label htmlFor="regFile">Foto del comprobante (opcional)</label>
          <input id="regFile" type="file" accept="image/*,application/pdf" onChange={handleFileChange} />
          {aiMessage && (
            <p style={{ fontSize: 12, marginTop: 4, color: aiStatus === 'error' ? '#A2483A' : aiStatus === 'done' ? '#2B6459' : 'inherit' }}>
              {(aiStatus === 'uploading' || aiStatus === 'analyzing') && '⏳ '}
              {aiMessage}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="regAmount">Monto</label>
          <input id="regAmount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="regDate">Fecha (opcional)</label>
          <input id="regDate" type="date" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="regNotes">Nota (opcional)</label>
          <input id="regNotes" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ej. Pagó en efectivo" />
        </div>
        {error && <p className="error-text">{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={busy || aiStatus === 'uploading' || aiStatus === 'analyzing'}>
            {busy ? 'Guardando...' : 'Registrar pago'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancelar</button>
        </div>
      </form>
    </div>
  )
}

export default function PaymentGroupDetail() {
  const { groupId } = useParams()
  const [group, setGroup] = useState(null)
  const [members, setMembers] = useState([])
  const [periods, setPeriods] = useState([])
  const [memberHistory, setMemberHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [registeringFor, setRegisteringFor] = useState(null)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId])

  async function load() {
    setLoading(true)
    setError(null)
    const [
      { data: groupData, error: groupError },
      { data: memberData, error: memberError },
      { data: periodData, error: periodError },
      { data: historyData, error: historyError }
    ] = await Promise.all([
      supabase.rpc('get_payment_group', { p_group_id: groupId }),
      supabase.rpc('list_payment_group_members', { p_group_id: groupId }),
      supabase.rpc('list_payment_group_periods', { p_group_id: groupId }),
      supabase.rpc('list_payment_group_member_history', { p_group_id: groupId })
    ])
    setLoading(false)
    if (groupError || memberError) {
      setError(groupError?.message || memberError?.message)
      return
    }
    setGroup(groupData?.[0] || null)
    setMembers(memberData || [])
    // Periodos e historial son "extra" -- si fallan (ej. rol sin acceso a auditor, o el RPC
    // todavía no está desplegado), no se bloquea la pantalla principal por eso.
    setPeriods(periodError ? [] : (periodData || []))
    setMemberHistory(historyError ? [] : (historyData || []))
  }

  if (loading) {
    return (
      <div className="container">
        <SkeletonPaymentList rows={4} />
      </div>
    )
  }

  if (!group) {
    return (
      <div className="container">
        <p className="error-text">{error || 'Grupo no encontrado.'}</p>
      </div>
    )
  }

  const origin = getCanonicalOrigin()
  const groupLink = `${origin}/g/${group.link_code}`
  const paidCount = members.filter((m) => m.paid).length
  const pending = members.filter((m) => !m.paid)
  const historyByMember = {}
  memberHistory.forEach((h) => { historyByMember[h.member_id] = h.history })
  // El mes actual ya se muestra completo arriba (Faltan / Ya pagaron), así que el historial
  // solo lista los meses anteriores -- evitar mostrar el mismo mes dos veces.
  const currentPeriod = group.period_type === 'monthly' ? periods[0]?.period : null
  const pastPeriods = periods.filter((p) => p.period !== currentPeriod)

  return (
    <div className="container">
      <h2 style={{ marginTop: 0 }}>{group.name}</h2>
      <p style={{ opacity: 0.7, fontSize: 14, marginTop: -8, marginBottom: 20 }}>
        {group.period_type === 'monthly' ? 'Cobro mensual — se reinicia cada mes.' : 'Cobro único.'}
        {' '}{paidCount} de {members.length} {members.length === 1 ? 'persona ha' : 'personas han'} pagado
        {group.period_type === 'monthly' ? ' este mes.' : '.'}
      </p>

      {error && <p className="error-text">{error}</p>}

      <div className="card" style={{ marginBottom: 20, maxWidth: 480 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Enlace general del grupo</div>
        <p style={{ fontSize: 12, opacity: 0.65, margin: '0 0 8px' }}>
          Para compartir con todo el grupo a la vez. Si alguien manda un comprobante sin estar en la lista, se agrega
          solo, marcado como nuevo.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input readOnly value={groupLink} onFocus={(e) => e.target.select()} style={{ flex: 1, fontSize: 13 }} />
          <CopyLink link={groupLink} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <AddMemberForm groupId={groupId} onAdded={load} />
        <ImportMembersForm groupId={groupId} onImported={load} />
      </div>

      {pending.length > 0 && (
        <>
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>Faltan ({pending.length})</h3>
          <div className="payment-list" style={{ marginBottom: 24 }}>
            {pending.map((m) => (
              <div key={m.member_id} className="payment-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div className="amount" style={{ fontSize: 15 }}>
                      {m.display_name}{m.identifier ? ` · ${m.identifier}` : ''}
                    </div>
                    <div className="meta">
                      {m.expected_amount ? `Esperado: L ${Number(m.expected_amount).toLocaleString('es-HN', { minimumFractionDigits: 2 })}` : 'Sin monto esperado'}
                      {m.source === 'auto' && ' · 🆕 nuevo, no estaba en la lista'}
                    </div>
                    <PaymentStreak history={historyByMember[m.member_id]} />
                  </div>
                  <div className="actions-row">
                    <CopyLink link={`${origin}/g/${group.link_code}/${m.member_code}`} />
                    <button type="button" className="btn btn-primary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setRegisteringFor(m.member_id)}>
                      Registrar pago
                    </button>
                  </div>
                </div>
                {registeringFor === m.member_id && (
                  <RegisterPaymentForm
                    groupId={groupId}
                    organizationId={group.organization_id}
                    member={m}
                    onCancel={() => setRegisteringFor(null)}
                    onDone={() => { setRegisteringFor(null); load() }}
                  />
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {paidCount > 0 && (
        <>
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>Ya pagaron ({paidCount})</h3>
          <div className="payment-list">
            {members.filter((m) => m.paid).map((m) => (
              <div key={m.member_id} className="payment-row">
                <div>
                  <div className="amount" style={{ fontSize: 15 }}>
                    {m.display_name}{m.identifier ? ` · ${m.identifier}` : ''}
                  </div>
                  <div className="meta">
                    L {Number(m.paid_amount).toLocaleString('es-HN', { minimumFractionDigits: 2 })}
                    {' · '}{m.entry_method === 'manual' ? 'Registrado manualmente' : m.entry_status === 'confirmed' ? 'Comprobante confirmado' : 'Comprobante en revisión'}
                  </div>
                  <PaymentStreak history={historyByMember[m.member_id]} />
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {m.evidence_path && <ViewEvidence path={m.evidence_path} />}
                  <CopyLink link={`${origin}/g/${group.link_code}/${m.member_code}`} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {members.length === 0 && (
        <p className="empty-state">Todavía no hay nadie en la lista. Agrega personas o importa una lista arriba.</p>
      )}

      {pastPeriods.length > 0 && (
        <>
          <h3 style={{ fontSize: 15, marginTop: 28, marginBottom: 8 }}>Historial</h3>
          {pastPeriods.map((p) => (
            <MonthHistorySection
              key={p.period}
              groupId={groupId}
              period={p.period}
              paidCount={p.paid_count}
              totalCount={p.total_count}
              defaultOpen={p.total_count > 0 && p.paid_count < p.total_count}
            />
          ))}
        </>
      )}
    </div>
  )
}
