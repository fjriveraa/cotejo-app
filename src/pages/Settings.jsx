import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import {
  isBiometricSupported, isBiometricEnabled, enableBiometricLock, disableBiometricLock
} from '../lib/biometric'

const DELETE_CONFIRM_WORD = 'ELIMINAR'

export default function Settings() {
  const { user, signOut } = useAuth()
  const showToast = useToast()

  const [preview, setPreview] = useState(null)
  const [loadingPreview, setLoadingPreview] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const [biometricOn, setBiometricOn] = useState(false)
  const [biometricBusy, setBiometricBusy] = useState(false)

  useEffect(() => {
    loadPreview()
    isBiometricSupported().then(setBiometricAvailable)
    setBiometricOn(isBiometricEnabled())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadPreview() {
    setLoadingPreview(true)
    const { data, error } = await supabase.rpc('get_account_deletion_preview')
    setLoadingPreview(false)
    if (!error && data) setPreview(data)
  }

  async function handleToggleBiometric() {
    if (biometricBusy) return
    setBiometricBusy(true)
    try {
      if (biometricOn) {
        disableBiometricLock()
        setBiometricOn(false)
        showToast('Bloqueo con Face ID / huella desactivado')
      } else {
        const ok = await enableBiometricLock()
        if (ok) {
          setBiometricOn(true)
          showToast('Bloqueo activado — se pedirá al abrir la app', { tone: 'success' })
        } else {
          showToast('No se pudo verificar tu identidad — inténtalo de nuevo', { tone: 'error' })
        }
      }
    } finally {
      setBiometricBusy(false)
    }
  }

  // La lista de organizaciones bloqueantes (donde la persona es la única
  // propietaria activa) es lo que más importa mostrar ANTES de que intente
  // borrar -- si se entera hasta que la Edge Function le devuelve el error,
  // ya gastó el gesto de escribir "ELIMINAR" para nada.
  const blocking = preview?.blocking_organizations || []
  const orgs = preview?.organizations || []

  async function handleDelete() {
    setDeleteError(null)
    setDeleting(true)
    try {
      const { data, error } = await supabase.functions.invoke('delete-account')
      if (error) {
        // supabase-js no siempre expone el body del error en `error.message`
        // para respuestas non-2xx de una Edge Function -- lo leemos aparte.
        let message = error.message
        try {
          const body = await error.context?.json?.()
          if (body?.error) message = body.error
        } catch {
          // sin body legible, nos quedamos con el mensaje genérico
        }
        throw new Error(message || 'No se pudo eliminar la cuenta')
      }
      if (data?.error) throw new Error(data.error)

      showToast('Tu cuenta fue eliminada', { tone: 'success' })
      await signOut()
    } catch (err) {
      setDeleteError(err.message || 'No se pudo eliminar la cuenta')
      setDeleting(false)
    }
  }

  return (
    <div className="container">
      <h2 style={{ marginTop: 0 }}>Ajustes</h2>
      <p style={{ opacity: 0.7, fontSize: 14, marginTop: -8, marginBottom: 24 }}>
        Conectado como {user?.email}
      </p>

      {biometricAvailable && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Seguridad</div>
          <p style={{ fontSize: 13, opacity: 0.7, marginTop: 0, marginBottom: 12 }}>
            Pide Face ID / Touch ID (o tu huella) cada vez que abras Cotejo en este teléfono.
          </p>
          <button type="button" className="btn btn-secondary" onClick={handleToggleBiometric} disabled={biometricBusy}>
            {biometricOn ? 'Desactivar bloqueo biométrico' : 'Activar bloqueo biométrico'}
          </button>
        </div>
      )}

      <div className="card" style={{ borderColor: 'rgba(185, 28, 28, 0.3)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#B91C1C', marginBottom: 4 }}>Zona de peligro</div>

        {loadingPreview ? (
          <p style={{ fontSize: 13, opacity: 0.6 }}>Revisando tu cuenta...</p>
        ) : blocking.length > 0 ? (
          <>
            <p style={{ fontSize: 13, marginTop: 0, marginBottom: 8 }}>
              No puedes eliminar tu cuenta todavía: eres la única persona propietaria en{' '}
              <strong>{blocking.map((b) => b.name).join(', ')}</strong>. Agrega otro propietario o transfiere la
              empresa desde <em>Mi empresa → Equipo</em> antes de continuar — de lo contrario esa empresa se
              quedaría sin nadie que pueda administrarla.
            </p>
          </>
        ) : !confirming ? (
          <>
            <p style={{ fontSize: 13, opacity: 0.7, marginTop: 0, marginBottom: 12 }}>
              Esto elimina tu acceso a Cotejo por completo{orgs.length > 0 ? ` y a las ${orgs.length === 1 ? 'empresa' : `${orgs.length} empresas`} donde participas` : ''}.
              Es permanente y no se puede deshacer. Tu historial de pagos ya registrados se conserva (no se borra),
              pero tu cuenta deja de poder acceder a él.
            </p>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ color: '#B91C1C', borderColor: 'rgba(185, 28, 28, 0.4)' }}
              onClick={() => setConfirming(true)}
            >
              Eliminar mi cuenta
            </button>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, marginTop: 0, marginBottom: 8 }}>
              Para confirmar, escribe <strong>{DELETE_CONFIRM_WORD}</strong>:
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={DELETE_CONFIRM_WORD}
                style={{ flex: '1 1 200px' }}
              />
              <button
                className="btn btn-amber"
                disabled={deleting || confirmText.trim().toUpperCase() !== DELETE_CONFIRM_WORD}
                onClick={handleDelete}
              >
                {deleting ? 'Eliminando...' : 'Eliminar definitivamente'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => { setConfirming(false); setConfirmText(''); setDeleteError(null) }}
                disabled={deleting}
              >
                Cancelar
              </button>
            </div>
            {deleteError && <p className="error-text" style={{ marginTop: 8, marginBottom: 0 }}>{deleteError}</p>}
          </>
        )}
      </div>
    </div>
  )
}
