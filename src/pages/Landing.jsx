import { Link } from 'react-router-dom'

// Página pública en "/". Dos caminos claros y universales: crear cuenta o
// iniciar sesión. El tipo de uso (personal o empresarial) se elige después de
// crear la cuenta. Quien solo va a pagar tiene su acceso discreto abajo.
export default function Landing() {
  return (
    <div className="landing-wrap">
      <div className="landing-brand">
        <h1>Cotejo</h1>
        <p>Controles administrativos para tu negocio o uso personal</p>
      </div>

      <div className="landing-choices">
        <Link to="/registro" className="landing-primary">
          <span className="title">Crear cuenta</span>
          <span className="subtitle">Comprobantes, duplicados, asistencia y horarios</span>
        </Link>
        <Link to="/login" className="landing-secondary">
          <span className="title">Ya tengo cuenta</span>
          <span className="subtitle">Iniciar sesión</span>
        </Link>
      </div>

      <p className="landing-login-hint">
        ¿Solo vienes a pagar? <Link to="/comprobante">Envía tu comprobante aquí</Link>
      </p>
    </div>
  )
}
