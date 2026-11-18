// Informe de cobros de un grupo (o de un grupo principal con todos sus paquetes):
// imagen PNG, PDF y Excel. Todo se arma en el navegador, sin librerías nuevas.
import * as XLSX from 'xlsx'

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const hn = (iso) => new Date(new Date(iso).getTime() - 6 * 3600 * 1000)
const dateShort = (iso) => {
  if (!iso) return ''
  const d = hn(iso)
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
}
const nowText = () => {
  const d = new Date(Date.now() - 6 * 3600 * 1000)
  return `${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()}`
}
const money = (n) => `L ${Number(n || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function statusOf(m) {
  if (m.paid && m.entry_status === 'confirmed') return { key: 'ok', text: m.entry_method === 'manual' ? 'Registrado' : 'Confirmado' }
  if (m.paid) return { key: 'rev', text: 'En revisión' }
  return { key: 'no', text: 'Falta' }
}

// Reúne los datos: un grupo suelto es una sola sección; un principal, una sección por paquete.
export async function fetchGroupReport(supabase, { groupId, group, kids, orgName }) {
  const targets = kids && kids.length > 0
    ? kids.map((k) => ({ id: k.group_id, label: k.option_label || k.name, amount: k.default_expected_amount }))
    : [{ id: groupId, label: group.name, amount: group.default_expected_amount }]
  const sections = []
  for (const t of targets) {
    const { data, error } = await supabase.rpc('list_payment_group_members', { p_group_id: t.id })
    if (error) throw error
    const rows = (data || []).map((m) => {
      const st = statusOf(m)
      return {
        name: m.display_name || '',
        identifier: m.identifier || '',
        expected: m.expected_amount != null ? Number(m.expected_amount) : (t.amount != null ? Number(t.amount) : null),
        paid: m.paid ? Number(m.paid_amount || 0) : 0,
        status: st.key,
        statusText: st.text,
        date: m.submitted_at || null
      }
    }).sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name, 'es') : ({ ok: 0, rev: 1, no: 2 }[a.status] - { ok: 0, rev: 1, no: 2 }[b.status])))
    sections.push({
      label: t.label,
      amount: t.amount != null ? Number(t.amount) : null,
      rows,
      ok: rows.filter((r) => r.status === 'ok').length,
      rev: rows.filter((r) => r.status === 'rev').length,
      no: rows.filter((r) => r.status === 'no').length,
      total: rows.filter((r) => r.status === 'ok').reduce((s, r) => s + r.paid, 0)
    })
  }
  const sum = (k) => sections.reduce((s, x) => s + x[k], 0)
  return {
    orgName: orgName || '',
    title: group.name,
    isParent: Boolean(kids && kids.length > 0),
    sections,
    totals: { ok: sum('ok'), rev: sum('rev'), no: sum('no'), amount: sum('total') }
  }
}

// ───────────────────────── Imagen y PDF ─────────────────────────
const W = 1240
const PAD = 60
const PAGE_H = 1754 // A4 a 150 ppp
const font = (w, s) => `${w} ${s}px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`
const COLORS = { ok: '#17724A', rev: '#8A5A00', no: '#B3261E' }

function buildItems(report) {
  const items = []
  items.push({
    h: 250,
    draw(g, y) {
      g.textAlign = 'left'; g.textBaseline = 'alphabetic'
      g.fillStyle = '#7d7668'; g.font = font('700', 20); g.fillText((report.orgName || '').toUpperCase(), PAD, y + 40)
      // El título puede ocupar hasta dos líneas.
      g.fillStyle = '#1f1b14'; g.font = font('700', 38)
      const maxW = W - PAD * 2 - 140
      const words = report.title.split(' ')
      const lines = ['']
      words.forEach((w) => {
        const test = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${w}` : w
        if (g.measureText(test).width > maxW && lines[lines.length - 1]) lines.push(w)
        else lines[lines.length - 1] = test
      })
      const shown = lines.slice(0, 2)
      if (lines.length > 2) shown[1] = shown[1].replace(/\s*\S*$/, '') + '…'
      shown.forEach((ln, i) => g.fillText(ln, PAD, y + 92 + i * 48))
      const base = y + 92 + (shown.length - 1) * 48
      g.fillStyle = '#4a4438'; g.font = font('400', 24); g.fillText(`Informe de cobros · ${nowText()}`, PAD, base + 42)
      g.textAlign = 'right'; g.fillStyle = '#2B6459'; g.font = font('700', 32); g.fillText('Cotejo', W - PAD, y + 42)
      g.fillStyle = '#2B6459'; g.fillRect(PAD, y + 218, W - PAD * 2, 3)
    }
  })
  items.push({
    h: 170,
    draw(g, y) {
      const boxes = [
        ['TOTAL CONFIRMADO', money(report.totals.amount), '#16483F'],
        ['PAGOS CONFIRMADOS', String(report.totals.ok), COLORS.ok],
        ['EN REVISIÓN', String(report.totals.rev), COLORS.rev],
        ['FALTAN', String(report.totals.no), COLORS.no]
      ]
      const gap = 16, bw = (W - PAD * 2 - gap * 3) / 4
      boxes.forEach(([label, value, color], i) => {
        const x = PAD + i * (bw + gap)
        g.fillStyle = '#F7F5EF'
        if (g.roundRect) { g.beginPath(); g.roundRect(x, y + 10, bw, 130, 16); g.fill() } else g.fillRect(x, y + 10, bw, 130)
        g.textAlign = 'left'; g.textBaseline = 'alphabetic'
        g.fillStyle = '#7d7668'; g.font = font('700', 17); g.fillText(label, x + 20, y + 48)
        g.fillStyle = color; g.font = font('700', i === 0 ? 38 : 52); g.fillText(value, x + 20, y + 110)
      })
    }
  })
  report.sections.forEach((s) => {
    if (report.isParent) {
      items.push({
        h: 84,
        draw(g, y) {
          g.textAlign = 'left'; g.textBaseline = 'alphabetic'
          g.fillStyle = '#16483F'; g.font = font('700', 32)
          g.fillText(`${s.label}${s.amount != null ? ` · ${money(s.amount)}` : ''}`, PAD, y + 50)
          g.textAlign = 'right'; g.fillStyle = '#4a4438'; g.font = font('400', 22)
          g.fillText(`${s.ok} confirmados · ${money(s.total)}${s.rev ? ` · ${s.rev} en revisión` : ''}${s.no ? ` · ${s.no} faltan` : ''}`, W - PAD, y + 50)
        }
      })
    }
    items.push({
      h: 50,
      draw(g, y) {
        g.textBaseline = 'alphabetic'; g.fillStyle = '#9a9384'; g.font = font('700', 17)
        g.textAlign = 'left'; g.fillText('PERSONA', PAD, y + 32)
        g.fillText('ESTADO', 600, y + 32)
        g.textAlign = 'right'; g.fillText('ESPERADO', 850, y + 32); g.fillText('PAGADO', 1000, y + 32); g.fillText('FECHA', W - PAD, y + 32)
        g.fillStyle = '#D9D3C6'; g.fillRect(PAD, y + 44, W - PAD * 2, 2)
      }
    })
    if (s.rows.length === 0) {
      items.push({ h: 60, draw(g, y) { g.textAlign = 'left'; g.fillStyle = '#9a9384'; g.font = font('400', 22); g.fillText('Sin personas en la lista.', PAD, y + 38) } })
    }
    s.rows.forEach((r, i) => {
      items.push({
        h: 52,
        draw(g, y) {
          if (i % 2 === 1) { g.fillStyle = '#FBFAF6'; g.fillRect(PAD, y, W - PAD * 2, 52) }
          g.textBaseline = 'middle'
          g.textAlign = 'left'; g.fillStyle = '#1f1b14'; g.font = font('600', 23)
          let n = r.name
          while (n.length > 1 && g.measureText(n).width > 520) n = n.slice(0, -1)
          g.fillText(n === r.name ? n : n.trimEnd() + '…', PAD + 4, y + 26)
          g.fillStyle = COLORS[r.status]; g.font = font('700', 21); g.fillText(r.statusText, 600, y + 26)
          g.textAlign = 'right'; g.fillStyle = '#4a4438'; g.font = font('400', 22)
          g.fillText(r.expected != null ? money(r.expected) : '—', 850, y + 26)
          g.fillStyle = r.paid > 0 ? '#1f1b14' : '#b8b2a3'; g.font = font(r.paid > 0 ? '700' : '400', 22)
          g.fillText(r.paid > 0 ? money(r.paid) : '—', 1000, y + 26)
          g.fillStyle = '#7d7668'; g.font = font('400', 20); g.fillText(dateShort(r.date), W - PAD, y + 26)
        }
      })
    })
    items.push({ h: 28, draw() {} })
  })
  return items
}

