import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { getCanonicalOrigin } from '../lib/appUrl'
import { groupImageUrl, compressImage, MAX_GROUP_IMAGES } from '../lib/groupImages'
import { fetchGroupReport, reportToPng, reportToPdf, reportToXlsx, reportFilename, saveOrShareFile } from '../lib/groupReport'
import { SkeletonPaymentList } from '../components/Skeleton'
import Loading from '../components/Loading'

// Palabras que ayudan a reconocer qué columna es cuál en un Excel/CSV con
// encabezados. Si no se reconoce ninguna, se asume el mismo orden que ya
// usa el pegado manual: nombre, identificador, monto.
const NAME_HEADER_RE = /nombre|name/i
const IDENTIFIER_HEADER_RE = /identificador|depto|apart|unidad|local|salon|salón|grado|equipo|casa|lote/i
const AMOUNT_HEADER_RE = /monto|renta|cuota|amount|pago|esperado/i

// Convierte filas ya parseadas (de Excel/CSV o de la lectura por IA de una
// imagen) al mismo formato de texto "nombre, identificador, monto" que ya
// usa el textarea de pegado manual -- así el admin revisa/corrige todo en
// un solo lugar antes de confirmar la importación, sin importar de dónde
// vino cada fila.
function rowsToText(rows) {
  return rows
    .map((r) => {
      // El monto solo se puede poner en la 3ra posición, así que si hay monto pero no
      // identificador, se deja ese hueco vacío en vez de correr el monto a la 2da posición.
      if (r.amount != null) return `${r.name}, ${r.identifier || ''}, ${r.amount}`
      if (r.identifier) return `${r.name}, ${r.identifier}`
      return r.name
    })
    .join('\n')
}

function parseSpreadsheetFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
    reader.onload = () => {
      try {
        const data = new Uint8Array(reader.result)
        const wb = XLSX.read(data, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
        if (grid.length === 0) return resolve([])

        // ¿La primera fila es un encabezado reconocible, o ya es una persona?
        const firstRow = grid[0].map((c) => String(c || ''))
        let nameIdx = firstRow.findIndex((c) => NAME_HEADER_RE.test(c))
        let idIdx = firstRow.findIndex((c) => IDENTIFIER_HEADER_RE.test(c))
        let amountIdx = firstRow.findIndex((c) => AMOUNT_HEADER_RE.test(c))
        const hasHeader = nameIdx !== -1
        const dataRows = hasHeader ? grid.slice(1) : grid
        if (!hasHeader) { nameIdx = 0; idIdx = 1; amountIdx = 2 }

        const rows = dataRows
          .map((r) => {
            const name = String(r[nameIdx] ?? '').trim()
            if (!name) return null
            const identifier = idIdx !== -1 ? String(r[idIdx] ?? '').trim() : ''
            const rawAmount = amountIdx !== -1 ? r[amountIdx] : ''
            const amount = rawAmount !== '' && Number.isFinite(Number(rawAmount)) ? Number(rawAmount) : null
            return { name, identifier: identifier || null, amount }
          })
          .filter(Boolean)
        resolve(rows)
      } catch (err) {
        reject(err)
      }
    }
    reader.readAsArrayBuffer(file)
  })
}

const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

// "2026-09" -> "septiembre 2026"
function formatPeriodLabel(period) {
  if (!period) return period
  const [year, month] = period.split('-')
  const name = MONTH_NAMES[Number(month) - 1]
  return name ? `${name} ${year}` : period
}

// Racha de pagos de una persona -- mismo lenguaje visual que las bolitas W/D/L de "forma
// reciente" en FiguSwitch: de un vistazo se ve el patrón (quién falla seguido) sin tener que
// abrir el historial mes por mes. Verde = pagó, rojo = no pagó, gris = todavía no estaba en
// el grupo ese mes (nunca se marca como "no pagó" a alguien que ni existía).
function PaymentStreak({ history }) {
  if (!history || history.length <= 1) return null
  return (
    <div style={{ display: 'flex', gap: 3, marginTop: 4 }} title="Racha de pagos, mes a mes (más reciente a la derecha)">
      {history.map((h) => (
        <span
          key={h.period}
          title={`${formatPeriodLabel(h.period)}${h.paid === null ? ': todavía no estaba en el grupo' : h.paid ? ': pagó' : ': no pagó'}`}
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            display: 'inline-block',
            background: h.paid === null ? '#e5e7eb' : h.paid ? '#2B6459' : '#B91C1C'
          }}
        />
      ))}
    </div>
  )
}

