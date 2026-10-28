import AttendanceQr from './AttendanceQr'

// Hoja inferior con el QR de asistencia. Se abre desde el botón central
// "Marcar" de la barra inferior (o desde el menú en escritorio).
export default function AttendanceSheet({ orgId, onClose }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: '100%', maxWidth: 420, borderRadius: '20px 20px 0 0', padding: '20px 20px 28px', textAlign: 'center' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>Tu código de asistencia</h2>
        <p style={{ margin: '0 0 12px', opacity: 0.65, fontSize: 14 }}>Muéstralo a la cámara del dispositivo de tu sucursal.</p>
        <AttendanceQr orgId={orgId} size={240} />
        <button type="button" className="btn btn-secondary" style={{ marginTop: 14 }} onClick={onClose}>Cerrar</button>
      </div>
    </div>
  )
}
