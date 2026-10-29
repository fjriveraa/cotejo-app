// Nombres y descripciones de los roles, tal como se muestran en pantalla.
// Roles que se ofrecen al invitar: Propietario, Colaborador y Reloj de sucursal.
// En la base siguen existiendo admin, supervisor, contador y auditor para quien
// ya los tenga (siguen funcionando y se muestran con su nombre), pero ya no se
// ofrecen al invitar.

export const ROLE_LABEL = {
  propietario: 'Propietario',
  admin: 'Propietario',
  supervisor: 'Supervisor',
  contador: 'Contador',
  auditor: 'Auditor',
  empleado: 'Colaborador',
  marcador: 'Reloj de sucursal'
}

export const roleLabel = (role) => ROLE_LABEL[role] || role

// Roles que se pueden dar al invitar, con una frase para entender cada uno.
export const INVITE_ROLES = [
  { value: 'propietario', label: 'Propietario', help: 'Dueño o co-dueño: ve y maneja todo en la empresa.' },
  { value: 'empleado', label: 'Colaborador', help: 'Registra pagos, marca su asistencia y ve su horario.' },
  { value: 'marcador', label: 'Reloj de sucursal', help: 'Cuenta del teléfono o tableta de una sucursal: solo detecta la entrada y salida de los colaboradores.' }
]
