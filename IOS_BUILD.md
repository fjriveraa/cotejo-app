# Cotejo en iOS (App Store) — guía paso a paso

Este archivo es la continuación de lo que se preparó desde la sesión en la nube
(que no tiene acceso a npm ni a Xcode). Todo lo de aquí en adelante corre en tu
Mac.

## Ya preparado en el repo (no lo repitas)

- `capacitor.config.json` — `appId: net.cotejo.app`, `appName: Cotejo`, `webDir: dist`.
- `package.json` — dependencias de Capacitor agregadas (`@capacitor/core`,
  `@capacitor/ios`, `@capacitor/app`, `@capacitor/cli`, `@capacitor/assets`,
  `@capacitor/filesystem`, `@capacitor/share`, `@capgo/capacitor-native-biometric`)
  y scripts `ios:sync` / `ios:open`.
- `resources/icon.png` (1024×1024, sin transparencia) y `resources/splash.png`
  (2732×2732) — un ícono/splash de arranque generados a partir del logo actual
  (`public/logo-mark.png`). Es un borrador funcional; si tienes una versión más
  nítida o vectorial del logo, reemplaza estos dos archivos antes de generar los
  íconos finales (paso 4).
- **Eliminación de cuenta** (`/ajustes` → "Zona de peligro") — obligatorio
  para pasar revisión (guideline 5.1.1(v), ver abajo). Ya implementado de
  punta a punta: RPCs `get_account_deletion_preview` / `request_account_deletion`
  + Edge Function `delete-account` + UI.
- **Bloqueo con Face ID/Touch ID** (`/ajustes` → "Seguridad") — usa
  `@capgo/capacitor-native-biometric`, ya integrado y gateado a
  `Capacitor.isNativePlatform()` (no hace nada en la web).
- **Export de Excel arreglado para nativo** — `src/lib/exportExcel.js` ahora
  detecta `Capacitor.isNativePlatform()` y, en vez de la descarga de
  navegador (que no funciona dentro de un WKWebView empacado), escribe el
  archivo con `@capacitor/filesystem` y abre la hoja nativa de compartir con
  `@capacitor/share`.
- **Notificaciones push nativas** — el botón "Activar notificaciones push"
  del menú ahora usa `@capacitor/push-notifications` dentro de la app nativa
  (en la web sigue usando Web Push/VAPID igual que antes). El token del
  dispositivo se guarda en la tabla `push_device_tokens`, y
  `send-push-notification` (Edge Function) ya manda por APNs además de Web
  Push -- pero **solo si configuras la key de Apple** (paso 6.1 abajo); si no
  la configuras, todo sigue funcionando igual que hoy, simplemente sin push
  nativo.

## 1. Requisitos en tu Mac

- Xcode (App Store) — la versión más reciente.
- CocoaPods: `sudo gem install cocoapods` (o `brew install cocoapods`).
- Node.js 18+ y npm.
- Haber aceptado el acuerdo de licencia de Xcode al menos una vez (ábrelo una
  vez y acepta si pide algo).

## 2. Traer el código y las dependencias

```bash
git clone https://github.com/fjriveraa/cotejo-app
cd cotejo-app
npm install
```

## 3. Agregar la plataforma iOS

```bash
npx cap add ios
```

Esto crea la carpeta `ios/` con el proyecto de Xcode (no existe todavía en el
repo porque hace falta correr esto con las dependencias instaladas).

## 4. Generar íconos y splash screen para todos los tamaños

```bash
npx @capacitor/assets generate --ios
```

Lee `resources/icon.png` y `resources/splash.png` y genera automáticamente
todos los tamaños que pide Apple (dispositivo, notificación, Spotlight, etc.)
dentro de `ios/App/App/Assets.xcassets`.

## 5. Compilar el sitio y sincronizar con el proyecto nativo

```bash
npm run ios:sync
```

Corre `vite build` y copia el resultado (`dist/`) al proyecto de Xcode. Vas a
repetir este comando cada vez que haya cambios en el código antes de volver a
compilar en Xcode.

## 6. Permisos nativos (importante — sin esto, Apple rechaza la app)

Cotejo deja subir fotos de comprobantes desde la cámara o la galería. Abre
`ios/App/App/Info.plist` y agrega (Xcode > clic derecho en Info.plist > Open
As > Source Code, o edítalo como texto):

```xml
<key>NSCameraUsageDescription</key>
<string>Cotejo usa la cámara para tomar fotos de comprobantes de pago.</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>Cotejo necesita acceso a tus fotos para adjuntar comprobantes de pago.</string>
<key>NSFaceIDUsageDescription</key>
<string>Cotejo usa Face ID para bloquear la app cuando activas esa opción en Ajustes.</string>
```

