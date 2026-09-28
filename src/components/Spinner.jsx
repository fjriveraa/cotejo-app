// Antes, un botón "cargando" solo cambiaba su texto ("Ingresar" ->
// "Ingresando..."), lo cual es fácil de no notar si la persona no está
// mirando fijo el botón. Este spinner chico -- pensado para ir adentro del
// botón, no reemplazarlo -- usa currentColor para heredar el color del
// texto del botón (blanco en btn-primary, oscuro en btn-secondary).
export default function Spinner({ style }) {
  return <span className="spinner" aria-hidden="true" style={style} />
}
