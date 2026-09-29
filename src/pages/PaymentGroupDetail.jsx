import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getCanonicalOrigin } from '../lib/appUrl'
import { SkeletonPaymentList } from '../components/Skeleton'

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

function RegisterPaymentForm({ groupId, member, onDone, onCancel }) {
  const [amount, setAmount] = useState(member.expected_amount || '')
  const [transactionDate, setTransactionDate] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

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
      p_notes: notes.trim() || null
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
          Para cuando la persona pagó pero no mandó comprobante (efectivo, o ya lo confirmaste por tu cuenta).
        </p>
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
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Guardando...' : 'Registrar pago'}</button>
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
    const [{ data: groupData, error: groupError }, { data: memberData, error: memberError }] = await Promise.all([
      supabase.rpc('get_payment_group', { p_group_id: groupId }),
      supabase.rpc('list_payment_group_members', { p_group_id: groupId })
    ])
    setLoading(false)
    if (groupError || memberError) {
      setError(groupError?.message || memberError?.message)
      return
    }
    setGroup(groupData?.[0] || null)
    setMembers(memberData || [])
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
                </div>
                <CopyLink link={`${origin}/g/${group.link_code}/${m.member_code}`} />
              </div>
            ))}
          </div>
        </>
      )}

      {members.length === 0 && (
        <p className="empty-state">Todavía no hay nadie en la lista. Agrega personas o importa una lista arriba.</p>
      )}
    </div>
  )
}
