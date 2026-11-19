// Indicador de espera sutil: tres puntos que laten suave y un texto corto.
// Aparece con un pequeño retraso (CSS) para que una carga rápida no
// parpadee, y respeta "reducir movimiento" del sistema.
export default function Loading({ label = 'Cargando', light = false, small = false }) {
  return (
    <div
      className={`loading-inline${small ? ' loading-inline-small' : ''}`}
      style={light ? { color: 'white' } : undefined}
      role="status"
      aria-live="polite"
    >
      <span className="loading-dots" aria-hidden="true"><i /><i /><i /></span>
      <span>{label}</span>
    </div>
  )
}
