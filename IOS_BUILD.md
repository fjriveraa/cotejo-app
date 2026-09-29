# Cotejo en iOS (App Store) — guía paso a paso

Este archivo es la continuación de lo que se preparó desde la sesión en la nube
(que no tiene acceso a npm ni a Xcode). Todo lo de aquí en adelante corre en tu
Mac.

## Ya preparado en el repo (no lo repitas)

- `capacitor.config.json` — `appId: net.cotejo.app`, `appName: Cotejo`, `webDir: dist`.
- `package.json` — dependencias de Capacitor agregadas (`@capacitor/core`,
  `@capacitor/ios`, `@capacitor/app`, `@capacitor/cli`, `@capacitor/assets`) y
  scripts `ios:sync` / `ios:open`.
- `resources/icon.png` (1024×1024, sin transparencia) y `resources/splash.png`
  (2732×2732) — un ícono/splash de arranque generados a partir del logo actual
  (`public/logo-mark.png`). Es un borrador funcional; si tienes una versión más
  nítida o vectorial del logo, reemplaza estos dos archivos antes de generar los
  íconos finales (paso 4).

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
```

Sin estas dos líneas, la app truena al pedir la cámara/galería y Apple la
rechaza en revisión.

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

## 11. Enviar a revisión

En App Store Connect, dentro de la versión: selecciona el build subido,
completa lo que falte, y **Enviar para revisión**.

## Dos cosas a tener en cuenta

**Notificaciones push:** Cotejo hoy usa Web Push (VAPID) para las
notificaciones del navegador. Dentro de la app nativa empacada con Capacitor,
ese mecanismo generalmente **no funciona igual** — para push nativo real hace
falta el plugin `@capacitor/push-notifications` más un certificado/key de
APNs configurado en el Developer portal. Es trabajo aparte; si quieres, lo
armamos en una siguiente vuelta una vez que la app básica esté aprobada.

**Riesgo de rechazo (guideline 4.2, "funcionalidad mínima"):** Apple a veces
rechaza apps que se sienten como "solo un sitio web metido en una app". Cotejo
ya tiene bastante funcionalidad propia (cámara, subida de archivos, flujos de
aprobación) que ayuda, pero si la rechazan por esto, algunas mejoras rápidas
que lo refuerzan: desbloqueo con Face ID/Touch ID al abrir la app
(`@capacitor/biometric`), compartir nativo de reportes
(`@capacitor/share`), o haptics en confirmaciones (`@capacitor/haptics`).
