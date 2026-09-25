import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const OTHER = '__other__'

const emptyForm = {
  amount: '',
  currency: 'HNL',
  receiving_account_id: '',
  manual_bank: '',
  reference_raw: '',
  notes: '',
  customer_waiting: false
}

export default function EmployeeDashboard() {
  const { membership } = useAuth()
  const [accounts, setAccounts] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [file, setFile] = useState(null)
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
      let evidencePath = null

      if (file) {
        const ext = file.name.split('.').pop()
        const path = `${membership.organization_id}/${crypto.randomUUID()}.${ext}`
        const { error: uploadError } = await supabase.storage
          .from('evidence')
          .upload(path, file, { upsert: false })

        if (uploadError) throw uploadError
        evidencePath = path
      }

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
        notes: form.notes || null,
        evidence_path: evidencePath,
        customer_waiting: form.customer_waiting,
        verification_status: 'pending',
        processing_status: evidencePath ? 'processing' : 'needs_information'
      })

      if (insertError) throw insertError

      setSuccess('Comprobante registrado. Queda por confirmar.')
      setForm(emptyForm)
      setFile(null)
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
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
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
                value={form.manual_bank}
                onChange={(e) => updateField('manual_bank', e.target.value)}
                placeholder="ej. Ficohsa"
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="reference_raw">Referencia (opcional)</label>
            <input
              id="reference_raw"
              type="text"
              value={form.reference_raw}
              onChange={(e) => updateField('reference_raw', e.target.value)}
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

          <button type="submit" className="btn btn-primary" disabled={submitting} style={{ marginTop: 8 }}>
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
