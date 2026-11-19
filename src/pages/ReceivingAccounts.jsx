import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { bankNamesForCountry, DEFAULT_COUNTRY } from '../lib/banks'
import { IconBuilding } from '../components/icons'
import Loading from '../components/Loading'

const OTHER_BANK = '__other__'
const emptyForm = { bank: '', bankOther: '', alias: '', last4: '', currency: 'HNL', accountNumber: '', holder: '', accountType: 'Ahorro', show: true }

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
  const [openId, setOpenId] = useState(null)
  const [det, setDet] = useState({ account_number: '', holder_name: '', account_type: 'Ahorro', show_to_payers: false })
  const [detMsg, setDetMsg] = useState(null)

  useEffect(() => {
    if (!membership) return
    load()
  }, [membership])

  async function load() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('receiving_accounts')
      .select('id, bank, alias, last4, currency, active, created_at, account_number, holder_name, account_type, show_to_payers')
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
    const number = form.accountNumber.trim()
    const digits = number.replace(/\D/g, '')
    const last4 = digits.length >= 4 ? digits.slice(-4) : form.last4.trim()

    if (!bank || !alias) {
      setError('Indica el banco y un alias (ej. "Principal", "Ahorros").')
      return
    }
    if (number && !/^[\d\- ]{6,30}$/.test(number)) {
      setError('El número de cuenta solo lleva dígitos (entre 6 y 30).')
      return
    }
    if (!/^\d{4}$/.test(last4)) {
      setError('Escribe el número de cuenta completo (o al menos sus últimos 4 dígitos).')
      return
    }

    setSubmitting(true)
    const { error } = await supabase.from('receiving_accounts').insert({
      organization_id: membership.organization_id,
      bank,
      alias,
      last4,
      currency: form.currency,
      account_number: number || null,
      holder_name: form.holder.trim() || null,
      account_type: form.accountType || null,
      show_to_payers: Boolean(number) && form.show
    })
    setSubmitting(false)

    if (error) {
      setError(error.message)
      return
    }
    setForm(emptyForm)
    load()
  }

  function openDetails(acc) {
    if (openId === acc.id) { setOpenId(null); return }
    setOpenId(acc.id)
    setDetMsg(null)
    setDet({
      account_number: acc.account_number || '',
      holder_name: acc.holder_name || '',
      account_type: acc.account_type || 'Ahorro',
      show_to_payers: Boolean(acc.show_to_payers)
    })
  }

  async function saveDetails(acc) {
    setDetMsg(null)
    const number = det.account_number.trim()
    if (det.show_to_payers && !number) { setDetMsg('Para mostrarla a quien paga, escribe el número de cuenta.'); return }
    if (number && !/^[\d\- ]{6,30}$/.test(number)) { setDetMsg('El número de cuenta solo lleva dígitos (6 a 30).'); return }
    setBusyId(acc.id)
    const digits = number.replace(/\D/g, '')
    const patch = {
      account_number: number || null,
      holder_name: det.holder_name.trim() || null,
      account_type: det.account_type || null,
      show_to_payers: det.show_to_payers
    }
    if (digits.length >= 4) patch.last4 = digits.slice(-4)
    const { error } = await supabase.from('receiving_accounts').update(patch).eq('id', acc.id)
    setBusyId(null)
    if (error) { setDetMsg(error.message); return }
    setDetMsg('✓ Guardado.')
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
    return <div className="container"><Loading label="Cargando" /></div>
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
          <div className="field" style={{ flex: '1 1 100%', margin: 0 }}>
            <label htmlFor="accountNumber">Número de cuenta completo</label>
            <input
              id="accountNumber"
              type="text"
              inputMode="numeric"
              value={form.accountNumber}
              onChange={(e) => updateField('accountNumber', e.target.value)}
              placeholder="ej. 21120002331"
            />
          </div>
          <div className="field" style={{ flex: '1 1 200px', margin: 0 }}>
            <label htmlFor="holder">A nombre de</label>
            <input id="holder" type="text" value={form.holder} onChange={(e) => updateField('holder', e.target.value)} placeholder="Titular de la cuenta" />
          </div>
          <div className="field" style={{ flex: '0 1 130px', margin: 0 }}>
            <label htmlFor="accountType">Tipo</label>
            <select id="accountType" value={form.accountType} onChange={(e) => updateField('accountType', e.target.value)}>
              <option value="Ahorro">Ahorro</option>
              <option value="Cheques">Cheques</option>
            </select>
          </div>
          <div className="field" style={{ flex: '0 1 100px', margin: 0 }}>
            <label htmlFor="currency">Moneda</label>
            <select id="currency" value={form.currency} onChange={(e) => updateField('currency', e.target.value)}>
              <option value="HNL">HNL</option>
              <option value="USD">USD</option>
            </select>
          </div>
          <label style={{ flex: '1 1 100%', display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.show} onChange={(e) => updateField('show', e.target.checked)} />
            Mostrar esta cuenta a quien va a pagar (con número completo para copiar y pegar)
          </label>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Agregando...' : '+ Agregar'}
          </button>
        </form>
      </div>

      {error && <p className="error-text">{error}</p>}

      {accounts.length === 0 ? (
        <div className="empty-state-friendly">
          <IconBuilding width={36} height={36} />
          <div className="title">Sin cuentas registradas</div>
          <div className="subtitle">Agrega una arriba para empezar a recibir pagos con ella.</div>
        </div>
      ) : (
        <div className="payment-list">
          {accounts.map((acc) => (
            <div key={acc.id} className="payment-row" style={{ flexWrap: 'wrap', gap: 10, opacity: acc.active ? 1 : 0.5 }}>
              <div>
                <div className="amount" style={{ fontSize: 14 }}>
                  {acc.bank} · {acc.alias}
                  {!acc.active && <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>(inactiva)</span>}
                </div>
                <div className="meta">
                  **** {acc.last4} · {acc.currency}
                  {acc.show_to_payers && ' · 👁 visible para quien paga'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary" onClick={() => openDetails(acc)}>
                  {openId === acc.id ? 'Cerrar' : 'Datos para pagar'}
                </button>
                <button
                  className="btn btn-amber"
                  disabled={busyId === acc.id}
                  onClick={() => toggleActive(acc)}
                >
                  {busyId === acc.id ? 'Un momento...' : acc.active ? 'Desactivar' : 'Reactivar'}
                </button>
              </div>
              {openId === acc.id && (
                <div style={{ flexBasis: '100%', borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 12 }}>
                  <p style={{ fontSize: 12, opacity: 0.7, margin: '0 0 10px' }}>
                    Estos datos los ve cualquiera que abra tus enlaces de pago, para que sepa a dónde depositar. Úsalos solo en cuentas que quieras mostrar.
                  </p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <div className="field" style={{ flex: '1 1 200px', margin: 0 }}>
                      <label>Número de cuenta</label>
                      <input type="text" inputMode="numeric" value={det.account_number} onChange={(e) => setDet((p) => ({ ...p, account_number: e.target.value }))} placeholder="ej. 21120002331" />
                    </div>
                    <div className="field" style={{ flex: '1 1 200px', margin: 0 }}>
                      <label>A nombre de</label>
                      <input type="text" value={det.holder_name} onChange={(e) => setDet((p) => ({ ...p, holder_name: e.target.value }))} placeholder="Titular de la cuenta" />
                    </div>
                    <div className="field" style={{ flex: '0 1 130px', margin: 0 }}>
                      <label>Tipo</label>
                      <select value={det.account_type} onChange={(e) => setDet((p) => ({ ...p, account_type: e.target.value }))}>
                        <option value="Ahorro">Ahorro</option>
                        <option value="Cheques">Cheques</option>
                      </select>
                    </div>
                  </div>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0', fontSize: 14, cursor: 'pointer' }}>
                    <input type="checkbox" checked={det.show_to_payers} onChange={(e) => setDet((p) => ({ ...p, show_to_payers: e.target.checked }))} />
                    Mostrar esta cuenta a quien va a pagar
                  </label>
                  <button type="button" className="btn btn-primary" disabled={busyId === acc.id} onClick={() => saveDetails(acc)}>Guardar</button>
                  {detMsg && <span style={{ marginLeft: 10, fontSize: 13 }}>{detMsg}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
