import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './hooks/useAuth.jsx'
import { ToastProvider } from './hooks/useToast.jsx'
import { isNativeApp } from './lib/appUrl'
import './index.css'

// En la app nativa no se permite el zoom de la página: un toque accidental al
// escribir en un campo dejaba la pantalla ampliada sin forma de volver.
if (isNativeApp()) {
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0')
}

// Se registra apenas carga la app -- sin esto no hay dónde recibir un evento
// push ni mostrar la notificación cuando la pestaña está cerrada. No hace
// falta esperar a que alguien lo pida: registrar el service worker no pide
// permiso de notificaciones por sí solo, eso queda para cuando la persona
// activa push desde el menú.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('No se pudo registrar el service worker', err)
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
)