function newCanvas(h) {
  const c = document.createElement('canvas')
  c.width = W; c.height = h
  const g = c.getContext('2d')
  g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, W, h)
  return { c, g }
}

function drawFooter(g, h, page, pages) {
  g.textBaseline = 'alphabetic'; g.fillStyle = '#9a9384'; g.font = font('400', 18)
  g.textAlign = 'left'; g.fillText(`Emitido el ${nowText()} · Cotejo`, PAD, h - 36)
  if (pages > 1) { g.textAlign = 'right'; g.fillText(`Página ${page} de ${pages}`, W - PAD, h - 36) }
}

const canvasToBlob = (c, type, q) => new Promise((res) => c.toBlob(res, type, q))

// Una sola imagen PNG larga con todo el informe.
export async function reportToPng(report) {
  const items = buildItems(report)
  const H = items.reduce((s, it) => s + it.h, 0) + 90
  const { c, g } = newCanvas(H)
  let y = 0
  items.forEach((it) => { it.draw(g, y); y += it.h })
  drawFooter(g, H, 1, 1)
  return canvasToBlob(c, 'image/png')
}

function paginate(items) {
  const usable = PAGE_H - 100
  const pages = [[]]
  let used = 0
  items.forEach((it) => {
    if (used + it.h > usable && pages[pages.length - 1].length > 0) { pages.push([]); used = 0 }
    pages[pages.length - 1].push(it)
    used += it.h
  })
  return pages
}

