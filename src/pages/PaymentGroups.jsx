import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { SkeletonPaymentList } from '../components/Skeleton'

export default function PaymentGroups() {
  const { membership } = useAuth()
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [parentOf, setParentOf] = useState({})
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [periodType, setPeriodType] = useState('monthly')
  const [defaultAmount, setDefaultAmount] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!membership) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membership?.organization_id])

  async function load() {
    setLoading(true)
    setError(null)
    let res
    try {
      res = await supabase.rpc('list_payment_groups', { p_organization_id: membership.organization_id })
      // Un corte momentáneo de internet se reintenta una vez antes de avisar.
      if (res.error && /load failed|failed to fetch|network/i.test(res.error.message || '')) {
        await new Promise((r) => setTimeout(r, 1200))
        res = await supabase.rpc('list_payment_groups', { p_organization_id: membership.organization_id })
      }
    } catch (e) {
      res = { error: { message: String(e?.message || e) } }
    }
    try {
      const pr = await supabase.rpc('payment_group_parents', { p_organization_id: membership.organization_id })
      const map = {}
      ;(pr.data || []).forEach((r) => { if (r.parent_group_id) map[r.group_id] = { parent: r.parent_group_id, label: r.option_label } })
      setParentOf(map)
    } catch { /* sin anidar si falla */ }
    setLoading(false)
    if (res.error) setError(/load failed|failed to fetch|network/i.test(res.error.message || '') ? 'No se pudo cargar por la conexión. Toca Reintentar.' : res.error.message)
    else setGroups(res.data || [])
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    setError(null)
    const { error } = await supabase.rpc('create_payment_group', {
      p_organization_id: membership.organization_id,
      p_name: name.trim(),
      p_period_type: periodType,
      p_default_expected_amount: defaultAmount ? Number(defaultAmount) : null
    })
    setCreating(false)
    if (error) {
      setError(error.message)
      return
    }
    setName('')
    setDefaultAmount('')
    setPeriodType('monthly')
    setShowForm(false)
    load()
  }

  if (loading) {
    return (
      <div className="container">
        <h2 style={{ marginTop: 0 }}>Grupos</h2>
        <SkeletonPaymentList rows={3} />
      </div>
    )
  }

  return (
    <div className="container">
      <h2 style={{ marginTop: 0 }}>Grupos</h2>
      <p style={{ opacity: 0.7, fontSize: 14, marginTop: -8, marginBottom: 24 }}>
        Un grupo tiene su propio enlace y su propia lista de personas esperadas — para cobros recurrentes a un
        conjunto conocido de gente (padres de familia, inquilinos, jugadores, vendedores) donde te interesa saber
        quién ya pagó y quién falta, no solo recibir comprobantes sueltos.
      </p>

      {error && (
        <p className="error-text">
          {error}{' '}
          <button type="button" className="btn btn-secondary" style={{ fontSize: 13, padding: '2px 10px' }} onClick={load}>Reintentar</button>
        </p>
      )}

      {!showForm ? (
        <button type="button" className="btn btn-primary" onClick={() => setShowForm(true)} style={{ marginBottom: 20 }}>
          + Nuevo grupo
        </button>
      ) : (
        <div className="card" style={{ marginBottom: 20, maxWidth: 480 }}>
          <form onSubmit={handleCreate}>
            <div className="field">
              <label htmlFor="groupName">Nombre del grupo</label>
              <input id="groupName" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="ej. Renta de locales — Pazari" required />
            </div>
            <div className="field">
              <label htmlFor="periodType">¿Cómo se cobra?</label>
              <select id="periodType" value={periodType} onChange={(e) => setPeriodType(e.target.value)}>
                <option value="monthly">Cada mes (la lista de quién pagó se reinicia mensualmente)</option>
                <option value="once">Una sola vez (cobro único, sin repetirse)</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="defaultAmount">Monto esperado por persona (opcional — puedes ajustarlo por persona después)</label>
              <input id="defaultAmount" type="number" step="0.01" min="0" value={defaultAmount} onChange={(e) => setDefaultAmount(e.target.value)} placeholder="ej. 1500" />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating ? 'Creando...' : 'Crear grupo'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      {groups.length === 0 ? (
        <p className="empty-state">Todavía no tienes grupos.</p>
      ) : (
        <div className="payment-list">
          {groups.filter((g) => !parentOf[g.group_id]).map((g) => {
            const kids = groups.filter((k) => parentOf[k.group_id]?.parent === g.group_id)
            return (
              <div key={g.group_id}>
                <Link to={`/grupos/${g.group_id}`} className="payment-row" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div>
                    <div className="row-title">{g.name}</div>
                    <div className="meta">
                      {kids.length > 0
                        ? `Grupo principal · ${kids.length} ${kids.length === 1 ? 'subgrupo' : 'subgrupos'}`
                        : `${g.member_count} ${g.member_count === 1 ? 'persona' : 'personas'} en la lista · ${g.period_type === 'monthly' ? 'cobro mensual' : 'cobro único'}`}
                      {!g.active && ' · 📦 archivado'}
                    </div>
                  </div>
                </Link>
                {kids.map((k) => (
                  <Link key={k.group_id} to={`/grupos/${k.group_id}`} className="payment-row" style={{ textDecoration: 'none', color: 'inherit', marginLeft: 22, marginTop: 6, borderLeft: '3px solid #2B6459' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>
                        {parentOf[k.group_id]?.label || k.name}
                        {k.default_expected_amount ? ` · L ${Number(k.default_expected_amount).toLocaleString('es-HN', { minimumFractionDigits: 2 })}` : ''}
                      </div>
                      <div className="meta">
                        {k.member_count} {k.member_count === 1 ? 'persona' : 'personas'} en la lista
                        {!k.active && ' · 📦 archivado'}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
