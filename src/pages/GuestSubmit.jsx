import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const emptyForm = {
  submitterName: '',
  submitterContact: '',
  amount: '',
  currency: 'HNL',
  referenceRaw: '',
  transactionDate: '',
  originBank: '',
  originAccountHolder: '',
  originAccountNumber: '',
  notes: ''
}

export default function GuestSubmit() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [selectedOrg, setSelectedOrg] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [file, setFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function handleSearch(e) {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    setSearched(true)
    setError(null)
    const { data, error } = await supabase.rpc('public_search_organizations_for_payment', { p_query: query.trim() })
    setSearching(false)
    if (error) setError(error.message)
    else setResults(data || [])
  }

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (!form.amount || Number(form.amount) <= 0) {
      setError('Ingresa un monto válido.')
      return
    }

    setSubmitting(true)
    try {
      let evidencePath = null
      if (file) {
        const ext = file.name.split('.').pop()
        const path = `${selectedOrg.organization_id}/${crypto.randomUUID()}.${ext}`
        const { error: uploadError } = await supabase.storage.from('guest-evidence').upload(path, file)
        if (uploadError) throw uploadError
        evidencePath = path
      }

      const { data, error: rpcError } = await supabase.rpc('submit_guest_payment', {
        p_organization_id: selectedOrg.organization_id,
        p_submitter_name: form.submitterName.trim() || null,
        p_submitter_contact: form.submitterContact.trim() || null,
        p_amount: Number(form.amount),
        p_currency: form.currency,
        p_reference_raw: form.referenceRaw.trim() || null,
        p_transaction_date: form.transactionDate || null,
        p_origin_bank: form.originBank.trim() || null,
        p_origin_account_holder: form.originAccountHolder.trim() || null,
        p_origin_account_number: form.originAccountNumber.trim() || null,
        p_notes: form.notes.trim() || null,
        p_evidence_path: evidencePath
      })

      if (rpcError) throw rpcError

      navigate(`/comprobante/estado/${data.tracking_token}`)
    } catch (err) {
      setError(err.message || 'No se pudo enviar tu comprobante.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="card login-card" style={{ maxWidth: 480 }}>
        <h1>Enviar comprobante de pago</h1>
        <p>Busca la empresa a la que le hiciste la transferencia para que confirmen tu pago.</p>

        {!selectedOrg ? (
          <>
            <form onSubmit={handleSearch}>
              <div className="field">
                <label htmlFor="query">Nombre de la empresa</label>
                <input
                  id="query"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ej. FARO HN"
                  required
                />
              </div>
              {error && <p className="error-text">{error}</p>}
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={searching}>
                {searching ? 'Buscando...' : 'Buscar'}
              </button>
            </form>

            {searched && !searching && (
              results.length === 0 ? (
                <p className="empty-state" style={{ marginTop: 16 }}>No encontramos ninguna empresa con ese nombre.</p>
              ) : (
                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {results.map((org) => (
                    <button
                      key={org.organization_id}
                      type="button"
                      className="btn btn-secondary"
                      style={{ textAlign: 'left' }}
                      onClick={() => setSelectedOrg(org)}
                    >
                      {org.name}
                      {org.verification_status === 'verified' && (
                        <span style={{ marginLeft: 8, fontSize: 12, color: '#2B6459' }}>✓ Verificada</span>
                      )}
                    </button>
                  ))}
                </div>
              )
            )}
          </>
        ) : (
          <>
            <p style={{ fontSize: 14 }}>
              Enviando comprobante a <strong>{selectedOrg.name}</strong>.{' '}
              <button type="button" onClick={() => setSelectedOrg(null)} style={{ background: 'none', border: 'none', color: '#2B6459', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: 14 }}>
                Cambiar empresa
              </button>
            </p>
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="file">Foto o captura de tu comprobante</label>
                <input id="file" type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </div>
              <div className="field">
                <label htmlFor="amount">Monto</label>
                <input id="amount" type="number" step="0.01" min="0" value={form.amount} onChange={(e) => updateField('amount', e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="currency">Moneda</label>
                <select id="currency" value={form.currency} onChange={(e) => updateField('currency', e.target.value)}>
                  <option value="HNL">Lempiras (HNL)</option>
                  <option value="USD">Dólares (USD)</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="referenceRaw">Referencia / N° de comprobante (opcional)</label>
                <input id="referenceRaw" type="text" value={form.referenceRaw} onChange={(e) => updateField('referenceRaw', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="transactionDate">Fecha de la transferencia (opcional)</label>
                <input id="transactionDate" type="date" value={form.transactionDate} onChange={(e) => updateField('transactionDate', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="submitterName">Tu nombre</label>
                <input id="submitterName" type="text" value={form.submitterName} onChange={(e) => updateField('submitterName', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="submitterContact">Tu teléfono o correo (para que te contacten si hace falta)</label>
                <input id="submitterContact" type="text" value={form.submitterContact} onChange={(e) => updateField('submitterContact', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="notes">Notas (opcional)</label>
                <textarea id="notes" rows={2} value={form.notes} onChange={(e) => updateField('notes', e.target.value)} />
              </div>
              {error && <p className="error-text">{error}</p>}
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={submitting}>
                {submitting ? 'Enviando...' : 'Enviar comprobante'}
              </button>
            </form>
          </>
        )}

        <p style={{ marginTop: 16, fontSize: 13, opacity: 0.7 }}>
          ¿Trabajas en una empresa registrada en Cotejo? <Link to="/login">Inicia sesión aquí</Link>
        </p>
      </div>
    </div>
  )
}
