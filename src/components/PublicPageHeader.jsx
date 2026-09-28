import { Link } from 'react-router-dom'

// Las pantallas públicas (enviar comprobante, ver estado, unirse) no tenían
// ninguna forma de volver al inicio o de llegar a iniciar sesión -- alguien
// que entraba directo desde un link de WhatsApp quedaba "atrapado" ahí, sin
// saber que Cotejo tiene una app con cuenta. Este header chico se repite en
// todas esas pantallas para resolver justo eso.
export default function PublicPageHeader() {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
      <Link to="/" style={{ fontWeight: 700, fontSize: 15, color: 'var(--teal-strong)', textDecoration: 'none' }}>
        Cotejo
      </Link>
      <Link to="/login" style={{ fontSize: 13, opacity: 0.75 }}>
        Iniciar sesión
      </Link>
    </div>
  )
}
