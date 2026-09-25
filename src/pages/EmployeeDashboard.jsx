import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { bankNamesForCountry, DEFAULT_COUNTRY } from '../lib/banks'

const OTHER = '__other__'

const emptyForm = {
  amount: '',
  currency: 'HNL',
  receiving_account_id: '',
  manual_bank: '',
  reference_raw: '',
  transaction_date: '',
  origin_bank: '',
  origin_account_holder: '',
  origin_account_number: '',
  destination_account_holder: '',
  notes: '',
  customer_waiting: false
}

export default function EmployeeDashboard() {
  const { membership } = useAuth()
  const country = membership?.organizations?.country || DEFAULT_COUNTRY
  const bankOptions = bankNamesForCountry(country)
  const [accounts, setAccounts] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [file, setFile] = useState(null)
  const [evidencePath, setEvidencePath] = useState(null)
  const [extraction, setExtraction] = useState(null)
  const [aiStatus, setAiStatus] = useState('idle') // idle | uploading | analyzing | done | error | skipped
  const [aiMessage, setAiMessage] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [recent, setRecent] = useState([])

  useEffect(() => {
    if (!membership) return
    loadAccounts()
    loadRecent()
  }, [membership])

  async function loadAccounts() {
    const { data, error } = await supabase
      .from('receiving_accounts')
      .select('id, bank, alias, last4')
      .eq('organization_id', membership.organization_id)
      .eq('active', true)
      .order('bank')

    if (!error) setAccounts(data || [])
  }

  async function loadRecent() {
    const { data, error } = await supabase
      .from('payment_records')
      .select('id, amount, currency, reference_raw, verification_status, created_at')
      .eq('organization_id', membership.organization_id)
      .eq('created_by', membership.id)
      .order('created_at', { ascending: false })
      .limit(8)

    if (!error) setRecent(data || [])
  }

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function resetEvidence() {
    setFile(null)
    setEvidencePath(null)
    setExtraction(null)
    setAiStatus('idle')
    setAiMessage(null)
  }

  function normalize(str) {
    return (str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim()
  }

  function applyExtraction(data) {
    if (!data) return
    setForm((prev) => {
      const next = { ...prev }
      if (data.amount && !prev.amount) next.amount = String(data.amount)
      if (data.currency && (data.currency === 'HNL' || data.currency === 'USD')) next.currency = data.currency
      if (data.reference_raw && !prev.reference_raw) next.reference_raw = data.reference_raw
      if (data.transaction_date && !prev.transaction_date) next.transaction_date = data.transaction_date
      if (data.origin_bank && !prev.origin_bank) next.origin_bank = data.origin_bank
      if (data.origin_account_holder && !prev.origin_account_holder) next.origin_account_holder = data.origin_account_holder
      if (data.origin_account_number && !prev.origin_account_number) next.origin_account_number = data.origin_account_number
      if (data.destination_account_holder && !prev.destination_account_holder) next.destination_account_holder = data.destination_account_holder

      if (data.bank) {
        const match = accounts.find(
          (a) =>
            normalize(a.bank) === normalize(data.bank) ||
            (data.account_last4 && a.last4 === data.account_last4 && normalize(a.bank).includes(normalize(data.bank)))
        )
        if (match) {
          next.receiving_account_id = match.id
        } else {
          next.receiving_account_id = OTHER
          next.manual_bank = data.bank
        }
      }
      return next
    })
  }

  async function handleFileChange(e) {
    const selected = e.target.files?.[0] ?? null
    resetEvidence()
    if (!selected) return
    setFile(selected)

    if (!selected.type.startsWith('image/')) {
      // PDFs u otros formatos: se sube pero no se analiza con IA.
      setAiStatus('skipped')
      setAiMessage('Este archivo no se puede leer automáticamente. Completa los datos a mano.')
    }

    try {
      setAiStatus('uploading')
      setAiMessage('Subiendo comprobante...')
      const ext = selected.name.split('.').pop()
      const path = `${membership.organization_id}/${crypto.randomUUID()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('evidence').upload(path, selected, { upsert: false })
      if (uploadError) throw uploadError
      setEvidencePath(path)

      if (!selected.type.startsWith('image/')) {
        return
      }

      setAiStatus('analyzing')
      setAiMessage('Leyendo comprobante con IA...')
      const { data: fnData, error: fnError } = await supabase.functions.invoke('analyze-payment-evidence', {
        body: { path }
      })

      if (fnError) throw fnError
      if (fnData?.extraction) {
        setExtraction(fnData.extraction)
        applyExtraction(fnData.extraction)
        setAiStatus('done')
        setAiMessage('Datos detectados automáticamente. Revísalos antes de enviar.')
      } else {
        setAiStatus('skipped')
        setAiMessage('No se pudieron detectar datos automáticamente. Completa los campos a mano.')
      }
    } catch (err) {
      console.error('Error analizando comprobante:', err)
      setAiStatus('error')
      setAiMessage('No se pudo leer el comprobante con IA. Completa los datos a mano; el archivo ya quedó guardado.')
    }
  }

  const selectedAccount = accounts.find((a) => a.id === form.receiving_account_id)
  const needsManualBank = form.receiving_account_id === OTHER

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!form.amount || Number(form.amount) <= 0) {
      setError('Ingresa un monto válido.')
      return
    }

    const bank = needsManualBank ? form.manual_bank.trim() : selectedAccount?.bank
    if (!bank) {
      setError('Indica el banco (elige una cuenta o escribe el nombre del banco).')
      return
    }

    setSubmitting(true)
    try {
      const { error: insertError } = await supabase.from('payment_records').insert({
        organization_id: membership.organization_id,
        branch_id: membership.branch_scope?.[0] ?? null,
        created_by: membership.id,
        receiving_account_id: needsManualBank ? null : (form.receiving_account_id || null),
        bank,
        account_last4: needsManualBank ? null : (selectedAccount?.last4 ?? null),
        routing_reason: needsManualBank ? 'Banco indicado manualmente por el empleado' : null,
        amount: Number(form.amount),
        currency: form.currency,
        reference_raw: form.reference_raw || null,
        transaction_date: form.transaction_date || null,
        origin_bank: form.origin_bank || null,
        origin_account_holder: form.origin_account_holder || null,
        origin_account_number: form.origin_account_number || null,
        destination_account_holder: form.destination_account_holder || null,
        notes: form.notes || null,
        evidence_path: evidencePath,
        extraction: extraction,
        customer_waiting: form.customer_waiting,
        verification_status: 'pending',
        processing_status: extraction ? 'ready' : (evidencePath ? 'needs_information' : 'needs_information')
      })

      if (insertError) throw insertError

      setSuccess('Comprobante registrado. Queda por confirmar.')
      setForm(emptyForm)
      resetEvidence()
      loadRecent()
    } catch (err) {
      console.error(err)
      setError(err.message || 'No se pudo registrar el pago.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="container">
      <h2 style={{ marginTop: 0 }}>Registrar comprobante</h2>

      <div className="card" style={{ marginBottom: 32 }}>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="file">Foto o captura del comprobante</label>
            <input
              id="file"
              type="file"
              accept="image/*,application/pdf"
              onChange={handleFileChange}
            />
            {aiMessage && (
              <p
                style={{
                  fontSize: 13,
                  marginTop: 6,
                  color: aiStatus === 'error' ? '#A2483A' : aiStatus === 'done' ? '#2B6459' : 'inherit',
                  opacity: aiStatus === 'uploading' || aiStatus === 'analyzing' ? 0.7 : 1
                }}
              >
                {(aiStatus === 'uploading' || aiStatus === 'analyzing') && '⏳ '}
                {aiStatus === 'done' && '✓ '}
                {aiMessage}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="amount">Monto</label>
            <input
              id="amount"
              type="number"
              step="0.01"
              min="0"
              value={form.amount}
              onChange={(e) => updateField('amount', e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="receiving_account_id">¿Dónde debe revisarse?</label>
            <select
              id="receiving_account_id"
              value={form.receiving_account_id}
              onChange={(e) => updateField('receiving_account_id', e.target.value)}
            >
              <option value="">Selecciona una cuenta</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.bank} · {acc.alias} ({acc.last4})
                </option>
              ))}
              <option value={OTHER}>Otro banco / no estoy seguro</option>
            </select>
          </div>

          {needsManualBank && (
            <div className="field">
              <label htmlFor="manual_bank">Nombre del banco</label>
              <input
                id="manual_bank"
                type="text"
                list="bank-options"
                value={form.manual_bank}
                onChange={(e) => updateField('manual_bank', e.target.value)}
                placeholder="ej. Ficohsa"
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="reference_raw">Referencia / N° comprobante (opcional)</label>
            <input
              id="reference_raw"
              type="text"
              value={form.reference_raw}
              onChange={(e) => updateField('reference_raw', e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="transaction_date">Fecha de la transacción (opcional)</label>
            <input
              id="transaction_date"
              type="date"
              value={form.transaction_date}
              onChange={(e) => updateField('transaction_date', e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '1 1 200px' }}>
              <label htmlFor="origin_account_holder">Cuenta origen · nombre (opcional)</label>
              <input
                id="origin_account_holder"
                type="text"
                value={form.origin_account_holder}
                onChange={(e) => updateField('origin_account_holder', e.target.value)}
                placeholder="Quién envía"
              />
            </div>
            <div className="field" style={{ flex: '1 1 160px' }}>
              <label htmlFor="origin_account_number">Cuenta origen · número (opcional)</label>
              <input
                id="origin_account_number"
                type="text"
                value={form.origin_account_number}
                onChange={(e) => updateField('origin_account_number', e.target.value)}
              />
            </div>
            <div className="field" style={{ flex: '1 1 160px' }}>
              <label htmlFor="origin_bank">Banco origen (opcional)</label>
              <input
                id="origin_bank"
                type="text"
                list="bank-options"
                value={form.origin_bank}
                onChange={(e) => updateField('origin_bank', e.target.value)}
                placeholder="Banco de quien envía"
              />
            </div>
          </div>
          <datalist id="bank-options">
            {bankOptions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>

          <div className="field">
            <label htmlFor="destination_account_holder">Cuenta destino · nombre/razón social (opcional)</label>
            <input
              id="destination_account_holder"
              type="text"
              value={form.destination_account_holder}
              onChange={(e) => updateField('destination_account_holder', e.target.value)}
              placeholder="A nombre de quién está la cuenta receptora"
            />
          </div>

          <div className="field">
            <label htmlFor="notes">Notas (opcional)</label>
            <textarea
              id="notes"
              rows={2}
              value={form.notes}
              onChange={(e) => updateField('notes', e.target.value)}
            />
          </div>

          <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              id="customer_waiting"
              type="checkbox"
              checked={form.customer_waiting}
              onChange={(e) => updateField('customer_waiting', e.target.checked)}
              style={{ width: 'auto' }}
            />
            <label htmlFor="customer_waiting" style={{ margin: 0 }}>El cliente está esperando confirmación</label>
          </div>

          {error && <p className="error-text">{error}</p>}
          {success && <p style={{ color: '#2B6459', fontSize: 13, marginTop: 8 }}>{success}</p>}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting || aiStatus === 'uploading' || aiStatus === 'analyzing'}
            style={{ marginTop: 8 }}
          >
            {submitting ? 'Registrando...' : 'Registrar pago'}
          </button>
        </form>
      </div>

      <h3>Tus últimos registros</h3>
      {recent.length === 0 ? (
        <p className="empty-state">Todavía no has registrado comprobantes.</p>
      ) : (
        <div className="payment-list">
          {recent.map((p) => (
            <div key={p.id} className="payment-row">
              <div>
                <div className="amount">{p.currency} {Number(p.amount).toLocaleString('es-HN', { minimumFractionDigits: 2 })}</div>
                <div className="meta">
                  {new Date(p.created_at).toLocaleDateString('es-HN')} {p.reference_raw ? `· ${p.reference_raw}` : ''}
                </div>
              </div>
              <span className={`status-pill status-${p.verification_status}`}>{p.verification_status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
