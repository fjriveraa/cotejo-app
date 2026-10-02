import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Visor de comprobantes dentro de la app. Antes se abría la URL firmada con
// window.open, y en la app del iPhone eso saca a la persona al navegador.
// Aquí el archivo se descarga y se muestra en una capa propia.
export default function EvidenceViewer({ bucket, path, onClose }) {
  const [src, setSrc] = useState(null)
  const [isPdf, setIsPdf] = useState(false)
  const [error, setError] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    let objectUrl = null
    setSrc(null)
    setError(null)
    supabase.storage.from(bucket).download(path).then(({ data, error: dlError }) => {
      if (cancelled) return
      if (dlError || !data) {
        setError(dlError?.message || 'No se pudo abrir el comprobante.')
        return
      }
      const pdf = data.type === 'application/pdf' || /\.pdf$/i.test(path)
      objectUrl = URL.createObjectURL(pdf && data.type !== 'application/pdf' ? new Blob([data], { type: 'application/pdf' }) : data)
      setIsPdf(pdf)
      setSrc(objectUrl)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [bucket, path, tick])

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 1000, display: 'flex', flexDirection: 'column', padding: 'calc(12px + env(safe-area-inset-top)) 12px calc(12px + env(safe-area-inset-bottom))' }}
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button type="button" className="btn btn-primary" onClick={onClose}>Cerrar</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={(e) => e.stopPropagation()}>
        {!src && !error && <p style={{ color: 'white' }}>Cargando comprobante...</p>}
        {error && (
          <div style={{ color: 'white', textAlign: 'center' }}>
            <p>{error}</p>
            <button type="button" className="btn btn-secondary" onClick={() => setTick((t) => t + 1)}>Reintentar</button>
          </div>
        )}
        {src && !isPdf && (
          <img src={src} alt="Comprobante" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8 }} />
        )}
        {src && isPdf && (
          <iframe title="Comprobante" src={src} style={{ width: '100%', height: '100%', border: 0, background: 'white', borderRadius: 8 }} />
        )}
      </div>
    </div>
  )
}
