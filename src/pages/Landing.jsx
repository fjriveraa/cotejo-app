import { Link } from 'react-router-dom'

// Página pública en "/". No pide sesión — la persona decide primero qué
// necesita hacer, y solo si va a trabajar con una empresa se le pide login.
export default function Landing() {
  return (
    <div className="landing-wrap">
      <div className="landing-brand">
        <h1>Cotejo</h1>
        <p>Control y verificación de pagos</p>
      </div>

      <div className="landing-choices">
        <Link to="/comprobante" className="landing-primary">
          <span className="title">Enviar mi comprobante de pago</span>
          <span className="subtitle">Para clientes — no necesitas cuenta</span>
        </Link>
        <Link to="/login" className="landing-secondary">
          <span className="title">Soy parte de un negocio</span>
          <span className="subtitle">Inicia sesión o crea tu cuenta en Cotejo</span>
        </Link>
      </div>

      <p className="landing-login-hint">
        ¿Ya tienes cuenta? <Link to="/login">Inicia sesión aquí</Link>
      </p>
    </div>
  )
}
