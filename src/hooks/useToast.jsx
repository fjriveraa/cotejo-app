import { createContext, useCallback, useContext, useRef, useState } from 'react'

const ToastContext = createContext(null)

let idCounter = 0

// Antes cada acción (compartir, instalar, copiar) mostraba su propio texto
// suelto debajo del botón que la disparó -- cada pantalla lo reinventaba a
// su manera y se sentía como un detalle de formulario, no como feedback de
// una app terminada. Este único sistema de notificaciones flotantes
// reemplaza esos textos sueltos: aparece arriba, se desvanece solo, y
// cualquier pantalla lo puede usar con useToast().
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef({})

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    clearTimeout(timers.current[id])
    delete timers.current[id]
  }, [])

  const showToast = useCallback((message, opts = {}) => {
    const { tone = 'default', duration = 3200 } = opts
    const id = ++idCounter
    setToasts((prev) => [...prev, { id, message, tone }])
    timers.current[id] = setTimeout(() => dismiss(id), duration)
    return id
  }, [dismiss])

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast-${t.tone}`}
            onClick={() => dismiss(t.id)}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const showToast = useContext(ToastContext)
  if (!showToast) throw new Error('useToast debe usarse dentro de <ToastProvider>')
  return showToast
}
