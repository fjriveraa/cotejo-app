import { useAuth } from '../hooks/useAuth'
import { IconBuilding } from './icons'

const QUEUE_ROLES = ['contador', 'propietario', 'supervisor', 'admin', 'auditor']

// Antes, con más de una empresa, Cotejo simplemente asumía en cuál estabas
// (la que quedó guardada en el teléfono la última vez) y seguía de largo sin
// avisar nada — así fue como alguien terminó registrando y tratando de
// confirmar pagos en una sucursal pensando que estaba en la empresa
// principal, sin ninguna señal de que el contexto había cambiado. Esta
// pantalla obliga a elegir a propósito antes de entrar, una vez por sesión
// de navegador.
export default function OrgPicker() {
  const { memberships, confirmActiveOrg } = useAuth()

  return (
    <div className="login-wrap">
      <div className="card login-card" style={{ maxWidth: 460 }}>
        <h1 style={{ fontSize: 20 }}>¿En cuál empresa vas a trabajar?</h1>
        <p style={{ marginBottom: 20, fontSize: 13.5, opacity: 0.7 }}>
          Perteneces a más de una — elige una para entrar. Puedes cambiar de empresa
          en cualquier momento desde el menú.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {memberships.map((m) => (
            <button
              key={m.organization_id}
              type="button"
              className="choice-card"
              style={{
                flexDirection: 'row', alignItems: 'center', textAlign: 'left', gap: 12, width: '100%',
                cursor: 'pointer', font: 'inherit'
              }}
              onClick={() => confirmActiveOrg(m.organization_id)}
            >
              <IconBuilding width={22} height={22} style={{ flexShrink: 0 }} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="choice-title">{m.organizations?.name || 'Empresa'}</span>
                <span className="choice-subtitle">
                  {m.role}{QUEUE_ROLES.includes(m.role) ? '' : ' · no revisa pagos'}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
