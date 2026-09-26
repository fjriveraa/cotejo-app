import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { hashFile, computePerceptualHash } from '../lib/fileHash'

const STATUS_LABELS = {
  unverified: { label: 'Sin verificar', color: '#6B7280' },
  pending: { label: 'En revisión', color: '#B45309' },
  verified: { label: 'Verificada', color: '#2B6459' },
  rejected: { label: 'Rechazada', color: '#B91C1C' }
}

async function uploadFile(file, organizationId, kind) {
  if (!file) return null
  const ext = file.name.split('.').pop()
  const path = `${organizationId}/${kind}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('verification-docs').upload(path, file)
  if (error) throw error
  return path
}

export default function Verify() {
  const { membership, refreshMemberships } = useAuth()
  const [method, setMethod] = useState('documentos_legales')
  const [rtn, setRtn] = useState('')
  const [legalDocFile, setLegalDocFile] = useState(null)
  const [idDocFile, setIdDocFile] = useState(null)
  const [socialUrl, setSocialUrl] = useState('')
  const [socialEvidenceFile, setSocialEvidenceFile] = useState(null)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  const status = membership?.organizations?.verification_status || 'unverified'
  const statusInfo = STATUS_LABELS[status] || STATUS_LABELS.unverified

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    if (!membership) return

    setLoading(true)
    try {
      let legalDocPath = null
      let idDocPath = null
      let socialEvidencePath = null
      let legalDocHash = null
      let idDocHash = null
      let legalDocPhash = null
      let idDocPhash = null

      if (method === 'documentos_legales') {
        if (legalDocFile) {
          ;[legalDocPath, legalDocHash, legalDocPhash] = await Promise.all([
            uploadFile(legalDocFile, membership.organization_id, 'escritura'),
            hashFile(legalDocFile),
            computePerceptualHash(legalDocFile)
          ])
        }
        if (idDocFile) {
          ;[idDocPath, idDocHash, idDocPhash] = await Promise.all([
            uploadFile(idDocFile, membership.organization_id, 'identificacion'),
            hashFile(idDocFile),
            computePerceptualHash(idDocFile)
          ])
        }
      } else {
        socialEvidencePath = await uploadFile(socialEvidenceFile, membership.organization_id, 'redes')
      }

      const { error: rpcError } = await supabase.rpc('submit_organization_verification', {
        p_organization_id: membership.organization_id,
        p_method: method,
        p_rtn: rtn.trim() || null,
        p_legal_doc_path: legalDocPath,
        p_id_doc_path: idDocPath,
        p_social_url: method === 'redes_sociales' ? socialUrl.trim() : null,
        p_social_evidence_path: socialEvidencePath,
        p_notes: notes.trim() || null,
        p_legal_doc_hash: legalDocHash,
        p_id_doc_hash: idDocHash,
        p_legal_doc_phash: legalDocPhash,
        p_id_doc_phash: idDocPhash
      })

      if (rpcError) throw rpcError

      setSuccess(true)
      refreshMemberships()
    } catch (err) {
      setError(err.message || 'No se pudo enviar la verificación.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container">
      <h2 style={{ marginTop: 0 }}>Verificar mi empresa</h2>
      <p style={{ opacity: 0.7, fontSize: 14, marginTop: -8, marginBottom: 16 }}>
        Verificar tu empresa le da confianza a quien la busque en el directorio de Cotejo. No es obligatorio para
        usar la app, pero ayuda a que otros sepan que de verdad eres el dueño.
      </p>

      <div style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 999, background: statusInfo.color, color: '#fff', fontSize: 13, fontWeight: 600, marginBottom: 24 }}>
        {statusInfo.label}
      </div>

      {status === 'rejected' && (
        <p className="error-text" style={{ marginBottom: 16 }}>
          Tu última solicitud fue rechazada. Revisa los datos y vuelve a enviarla.
        </p>
      )}

      {success ? (
        <div className="card">
          <p>Tu solicitud fue enviada. La vamos a revisar y te avisamos aquí mismo cuando quede lista.</p>
        </div>
      ) : status === 'pending' ? (
        <div className="card">
          <p>Ya tienes una solicitud en revisión para esta empresa. Te avisamos aquí cuando quede resuelta.</p>
        </div>
      ) : (
        <div className="card">
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button
              type="button"
              className={method === 'documentos_legales' ? 'btn btn-primary' : 'btn btn-secondary'}
              onClick={() => setMethod('documentos_legales')}
              style={{ flex: 1 }}
            >
              Tengo escritura / RTN
            </button>
            <button
              type="button"
              className={method === 'redes_sociales' ? 'btn btn-primary' : 'btn btn-secondary'}
              onClick={() => setMethod('redes_sociales')}
              style={{ flex: 1 }}
            >
              Solo tengo redes sociales
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            {method === 'documentos_legales' ? (
              <>
                <div className="field">
                  <label htmlFor="rtn">RTN (opcional si no tienes uno todavía)</label>
                  <input id="rtn" type="text" value={rtn} onChange={(e) => setRtn(e.target.value)} placeholder="ej. 08019999012345" />
                </div>
                <div className="field">
                  <label htmlFor="legalDoc">Escritura pública o constancia de comerciante individual (foto o PDF)</label>
                  <input id="legalDoc" type="file" accept="image/*,application/pdf" onChange={(e) => setLegalDocFile(e.target.files?.[0] || null)} />
                </div>
                <div className="field">
                  <label htmlFor="idDoc">Tu identificación (cédula) — foto de ambos lados en una sola imagen o PDF</label>
                  <input id="idDoc" type="file" accept="image/*,application/pdf" onChange={(e) => setIdDocFile(e.target.files?.[0] || null)} />
                </div>
                <p style={{ fontSize: 12, opacity: 0.6, marginTop: -8, marginBottom: 16 }}>
                  Sube al menos uno de los dos documentos. Estos archivos son privados — solo tú y quien revisa
                  verificaciones en Cotejo pueden verlos.
                </p>
              </>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="socialUrl">Enlace a tu página o perfil de negocio</label>
                  <input
                    id="socialUrl"
                    type="url"
                    value={socialUrl}
                    onChange={(e) => setSocialUrl(e.target.value)}
                    placeholder="https://instagram.com/tu_negocio"
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="socialEvidence">
                    Captura de pantalla donde se vea que eres administrador/dueño (panel de administrador,
                    configuración de la página, o una publicación pidiendo el código que te demos)
                  </label>
                  <input id="socialEvidence" type="file" accept="image/*,application/pdf" onChange={(e) => setSocialEvidenceFile(e.target.files?.[0] || null)} />
                </div>
              </>
            )}
            <div className="field">
              <label htmlFor="notes">Notas para quien revisa (opcional)</label>
              <input id="notes" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Cualquier contexto que ayude a confirmar que eres el dueño" />
            </div>
            {error && <p className="error-text">{error}</p>}
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
              {loading ? 'Enviando...' : 'Enviar para revisión'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
