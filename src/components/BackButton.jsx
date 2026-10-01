import { useNavigate } from 'react-router-dom'

// Botón "Volver" para pantallas que no tienen barra de navegación propia
// (en la app de iPhone no hay botón "atrás" del navegador).
export default function BackButton({ to = '/', label = 'Volver' }) {
  const navigate = useNavigate()
  function goBack() {
    // Si hay historial dentro de la app se vuelve a la pantalla anterior; si
    // no (por ejemplo, tras abrir la app directo en esta pantalla), al inicio.
    if (window.history.state && window.history.state.idx > 0) navigate(-1)
    else navigate(to)
  }
  return (
    <button
      type="button"
      onClick={goBack}
      style={{
        background: 'none',
        border: 'none',
        padding: '4px 0',
        marginBottom: 12,
        fontFamily: 'inherit',
        fontSize: 14,
        fontWeight: 600,
        color: 'var(--teal-text)',
        cursor: 'pointer',
        WebkitAppearance: 'none',
        appearance: 'none'
      }}
    >
      ← {label}
    </button>
  )
}
