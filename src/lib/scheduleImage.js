// Dibuja el horario como imagen PNG (sin librerías) para guardarlo, imprimirlo o compartirlo.
const DAY = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM']
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

export function rangeText(from, to) {
  const [y1, m1, d1] = from.split('-').map(Number)
  const [y2, m2, d2] = to.split('-').map(Number)
  if (y1 === y2 && m1 === m2) return `${d1} al ${d2} de ${MONTHS[m2 - 1]} de ${y2}`
  return `${d1} de ${MONTHS[m1 - 1]} al ${d2} de ${MONTHS[m2 - 1]} de ${y2}`
}
export function todayText() {
  const d = new Date(Date.now() - 6 * 3600 * 1000)
  return `${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()}`
}

export function scheduleToPng({ orgName, title, period, days, rows, legend }) {
  const scale = 2
  const nameW = 200, colW = 120, rowH = 66, headH = 58, topH = 130, footH = 70, pad = 36
  const W = pad * 2 + nameW + colW * days.length
  const H = topH + headH + rowH * rows.length + footH
  const c = document.createElement('canvas')
  c.width = W * scale; c.height = H * scale
  const g = c.getContext('2d')
  g.scale(scale, scale)
  g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, W, H)
  const font = (w, s) => `${w} ${s}px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`
  const fit = (t, max) => { let s = t; while (s.length > 1 && g.measureText(s).width > max) s = s.slice(0, -1); return s === t ? t : s.trimEnd() + '…' }
  const spaced = (t, x, y, sp) => { for (const ch of t) { g.fillText(ch, x, y); x += g.measureText(ch).width + sp } }

  // Encabezado de documento
  g.textBaseline = 'alphabetic'; g.textAlign = 'left'
  g.fillStyle = '#7d7668'; g.font = font('700', 12); spaced((orgName || '').toUpperCase(), pad, pad + 8, 1.5)
  g.fillStyle = '#1f1b14'; g.font = font('700', 28); g.fillText(title, pad, pad + 42)
  g.fillStyle = '#4a4438'; g.font = font('400', 15); g.fillText(period, pad, pad + 64)
  g.textAlign = 'right'; g.fillStyle = '#2B6459'; g.font = font('700', 20); g.fillText('Cotejo', W - pad, pad + 14)
  g.fillStyle = '#9a9384'; g.font = font('400', 11); g.fillText('Control de asistencia', W - pad, pad + 32)
  g.textAlign = 'left'
  g.fillStyle = '#2B6459'; g.fillRect(pad, topH - 14, W - pad * 2, 2)

  // Días
  const gx = pad + nameW
  days.forEach((d, i) => {
    const dow = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7
    const x = gx + colW * i
    if (dow >= 5) { g.fillStyle = '#F7F5EF'; g.fillRect(x, topH, colW, headH + rowH * rows.length) }
    g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillStyle = '#9a9384'; g.font = font('700', 11); g.fillText(DAY[dow], x + colW / 2, topH + 20)
    g.fillStyle = '#1f1b14'; g.font = font('700', 20); g.fillText(d.slice(8), x + colW / 2, topH + 42)
  })
  g.textAlign = 'left'; g.fillStyle = '#9a9384'; g.font = font('700', 11); g.fillText('EQUIPO', pad, topH + 30)
  g.fillStyle = '#D9D3C6'; g.fillRect(pad, topH + headH - 1, W - pad * 2, 1)

  rows.forEach((r, ri) => {
    const y = topH + headH + ri * rowH
    if (ri > 0) { g.fillStyle = '#EFEBE0'; g.fillRect(pad, y, W - pad * 2, 1) }
    g.textBaseline = 'middle'; g.textAlign = 'left'
    g.fillStyle = '#1f1b14'; g.font = font('700', 16); g.fillText(fit(r.name, nameW - 16), pad, y + rowH / 2 - 8)
    g.fillStyle = '#7d7668'; g.font = font('400', 12); g.fillText(r.total || '', pad, y + rowH / 2 + 12)
    r.cells.forEach((cell, i) => {
      const x = gx + colW * i + 6, w = colW - 12, h = rowH - 14, yy = y + 7
      if (!cell) { g.fillStyle = '#D9D3C6'; g.textAlign = 'center'; g.font = font('400', 16); g.fillText('·', x + w / 2, yy + h / 2); return }
      if (cell.off) {
        g.textAlign = 'center'; g.fillStyle = '#A2483A'; g.font = font('700', 11)
        const t = 'LIBRE', tw = [...t].reduce((a, ch) => a + g.measureText(ch).width + 2, -2)
        let tx = x + w / 2 - tw / 2; g.textAlign = 'left'
        for (const ch of t) { g.fillText(ch, tx, yy + h / 2); tx += g.measureText(ch).width + 2 }
        return
      }
      g.fillStyle = '#FFFFFF'; g.strokeStyle = '#E6E0D2'; g.lineWidth = 1
      g.beginPath(); g.roundRect(x, yy, w, h, 8); g.fill(); g.stroke()
      g.save(); g.beginPath(); g.roundRect(x, yy, w, h, 8); g.clip()
      g.fillStyle = cell.border; g.fillRect(x, yy, 5, h); g.restore()
      g.textAlign = 'center'
      g.fillStyle = '#1f1b14'; g.font = font('700', 14); g.fillText(cell.main, x + w / 2 + 2, yy + h / 2 - 8)
      g.fillStyle = '#7d7668'; g.font = font('400', 12); g.fillText(fit(cell.sub || '', w - 18), x + w / 2 + 2, yy + h / 2 + 11)
    })
  })

  // Pie: leyenda y fecha de emisión
  const ly = topH + headH + rows.length * rowH + 22
  g.fillStyle = '#D9D3C6'; g.fillRect(pad, ly - 12, W - pad * 2, 1)
  let lx = pad
  g.font = font('400', 13); g.textBaseline = 'middle'; g.textAlign = 'left'
  legend.forEach((l) => {
    g.fillStyle = l.border
    g.beginPath(); g.roundRect(lx, ly + 2, 6, 18, 2); g.fill()
    g.fillStyle = '#4a4438'; g.fillText(l.label, lx + 14, ly + 11)
    lx += 14 + g.measureText(l.label).width + 24
  })
  g.textAlign = 'right'; g.fillStyle = '#9a9384'; g.font = font('400', 11)
  g.fillText(`Emitido el ${todayText()}`, W - pad, ly + 11)
  return new Promise((res) => c.toBlob(res, 'image/png'))
}

export async function saveOrShareImage(blob, filename) {
  const file = new File([blob], filename, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return } catch (e) { if (e?.name === 'AbortError') return }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
