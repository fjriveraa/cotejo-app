import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { exportReportToExcel } from '../lib/exportExcel'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function daysAgoISO(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

export default function Reports() {
  const { membership } = useAuth()
  const [from, setFrom] = useState(daysAgoISO(30))
  const [to, setTo] = useState(todayISO())
  const [allTime, setAllTime] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState(null)
  const [lastCount, setLastCount] = useState(null)

  async function handleGenerate(e) {
    e.preventDefault()
    if (!membership) return
    setError(null)
    setGenerating(true)
    setLastCount(null)
    try {
      const p_from = allTime ? null : (from || null)
      const p_to = allTime ? null : (to || null)

      const [{ data: payments, error: paymentsError }, { data: guestSubmissions, error: guestError }] = await Promise.all([
        supabase.rpc('list_payment_records_for_export', {
          p_organization_id: membership.organization_id,
          p_from,
          p_to
        }),
        supabase.rpc('list_guest_submissions_for_export', {
          p_organization_id: membership.organization_id,
          p_from,
          p_to
        })
      ])

      if (paymentsError) throw paymentsError
      if (guestError) throw guestError

      exportReportToExcel({
        organizationName: membership.organizations?.name,
        payments,
        guestSubmissions,
        from: p_from,
        to: p_to
      })

      setLastCount((payments?.length || 0) + (guestSubmissions?.length || 0))
    } catch (err) {
      setError(err.message || 'No se pudo generar el archivo.')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="container">
      <h2 style={{ marginTop: 0 }}>Reportes</h2>
      <p style={{ opacity: 0.7, fontSize: 14, marginTop: -8, marginBottom: 24 }}>
        Descarga un Excel con todos los pagos registrados por tu equipo y los comprobantes enviados por
        invitados, organizados en hojas separadas. Puedes generarlo cuando lo necesites.
      </p>

      <div className="card" style={{ maxWidth: 480 }}>
        <form onSubmit={handleGenerate}>
          <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              id="allTime"
              type="checkbox"
              checked={allTime}
              onChange={(e) => setAllTime(e.target.checked)}
              style={{ width: 'auto' }}
            />
            <label htmlFor="allTime" style={{ margin: 0 }}>Incluir todo el historial (sin rango de fechas)</label>
          </div>

          {!allTime && (
            <div style={{ display: 'flex', gap: 12 }}>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="from">Desde</label>
                <input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} required={!allTime} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="to">Hasta</label>
                <input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} required={!allTime} />
              </div>
            </div>
          )}

          {error && <p className="error-text">{error}</p>}
          {lastCount !== null && !error && (
            <p style={{ color: '#2B6459', fontSize: 13, marginTop: 8 }}>
              Listo — se descargó el Excel con {lastCount} registros en total.
            </p>
          )}

          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={generating}>
            {generating ? 'Generando...' : 'Descargar Excel'}
          </button>
        </form>
      </div>
    </div>
  )
}
