import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import AttendanceQr from './AttendanceQr'

// Botón circular siempre visible: un toque y aparece el QR para marcar
// entrada, almuerzo o salida en el dispositivo de la sucursal.
export default function AttendanceFab() {
  const { membership } = useAuth()
  const location = useLocation()
  const [open, setOpen] = useState(false)

  if (!membership) return null
  if (location.pathname.startsWith('/asistencia/marcar') || location.pathname === '/mi-asistencia') return null

  return (
    <>
      <button
        type="button"
        aria-label="Marcar asistencia"
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed', right: 16, bottom: 96, zIndex: 40, width: 64, height: 64, borderRadius: '50%',
          border: 'none', background: '#2B6459', color: '#fff', boxShadow: '0 6px 18px rgba(0,0,0,0.3)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
          fontSize: 10, fontWeight: 700, letterSpacing: 0.3, cursor: 'pointer'
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
        </svg>
        Marcar
      </button>

      {open && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setOpen(false)}
        >
          <div
            className="card"
            style={{ width: '100%', maxWidth: 420, borderRadius: '20px 20px 0 0', padding: '20px 20px 28px', textAlign: 'center' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>Tu código de asistencia</h2>
            <p style={{ margin: '0 0 12px', opacity: 0.65, fontSize: 14 }}>Muéstralo a la cámara del dispositivo de tu sucursal.</p>
            <AttendanceQr orgId={membership.organization_id} size={240} />
            <button type="button" className="btn btn-secondary" style={{ marginTop: 14 }} onClick={() => setOpen(false)}>Cerrar</button>
          </div>
        </div>
      )}
    </>
  )
}