// PDF A4: cada página es una imagen JPEG a pantalla completa (sin librerías).
export async function reportToPdf(report) {
  const pages = paginate(buildItems(report))
  const jpegs = []
  for (let p = 0; p < pages.length; p++) {
    const { c, g } = newCanvas(PAGE_H)
    let y = 40
    pages[p].forEach((it) => { it.draw(g, y); y += it.h })
    drawFooter(g, PAGE_H, p + 1, pages.length)
    const blob = await canvasToBlob(c, 'image/jpeg', 0.92)
    jpegs.push(new Uint8Array(await blob.arrayBuffer()))
  }
  const enc = new TextEncoder()
  const parts = []
  const offsets = []
  let length = 0
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); length += b.length }
  const startObj = (n) => { offsets[n] = length; push(`${n} 0 obj\n`) }
  push('%PDF-1.4\n')
  const total = 2 + pages.length * 3
  startObj(1); push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  startObj(2)
  push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>\nendobj\n`)
  jpegs.forEach((jpg, i) => {
    const pageN = 3 + i * 3, imgN = pageN + 1, contN = pageN + 2
    startObj(pageN)
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${imgN} 0 R >> >> /Contents ${contN} 0 R >>\nendobj\n`)
    startObj(imgN)
    push(`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${PAGE_H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`)
    push(jpg); push('\nendstream\nendobj\n')
    const content = 'q 595 0 0 842 0 0 cm /Im0 Do Q'
    startObj(contN)
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`)
  })
  const xrefAt = length
  push(`xref\n0 ${total + 1}\n0000000000 65535 f \n`)
  for (let n = 1; n <= total; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`)
  return new Blob(parts, { type: 'application/pdf' })
}

// ───────────────────────── Excel ─────────────────────────
export function reportToXlsx(report) {
  const wb = XLSX.utils.book_new()
  const resumen = [
    [report.title],
    [`Informe de cobros · ${nowText()}`],
    [],
    [report.isParent ? 'Paquete' : 'Grupo', 'Monto', 'Confirmados', 'En revisión', 'Faltan', 'Total confirmado (L)']
  ]
  report.sections.forEach((s) => resumen.push([s.label, s.amount ?? '', s.ok, s.rev, s.no, s.total]))
  if (report.sections.length > 1) resumen.push(['TOTAL', '', report.totals.ok, report.totals.rev, report.totals.no, report.totals.amount])
  const ws1 = XLSX.utils.aoa_to_sheet(resumen)
  ws1['!cols'] = [{ wch: 44 }, { wch: 12 }, { wch: 13 }, { wch: 13 }, { wch: 10 }, { wch: 20 }]
  XLSX.utils.book_append_sheet(wb, ws1, 'Resumen')

  const detalle = [[report.isParent ? 'Paquete' : 'Grupo', 'Persona', 'Identificador', 'Estado', 'Esperado (L)', 'Pagado (L)', 'Fecha de envío']]
  report.sections.forEach((s) => s.rows.forEach((r) => detalle.push([s.label, r.name, r.identifier, r.statusText, r.expected ?? '', r.paid || '', dateShort(r.date)])))
  const ws2 = XLSX.utils.aoa_to_sheet(detalle)
  ws2['!cols'] = [{ wch: 30 }, { wch: 36 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }]
  XLSX.utils.book_append_sheet(wb, ws2, 'Detalle')
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export function reportFilename(report, ext) {
  const base = report.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'informe'
  const d = new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10)
  return `Cotejo-${base}-${d}.${ext}`
}

export async function saveOrShareFile(blob, filename) {
  const file = new File([blob], filename, { type: blob.type })
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return } catch (e) { if (e?.name === 'AbortError') return }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
