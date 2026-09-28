import { useState } from 'react'
import { IconDoc, IconCheckCircle, IconMenu, IconChevronRight } from './icons'

// Tour corto de bienvenida para quien entra por primera vez a la cola de
// confirmación (el rol que más usa Cotejo día a día). Se guarda en
// localStorage por dispositivo — no es crítico que se repita si cambian de
// computadora, y evita depender de una columna nueva en la base de datos
// solo para esto.
const SEEN_KEY = 'cotejo:onboardingSeen:v1'

export function hasSeenOnboarding() {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return true // si no hay storage, mejor no insistir con el tour
  }
}

export function markOnboardingSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    // almacenamiento no disponible — no es crítico
  }
}

const STEPS = [
  {
    icon: IconDoc,
    title: 'Bienvenido a tu cola de confirmación',
    body: 'Aquí aparecen los comprobantes que tu equipo registró y todavía nadie confirmó, agrupados por banco para que sea fácil ir cotejando uno por uno.'
  },
  {
    icon: IconDoc,
    title: 'Revisa antes de confirmar',
    body: 'Toca la miniatura o "Ver comprobante" para ver la imagen y comparar lo que detectó la IA contra lo que quedó registrado — así detectas un desajuste antes de aprobar.'
  },
  {
    icon: IconCheckCircle,
    title: '"Confirmar" es lo que vas a usar más',
    body: 'Por eso está arriba y en verde. Las otras tres opciones (en revisión, no encontrado, duplicado) son para las excepciones — por eso viven más pequeñas debajo.'
  },
  {
    icon: IconMenu,
    title: 'El menú tiene más',
    body: 'Desde el menú de arriba puedes cambiar de empresa, invitar a tu equipo, agregar Cotejo a la pantalla de inicio y compartirlo con quien lo necesite.'
  }
]

export default function OnboardingTour({ onClose }) {
  const [step, setStep] = useState(0)
  const isLast = step === STEPS.length - 1
  const current = STEPS[step]
  const Icon = current.icon

  function finish() {
    markOnboardingSeen()
    onClose()
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16
      }}
      onClick={finish}
    >
      <div
        className="card"
        style={{ maxWidth: 420, width: '100%', background: 'white', textAlign: 'center' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            width: 56, height: 56, borderRadius: '50%', background: 'rgba(43, 100, 89, 0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '4px auto 16px',
            color: 'var(--teal-strong)'
          }}
        >
          <Icon width={26} height={26} />
        </div>
        <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>{current.title}</h3>
        <p style={{ margin: '0 0 20px', fontSize: 14, opacity: 0.75, lineHeight: 1.5 }}>{current.body}</p>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 20 }}>
          {STEPS.map((_, i) => (
            <span
              key={i}
              style={{
                width: 6, height: 6, borderRadius: '50%',
                background: i === step ? 'var(--teal-strong)' : 'rgba(42, 38, 32, 0.2)',
                transition: 'background 0.2s ease'
              }}
            />
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={finish}>
            Saltar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
            onClick={() => (isLast ? finish() : setStep((s) => s + 1))}
          >
            {isLast ? 'Entendido' : 'Siguiente'}
            {!isLast && <IconChevronRight width={16} height={16} />}
          </button>
        </div>
      </div>
    </div>
  )
}
