# Cotejo — App (Fase 2)

App real React + Vite conectada al proyecto Supabase **COTEJO** (`leprvnyswebmuohvvabd`), siguiendo el mismo patrón que FiguSwitch: React/Vite + Supabase + Vercel + GitHub.

## Qué incluye esta fase

- Login real con Supabase Auth (email + contraseña).
- Vista de **empleado** (Marta) para registrar comprobantes: sube evidencia al bucket privado `evidence`, inserta en `payment_records` con `verification_status = 'pending'`.
- Vista de **contadora** (Ana) con cola de pagos pendientes agrupada por banco/cuenta, con acciones que llaman **exclusivamente** a las funciones RPC ya blindadas en la base de datos (nunca UPDATE directo):
  - `confirm_payment`
  - `mark_under_review`
  - `mark_not_found` (pide motivo)
  - `void_as_duplicate` (pide el ID del pago original)
- Control de concurrencia optimista: cada acción envía `p_expected_version` con la versión actual del registro.

## Cómo correr localmente

```bash
npm install
cp .env.example .env.local   # ya trae la URL y la publishable key del proyecto COTEJO
npm run dev
```

## Usuarios de prueba (ya sembrados en la base de datos)

- **Marta (empleado):** amdreaosorio95@hotmail.com
- **Ana (contadora):** fernando_mar15@hotmail.com

(Las contraseñas las definió el usuario directamente en Supabase Auth.)

## Desplegar (patrón FiguSwitch)

1. Crear un repositorio nuevo en GitHub (ej. `cotejo-app`) y subir este código.
2. Importar el repo en Vercel.
3. En Vercel, configurar las variables de entorno:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy. Framework preset: Vite.

## Siguientes fases (no incluidas todavía)

- UI de notificaciones (tabla `notifications` ya existe con fanout por rol).
- UI de comparación de posibles duplicados.
- Integración de IA/OCR vía Edge Function (Fase 5 del brief).
- Piloto interno en FARO HN (Fase 6).

Desplegado en Vercel el 2026-09-25 11:07 hora Honduras.
