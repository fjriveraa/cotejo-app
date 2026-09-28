import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { isPlausibleTransactionDate } from '../lib/dateSanity'
import PublicPageHeader from '../components/PublicPageHeader'
import Spinner from '../components/Spinner'

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

// Hash perceptual (dHash de 64 bits): a diferencia del hash exacto de
// arriba, este detecta imágenes visualmente muy parecidas aunque el
// archivo haya sido recortado, recomprimido o le hayan puesto un filtro —
// se calcula aquí mismo en el navegador, sin costo ni llamada a ningún
// servicio externo. Si algo falla (formato no soportado, etc.) se
// devuelve null y simplemente esa señal no aplica para este envío.
async function computePerceptualHash(file) {
  if (!file.type.startsWith('image/')) return null
  try {
    const bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = 9
    canvas.height = 8
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, 9, 8)
    const { data } = ctx.getImageData(0, 0, 9, 8)
    const gray = []
    for (let i = 0; i < data.length; i += 4) {
      gray.push((data[i] + data[i + 1] + data[i + 2]) / 3)
    }
    let hash = 0n
    let bit = 0n
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const left = gray[y * 9 + x]
        const right = gray[y * 9 + x + 1]
        if (left > right) hash |= (1n << bit)
        bit += 1n
      }
    }
    const TWO63 = 1n << 63n
    const TWO64 = 1n << 64n
    const signed = hash >= TWO63 ? hash - TWO64 : hash
    return signed.toString()
  } catch (err) {
    console.error('No se pudo calcular el hash perceptual:', err)
    return null
  }
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
  const [perceptualHash, setPerceptualHash] = useState(null)
  const [aiStatus, setAiStatus] = useState('idle') // idle | uploading | analyzing | done | error | skipped
  const [aiMessage, setAiMessage] = useState(null)
  const [dateWarning, setDateWarning] = useState(null)
  // Cuando la IA lee el monto con buena confianza, no tiene sentido pedirle
  // al invitado que "llene" un formulario que ya está lleno -- se le muestra
  // un resumen para CONFIRMAR (revisar y enviar), no para completar. Si algo
  // no cuadra, puede pasar a edición manual con un solo click.
  const [extractionConfidence, setExtractionConfidence] = useState(null)
  const [manualOverride, setManualOverride] = useState(false)
  // Copia cruda de lo que la IA leyó del comprobante, guardada aparte de lo
  // que termina en el formulario -- así el negocio puede comparar en su cola
  // "lo que decía la imagen" contra "lo que el invitado terminó mandando",
  // sin importar si editó algo antes de enviar.
  const [rawExtraction, setRawExtraction] = useState(null)
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
    setPerceptualHash(null)
    setAiStatus('idle')
    setAiMessage(null)
    setDateWarning(null)
    setExtractionConfidence(null)
    setManualOverride(false)
    setRawExtraction(null)
  }

  function applyExtraction(data) {
    if (!data) return
    // Si la fecha que detectó la IA no es creíble (año equivocado, futura,
    // etc.), mejor dejar el campo vacío que autocompletar algo mal.
    if (data.transaction_date && !isPlausibleTransactionDate(data.transaction_date)) {
      setDateWarning(`La IA detectó ${data.transaction_date} como fecha, pero no parece correcta — revísala y corrígela a mano.`)
      data = { ...data, transaction_date: null }
    }
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

    // La subida y la lectura con IA son dos pasos distintos que pueden
    // fallar por razones distintas -- antes un error de CUALQUIERA de los
    // dos mostraba el mismo mensaje ("no se pudo leer con IA... el archivo
    // ya quedó guardado"), lo cual era falso cuando en realidad la subida
    // había fallado (el archivo nunca se guardó). Separarlos evita decirle
    // al invitado que algo se guardó cuando no fue así.
    // Los hashes (para detectar comprobantes reciclados) son una mejora
    // aparte de la subida en sí -- algunos navegadores embebidos (Instagram,
    // WhatsApp en iOS) restringen crypto.subtle o createImageBitmap y antes
    // eso hacía fallar la subida COMPLETA con el mismo mensaje engañoso.
    // Ahora, si fallan, simplemente ese comprobante no queda protegido por
    // esa señal de duplicado, pero la subida real sigue adelante.
    let hash = null
    try {
      hash = await hashFile(selected)
    } catch (err) {
      console.error('No se pudo calcular el hash del archivo (se sigue sin esta protección):', err)
    }
    setFileHash(hash)
    const phash = await computePerceptualHash(selected)
    setPerceptualHash(phash)

    let path = null
    try {
      setAiStatus('uploading')
      setAiMessage('Subiendo comprobante...')
      const ext = selected.name.split('.').pop()
      path = `${selectedOrg.organization_id}/${crypto.randomUUID()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('guest-evidence').upload(path, selected)
      if (uploadError) throw uploadError
      setEvidencePath(path)
    } catch (err) {
      console.error('Error subiendo comprobante:', err)
      setAiStatus('error')
      setAiMessage(`No se pudo subir tu foto (${err?.message || 'error desconocido'}). Revisa tu conexión e intenta de nuevo, o prueba con otra foto.`)
      return
    }

    if (!selected.type.startsWith('image/')) {
      return
    }

    try {
      setAiStatus('analyzing')
      setAiMessage('Leyendo comprobante con IA...')
      const { data: fnData, error: fnError } = await supabase.functions.invoke('analyze-guest-evidence', {
        body: { path, organization_id: selectedOrg.organization_id }
      })

      if (fnError) throw fnError
      if (fnData?.extraction) {
        setExtractionConfidence(fnData.extraction.confidence || null)
        setRawExtraction(fnData.extraction)
        applyExtraction(fnData.extraction)
        setAiStatus('done')
        setAiMessage('✓ Detectamos casi todo. Confirma los datos abajo y listo.')
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
        p_is_in_person: isInPerson,
        p_perceptual_hash: perceptualHash,
        p_detected_bank: rawExtraction?.bank || null,
        p_detected_account_last4: rawExtraction?.account_last4 || null,
        p_ai_amount: rawExtraction?.amount ?? null,
        p_ai_currency: rawExtraction?.currency || null,
        p_ai_reference_raw: rawExtraction?.reference_raw || null,
        p_ai_transaction_date: /^\d{4}-\d{2}-\d{2}$/.test(rawExtraction?.transaction_date || '') ? rawExtraction.transaction_date : null,
        p_ai_confidence: rawExtraction?.confidence || null
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

  const inReviewMode = aiStatus === 'done' && Boolean(form.amount) && (extractionConfidence?.amount ?? 0) >= 0.6 && !manualOverride

  if (loadingDirectOrg) {
    return (
      <div className="login-wrap">
        <div className="card login-card" style={{ maxWidth: 480 }}>
          <PublicPageHeader />
          <p style={{ opacity: 0.6 }}>Cargando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="login-wrap">
      <div className="card login-card" style={{ maxWidth: 480 }}>
        <PublicPageHeader />
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
              {inReviewMode ? (
                <div className="field" style={{ background: 'rgba(43, 100, 89, 0.06)', borderRadius: 10, padding: 14, marginBottom: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Esto es lo que detectamos:</div>
                  <div style={{ fontSize: 14, marginBottom: 4 }}>
                    <strong>{form.currency} {Number(form.amount).toLocaleString('es-HN', { minimumFractionDigits: 2 })}</strong>
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.75, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {form.referenceRaw && <span>Referencia: {form.referenceRaw}</span>}
                    {form.transactionDate && <span>Fecha: {form.transactionDate}</span>}
                    {(rawExtraction?.bank || rawExtraction?.account_last4) && (
                      <span>
                        Cuenta destino: {rawExtraction?.bank || 'banco no identificado'}
                        {rawExtraction?.account_last4 ? ` ****${rawExtraction.account_last4}` : ''}
                      </span>
                    )}
                    {form.originBank && <span>Banco origen: {form.originBank}</span>}
                    {form.originAccountHolder && <span>Titular origen: {form.originAccountHolder}</span>}
                    {form.originAccountNumber && <span>Cuenta origen: {form.originAccountNumber}</span>}
                  </div>
                  <p style={{ fontSize: 11.5, opacity: 0.55, marginTop: 8, marginBottom: 0 }}>
                    Comparamos estos datos con el comprobante y con las cuentas registradas de {selectedOrg.name}.
                  </p>
                  {dateWarning && (
                    <p style={{ color: '#B08900', fontSize: 12.5, marginTop: 8, marginBottom: 0 }}>⚠ {dateWarning}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => setManualOverride(true)}
                    style={{ background: 'none', border: 'none', padding: 0, marginTop: 10, color: 'inherit', textDecoration: 'underline', cursor: 'pointer', fontSize: 12.5, opacity: 0.75 }}
                  >
                    Algo no está bien -- editar a mano
                  </button>
                </div>
              ) : (
                <>
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
                    <input
                      id="transactionDate"
                      type="date"
                      value={form.transactionDate}
                      onChange={(e) => { updateField('transactionDate', e.target.value); setDateWarning(null) }}
                    />
                    {dateWarning && (
                      <p style={{ color: '#B08900', fontSize: 12.5, marginTop: 4 }}>⚠ {dateWarning}</p>
                    )}
                  </div>
                </>
              )}
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
                {submitting && <Spinner />}{submitting ? 'Enviando...' : inReviewMode ? 'Confirmar y enviar' : 'Enviar comprobante'}
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
