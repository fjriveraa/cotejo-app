import * as XLSX from 'xlsx'

const PAYMENT_STATUS_LABELS = {
  pending: 'Pendiente',
  under_review: 'En revisión',
  confirmed_manual: 'Confirmado',
  not_found: 'No encontrado',
  rejected: 'Rechazado',
  voided: 'Anulado (duplicado)'
}

const GUEST_STATUS_LABELS = {
  pending: 'En revisión',
  confirmed: 'Confirmado',
  not_confirmed: 'No se pudo confirmar'
}

const FORENSICS_LABELS_XLS = {
  posible_ia: 'Posible imagen generada por IA',
  revisar: 'Revisar — señales de manipulación',
  limpio: 'Sin señales de manipulación',
  sin_datos: 'Sin resultado claro'
}

function autoWidth(rows) {
  if (rows.length === 0) return []
  const keys = Object.keys(rows[0])
  return keys.map((key) => {
    const longest = rows.reduce((max, row) => {
      const value = row[key]
      const len = value === null || value === undefined ? 0 : String(value).length
      return Math.max(max, len)
    }, key.length)
    return { wch: Math.min(Math.max(longest + 2, 10), 45) }
  })
}

function formatDateTime(value) {
  if (!value) return ''
  return new Date(value).toLocaleString('es-HN')
}

function money(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : value
}

/**
 * Genera y descarga un archivo Excel (.xlsx) con los pagos registrados y los
 * comprobantes de invitados de una empresa, cada uno en su propia hoja.
 */
export function exportReportToExcel({ organizationName, payments, guestSubmissions, from, to }) {
  const wb = XLSX.utils.book_new()

  const paymentRows = (payments || []).map((p) => ({
    'ID público': p.public_id || '',
    Estado: PAYMENT_STATUS_LABELS[p.verification_status] || p.verification_status,
    Monto: money(p.amount),
    Moneda: p.currency,
    Banco: p.bank,
    'Últimos 4 dígitos': p.account_last4 || '',
    Referencia: p.reference_raw || '',
    'Fecha de transacción': p.transaction_date || '',
    'Cuenta origen (nombre)': p.origin_account_holder || '',
    'Cuenta origen (número)': p.origin_account_number || '',
    'Banco origen': p.origin_bank || '',
    'Cuenta destino': p.destination_account_holder || '',
    'Cliente esperaba': p.customer_waiting ? 'Sí' : 'No',
    Notas: p.notes || '',
    'Motivo no encontrado': p.not_found_reason || '',
    'Motivo de anulación': p.reversal_reason || '',
    'Registrado por': p.created_by_email || '',
    'Registrado el': formatDateTime(p.created_at),
    'Confirmado el': formatDateTime(p.verified_at)
  }))

  const paymentSheet = XLSX.utils.json_to_sheet(paymentRows)
  paymentSheet['!cols'] = autoWidth(paymentRows)
  XLSX.utils.book_append_sheet(wb, paymentSheet, 'Pagos registrados')

  const guestRows = (guestSubmissions || []).map((g) => ({
    Estado: GUEST_STATUS_LABELS[g.status] || g.status,
    Origen: g.is_in_person ? 'En tienda' : 'A distancia',
    Monto: money(g.amount),
    Moneda: g.currency,
    'Nombre del remitente': g.submitter_name || '',
    'Contacto del remitente': g.submitter_contact || '',
    Referencia: g.reference_raw || '',
    'Fecha de transacción': g.transaction_date || '',
    'Cuenta origen (nombre)': g.origin_account_holder || '',
    'Cuenta origen (número)': g.origin_account_number || '',
    'Banco origen': g.origin_bank || '',
    Notas: g.notes || '',
    'Comprobante visto en otra empresa': g.hash_seen_elsewhere ? 'Sí — posible reciclado' : g.similar_hash_elsewhere ? 'Parecido a uno de otra empresa' : 'No',
    'Forensia IA': g.forensics_label ? FORENSICS_LABELS_XLS[g.forensics_label] || g.forensics_label : '',
    'Nota de revisión': g.review_notes || '',
    'Enviado el': formatDateTime(g.created_at)
  }))

  const guestSheet = XLSX.utils.json_to_sheet(guestRows)
  guestSheet['!cols'] = autoWidth(guestRows)
  XLSX.utils.book_append_sheet(wb, guestSheet, 'Comprobantes de invitados')

  const rangeLabel = from || to ? `${from || 'inicio'}_a_${to || 'hoy'}` : 'todo'
  const safeName = (organizationName || 'cotejo').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const fileName = `cotejo-${safeName}-${rangeLabel}.xlsx`

  XLSX.writeFile(wb, fileName)
}
