// Placeholders de carga con la forma del contenido real, en vez del típico
// "Cargando..." en texto plano. La persona ve de entrada dónde va a
// aparecer cada cosa (una fila de pago, una tarjeta) y la pantalla se
// siente "en proceso" en vez de vacía -- eso es lo que hace que una carga
// de medio segundo no se sienta como que algo se rompió.

export function SkeletonBar({ width = '100%', height = 14, radius = 6, style }) {
  return (
    <span
      className="skeleton-bar"
      style={{ display: 'block', width, height, borderRadius: radius, ...style }}
    />
  )
}

// Imita una .payment-row: miniatura + dos líneas de texto + monto a la
// derecha. Se usa donde se listan pagos o comprobantes (cola, invitados).
export function SkeletonPaymentRow() {
  return (
    <div className="payment-row payment-row-with-thumb" aria-hidden="true">
      <SkeletonBar width={58} height={58} radius={8} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SkeletonBar width="60%" height={15} />
        <SkeletonBar width="40%" height={12} />
      </div>
      <SkeletonBar width={70} height={16} />
    </div>
  )
}

export function SkeletonPaymentList({ rows = 4 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonPaymentRow key={i} />
      ))}
    </div>
  )
}

// Imita una fila corta de lista (notificaciones, menús desplegables).
export function SkeletonListRow() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 0' }} aria-hidden="true">
      <SkeletonBar width="75%" height={13} />
      <SkeletonBar width="45%" height={11} />
    </div>
  )
}
