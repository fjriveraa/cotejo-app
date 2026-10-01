import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { isPlausibleTransactionDate, parseLocalDate } from '../lib/dateSanity'
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
  const { organizationId, linkCode, memberCode } = useParams() // organizationId: enlace directo de empresa; linkCode: enlace de grupo
  const [searchParams] = useSearchParams()
  const isDirectLink = Boolean(organizationId)
  const isGroupLink = Boolean(linkCode)
  // El mismo enlace directo puede ser para el QR de la tienda (?presencial=1)
  // o para compartir por WhatsApp/Instagram (sin el parámetro) — son casos
  // distintos aunque apunten a la misma empresa.
  const isInPerson = isDirectLink && searchParams.get('presencial') === '1'

  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [selectedOrg, setSelectedOrg] = useState(null)
  const [loadingDirectOrg, setLoadingDirectOrg] = useState(isDirectLink || isGroupLink)
  // Cuando el enlace ya identifica a la persona (uno individual del roster,
  // no el genérico del grupo), no tiene sentido pedirle su nombre otra vez
  // ni dejar que lo cambie -- ya sabemos quién es.
  const [groupInfo, setGroupInfo] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  const [evidencePath, setEvidencePath] = useState(null)
  const [fileHash, setFileHash] = useState(null)
  const [perceptualHash, setPerceptualHash] = useState(null)
  const [aiStatus, setAiStatus] = useState('idle') // idle | uploading | analyzing | done | error | skipped
  const [aiMessage, setAiMessage] = useState(null)
  // dateWarning: null | { kind: 'old', date, daysAgo } | { kind: 'unreadable', date }
  const [dateWarning, setDateWarning] = useState(null)
  const [oldDateConfirmed, setOldDateConfirmed] = useState(false)
  const [nameFromReceipt, setNameFromReceipt] = useState(false)
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

  useEffect(() => {
    if (!isGroupLink) return
    let cancelled = false
    supabase.rpc('resolve_payment_group_link', { p_link_code: linkCode, p_member_code: memberCode || null }).then(({ data, error }) => {
      if (cancelled) return
      setLoadingDirectOrg(false)
      const row = data?.[0]
      if (error || !row) {
        setError('Este enlace no es válido. Pide uno nuevo a quien te lo compartió.')
        return
      }
      setSelectedOrg({ organization_id: row.organization_id, name: row.organization_name })
      setGroupInfo(row)
      if (row.member_id) {
        // Enlace individual: ya sabemos quién es -- se precarga el nombre y
        // no se le pide que lo escriba.
        setForm((prev) => ({ ...prev, submitterName: row.member_display_name }))
      }
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkCode, memberCode])

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
    setOldDateConfirmed(false)
    setNameFromReceipt(false)
    setExtractionConfidence(null)
    setManualOverride(false)
    setRawExtraction(null)
  }

  function applyExtraction(data) {
    if (!data) return
    // Fecha dudosa: si es antigua (pero válida) se conserva y se le pregunta a
    // la persona si es correcta -- no se le pide "corregirla", porque un
    // comprobante viejo real no tiene nada que corregir. Si es imposible
    // (futura o ilegible) sí se descarta y se pide la fecha.
    if (data.transaction_date && !isPlausibleTransactionDate(data.transaction_date)) {
      const d = parseLocalDate(data.transaction_date)
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const daysAgo = d ? Math.round((today.getTime() - d.getTime()) / 86400000) : null
      if (d && daysAgo > 0) {
        setDateWarning({ kind: 'old', date: data.transaction_date, daysAgo })
      } else {
        setDateWarning({ kind: 'unreadable', date: data.transaction_date })
        data = { ...data, transaction_date: null }
      }
    }
    setForm((prev) => {
      const next = { ...prev }
      if (data.amount && !prev.amount) next.amount = String(data.amount)
      if (data.currency && (data.currency === 'HNL' || data.currency === 'USD')) next.currency = data.currency
      if (data.reference_raw && !prev.referenceRaw) next.referenceRaw = data.reference_raw
      if (data.transaction_date && !prev.transactionDate) next.transactionDate = data.transaction_date
      if (data.origin_bank && !prev.originBank) next.originBank = data.origin_bank
      if (data.origin_account_holder && !prev.originAccountHolder) next.originAccountHolder = data.origin_account_holder
      if (data.origin_account_holder && !prev.submitterName && !groupInfo?.member_id) {
        next.submitterName = data.origin_account_holder.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())
        setNameFromReceipt(true)
      }
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

    if (dateWarning?.kind === 'old' && form.transactionDate === dateWarning.date && !oldDateConfirmed) {
      setError('Confirma si la fecha del comprobante es correcta.')
      return
    }

    const confirmedOldNote = dateWarning?.kind === 'old' && oldDateConfirmed && form.transactionDate === dateWarning.date
      ? `[Fecha antigua confirmada por quien envió: ${dateWarning.date}, hace ${dateWarning.daysAgo} días]`
      : null
    const finalNotes = [form.notes.trim(), confirmedOldNote].filter(Boolean).join('\n')

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
        p_notes: finalNotes || null,
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
        p_ai_confidence: rawExtraction?.confidence || null,
        p_group_id: groupInfo?.group_id || null,
        p_group_member_id: groupInfo?.member_id || null
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

  const processing = aiStatus === 'uploading' || aiStatus === 'analyzing'
  // Paso 1: solo el selector. Paso 2: "leyendo". Paso 3: campos ya llenos.
  const showFields = aiStatus === 'done' || aiStatus === 'skipped' || (aiStatus === 'error' && Boolean(evidencePath))
  const inReviewMode = aiStatus === 'done' && Boolean(form.amount) && (extractionConfidence?.amount ?? 0) >= 0.6 && !manualOverride

  const dateNotice = !dateWarning ? null : dateWarning.kind === 'old' ? (
    <div style={{ background: 'rgba(176, 137, 0, 0.1)', borderRadius: 10, padding: 12, marginTop: 10, fontSize: 13.5 }}>
      <div>
        📅 Este comprobante es del <strong>{parseLocalDate(dateWarning.date)?.toLocaleDateString('es-HN', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>
        {' '}(hace {dateWarning.daysAgo >= 60 ? `${Math.round(dateWarning.daysAgo / 30)} meses` : `${dateWarning.daysAgo} días`}).
      </div>
      {oldDateConfirmed && form.transactionDate === dateWarning.date ? (
        <div style={{ marginTop: 6, color: '#2B6459' }}>✓ Fecha confirmada.</div>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" style={{ padding: '8px 12px', fontSize: 13 }} onClick={() => setOldDateConfirmed(true)}>Sí, es de esa fecha</button>
          <button type="button" className="btn" style={{ padding: '8px 12px', fontSize: 13 }} onClick={() => { setManualOverride(true); setDateWarning(null) }}>La fecha está mal</button>
        </div>
      )}
    </div>
  ) : (
    <p style={{ color: '#B08900', fontSize: 13, marginTop: 8 }}>⚠ No pudimos leer bien la fecha del comprobante. Escríbela abajo.</p>
  )

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
        {!isDirectLink && !isGroupLink && <p>Busca la empresa a la que le hiciste la transferencia para que confirmen tu pago.</p>}

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
              Enviando comprobante a <strong>{selectedOrg.name}</strong>
              {groupInfo?.group_name ? <> · <strong>{groupInfo.group_name}</strong></> : null}.{' '}
              {!isDirectLink && !isGroupLink && (
                <button type="button" onClick={() => setSelectedOrg(null)} style={{ background: 'none', border: 'none', color: '#2B6459', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: 14 }}>
                  Cambiar empresa
                </button>
              )}
            </p>
            {groupInfo?.member_id && (
              <p style={{ fontSize: 13, opacity: 0.75, marginTop: -8 }}>
                Enviando como <strong>{groupInfo.member_display_name}</strong>.
              </p>
            )}
            {(groupInfo?.member_expected_amount || groupInfo?.default_expected_amount) && (
              <p style={{ fontSize: 13, opacity: 0.75, marginTop: -8 }}>
                Monto esperado: L {Number(groupInfo.member_expected_amount || groupInfo.default_expected_amount).toLocaleString('es-HN', { minimumFractionDigits: 2 })}
              </p>
            )}
            <form onSubmit={handleSubmit}>
              <div className="field">
                {!processing && !showFields && (
                  <label
                    htmlFor="file"
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '28px 16px', border: '2px dashed #2B6459', borderRadius: 14, background: 'rgba(43, 100, 89, 0.06)', cursor: 'pointer', textAlign: 'center', fontWeight: 600, color: '#2B6459' }}
                  >
                    <span style={{ fontSize: 34, lineHeight: 1 }}>📷</span>
                    <span style={{ fontSize: 16 }}>Subir o tomar foto del comprobante</span>
                    <span style={{ fontSize: 12.5, fontWeight: 400, opacity: 0.75 }}>Nosotros leemos los datos por ti</span>
                  </label>
                )}
                <input
                  id="file"
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={handleFileChange}
                  style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden', pointerEvents: 'none' }}
                  tabIndex={-1}
                />
                {processing && (
                  <div style={{ textAlign: 'center', padding: '32px 16px', borderRadius: 14, background: 'rgba(43, 100, 89, 0.06)' }}>
                    <Spinner />
                    <p style={{ margin: '10px 0 0', fontWeight: 600 }}>
                      {aiStatus === 'uploading' ? 'Subiendo tu comprobante...' : 'Leyendo tu comprobante...'}
                    </p>
                    <p style={{ margin: '4px 0 0', fontSize: 12.5, opacity: 0.65 }}>Solo toma unos segundos.</p>
                  </div>
                )}
                {aiMessage && !processing && (
                  <p style={{ fontSize: 13, marginTop: 8, color: aiStatus === 'error' ? '#A2483A' : aiStatus === 'done' ? '#2B6459' : 'inherit' }}>
                    {aiMessage}
                  </p>
                )}
                {showFields && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
                    {previewUrl ? (
                      <button type="button" onClick={() => setPreviewOpen(true)} style={{ padding: 0, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'none', cursor: 'pointer', width: 64, height: 64, flex: '0 0 auto' }} aria-label="Ver comprobante">
                        <img src={previewUrl} alt="Tu comprobante" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      </button>
                    ) : (
                      <span style={{ fontSize: 13 }}>📄 {file?.name}</span>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                      {previewUrl && (
                        <button type="button" onClick={() => setPreviewOpen(true)} style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', color: '#2B6459', textDecoration: 'underline', cursor: 'pointer', fontSize: 13 }}>
                          Ver mi comprobante
                        </button>
                      )}
                      <label htmlFor="file" style={{ textDecoration: 'underline', opacity: 0.75, cursor: 'pointer', fontWeight: 400, fontSize: 13 }}>
                        Cambiar foto
                      </label>
                    </div>
                  </div>
                )}
                {previewOpen && previewUrl && (
                  <div onClick={() => setPreviewOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
                    <img src={previewUrl} alt="Tu comprobante" style={{ maxWidth: '100%', maxHeight: '85%', objectFit: 'contain', borderRadius: 8 }} />
                    <button type="button" className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setPreviewOpen(false)}>Cerrar</button>
                  </div>
                )}
              </div>
              {showFields && (<>
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
                  {dateNotice}
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
                      onChange={(e) => { updateField('transactionDate', e.target.value); setDateWarning(null); setOldDateConfirmed(false) }}
                    />
                    {dateNotice}
                  </div>
                </>
              )}
              {!groupInfo?.member_id && (
                <div className="field">
                  <label htmlFor="submitterName">Nombre de quien envía</label>
                  <input id="submitterName" type="text" value={form.submitterName} onChange={(e) => { updateField('submitterName', e.target.value); setNameFromReceipt(false) }} required={isGroupLink} />
                  {nameFromReceipt && (
                    <p style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>Lo tomamos del comprobante (titular de la cuenta). Si pagó otra persona por ti, como un familiar, escribe aquí tu nombre como aparece en la lista.</p>
                  )}
                  {isGroupLink && !nameFromReceipt && (
                    <p style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>Escribe tu nombre igual que en la lista para que te encontremos más rápido.</p>
                  )}
                </div>
              )}
              <div className="field">
                <label htmlFor="submitterContact">Tu teléfono o correo (para que te contacten si hace falta)</label>
                <input id="submitterContact" type="text" value={form.submitterContact} onChange={(e) => updateField('submitterContact', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="notes">Notas (opcional)</label>
                <textarea id="notes" rows={2} value={form.notes} onChange={(e) => updateField('notes', e.target.value)} />
              </div>
              {error && <p className="error-text">{error}</p>}
              <div style={{ position: 'sticky', bottom: 0, background: 'var(--card)', padding: '12px 0 calc(12px + env(safe-area-inset-bottom))', marginTop: 8, zIndex: 5 }}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: '100%' }}
                  disabled={submitting || processing}
                >
                  {submitting && <Spinner />}{submitting ? 'Enviando...' : inReviewMode ? 'Confirmar y enviar' : 'Enviar comprobante'}
                </button>
              </div>
              </>)}
            </form>
          </>
        )}

        {!isDirectLink && !isGroupLink && (
          <p style={{ marginTop: 16, fontSize: 13, opacity: 0.7 }}>
            ¿Trabajas en una empresa registrada en Cotejo? <Link to="/login">Inicia sesión aquí</Link>
          </p>
        )}
      </div>
    </div>
  )
}
