import Spinner from './Spinner'
import { isNativeApp } from '../lib/appUrl'

// Separador "o" + botones de Google (web y app) y Apple (solo app nativa,
// donde Apple lo exige si se ofrece Google).
export default function SocialButtons({ onGoogle, onApple, loading, googleLabel = 'Continuar con Google', appleLabel = 'Continuar con Apple' }) {
  const native = isNativeApp()
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0', fontSize: 12, opacity: 0.6 }}>
        <div style={{ flex: 1, height: 1, background: 'currentColor', opacity: 0.3 }} />
        o
        <div style={{ flex: 1, height: 1, background: 'currentColor', opacity: 0.3 }} />
      </div>
      <button
        type="button"
        className="btn btn-secondary"
        style={{ width: '100%' }}
        onClick={onGoogle}
        disabled={loading}
      >
        {loading && <Spinner />}{loading ? 'Conectando...' : googleLabel}
      </button>
      {native && (
        <button
          type="button"
          onClick={onApple}
          disabled={loading}
          style={{
            width: '100%',
            marginTop: 8,
            padding: '12px 16px',
            borderRadius: 8,
            border: '1px solid #000',
            background: '#000',
            color: '#fff',
            fontFamily: 'inherit',
            fontSize: 15,
            fontWeight: 600,
            cursor: 'pointer',
            opacity: loading ? 0.6 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8
          }}
        >
          <svg width="16" height="18" viewBox="0 0 814 1000" fill="#fff" aria-hidden="true">
            <path d="M788 341c-6 5-109 63-109 192 0 150 131 203 135 204-1 3-21 72-69 142-43 62-88 124-156 124s-86-40-165-40c-77 0-104 41-167 41s-106-58-156-129C46 770 0 646 0 529c0-190 124-291 245-291 64 0 118 42 158 42 38 0 98-45 171-45 28 0 128 3 193 96zM554 159c30-36 51-86 51-136 0-7-1-14-2-20-48 2-106 32-141 73-27 31-53 82-53 133 0 8 1 15 2 17 3 1 8 1 12 1 43 0 97-29 131-68z" />
          </svg>
          {appleLabel}
        </button>
      )}
    </>
  )
}
