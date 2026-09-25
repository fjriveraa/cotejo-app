import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

function ViewEvidence({ path }) {
  const [loading, setLoading] = useState(false)

  async function open() {
    setLoading(true)
    const { data, error } = await supabase.storage.from('guest-evidence').createSignedUrl(path, 300)
    setLoading(false)
    if (!error && data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
  }

  if (!path) return null
  return (
    <button type="button" className="btn btn-secondary" onClick={open} disabled={loading} style={{ fontSize: 13 }}>
      {loading ? 'Abriendo...' : 'Ver comprobante'}
    </button>
  )
}

export default function GuestQueue() {
  const { membership } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    if (!membership) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membership?.organization_id])

  async function load() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase.rpc('list_guest_submissions', { p_organization_id: membership.organization_id })
    setLoading(false)
    if (error) setError(error.message)
    else setItems(data || [])
  }

  async function decide(item, approve) {
    let reviewNotes = null
    if (!approve) {
      reviewNotes = window.prompt('¿Por qué no se pudo confirmar? (esto lo va a ver la persona que lo envió, sé breve y claro)')
      if (reviewNotes === null) return
    }
    setBusyId(item.submission_id)
    setError(null)
    const { error } = await supabase.rpc('decide_guest_submission', {
      p_submission_id: item.submission_id,
      p_approve: approve,
      p_review_notes: reviewNotes
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
      <h2 style={{ marginTop: 0 }}>Comprobantes de invitados</h2>
      <p style={{ opacity: 0.7, fontSize: 14, marginTop: -8, marginBottom: 24 }}>
        Comprobantes que clientes enviaron directamente, sin necesitar cuenta en Cotejo. Al confirmar o no poder
        confirmar, la persona ve el resultado en el enlace que le dimos al enviarlo.
      </p>

      {error && <p className="error-text">{error}</p>}

      {items.length === 0 ? (
        <p className="empty-state">No hay comprobantes de invitados pendientes.</p>
      ) : (
        <div className="payment-list">
          {items.map((s) => (
            <div key={s.submission_id} className="payment-row" style={{ flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div className="amount">
                  {s.currency} {Number(s.amount).toLocaleString('es-HN', { minimumFractionDigits: 2 })}
                </div>
                <div className="meta">
                  {s.submitter_name || 'Sin nombre'}{s.submitter_contact ? ` · ${s.submitter_contact}` : ''}
                  {s.reference_raw ? ` · ref: ${s.reference_raw}` : ''}
                </div>
                <div className="meta">
                  {new Date(s.created_at).toLocaleString('es-HN')}
                  {s.origin_account_holder ? ` · de: ${s.origin_account_holder}` : ''}
                  {s.origin_bank ? ` (${s.origin_bank})` : ''}
                </div>
                {s.notes && <div className="meta">Nota del cliente: {s.notes}</div>}
              </div>
              <div className="actions-row">
                <ViewEvidence path={s.evidence_path} />
                <button className="btn btn-primary" disabled={busyId === s.submission_id} onClick={() => decide(s, true)}>
                  {busyId === s.submission_id ? 'Un momento...' : 'Confirmar'}
                </button>
                <button className="btn btn-amber" disabled={busyId === s.submission_id} onClick={() => decide(s, false)}>
                  No se pudo confirmar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
