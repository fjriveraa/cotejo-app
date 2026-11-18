import { useState } from 'react'
import { Link } from 'react-router-dom'

const KEY = 'cotejo_notice_access_control'

// Aviso interno (no público) de que Cotejo también controla el acceso laboral.
// Se cierra una vez y no vuelve a salir en este dispositivo.
export default function AccessControlNotice() {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(KEY) === '1' } catch { return false }
  })
  if (hidden) return null
  function close() {
    try { localStorage.setItem(KEY, '1') } catch { /* sin almacenamiento */ }
    setHidden(true)
  }
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <p style={{ margin: '0 0 4px', fontWeight: 700 }}>🆕 Control de acceso laboral</p>
      <p style={{ margin: '0 0 12px', fontSize: 14, opacity: 0.75 }}>
        Además de comprobantes, Cotejo registra la entrada, el almuerzo y la salida de tu equipo, con horarios y reportes.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <Link to="/asistencia" className="btn btn-primary" style={{ fontSize: 13, padding: '6px 14px' }}>Ver Asistencia</Link>
        <button type="button" className="btn btn-secondary" style={{ fontSize: 13, padding: '6px 14px' }} onClick={close}>Cerrar</button>
      </div>
    </div>
  )
}