Sin estas líneas, la app truena al pedir la cámara/galería/Face ID y Apple la
rechaza en revisión.

### 6.1 Activar el capability de Push Notifications

Dentro de Xcode (paso 7): selecciona el proyecto `App` → pestaña **Signing &
Capabilities** → **+ Capability** → agrega **Push Notifications**. Sin esto,
el permiso de notificaciones nunca aparece aunque el código ya esté listo.

### 6.2 Generar la key de APNs (para que el push nativo realmente envíe)

Sin este paso, el botón "Activar notificaciones push" va a funcionar (pide
permiso, guarda el token), pero nadie va a recibir nada — `send-push-notification`
detecta que falta la key y simplemente no intenta mandar por APNs, sin
romper nada más.

1. En [developer.apple.com/account](https://developer.apple.com/account) →
   **Certificates, Identifiers & Profiles** → **Keys** → **+**.
2. Nombre: `Cotejo Push`. Marca **Apple Push Notifications service (APNs)**.
   Continuar → Registrar → **Descargar** (el archivo `.p8` solo se puede
   descargar una vez — guárdalo bien).
3. Anota el **Key ID** (aparece junto al nombre de la key) y tu **Team ID**
   (arriba a la derecha en el portal, o en **Membership**).
4. En el proyecto de Supabase (`leprvnyswebmuohvvabd`) → **Edge Functions** →
   **Manage secrets**, agrega:
   - `APNS_KEY_ID` — el Key ID del paso 3.
   - `APNS_TEAM_ID` — tu Team ID.
   - `APNS_BUNDLE_ID` — `net.cotejo.app` (o el que hayas usado si lo cambiaste).
   - `APNS_PRIVATE_KEY` — el contenido completo del archivo `.p8` que
     descargaste, tal cual (con las líneas `-----BEGIN PRIVATE KEY-----` /
     `-----END PRIVATE KEY-----`).
   - `APNS_USE_SANDBOX` — déjalo sin configurar (o `false`) para builds de
     App Store/TestFlight. Solo ponlo en `true` si vas a probar push desde
     un build de desarrollo/debug instalado directo desde Xcode (esos usan
     el entorno sandbox de Apple, no el de producción).
5. No hace falta redesplegar nada — la Edge Function ya está lista y lee
   estas variables en cada llamada.

## 7. Abrir en Xcode y configurar la firma

```bash
npm run ios:open
```

Dentro de Xcode:
1. Selecciona el proyecto `App` en el panel izquierdo → pestaña **Signing &
   Capabilities**.
2. En **Team**, elige tu cuenta de Apple Developer.
3. Confirma que el **Bundle Identifier** sea `net.cotejo.app` (debe coincidir
   con el que registres en el paso 8). Si prefieres otro (ej. `com.faro.cotejo`),
   cámbialo aquí y también en `capacitor.config.json`, luego vuelve a correr
   `npm run ios:sync`.
4. En **Version**/**Build**, pon la versión inicial (ej. `1.0.0` / `1`).

## 8. Registrar la app en App Store Connect

En [appstoreconnect.apple.com](https://appstoreconnect.apple.com):
1. **Mis apps** → **+** → **Nueva app**.
2. Plataforma: iOS. Nombre: **Cotejo**. Idioma principal: Español.
3. Bundle ID: el mismo `net.cotejo.app` (Apple te deja crearlo ahí mismo si
   aún no existe en tu cuenta de Developer, o créalo antes en **Certificates,
   Identifiers & Profiles**).
4. SKU: cualquier identificador interno, ej. `cotejo-ios-1`.

Ahí mismo vas a necesitar, antes de poder enviarla a revisión:
- **Capturas de pantalla** por tamaño de dispositivo (mínimo iPhone 6.7" —
  puedes tomarlas del simulador de Xcode).
- **Descripción, palabras clave, categoría** (sugerido: Negocios o Finanzas).
- **Política de privacidad** — ya la tienes publicada en
  `https://cotejo.net/privacy.html`, solo pon esa URL.
- **Cuestionario de privacidad (App Privacy)** — declara qué datos recolecta
  la app: datos de contacto (nombre/teléfono de quien sube el comprobante),
  información financiera (montos, referencias bancarias en las fotos de
  comprobantes), fotos/imágenes. Todo vinculado a la cuenta de la empresa, no
  se vende ni se usa para publicidad.

## 9. Compilar, archivar y subir

En Xcode:
1. Arriba, selecciona el destino **Any iOS Device (arm64)** (no un simulador).
2. **Product → Archive**. Cuando termine, se abre el **Organizer**.
3. **Distribute App → App Store Connect → Upload**. Sigue el asistente
   (firma automática está bien si ya configuraste el Team en el paso 7).
4. Espera 5–15 min a que el build aparezca disponible en App Store Connect
   (pestaña **TestFlight** o **Compilación** dentro de la versión).

## 10. Probar antes de enviar a revisión (recomendado)

Antes del envío final, invita a alguien del equipo por **TestFlight** (dentro
de App Store Connect, pestaña TestFlight → agregar probador interno con su
Apple ID) y confirma que:
- Entra y ve el login/dashboard normal.
- Puede subir un comprobante desde cámara y desde galería (aquí es donde
  fallaría si el paso 6 quedó incompleto).
- Los links `/g/:linkCode` de Grupos abren bien dentro de la app.
- Activar el bloqueo biométrico en Ajustes, cerrar y reabrir la app: debe
  pedir Face ID/Touch ID antes de mostrar cualquier pantalla.
- Generar un reporte en Excel desde Reportes: debe abrir la hoja nativa de
  compartir (no debe quedarse sin hacer nada).
- Probar "Eliminar mi cuenta" en Ajustes con una cuenta de prueba que NO sea
  la única propietaria de ninguna empresa, para confirmar que el flujo
  completo funciona antes de que un revisor de Apple lo intente.
- Si ya configuraste la key de APNs (paso 6.2): activar push desde el menú,
  y desde otro dispositivo/cuenta generar una notificación real (ej. enviar
  un comprobante de invitado) para confirmar que llega y que el tap abre la
  pantalla correcta.

## 11. Enviar a revisión

En App Store Connect, dentro de la versión: selecciona el build subido,
completa lo que falte, y **Enviar para revisión**.

## Puntos de revisión de Apple — qué ya está cubierto y qué falta

**Guideline 5.1.1(v) — Eliminación de cuenta (obligatorio, ya resuelto).**
Apple exige textualmente: *"If your app supports account creation, you must
also offer account deletion within the app."* Cotejo crea cuentas dentro de
la misma app (`Signup.jsx`), así que este punto es de cumplimiento
obligatorio — ya está implementado en `/ajustes`. Ojo: si la persona es la
única propietaria activa de alguna empresa, el borrado se bloquea con un
mensaje explicando por qué (para no dejar esa empresa huérfana) — es
comportamiento esperado, no un bug, pero vale la pena probarlo con una
cuenta de prueba que SÍ pueda borrarse antes de enviar a revisión.

**Guideline 3.1.1 / 3.1.3(c) — Compras y "Enterprise Services".** Cotejo hoy
solo vende suscripciones fuera de la app (no tiene Apple In-App Purchase).
Para una app de consumo eso sería motivo de rechazo, pero Apple tiene una
excepción textual para B2B: *"If your app is only sold directly by you to
organizations or groups for their employees or students... you may allow
enterprise users to access previously-purchased content or subscriptions.
Consumer, single user, or family sales must use in-app purchase."* Cotejo se
vende a empresas (no a consumidores individuales), así que debería calificar
— pero **no lo des por hecho sin más**: en el campo "Notas para el revisor"
de App Store Connect (paso 8), cita explícitamente la guideline 3.1.3(c) y
explica en 2-3 líneas que Cotejo es una herramienta B2B vendida directamente
a empresas para su equipo interno, no una suscripción de consumidor. Da
también una **cuenta de demo** (usuario + contraseña) en esas notas para que
el revisor pueda entrar sin fricción — muchos rechazos de apps B2B pasan
simplemente porque el revisor no pudo entrar a probar nada.

**Guideline 4.2 — "Funcionalidad mínima" / no ser solo un sitio web
empacado.** Cotejo ya tiene bastante funcionalidad nativa propia que ayuda
acá: cámara/galería para comprobantes, flujos de aprobación con roles,
bloqueo con Face ID/Touch ID, compartir nativo del reporte Excel, y
notificaciones push nativas (una vez configures la key de APNs en el paso
6.2). Si aun así lo rechazan por esto, la siguiente mejora más efectiva
sería haptics en confirmaciones (`@capacitor/haptics`).

**Notificaciones push:** ya está integrado el plugin
`@capacitor/push-notifications` (el botón del menú lo usa automáticamente
dentro de la app nativa). Lo único que falta de tu lado es generar la key de
APNs y configurarla en Supabase — paso 6.2 arriba. Sin ese paso, el botón
funciona pero nadie recibe nada; con él, `send-push-notification` manda por
Web Push y APNs a la vez, sin duplicar (cada persona recibe según en qué
tenga activado el permiso).

**Guideline 4.8 — Sign in with Apple.** Solo es obligatorio cuando la
*única* forma de crear cuenta es un login social de terceros (Google,
Facebook, etc.) sin alternativa. Cotejo ofrece **email/contraseña
(`signUpWithPassword`) además de** "Continuar con Google" en `Signup.jsx` —
como el email/contraseña pide solo nombre y correo, deja que la persona
decida qué correo usar, y Cotejo no hace tracking publicitario, esa
alternativa ya cumple los tres criterios que Apple pide. **No hace falta
agregar Sign in with Apple** mientras el email/contraseña siga siendo una
opción visible en el login y el signup — no lo quites ni lo escondas detrás
de Google sin darte cuenta en un rediseño futuro.

**Privacy Manifest (`PrivacyInfo.xcprivacy`) — obligatorio desde 2024, no
verificado aún.** Apple exige que cada app (y cada SDK de terceros que use
"Required Reason APIs" — UserDefaults, timestamps de archivos, espacio en
disco, etc.) declare por qué las usa, o el build puede ser rechazado
**automáticamente en la subida** (antes de llegar a revisión humana) con un
error tipo `ITMS-91053`/`ITMS-91055`. Los plugins de Capacitor de primera
línea (`@capacitor/filesystem`, `@capacitor/share`, `@capacitor/push-notifications`,
`@capacitor/app`) en versiones recientes ya traen su propio
`PrivacyInfo.xcprivacy` embebido, así que probablemente no haga falta nada
manual — pero **confírmalo la primera vez que subas el build**: si Xcode o
App Store Connect marcan un plugin sin manifiesto, hay que revisar qué API
"Required Reason" usa y declararla (la guía de Capacitor lo explica:
https://capacitorjs.com/docs/v6/ios/privacy-manifest). No se puede verificar
esto desde la sesión en la nube porque necesita Xcode/el proceso real de
subida — queda pendiente para cuando hagas el paso 9.

**App Tracking Transparency (ATT) — no aplica.** Cotejo no tiene SDKs de
publicidad ni de tracking entre apps, así que no debería pedir el permiso de
ATT. Si en el futuro se agrega algún SDK de analítica/marketing que
comparta datos entre apps, ahí sí habría que agregar el prompt de ATT
(`@capgo/capacitor-app-tracking-transparency` o similar) antes de subir.

**Checklist rápido antes de enviar a revisión (con base en investigación de
los motivos de rechazo más comunes en 2026):**
- [ ] Cuenta de demo lista y probada en las notas del revisor (ver más abajo
      — ya se creó `revisor@cotejo.net`).
- [ ] Notas del revisor citan 3.1.3(c) y explican que Cotejo es B2B (arriba).
- [ ] Capturas de pantalla reales del dispositivo (no del sitio web en
      escritorio) — mínimo 6.9" o 6.7", ver sección de capturas más abajo.
- [ ] Política de privacidad accesible y el **cuestionario de App Privacy**
      (paso 8) coincide exactamente con lo que la app realmente recolecta —
      Apple compara ambos y un desajuste es causa común de rechazo (2.3.1 /
      5.1.1).
- [ ] Descripción y palabras clave no prometen nada que la app no hace
      todavía (1.1.6) ni repiten palabras clave sin sentido (4.5.6).
- [ ] Probar el flujo completo de eliminación de cuenta con una cuenta que sí
      pueda borrarse (ya cubierto en la sección 10 arriba).
- [ ] Confirmar que la build no truena al abrir sin conexión ni en el primer
      arranque sin sesión — un crash reproducible en el primer intento es el
      motivo de rechazo #1 según Apple (guideline 2.1).
- [ ] Revisar que no quede ningún texto/botón de "en construcción",
      placeholder o feature a medio hacer visible (2.3.1 — funcionalidad
      oculta o incompleta).
- [ ] Confirmar `PrivacyInfo.xcprivacy` sin advertencias al archivar (arriba).

## Inicio de sesión nativo con Google y Apple (rama native-social-login)

Código: `src/lib/nativeAuth.js` + `src/components/SocialButtons.jsx`. En la app
se abre la hoja nativa y se canjea el id_token con `supabase.auth.signInWithIdToken`.
La web sigue con el OAuth normal de Google (sin botón de Apple).

Configuración fuera del código:
- Google Cloud: cliente OAuth tipo iOS (bundle `net.cotejo.app`). Su ID está en `nativeAuth.js`.
- Supabase -> Authentication -> Providers: Google (agregar el ID iOS a *Authorized Client IDs* y activar *Skip nonce checks*); Apple (Client IDs = `net.cotejo.app`).
- Xcode: capability *Sign in with Apple*.
- Info.plist: URL scheme con el ID de cliente invertido:
  `com.googleusercontent.apps.586447784686-skt0bs8i37gaicpuci7a6eqp3v70nt7b`