// Sección de un mes anterior en el historial -- colapsada por defecto si ya se completó
// (todos pagaron), abierta si a alguien le falta, igual que las fases del mundial en
// FiguSwitch (una fase se colapsa sola solo cuando ya se jugó completa). La lista de
// integrantes de ese mes se carga solo al abrir la sección, no de una vez con todo lo demás.
function MonthHistorySection({ groupId, period, paidCount, totalCount, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen)
  const [members, setMembers] = useState(null)
  const [loading, setLoading] = useState(false)

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && members === null) {
      setLoading(true)
      const { data } = await supabase.rpc('list_payment_group_members', { p_group_id: groupId, p_period: period })
      setLoading(false)
      setMembers(data || [])
    }
  }

  const complete = totalCount > 0 && paidCount >= totalCount

  return (
    <div style={{ marginBottom: 8, background: '#fff', border: `1px solid ${complete ? '#e5e7eb' : '#f3c9c9'}`, borderRadius: 12, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={toggle}
        style={{ width: '100%', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' }}
      >
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, textTransform: 'capitalize' }}>{formatPeriodLabel(period)}</span>
        <span style={{ fontSize: 12, opacity: 0.65 }}>{paidCount}/{totalCount} pagaron</span>
        <span style={{ fontSize: 11, opacity: 0.5 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 14px 12px' }}>
          {loading && <Loading label="Cargando" small />}
          {members && members.length === 0 && <p style={{ fontSize: 12, opacity: 0.6 }}>Nadie en la lista ese mes.</p>}
          {members && members.map((m) => (
            <div key={m.member_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderTop: '1px solid #f1f1f1' }}>
              <span style={{ fontSize: 13 }}>{m.display_name}{m.identifier ? ` · ${m.identifier}` : ''}</span>
              <span style={{ fontSize: 12, opacity: 0.7 }}>
                {m.paid ? `✓ L ${Number(m.paid_amount).toLocaleString('es-HN', { minimumFractionDigits: 2 })}` : '✗ No pagó'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ViewEvidence({ path }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function open() {
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase.storage.from('guest-evidence').createSignedUrl(path, 300)
    setLoading(false)
    if (fetchError || !data?.signedUrl) {
      setError('No se pudo abrir. Intenta de nuevo.')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  if (!path) return null
  return (
    <span>
      <button type="button" className="btn btn-secondary" onClick={open} disabled={loading} style={{ fontSize: 12, padding: '4px 10px' }}>
        {loading ? 'Abriendo...' : 'Ver comprobante'}
      </button>
      {error && <span style={{ marginLeft: 8, fontSize: 12, color: '#B91C1C' }}>{error}</span>}
    </span>
  )
}

function CopyLink({ link }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard?.writeText(link).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button type="button" className="btn btn-secondary" onClick={copy} style={{ fontSize: 12, padding: '4px 10px' }}>
      {copied ? 'Copiado' : 'Copiar link'}
    </button>
  )
}

// Abre WhatsApp con el mensaje y el enlace listos. Si se pasa un teléfono, va directo a esa persona.
function WhatsAppShare({ link, text, phone, label = 'WhatsApp' }) {
  function send() {
    let digits = String(phone || '').replace(/\D/g, '')
    if (digits.length === 8) digits = `504${digits}`
    const to = digits.length >= 10 ? digits : ''
    const sep = String(text).includes('\n') ? '\n\n' : '\n'
    window.open(`https://wa.me/${to}?text=${encodeURIComponent(`${text}${sep}${link}`)}`, '_blank', 'noopener')
  }
  return (
    <button type="button" className="btn btn-secondary" onClick={send} style={{ fontSize: 12, padding: '4px 10px', color: '#1B7F4B', borderColor: 'rgba(27,127,75,0.5)' }}>
      💬 {label}
    </button>
  )
}

function money(n) {
  return `L ${Number(n).toLocaleString('es-HN', { minimumFractionDigits: 2 })}`
}

function AddMemberForm({ groupId, onAdded }) {
  const [open, setOpen] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [expectedAmount, setExpectedAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (!displayName.trim()) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('add_payment_group_member', {
      p_group_id: groupId,
      p_display_name: displayName.trim(),
      p_identifier: identifier.trim() || null,
      p_expected_amount: expectedAmount ? Number(expectedAmount) : null
    })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    setDisplayName('')
    setIdentifier('')
    setExpectedAmount('')
    setOpen(false)
    onAdded()
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
        + Agregar persona
      </button>
    )
  }

  return (
    <div className="card" style={{ maxWidth: 420, marginBottom: 16 }}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="displayName">Nombre</label>
          <input id="displayName" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="identifier">Identificador (opcional — ej. "Local 4", "Depto 2B")</label>
          <input id="identifier" type="text" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="expectedAmount">Monto esperado (opcional)</label>
          <input id="expectedAmount" type="number" step="0.01" min="0" value={expectedAmount} onChange={(e) => setExpectedAmount(e.target.value)} />
        </div>
        {error && <p className="error-text">{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Agregando...' : 'Agregar'}</button>
          <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancelar</button>
        </div>
      </form>
    </div>
  )
}

// Importa varias personas de un pegado tipo CSV (una por línea:
// nombre,identificador,monto), de un archivo Excel/CSV, o de una foto/
// captura de una lista (la IA la lee). Las tres vías terminan en el mismo
// textarea para que el admin revise y corrija antes de confirmar -- ni el
// parseo del Excel ni la lectura de la IA son perfectos, así que nunca se
// crea a nadie en la lista sin que alguien lo vea primero.
function ImportMembersForm({ groupId, organizationId, onImported }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [fileStatus, setFileStatus] = useState(null) // mensaje de progreso/errores de la carga de archivo
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite volver a elegir el mismo archivo si hace falta reintentar
    if (!file) return
    setError(null)
    setResult(null)

    const isImage = file.type.startsWith('image/')
    const isSpreadsheet = /\.(xlsx|xls|csv)$/i.test(file.name)

    if (!isImage && !isSpreadsheet) {
      setFileStatus('Formato no reconocido. Sube una imagen, o un archivo .xlsx/.xls/.csv.')
      return
    }

    try {
      if (isSpreadsheet) {
        setFileStatus('Leyendo archivo...')
        const rows = await parseSpreadsheetFile(file)
        if (rows.length === 0) {
          setFileStatus('No se encontró ninguna fila con nombre en el archivo.')
          return
        }
        setText((prev) => (prev ? `${prev}\n${rowsToText(rows)}` : rowsToText(rows)))
        setFileStatus(`✓ ${rows.length} persona(s) leídas del archivo. Revisa la lista antes de importar.`)
        return
      }

      // Imagen: se sube primero a Storage (mismo patrón que el comprobante manual)
      // y la Edge Function la lee con IA con el usuario ya autenticado -- no es el
      // formulario público de invitado.
      setFileStatus('Subiendo imagen...')
      const ext = file.name.split('.').pop()
      const path = `${organizationId}/roster-${crypto.randomUUID()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('guest-evidence').upload(path, file)
      if (uploadError) throw uploadError

      setFileStatus('Leyendo la lista con IA...')
      const { data: fnData, error: fnError } = await supabase.functions.invoke('extract-roster-list', { body: { path } })
      if (fnError) throw fnError
      if (fnData?.error) throw new Error(fnData.error)

      const rows = fnData?.members || []
      if (rows.length === 0) {
        setFileStatus('La IA no pudo leer nombres en esa imagen. Prueba con una foto más clara, o pega la lista a mano.')
        return
      }
      setText((prev) => (prev ? `${prev}\n${rowsToText(rows)}` : rowsToText(rows)))
      setFileStatus(`✓ ${rows.length} persona(s) leídas de la imagen. Revisa la lista antes de importar -- la IA puede equivocarse en nombres poco claros.`)
    } catch (err) {
      console.error('Error importando archivo:', err)
      setFileStatus(err.message || 'No se pudo leer el archivo. Prueba con otro, o pega la lista a mano.')
    }
  }

  async function submit(e) {
    e.preventDefault()
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) return
    setBusy(true)
    setError(null)
    setResult(null)
    let ok = 0
    let failed = 0
    for (const line of lines) {
      const [rawName, rawIdentifier, rawAmount] = line.split(',').map((v) => v?.trim())
      if (!rawName) { failed += 1; continue }
      const { error } = await supabase.rpc('add_payment_group_member', {
        p_group_id: groupId,
        p_display_name: rawName,
        p_identifier: rawIdentifier || null,
        p_expected_amount: rawAmount ? Number(rawAmount) : null
      })
      if (error) failed += 1
      else ok += 1
    }
    setBusy(false)
    setResult(`${ok} agregados${failed > 0 ? `, ${failed} con error` : ''}.`)
    setText('')
    setFileStatus(null)
    onImported()
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
        Importar lista
      </button>
    )
  }

  return (
    <div className="card" style={{ maxWidth: 480, marginBottom: 16 }}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="importFile">O sube una foto de la lista, o un archivo Excel/CSV</label>
          <input id="importFile" type="file" accept="image/*,.xlsx,.xls,.csv" onChange={handleFile} />
          {fileStatus && <p style={{ fontSize: 12, marginTop: 4, color: fileStatus.startsWith('✓') ? '#2B6459' : 'inherit', opacity: fileStatus.startsWith('✓') ? 1 : 0.7 }}>{fileStatus}</p>}
        </div>
        <div className="field">
          <label htmlFor="importText">Una persona por línea: nombre, identificador (opcional), monto esperado (opcional)</label>
          <textarea
            id="importText"
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Juan Pérez, Local 4, 1500\nMaría Gómez, Local 5, 1500'}
            required
          />
        </div>
        {error && <p className="error-text">{error}</p>}
        {result && <p style={{ color: '#2B6459', fontSize: 13 }}>{result}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Importando...' : 'Importar'}</button>
          <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cerrar</button>
        </div>
      </form>
    </div>
  )
}

function RegisterPaymentForm({ groupId, organizationId, member, onDone, onCancel }) {
  const [amount, setAmount] = useState(member.expected_amount || '')
  const [transactionDate, setTransactionDate] = useState('')
  const [notes, setNotes] = useState('')
  const [evidencePath, setEvidencePath] = useState(null)
  const [aiStatus, setAiStatus] = useState('idle') // idle | uploading | analyzing | done | error
  const [aiMessage, setAiMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Para cuando el inquilino/persona le manda la foto del comprobante por
  // WhatsApp u otro medio y quien administra el grupo prefiere subirla
  // directamente aquí, sin tener que ir al formulario público y salir de
  // esta pantalla. La IA intenta leerla igual que en el envío normal, para
  // no tener que copiar los datos a mano si ya se pueden leer solos.
  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setAiStatus('uploading')
    setAiMessage('Subiendo comprobante...')
    try {
      const ext = file.name.split('.').pop()
      const path = `${organizationId}/manual-${crypto.randomUUID()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('guest-evidence').upload(path, file)
      if (uploadError) throw uploadError
      setEvidencePath(path)

      if (!file.type.startsWith('image/')) {
        setAiStatus('done')
        setAiMessage('Comprobante adjunto. Completa el monto a mano.')
        return
      }

      setAiStatus('analyzing')
      setAiMessage('Leyendo comprobante con IA...')
      const { data: fnData, error: fnError } = await supabase.functions.invoke('analyze-guest-evidence', {
        body: { path, organization_id: organizationId }
      })
      if (fnError) throw fnError
      const extraction = fnData?.extraction
      if (extraction) {
        if (extraction.amount && !amount) setAmount(String(extraction.amount))
        if (extraction.transaction_date && !transactionDate) setTransactionDate(extraction.transaction_date)
        setAiStatus('done')
        setAiMessage('✓ Comprobante adjunto. Revisa los datos antes de guardar.')
      } else {
        setAiStatus('done')
        setAiMessage('Comprobante adjunto. No se pudieron leer los datos solos -- complétalos a mano.')
      }
    } catch (err) {
      console.error('Error subiendo/leyendo comprobante:', err)
      setAiStatus('error')
      setAiMessage('No se pudo subir el comprobante. Puedes registrar el pago sin foto.')
    }
  }

  async function submit(e) {
    e.preventDefault()
    if (!amount || Number(amount) <= 0) {
      setError('Ingresa un monto válido.')
      return
    }
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('register_manual_group_payment', {
      p_group_id: groupId,
      p_member_id: member.member_id,
      p_amount: Number(amount),
      p_transaction_date: transactionDate || null,
      p_notes: notes.trim() || null,
      p_evidence_path: evidencePath
    })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    onDone()
  }

  return (
    <div className="card" style={{ marginTop: 8, background: 'rgba(43, 100, 89, 0.05)' }}>
      <form onSubmit={submit}>
        <p style={{ fontSize: 13, marginTop: 0, fontWeight: 600 }}>Registrar pago de {member.display_name}</p>
        <p style={{ fontSize: 12, opacity: 0.65, marginTop: -8, marginBottom: 12 }}>
          Para cuando tú tienes el comprobante (te lo mandó por WhatsApp, por ejemplo) o la persona pagó sin mandar
          nada (efectivo, o ya lo confirmaste por tu cuenta).
        </p>
        <div className="field">
          <label htmlFor="regFile">Foto del comprobante (opcional)</label>
          <input id="regFile" type="file" accept="image/*,application/pdf" onChange={handleFileChange} />
          {aiMessage && (
            <p style={{ fontSize: 12, marginTop: 4, color: aiStatus === 'error' ? '#A2483A' : aiStatus === 'done' ? '#2B6459' : 'inherit' }}>
              {(aiStatus === 'uploading' || aiStatus === 'analyzing') && '⏳ '}
              {aiMessage}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="regAmount">Monto</label>
          <input id="regAmount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="regDate">Fecha (opcional)</label>
          <input id="regDate" type="date" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="regNotes">Nota (opcional)</label>
          <input id="regNotes" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ej. Pagó en efectivo" />
        </div>
        {error && <p className="error-text">{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={busy || aiStatus === 'uploading' || aiStatus === 'analyzing'}>
            {busy ? 'Guardando...' : 'Registrar pago'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancelar</button>
        </div>
      </form>
    </div>
  )
}

export default function PaymentGroupDetail() {
  const { groupId } = useParams()
  const navigate = useNavigate()
  const { membership } = useAuth()
  const canManage = ['propietario', 'admin'].includes(membership?.role)
  const [manageBusy, setManageBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [shareMsg, setShareMsg] = useState('')
  const [msgDraft, setMsgDraft] = useState('')
  const [msgBusy, setMsgBusy] = useState(false)
  const [msgInfo, setMsgInfo] = useState(null)
  const [editName, setEditName] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [group, setGroup] = useState(null)
  const [images, setImages] = useState([])
  const [kids, setKids] = useState([])
  const [orgGroups, setOrgGroups] = useState([])
  const [parentInfo, setParentInfo] = useState({ parent: null, label: '' })
  const [parentBusy, setParentBusy] = useState(false)
  const [parentMsg, setParentMsg] = useState(null)
  const [reportBusy, setReportBusy] = useState(null)
  const [reportError, setReportError] = useState(null)
  const [pkgOpen, setPkgOpen] = useState(false)
  const [pkgLabel, setPkgLabel] = useState('')
  const [pkgAmount, setPkgAmount] = useState('')
  const [pkgBusy, setPkgBusy] = useState(false)
  const [pkgError, setPkgError] = useState(null)
  const [imgBusy, setImgBusy] = useState(false)
  const [imgError, setImgError] = useState(null)
  const [members, setMembers] = useState([])
  const [periods, setPeriods] = useState([])
  const [memberHistory, setMemberHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [registeringFor, setRegisteringFor] = useState(null)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId])

  async function load() {
    setLoading(true)
    setError(null)
    const [
      { data: groupData, error: groupError },
      { data: memberData, error: memberError },
      { data: periodData, error: periodError },
      { data: historyData, error: historyError }
    ] = await Promise.all([
      supabase.rpc('get_payment_group', { p_group_id: groupId }),
      supabase.rpc('list_payment_group_members', { p_group_id: groupId }),
      supabase.rpc('list_payment_group_periods', { p_group_id: groupId }),
      supabase.rpc('list_payment_group_member_history', { p_group_id: groupId })
    ])
    setLoading(false)
    if (groupError || memberError) {
      setError(groupError?.message || memberError?.message)
      return
    }
    setGroup(groupData?.[0] || null)
    try {
      const { data: msg } = await supabase.rpc('get_payment_group_message', { p_group_id: groupId })
      setShareMsg(msg || ''); setMsgDraft(msg || '')
    } catch { /* sin mensaje si falla */ }
    if (groupData?.[0]?.link_code) {
      const { data: info } = await supabase.rpc('payment_group_public_info', { p_link_code: groupData[0].link_code })
      setImages(info?.[0]?.image_paths || [])
    }
    // Subgrupos dentro de este grupo y a qué grupo principal pertenece (si falla, se ignora).
    try {
      const orgId = groupData?.[0]?.organization_id
      const [kidsRes, treeRes, listRes] = await Promise.all([
        supabase.rpc('list_payment_group_children', { p_group_id: groupId }),
        supabase.rpc('payment_group_parents', { p_organization_id: orgId }),
        supabase.rpc('list_payment_groups', { p_organization_id: orgId })
      ])
      setKids(kidsRes.data || [])
      const mine = (treeRes.data || []).find((r) => r.group_id === groupId)
      setParentInfo({ parent: mine?.parent_group_id || null, label: mine?.option_label || '' })
      const hasParent = new Set((treeRes.data || []).filter((r) => r.parent_group_id).map((r) => r.group_id))
      setOrgGroups((listRes.data || []).filter((g) => g.group_id !== groupId && !hasParent.has(g.group_id)))
    } catch { /* sin subgrupos si falla */ }
    setMembers(memberData || [])
    // Periodos e historial son "extra" -- si fallan (ej. rol sin acceso a auditor, o el RPC
    // todavía no está desplegado), no se bloquea la pantalla principal por eso.
    setPeriods(periodError ? [] : (periodData || []))
    setMemberHistory(historyError ? [] : (historyData || []))
  }

  function startEdit() {
    setEditName(group.name)
    setEditAmount(group.default_expected_amount != null ? String(group.default_expected_amount) : '')
    setEditing(true)
  }

  async function saveEdit(e) {
    e.preventDefault()
    setManageBusy(true)
    setError(null)
    const { error: err } = await supabase.rpc('update_payment_group', {
      p_group_id: groupId,
      p_name: editName,
      p_default_expected_amount: editAmount === '' ? null : Number(editAmount)
    })
    setManageBusy(false)
    if (err) { setError(err.message); return }
    setEditing(false)
    load()
  }

  async function saveMessage() {
    setMsgBusy(true); setMsgInfo(null)
    const { error: err } = await supabase.rpc('set_payment_group_message', { p_group_id: groupId, p_message: msgDraft })
    setMsgBusy(false)
    if (err) { setMsgInfo({ error: err.message }); return }
    setShareMsg(msgDraft.trim())
    setMsgInfo({ ok: msgDraft.trim() ? 'Mensaje guardado.' : 'Mensaje quitado.' })
  }

  async function toggleArchive() {
    const archiving = group.active
    if (archiving && !window.confirm(`¿Archivar "${group.name}"?\n\nEl enlace del grupo dejará de funcionar y ya no se podrán enviar comprobantes por él. Todo se conserva y puedes reactivarlo cuando quieras.`)) return
    setManageBusy(true)
    const { error: e } = await supabase.rpc('set_payment_group_active', { p_group_id: groupId, p_active: !archiving })
    setManageBusy(false)
    if (e) { setError(e.message); return }
    load()
  }

  async function downloadReport(kind) {
    setReportBusy(kind); setReportError(null)
    try {
      const report = await fetchGroupReport(supabase, { groupId, group, kids, orgName: membership?.organizations?.name })
      if (kind === 'png') await saveOrShareFile(await reportToPng(report), reportFilename(report, 'png'))
      else if (kind === 'pdf') await saveOrShareFile(await reportToPdf(report), reportFilename(report, 'pdf'))
      else await saveOrShareFile(reportToXlsx(report), reportFilename(report, 'xlsx'))
    } catch (err) {
      setReportError(err?.message || 'No se pudo generar el informe.')
    }
    setReportBusy(null)
  }

  async function createPackage(e) {
    e.preventDefault()
    const label = pkgLabel.trim()
    if (!label) return
    setPkgBusy(true); setPkgError(null)
    try {
      const { data, error: cErr } = await supabase.rpc('create_payment_group', {
        p_organization_id: group.organization_id,
        p_name: `${label} – ${group.name}`,
        p_period_type: group.period_type,
        p_default_expected_amount: pkgAmount ? Number(pkgAmount) : null
      })
      if (cErr) throw cErr
      const childId = data?.[0]?.group_id
      const { error: pErr } = await supabase.rpc('set_payment_group_parent', { p_group_id: childId, p_parent_group_id: groupId, p_option_label: label })
      if (pErr) throw pErr
      setPkgLabel(''); setPkgAmount(''); setPkgOpen(false)
      await load()
    } catch (err) {
      setPkgError(err?.message || 'No se pudo crear el subgrupo.')
    }
    setPkgBusy(false)
  }

  async function saveParent() {
    setParentBusy(true); setParentMsg(null)
    const { error: e } = await supabase.rpc('set_payment_group_parent', {
      p_group_id: groupId,
      p_parent_group_id: parentInfo.parent || null,
      p_option_label: parentInfo.label || null
    })
    setParentBusy(false)
    if (e) { setParentMsg(e.message); return }
    setParentMsg('✓ Guardado.')
    load()
  }

  async function saveImages(paths) {
    const { error: e } = await supabase.rpc('set_payment_group_images', { p_group_id: groupId, p_image_paths: paths })
    if (e) throw e
    setImages(paths)
  }

  async function addImages(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setImgError(null)
    const room = MAX_GROUP_IMAGES - images.length
    if (room <= 0) { setImgError(`Máximo ${MAX_GROUP_IMAGES} imágenes.`); return }
    setImgBusy(true)
    try {
      const added = []
      for (const f of files.slice(0, room)) {
        const blob = await compressImage(f)
        const path = `${membership.organization_id}/${groupId}-${Date.now()}-${added.length}.jpg`
        const { error: upErr } = await supabase.storage.from('group-images').upload(path, blob, { contentType: 'image/jpeg' })
        if (upErr) throw upErr
        added.push(path)
      }
      await saveImages([...images, ...added])
      if (files.length > room) setImgError(`Solo se agregaron ${room}: el máximo es ${MAX_GROUP_IMAGES}.`)
    } catch (err) {
      setImgError(err?.message || 'No se pudo subir la imagen.')
    }
    setImgBusy(false)
  }

  async function removeImage(path) {
    if (!window.confirm('¿Quitar esta imagen del grupo?')) return
    setImgError(null)
    try { await saveImages(images.filter((p) => p !== path)) } catch (err) { setImgError(err?.message || 'No se pudo quitar.') }
  }

  async function deleteGroup() {
    const typed = window.prompt(`Eliminar "${group.name}" es definitivo: se borra la lista de personas y el enlace.\nLos comprobantes ya enviados se conservan, pero sin grupo.\n\nEscribe el nombre del grupo para confirmar:`)
    if (typed === null) return
    if (typed.trim().toLowerCase() !== group.name.trim().toLowerCase()) { setError('El nombre no coincide. No se eliminó nada.'); return }
    setManageBusy(true)
    const { error: e } = await supabase.rpc('delete_payment_group', { p_group_id: groupId })
    setManageBusy(false)
    if (e) { setError(e.message); return }
    navigate('/grupos')
  }

  if (loading) {
    return (
      <div className="container">
        <SkeletonPaymentList rows={4} />
      </div>
    )
  }

  if (!group) {
    return (
      <div className="container">
        <button type="button" onClick={() => navigate('/grupos')} style={{ background: 'none', border: 'none', padding: '4px 0', color: 'var(--primary, #2B6459)', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>← Grupos</button>
        <p className="error-text">{error || 'Grupo no encontrado.'}</p>
      </div>
    )
  }

  const origin = getCanonicalOrigin()
  const groupLink = `${origin}/g/${group.link_code}`
  const paidCount = members.filter((m) => m.paid).length
  const pending = members.filter((m) => !m.paid)
  const historyByMember = {}
  memberHistory.forEach((h) => { historyByMember[h.member_id] = h.history })
  // El mes actual ya se muestra completo arriba (Faltan / Ya pagaron), así que el historial
  // solo lista los meses anteriores -- evitar mostrar el mismo mes dos veces.
  const currentPeriod = group.period_type === 'monthly' ? periods[0]?.period : null
  const pastPeriods = periods.filter((p) => p.period !== currentPeriod)

  return (
    <div className="container">
      <button type="button" onClick={() => navigate('/grupos')} style={{ background: 'none', border: 'none', padding: '4px 0', margin: '0 0 8px', color: 'var(--primary, #2B6459)', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>← Grupos</button>
      <h2 style={{ marginTop: 0 }}>{group.name}</h2>
      <p style={{ opacity: 0.7, fontSize: 14, marginTop: -8, marginBottom: 20 }}>
        {group.period_type === 'monthly' ? 'Cobro mensual — se reinicia cada mes.' : 'Cobro único.'}
        {' '}{paidCount} de {members.length} {members.length === 1 ? 'persona ha' : 'personas han'} pagado
        {group.period_type === 'monthly' ? ' este mes.' : '.'}
      </p>

      {canManage && !editing && (
        <p style={{ margin: '-8px 0 16px' }}>
          <button type="button" className="btn btn-secondary" style={{ fontSize: 13, padding: '4px 12px' }} onClick={startEdit}>✏️ Editar nombre y monto</button>
        </p>
      )}
      {editing && (
        <form className="card" onSubmit={saveEdit} style={{ marginBottom: 20, maxWidth: 480, display: 'grid', gap: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Editar grupo</div>
          <div>
            <label htmlFor="groupEditName">Nombre del grupo</label>
            <input id="groupEditName" value={editName} onChange={(e) => setEditName(e.target.value)} required maxLength={120} />
          </div>
          <div>
            <label htmlFor="groupEditAmount">Monto esperado por persona (opcional)</label>
            <input id="groupEditAmount" type="number" step="0.01" min="0" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} placeholder="ej. 350" />
            <p style={{ fontSize: 12, opacity: 0.65, margin: '4px 0 0' }}>
              Se usa para las personas que no tienen un monto propio. Las que ya tienen monto individual no cambian.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={manageBusy}>{manageBusy ? 'Guardando...' : 'Guardar'}</button>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>Cancelar</button>
          </div>
        </form>
      )}

      {error && <p className="error-text">{error}</p>}
      {!group.active && <p style={{ background: 'rgba(0,0,0,0.06)', borderRadius: 8, padding: '8px 12px', fontSize: 14 }}>📦 Grupo archivado: el enlace está desactivado.</p>}

      {(canManage || images.length > 0) && (
        <div className="card" style={{ marginBottom: 20, maxWidth: 480 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Imágenes de referencia</div>
          <p style={{ fontSize: 13, opacity: 0.7, margin: '0 0 10px' }}>
            Las ve quien va a pagar (afiche, grupo, precios). La primera sale también en la vista previa del enlace.
          </p>
          {images.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {images.map((p, i) => (
                <div key={p} style={{ position: 'relative' }}>
                  <a href={groupImageUrl(p)} target="_blank" rel="noreferrer">
                    <img src={groupImageUrl(p)} alt={`Referencia ${i + 1}`} style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)', display: 'block' }} />
                  </a>
                  {i === 0 && <span style={{ position: 'absolute', left: 4, bottom: 4, fontSize: 10, fontWeight: 700, background: '#2B6459', color: '#fff', borderRadius: 6, padding: '1px 6px' }}>Portada</span>}
                  {canManage && <button type="button" aria-label="Quitar imagen" onClick={() => removeImage(p)} style={{ position: 'absolute', top: -6, right: -6, width: 24, height: 24, borderRadius: 12, border: 'none', background: '#B3261E', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>×</button>}
                </div>
              ))}
            </div>
          )}
          {canManage && images.length < MAX_GROUP_IMAGES && (
            <label className="btn btn-secondary" style={{ display: 'inline-block', fontSize: 13, padding: '6px 14px', cursor: imgBusy ? 'wait' : 'pointer' }}>
              {imgBusy ? 'Subiendo...' : '🖼 Agregar imagen'}
              <input type="file" accept="image/*" multiple disabled={imgBusy} onChange={addImages} style={{ display: 'none' }} />
            </label>
          )}
          {imgError && <p className="error-text" style={{ margin: '8px 0 0', fontSize: 13 }}>{imgError}</p>}
        </div>
      )}

      {(canManage || shareMsg) && (
        <div className="card" style={{ marginBottom: 20, maxWidth: 480 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Mensaje para compartir</div>
          <p style={{ fontSize: 13, opacity: 0.7, margin: '0 0 10px' }}>
            Es el texto que se envía por WhatsApp junto con el enlace: la descripción, precio, fecha de entrega, etc.
          </p>
          {canManage ? (
            <>
              <textarea
                value={msgDraft}
                onChange={(e) => { setMsgDraft(e.target.value); setMsgInfo(null) }}
                rows={10}
                maxLength={3000}
                placeholder={'ej. 🎄 *¡Arrancamos la PREVENTA!* ...\nPrecio: L.550'}
                style={{ width: '100%', fontSize: 14, lineHeight: 1.45, resize: 'vertical', boxSizing: 'border-box' }}
              />
              <p style={{ fontSize: 12, opacity: 0.6, margin: '4px 0 10px' }}>
                Para negrita en WhatsApp escribe *así*. Si lo dejas vacío se envía el saludo normal. El enlace se agrega solo al final.
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary" style={{ fontSize: 13, padding: '6px 14px' }} onClick={saveMessage} disabled={msgBusy || msgDraft.trim() === shareMsg}>{msgBusy ? 'Guardando...' : 'Guardar mensaje'}</button>
                {msgInfo?.ok && <span style={{ fontSize: 13, color: '#2B6459' }}>{msgInfo.ok}</span>}
                {msgInfo?.error && <span className="error-text" style={{ fontSize: 13 }}>{msgInfo.error}</span>}
              </div>
            </>
          ) : (
            <p style={{ fontSize: 14, whiteSpace: 'pre-wrap', margin: 0 }}>{shareMsg}</p>
          )}
        </div>
      )}

      {(kids.length > 0 || (canManage && members.length === 0 && !parentInfo.parent)) && (
        <div className="card" style={{ marginBottom: 20, maxWidth: 480 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{kids.length > 0 ? 'Subgrupos' : 'Subgrupos'}</div>
          <p style={{ fontSize: 12, opacity: 0.65, margin: '0 0 10px' }}>
            {kids.length > 0 ? 'Quien abre el enlace de este grupo elige su opción y sube el comprobante. Cada pago queda en el subgrupo elegido.' : 'Si este cobro tiene opciones (Prek 1, Prek 2…), crea aquí cada una: se comparte un solo enlace y cada persona elige. Cada subgrupo también tiene su propio enlace.'}
          </p>
          <div style={{ display: 'grid', gap: 8 }}>
            {kids.map((k) => {
              const kLink = `${origin}/g/${k.link_code}`
              return (
                <div key={k.group_id} style={{ padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(0,0,0,0.12)', background: '#fff' }}>
                  <button type="button" onClick={() => navigate(`/grupos/${k.group_id}`)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: 0, border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <strong>{k.option_label || k.name}{!k.active ? ' · 📦' : ''}</strong>
                      <strong>{k.default_expected_amount ? money(k.default_expected_amount) : ''}</strong>
                    </div>
                    <div style={{ fontSize: 13, opacity: 0.75, marginTop: 2 }}>
                      {k.confirmed_count} confirmados ({money(k.confirmed_amount)}){k.pending_count > 0 ? ` · ${k.pending_count} por confirmar` : ''}
                    </div>
                  </button>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <CopyLink link={kLink} />
                    <WhatsAppShare link={kLink} text={shareMsg || 'Hola 👋 Aquí puedes enviar tu comprobante de pago:'} />
                  </div>
                </div>
              )
            })}
          </div>
          {canManage && (
            <div style={{ marginTop: 12 }}>
              {!pkgOpen ? (
                <button type="button" className="btn btn-secondary" style={{ fontSize: 13, padding: '6px 14px' }} onClick={() => setPkgOpen(true)}>+ Nuevo subgrupo</button>
              ) : (
                <form onSubmit={createPackage}>
                  <div className="field">
                    <label htmlFor="pkgLabel">Nombre del subgrupo (ej. Prek 4)</label>
                    <input id="pkgLabel" type="text" maxLength={40} value={pkgLabel} onChange={(e) => setPkgLabel(e.target.value)} required />
                  </div>
                  <div className="field">
                    <label htmlFor="pkgAmount">Monto (opcional)</label>
                    <input id="pkgAmount" type="number" step="0.01" min="0" value={pkgAmount} onChange={(e) => setPkgAmount(e.target.value)} />
                  </div>
                  {pkgError && <p className="error-text" style={{ fontSize: 13 }}>{pkgError}</p>}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="submit" className="btn btn-primary" disabled={pkgBusy}>{pkgBusy ? 'Creando...' : 'Crear subgrupo'}</button>
                    <button type="button" className="btn btn-secondary" onClick={() => setPkgOpen(false)}>Cancelar</button>
                  </div>
                </form>
              )}
            </div>
          )}
          {kids.length > 0 && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(0,0,0,0.08)', fontSize: 14 }}>
            <strong>Total confirmado: L {kids.reduce((t, k) => t + Number(k.confirmed_amount || 0), 0).toLocaleString('es-HN', { minimumFractionDigits: 2 })}</strong>
            {' · '}{kids.reduce((t, k) => t + Number(k.confirmed_count || 0), 0)} pagos
          </div>
          )}
        </div>
      )}

      {canManage && (
        <p style={{ margin: '0 0 16px', fontSize: 13 }}>
          🏦 Quien paga ve tus cuentas con número completo para copiar.{' '}
          <button type="button" onClick={() => navigate('/cuentas')} style={{ background: 'none', border: 'none', padding: 0, color: '#2B6459', textDecoration: 'underline', cursor: 'pointer', fontSize: 13 }}>Administrar cuentas</button>
        </p>
      )}

      <div className="card" style={{ marginBottom: 20, maxWidth: 480 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Enlace general del grupo</div>
        <p style={{ fontSize: 12, opacity: 0.65, margin: '0 0 8px' }}>
          Para compartir con todo el grupo a la vez. Si alguien manda un comprobante sin estar en la lista, se agrega
          solo, marcado como nuevo.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input readOnly value={groupLink} onFocus={(e) => e.target.select()} style={{ flex: 1, fontSize: 13 }} />
          <CopyLink link={groupLink} />
          <WhatsAppShare link={groupLink} text={shareMsg || (kids.length > 0 ? 'Hola 👋 Aquí eliges tu grupo y envías tu comprobante de pago:' : 'Hola 👋 Aquí puedes enviar tu comprobante de pago:')} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20, maxWidth: 480 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Descargar informe</div>
        <p style={{ fontSize: 12, opacity: 0.65, margin: '0 0 10px' }}>
          {kids.length > 0 ? 'Incluye todos los subgrupos de este grupo, con el total y quién pagó, está en revisión o falta.' : 'Quién pagó, quién está en revisión y quién falta, con el total confirmado.'}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary" disabled={Boolean(reportBusy)} onClick={() => downloadReport('png')}>{reportBusy === 'png' ? 'Generando...' : '🖼 Imagen'}</button>
          <button type="button" className="btn btn-secondary" disabled={Boolean(reportBusy)} onClick={() => downloadReport('pdf')}>{reportBusy === 'pdf' ? 'Generando...' : '📄 PDF'}</button>
          <button type="button" className="btn btn-secondary" disabled={Boolean(reportBusy)} onClick={() => downloadReport('xlsx')}>{reportBusy === 'xlsx' ? 'Generando...' : '📊 Excel'}</button>
        </div>
        {reportError && <p className="error-text" style={{ margin: '8px 0 0', fontSize: 13 }}>{reportError}</p>}
      </div>

      {kids.length === 0 && (<>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <AddMemberForm groupId={groupId} onAdded={load} />
        <ImportMembersForm groupId={groupId} organizationId={group.organization_id} onImported={load} />
      </div>

      {pending.length > 0 && (
        <>
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>Faltan ({pending.length})</h3>
          <div className="payment-list" style={{ marginBottom: 24 }}>
            {pending.map((m) => (
              <div key={m.member_id} className="payment-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div className="amount" style={{ fontSize: 15 }}>
                      {m.display_name}{m.identifier ? ` · ${m.identifier}` : ''}
                    </div>
                    <div className="meta">
                      {m.expected_amount ? `Esperado: L ${Number(m.expected_amount).toLocaleString('es-HN', { minimumFractionDigits: 2 })}` : 'Sin monto esperado'}
                      {m.source === 'auto' && ' · 🆕 nuevo, no estaba en la lista'}
                    </div>
                    <PaymentStreak history={historyByMember[m.member_id]} />
                  </div>
                  <div className="actions-row">
                    <CopyLink link={`${origin}/g/${group.link_code}/${m.member_code}`} />
                    <WhatsAppShare
                      link={`${origin}/g/${group.link_code}/${m.member_code}`}
                      phone={m.contact}
                      text={`Hola ${m.display_name} 👋 Este es tu enlace para enviar tu comprobante de pago:`}
                    />
                    <button type="button" className="btn btn-primary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setRegisteringFor(m.member_id)}>
                      Registrar pago
                    </button>
                  </div>
                </div>
                {registeringFor === m.member_id && (
                  <RegisterPaymentForm
                    groupId={groupId}
                    organizationId={group.organization_id}
                    member={m}
                    onCancel={() => setRegisteringFor(null)}
                    onDone={() => { setRegisteringFor(null); load() }}
                  />
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {paidCount > 0 && (
        <>
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>Ya pagaron ({paidCount})</h3>
          <div className="payment-list">
            {members.filter((m) => m.paid).map((m) => (
              <div key={m.member_id} className="payment-row">
                <div>
                  <div className="amount" style={{ fontSize: 15 }}>
                    {m.display_name}{m.identifier ? ` · ${m.identifier}` : ''}
                  </div>
                  <div className="meta">
                    L {Number(m.paid_amount).toLocaleString('es-HN', { minimumFractionDigits: 2 })}
                    {' · '}{m.entry_method === 'manual' ? 'Registrado manualmente' : m.entry_status === 'confirmed' ? 'Comprobante confirmado' : 'Comprobante en revisión'}
                  </div>
                  <PaymentStreak history={historyByMember[m.member_id]} />
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {m.evidence_path && <ViewEvidence path={m.evidence_path} />}
                  <CopyLink link={`${origin}/g/${group.link_code}/${m.member_code}`} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {members.length === 0 && (
        <p className="empty-state">Todavía no hay nadie en la lista. Agrega personas o importa una lista arriba.</p>
      )}
      </>)}

      {pastPeriods.length > 0 && (
        <>
          <h3 style={{ fontSize: 15, marginTop: 28, marginBottom: 8 }}>Historial</h3>
          {pastPeriods.map((p) => (
            <MonthHistorySection
              key={p.period}
              groupId={groupId}
              period={p.period}
              paidCount={p.paid_count}
              totalCount={p.total_count}
              defaultOpen={p.total_count > 0 && p.paid_count < p.total_count}
            />
          ))}
        </>
      )}

      {canManage && kids.length === 0 && (
        <div className="card" style={{ marginTop: 28, maxWidth: 480 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Dentro de un grupo principal</div>
          <p style={{ fontSize: 12, opacity: 0.65, margin: '0 0 10px' }}>
            Si este grupo es un subgrupo u opción de otro grupo, elígelo aquí: se comparte un solo enlace y cada persona escoge.
          </p>
          <div className="field">
            <label htmlFor="parentSel">Grupo principal</label>
            <select id="parentSel" value={parentInfo.parent || ''} onChange={(e) => setParentInfo((p) => ({ ...p, parent: e.target.value || null }))}>
              <option value="">Ninguno (grupo independiente)</option>
              {orgGroups.map((g) => <option key={g.group_id} value={g.group_id}>{g.name}</option>)}
            </select>
          </div>
          {parentInfo.parent && (
            <div className="field">
              <label htmlFor="optLabel">Nombre corto que verá quien paga (ej. Prek 1)</label>
              <input id="optLabel" type="text" maxLength={40} value={parentInfo.label} onChange={(e) => setParentInfo((p) => ({ ...p, label: e.target.value }))} />
            </div>
          )}
          <button type="button" className="btn btn-secondary" disabled={parentBusy} onClick={saveParent}>{parentBusy ? 'Guardando...' : 'Guardar'}</button>
          {parentMsg && <span style={{ marginLeft: 10, fontSize: 13 }}>{parentMsg}</span>}
        </div>
      )}

      {canManage && (
        <div className="card" style={{ marginTop: 28, maxWidth: 480 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Administrar grupo</div>
          <p style={{ fontSize: 12, opacity: 0.65, margin: '0 0 10px' }}>
            Archivar desactiva el enlace pero conserva todo (se puede reactivar). Eliminar es definitivo.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" disabled={manageBusy} onClick={toggleArchive}>{group.active ? 'Archivar grupo' : 'Reactivar grupo'}</button>
            <button type="button" className="btn btn-secondary" disabled={manageBusy} onClick={deleteGroup} style={{ color: '#A2483A', borderColor: 'rgba(162,72,58,0.5)' }}>Eliminar grupo</button>
          </div>
        </div>
      )}
    </div>
  )
}
