import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

export default function MyIdentification() {
  const { user } = useAuth()
  const [idNumber, setIdNumber] = useState('')
  const [existingDocPath, setExistingDocPath] = useState(null)
  const [docFile, setDocFile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!user) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('user_identifications')
      .select('id_number, id_doc_path')
      .eq('user_id', user.id)
      .maybeSingle()
    setLoading(false)
    if (!error && data) {
      setIdNumber(data.id_number || '')
      setExistingDocPath(data.id_doc_path || null)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setSaving(true)
    try {
      let docPath = existingDocPath
      if (docFile) {
        const ext = docFile.name.split('.').pop()
        const path = `${user.id}/id-${Date.now()}.${ext}`
        const { error: uploadError } = await supabase.storage.from('id-docs').upload(path, docFile)
        if (uploadError) throw uploadError
        docPath = path
      }

      const { error: upsertError } = await supabase
        .from('user_identifications')
        .upsert({ user_id: user.id, id_number: idNumber.trim() || null, id_doc_path: docPath, updated_at: new Date().toISOString() })

      if (upsertError) throw upsertError

      setExistingDocPath(docPath)
      setDocFile(null)
      setSuccess(true)
    } catch (err) {
      setError(err.message || 'No se pudo guardar tu identificación.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="container"><p style={{ opacity: 0.6 }}>Cargando...</p></div>

  return (
    <div className="container">
      <h2 style={{ marginTop: 0 }}>Mi identificación</h2>
      <p style={{ opacity: 0.7, fontSize: 14, marginTop: -8, marginBottom: 24 }}>
        Agrega tu número de identificación (cédula, DNI o similar) y, si quieres, una foto. Esto ayuda a que el
        dueño de cada empresa a la que perteneces sepa quién eres de verdad. Es privado — solo tú y los
        dueños/administradores de tus empresas lo pueden ver.
      </p>

      <div className="card">
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="idNumber">Número de identificación</label>
            <input
              id="idNumber"
              type="text"
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value)}
              placeholder="ej. 0801-1999-01234"
            />
          </div>
          <div className="field">
            <label htmlFor="idDoc">Foto de tu identificación (opcional)</label>
            <input id="idDoc" type="file" accept="image/*,application/pdf" onChange={(e) => setDocFile(e.target.files?.[0] || null)} />
            {existingDocPath && !docFile && (
              <p style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>Ya tienes una foto guardada. Sube otra solo si quieres reemplazarla.</p>
            )}
          </div>
          {error && <p className="error-text">{error}</p>}
          {success && <p style={{ color: '#2B6459', fontSize: 13 }}>Guardado.</p>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={saving}>
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </form>
      </div>
    </div>
  )
}
