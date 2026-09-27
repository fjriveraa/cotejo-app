import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { bankNamesForCountry, DEFAULT_COUNTRY } from '../lib/banks'

const OTHER_BANK = '__other__'
const emptyForm = { bank: '', bankOther: '', alias: '', last4: '', currency: 'HNL' }

// Estas son las cuentas propias de la empresa — a dónde SÍ le pueden pagar
// los clientes. Sirven de dos formas: (1) le dan al empleado un menú
// cerrado en vez de escribir el banco a mano cada vez, y (2) si un
// comprobante llega a un banco/cuenta que no está en esta lista, la cola
// de confirmación lo marca como "cuenta desconocida" — puede ser un
// cliente que se equivocó de cuenta, o simplemente una cuenta nueva que
// falta agregar aquí.
export default function ReceivingAccounts() {
  const { membership } = useAuth()
  const country = membership?.organizations?.country || DEFAULT_COUNTRY
  const bankOptions = bankNamesForCountry(country)
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    if (!membership) return
    load()
  }, [membership])

  async function load() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('receiving_accounts')
      .select('id, bank, alias, last4, currency, active, created_at')
      .eq('organization_id', membership.organization_id)
      .order('active', { ascending: false })
      .order('bank')

    if (error) setError(error.message)
    else setAccounts(data || [])
    setLoading(false)
  }

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    const bank = (form.bank === OTHER_BANK ? form.bankOther : form.bank).trim()
    const alias = form.alias.trim()
    const last4 = form.last4.trim()

    if (!bank || !alias) {
      setError('Indica el banco y un alias (ej. "Principal", "Ahorros").')
      return
    }
    if (!/^\d{4}$/.test(last4)) {
      setError('Los últimos 4 dígitos deben ser exactamente 4 números.')
      return
    }

    setSubmitting(true)
    const { error } = await supabase.from('receiving_accounts').insert({
      organization_id: membership.organization_id,
      bank,
      alias,
      last4,
      currency: form.currency
    })
    setSubmitting(false)

    if (error) {
      setError(error.message)
      return
    }
    setForm(emptyForm)
    load()
  }

  async function toggleActive(account) {
    setBusyId(account.id)
    setError(null)
    const { error } = await supabase
      .from('receiving_accounts')
      .update({ active: !account.active })
      .eq('id', account.id)
    setBusyId(null)
    if (error) setError(error.message)
    else load()
  }

  if (loading) {
    return <div className="container"><p style={{ opacity: 0.6 }}>Cargando...</p></div>
  }

  return (
    <div className="container">
      <h2 style={{ marginTop: 0 }}>Cuentas receptoras</h2>
      <p style={{ opacity: 0.7, fontSize: 14, marginTop: -8, marginBottom: 24 }}>
        Las cuentas bancarias propias donde tu empresa recibe pagos. Aparecen como opciones al registrar un
        comprobante, y si un pago llega a una cuenta que no está aquí, se marca como "cuenta desconocida" en la
        cola de confirmación para que se revise con más cuidado.
      </p>

      <div className="card" style={{ marginBottom: 32 }}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Agregar cuenta</h3>
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '1 1 200px', margin: 0 }}>
            <label htmlFor="bank">Banco</label>
            <select id="bank" value={form.bank} onChange={(e) => updateField('bank', e.target.value)}>
              <option value="">Selecciona un banco</option>
              {bankOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
              <option value={OTHER_BANK}>Otro banco (escribir)</option>
            </select>
          </div>
          {form.bank === OTHER_BANK && (
            <div className="field" style={{ flex: '1 1 160px', margin: 0 }}>
              <label htmlFor="bankOther">Nombre del banco</label>
              <input
                id="bankOther"
                type="text"
                value={form.bankOther}
                onChange={(e) => updateField('bankOther', e.target.value)}
                placeholder="ej. Wells Fargo"
              />
            </div>
          )}
          <div className="field" style={{ flex: '1 1 140px', margin: 0 }}>
            <label htmlFor="alias">Alias</label>
            <input
              id="alias"
              type="text"
              value={form.alias}
              onChange={(e) => updateField('alias', e.target.value)}
              placeholder="ej. Ahorros, Cheques, Principal"
            />
          </div>
          <div className="field" style={{ flex: '0 1 110px', margin: 0 }}>
            <label htmlFor="last4">Últimos 4 dígitos</label>
            <input
              id="last4"
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={form.last4}
              onChange={(e) => updateField('last4', e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="0331"
            />
          </div>
          <div className="field" style={{ flex: '0 1 100px', margin: 0 }}>
            <label htmlFor="currency">Moneda</label>
            <select id="currency" value={form.currency} onChange={(e) => updateField('currency', e.target.value)}>
              <option value="HNL">HNL</option>
              <option value="USD">USD</option>
            </select>
          </div>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Agregando...' : '+ Agregar'}
          </button>
        </form>
      </div>

      {error && <p className="error-text">{error}</p>}

      {accounts.length === 0 ? (
        <p className="empty-state">Todavía no has registrado ninguna cuenta receptora.</p>
      ) : (
        <div className="payment-list">
          {accounts.map((acc) => (
            <div key={acc.id} className="payment-row" style={{ flexWrap: 'wrap', gap: 10, opacity: acc.active ? 1 : 0.5 }}>
              <div>
                <div className="amount" style={{ fontSize: 14 }}>
                  {acc.bank} · {acc.alias}
                  {!acc.active && <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>(inactiva)</span>}
                </div>
                <div className="meta">**** {acc.last4} · {acc.currency}</div>
              </div>
              <button
                className="btn btn-amber"
                disabled={busyId === acc.id}
                onClick={() => toggleActive(acc)}
              >
                {busyId === acc.id ? 'Un momento...' : acc.active ? 'Desactivar' : 'Reactivar'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
