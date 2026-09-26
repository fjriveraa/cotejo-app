import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
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

async function hashFile(file) {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export default function GuestSubmit() {
  const navigate = useNavigate()
  const { organizationId } = useParams() // presente solo si llegó por un enlace directo de una empresa
  const [searchParams] = useSearchParams()
  const isDirectLink = Boolean(organizationId)
  // El mismo enlace directo puede ser para el QR de la tienda (?presencial=1)
  // o para compartir por WhatsApp/Instagram (sin el parámetro) — son casos
  // distintos aunque apunten a la misma empresa.
  const isInPerson = isDirectLink && searchParams.get('presencial') === '1'

  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [selectedOrg, setSelectedOrg] = useState(null)
  const [loadingDirectOrg, setLoadingDirectOrg] = useState(isDirectLink)
  const [form, setForm] = useState(emptyForm)
  const [file, setFile] = useState(null)
  const [evidencePath, setEvidencePath] = useState(null)
  const [fileHash, setFileHash] = useState(null)
  const [aiStatus, setAiStatus] = useState('idle') // idle | uploading | analyzing | done | error | skipped
  const [aiMessage, setAiMessage] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isDirectLink) return
    let cancelled = false
    supabase.rpc('public_get_organization_for_payment', { p_organization_id: organizationId }).then(({ data, error }) => {
      if (cancelled) return
      setLoadingDirectOrg(false)
      if (error || !data || data.length === 0) {
        setError('No encontramos esta empresa. Pídele el enlace correcto.')
      } else {
        setSelectedOrg(data[0])
      }
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId])

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

  function resetEvidence() {
    setFile(null)
    setEvidencePath(null)
    setFileHash(null)
    setAiStatus('idle')
    setAiMessage(null)
  }

  function applyExtraction(data) {
    if (!data) return
    setForm((prev) => {
      const next = { ...prev }
      if (data.amount && !prev.amount) next.amount = String(data.amount)
      if (data.currency && (data.currency === 'HNL' || data.currency === 'USD')) next.currency = data.currency
      if (data.reference_raw && !prev.referenceRaw) next.referenceRaw = data.reference_raw
      if (data.transaction_date && !prev.transactionDate) next.transactionDate = data.transaction_date
      if (data.origin_bank && !prev.originBank) next.originBank = data.origin_bank
      if (data.origin_account_holder && !prev.originAccountHolder) next.originAccountHolder = data.origin_account_holder
      if (data.origin_account_number && !prev.originAccountNumber) next.originAccountNumber = data.origin_account_number
      return next
    })
  }

  async function handleFileChange(e) {
    const selected = e.target.files?.[0] ?? null
    resetEvidence()
    if (!selected || !selectedOrg) return
    setFile(selected)

    if (!selected.type.startsWith('image/')) {
      // PDFs u otros formatos: se suben pero no se leen automáticamente.
      setAiStatus('skipped')
      setAiMessage('Este archivo no se puede leer automáticamente. Completa los datos a mano.')
    }

    try {
      setAiStatus('uploading')
      setAiMessage('Subiendo comprobante...')
      const hash = await hashFile(selected)
      setFileHash(hash)
      const ext = selected.name.split('.').pop()
      const path = `${selectedOrg.organization_id}/${crypto.randomUUID()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('guest-evidence').upload(path, selected)
      if (uploadError) throw uploadError
      setEvidencePath(path)

      if (!selected.type.startsWith('image/')) {
        return
      }

      setAiStatus('analyzing')
      setAiMessage('Leyendo comprobante con IA...')
      const { data: fnData, error: fnError } = await supabase.functions.invoke('analyze-guest-evidence', {
        body: { path, organization_id: selectedOrg.organization_id }
      })

      if (fnError) throw fnError
      if (fnData?.extraction) {
        applyExtraction(fnData.extraction)
        setAiStatus('done')
        setAiMessage('Datos detectados automáticamente. Revísalos antes de enviar.')
      } else if (fnData?.rate_limited) {
        setAiStatus('skipped')
        setAiMessage('Por ahora no podemos leer el comprobante automáticamente. Completa los datos a mano — tu comprobante ya quedó guardado y puedes enviarlo igual.')
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

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (!form.amount || Number(form.amount) <= 0) {
      setError('Ingresa un monto válido.')
      return
    }

    setSubmitting(true)
    try {
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
        p_evidence_path: evidencePath,
        p_file_hash: fileHash,
        p_is_in_person: isInPerson
      })

      if (rpcError) throw rpcError

      if (data?.duplicate) {
        navigate(`/comprobante/estado/${data.tracking_token}?ya_enviado=1`)
        return
      }

      navigate(`/comprobante/estado/${data.tracking_token}`)
    } catch (err) {
      setError(err.message || 'No se pudo enviar tu comprobante.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loadingDirectOrg) {
    return (
      <div className="login-wrap">
        <p style={{ opacity: 0.6 }}>Cargando...</p>
      </div>
    )
  }

  return (
    <div className="login-wrap">
      <div className="card login-card" style={{ maxWidth: 480 }}>
        <h1>Enviar comprobante de pago</h1>
        {!isDirectLink && <p>Busca la empresa a la que le hiciste la transferencia para que confirmen tu pago.</p>}

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
              {!isDirectLink && (
                <button type="button" onClick={() => setSelectedOrg(null)} style={{ background: 'none', border: 'none', color: '#2B6459', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: 14 }}>
                  Cambiar empresa
                </button>
              )}
            </p>
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="file">Foto o captura de tu comprobante</label>
                <input id="file" type="file" accept="image/*,application/pdf" onChange={handleFileChange} />
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
              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%' }}
                disabled={submitting || aiStatus === 'uploading' || aiStatus === 'analyzing'}
              >
                {submitting ? 'Enviando...' : 'Enviar comprobante'}
              </button>
            </form>
          </>
        )}

        {!isDirectLink && (
          <p style={{ marginTop: 16, fontSize: 13, opacity: 0.7 }}>
            ¿Trabajas en una empresa registrada en Cotejo? <Link to="/login">Inicia sesión aquí</Link>
          </p>
        )}
      </div>
    </div>
  )
}
