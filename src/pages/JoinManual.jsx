import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

export default function JoinManual() {
  const { switchOrg, refreshMemberships } = useAuth()
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (!input.trim()) {
      setError('Pega el enlace o código de invitación que te compartieron.')
      return
    }
    setLoading(true)
    const { data, error } = await supabase.rpc('join_via_invite_token_input', { p_input: input.trim() })
    setLoading(false)
    if (error) {
      setError(error.message || 'No se pudo vincular tu cuenta con ese enlace.')
      return
    }
    // Deja la empresa recién unida como la "activa" y vuelve al inicio.
    if (data?.organization_id) switchOrg(data.organization_id)
    refreshMemberships()
    navigate('/')
  }

  return (
    <div className="container">
      <h2 style={{ marginTop: 0 }}>Unirme a otra empresa</h2>
      <p style={{ opacity: 0.7, fontSize: 14, marginTop: -8, marginBottom: 24 }}>
        Si alguien te compartió un enlace de invitación de otra empresa en Cotejo, pégalo aquí para vincular tu
        cuenta con ella. Puedes pertenecer a varias empresas a la vez y cambiar entre ellas arriba.
      </p>

      <div className="card">
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="input">Enlace o código de invitación</label>
            <input
              id="input"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://cotejo-app-two.vercel.app/join/..."
              autoComplete="off"
            />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Vinculando...' : 'Unirme'}
          </button>
        </form>
      </div>
    </div>
  )
}
