import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { IconInbox } from '../components/icons'

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

function LinkRow({ label, hint, link }) {
  const [copied, setCopied] = useState(false)
  function copyLink() {
    navigator.clipboard?.writeText(link).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{label}</div>
      <p style={{ fontSize: 12, opacity: 0.7, margin: '2px 0 6px' }}>{hint}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input readOnly value={link} onFocus={(e) => e.target.select()} style={{ flex: '1 1 220px', fontSize: 13 }} />
        <button type="button" className="btn btn-secondary" onClick={copyLink}>
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
    </div>
  )
}

function CustomerLinkCard({ organizationId, organizationName }) {
  const remoteLink = `${window.location.origin}/comprobante/${organizationId}`
  const inPersonLink = `${remoteLink}?presencial=1`
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(inPersonLink)}`

  return (
    <div className="card" style={{ marginBottom: 24, display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <img src={qrUrl} alt={`Código QR para enviar comprobantes a ${organizationName} en tienda`} width={120} height={120} style={{ borderRadius: 8 }} />
      <div style={{ flex: '1 1 260px' }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Enlaces para tus clientes (no necesitan cuenta)</div>
        <LinkRow
          label="Código QR / enlace para imprimir en tienda"
          hint="Para cuando el cliente está frente a ti pagando. Queda marcado como 'en tienda' en la cola."
          link={inPersonLink}
        />
        <LinkRow
          label="Enlace para WhatsApp / Instagram"
          hint="Para cuando pides el comprobante a distancia. Queda marcado como 'a distancia' en la cola."
          link={remoteLink}
        />
      </div>
    </div>
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

      {membership && (
        <CustomerLinkCard organizationId={membership.organization_id} organizationName={membership.organizations?.name} />
      )}

      {error && <p className="error-text">{error}</p>}

      {items.length === 0 ? (
        <div className="empty-state-friendly">
          <IconInbox width={36} height={36} />
          <div className="title">Bandeja al día</div>
          <div className="subtitle">No hay comprobantes de invitados pendientes de revisar.</div>
        </div>
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
                <div style={{ marginTop: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: s.is_in_person ? '#2B6459' : '#6B7280' }}>
                    {s.is_in_person ? '📍 Enviado en tienda' : 'Enviado a distancia'}
                  </span>
                  {s.duplicate_reference && (
                    <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 600, color: '#B91C1C' }}>
                      ⚠ Esta referencia ya se usó en otra solicitud — revisa con cuidado
                    </span>
                  )}
                  {s.hash_seen_elsewhere && (
                    <span
                      style={{
                        marginLeft: 10,
                        fontSize: 12,
                        fontWeight: 700,
                        color: '#7C2D12',
                        background: '#FEE2E2',
                        padding: '2px 8px',
                        borderRadius: 6
                      }}
                    >
                      🚨 Este mismo archivo ya fue enviado a otra empresa — posible comprobante reciclado
                    </span>
                  )}
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
