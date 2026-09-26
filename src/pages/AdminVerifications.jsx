import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const METHOD_LABELS = {
  documentos_legales: 'Escritura / RTN / identificación',
  redes_sociales: 'Redes sociales'
}

function DocLink({ path, label }) {
  const [loading, setLoading] = useState(false)

  async function open() {
    setLoading(true)
    const { data, error } = await supabase.storage.from('verification-docs').createSignedUrl(path, 300)
    setLoading(false)
    if (!error && data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
  }

  if (!path) return null
  return (
    <button type="button" className="btn btn-secondary" onClick={open} disabled={loading} style={{ fontSize: 13 }}>
      {loading ? 'Abriendo...' : label}
    </button>
  )
}

export default function AdminVerifications() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [notesById, setNotesById] = useState({})

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase.rpc('list_pending_verifications')
    setLoading(false)
    if (error) setError(error.message)
    else setItems(data || [])
  }

  async function decide(item, approve) {
    setBusyId(item.verification_id)
    setError(null)
    const { error } = await supabase.rpc('decide_organization_verification', {
      p_verification_id: item.verification_id,
      p_approve: approve,
      p_review_notes: notesById[item.verification_id] || null
    })
    setBusyId(null)
    if (error) {
      setError(error.message)
      return
    }
    load()
  }

  if (loading) return <div className="container"><p style={{ opacity: 0.6 }}>Cargando...</p></div>

  return (
    <div className="container">
      <h2 style={{ marginTop: 0 }}>Verificaciones pendientes</h2>
      <p style={{ opacity: 0.7, fontSize: 14, marginTop: -8, marginBottom: 24 }}>
        Revisa cada solicitud antes de aprobar. Los documentos son privados y se abren con un enlace temporal.
      </p>

      {error && <p className="error-text">{error}</p>}

      {items.length === 0 ? (
        <p className="empty-state">No hay verificaciones pendientes.</p>
      ) : (
        <div className="payment-list">
          {items.map((v) => (
            <div key={v.verification_id} className="payment-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
              <div>
                <div className="amount" style={{ fontSize: 14 }}>{v.organization_name}</div>
                <div className="meta">
                  {v.country || 'HN'} · {v.org_type === 'autonomo' ? 'Comerciante individual' : 'Empresa'} ·{' '}
                  {METHOD_LABELS[v.method] || v.method} · enviado por {v.submitted_by_email}
                </div>
                {v.rtn && <div className="meta">RTN: {v.rtn}</div>}
                {v.social_url && (
                  <div className="meta">
                    Perfil: <a href={v.social_url} target="_blank" rel="noopener noreferrer">{v.social_url}</a>
                  </div>
                )}
                {v.notes && <div className="meta">Notas: {v.notes}</div>}
                {(v.rtn_duplicate_org_name || v.doc_duplicate_org_name) && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {v.rtn_duplicate_org_name && (
                      <span
                        style={{
                          fontSize: 12, fontWeight: 700, color: '#92400E', background: '#FEF3C7',
                          padding: '4px 10px', borderRadius: 6, display: 'inline-block', width: 'fit-content'
                        }}
                      >
                        ⚠ Este mismo RTN ya está en {v.rtn_duplicate_org_name} — confirma si es una sucursal
                        legítima o alguien más reclamándolo
                      </span>
                    )}
                    {v.doc_duplicate_org_name && (
                      <span
                        style={{
                          fontSize: 12, fontWeight: 700, color: '#7C2D12', background: '#FEE2E2',
                          padding: '4px 10px', borderRadius: 6, display: 'inline-block', width: 'fit-content'
                        }}
                      >
                        🚨 Documento {v.doc_duplicate_kind === 'exacto' ? 'idéntico' : 'muy parecido'} a uno ya
                        usado por {v.doc_duplicate_org_name} — posible suplantación, revisa con cuidado
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <DocLink path={v.legal_doc_path} label="Ver escritura" />
                <DocLink path={v.id_doc_path} label="Ver identificación" />
                <DocLink path={v.social_evidence_path} label="Ver evidencia de redes" />
              </div>

              <input
                type="text"
                placeholder="Nota de revisión (opcional, ej. motivo de rechazo)"
                value={notesById[v.verification_id] || ''}
                onChange={(e) => setNotesById((prev) => ({ ...prev, [v.verification_id]: e.target.value }))}
              />

              <div className="actions-row">
                <button className="btn btn-primary" disabled={busyId === v.verification_id} onClick={() => decide(v, true)}>
                  {busyId === v.verification_id ? 'Un momento...' : 'Aprobar'}
                </button>
                <button className="btn btn-amber" disabled={busyId === v.verification_id} onClick={() => decide(v, false)}>
                  Rechazar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
