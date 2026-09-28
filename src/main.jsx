import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './hooks/useAuth.jsx'
import { ToastProvider } from './hooks/useToast.jsx'
import './index.css'

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
