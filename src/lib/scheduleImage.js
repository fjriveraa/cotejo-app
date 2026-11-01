// Dibuja el horario como imagen PNG (sin librerías) para guardarlo o compartirlo por WhatsApp.
const DAY = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

export function scheduleToPng({ title, subtitle, days, rows, legend }) {
  const scale = 2
  const nameW = 190, colW = 118, rowH = 62, headH = 46, titleH = 74, legendH = 44, pad = 20
  const W = pad * 2 + nameW + colW * days.length
  const H = titleH + headH + rowH * rows.length + legendH + pad
  const c = document.createElement('canvas')
  c.width = W * scale; c.height = H * scale
  const g = c.getContext('2d')
  g.scale(scale, scale)
  g.fillStyle = '#FFFDF8'; g.fillRect(0, 0, W, H)
  const font = (w, s) => `${w} ${s}px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`
  const fit = (t, max) => { let s = t; while (s.length > 1 && g.measureText(s).width > max) s = s.slice(0, -1); return s === t ? t : s.trimEnd() + '…' }

  g.fillStyle = '#1f1b14'; g.font = font('700', 24); g.textBaseline = 'alphabetic'
  g.fillText(title, pad, pad + 26)
  g.fillStyle = '#7d7668'; g.font = font('400', 14)
  g.fillText(subtitle, pad, pad + 48)

  const top = titleH
  g.fillStyle = '#2B6459'; g.fillRect(pad, top, nameW + colW * days.length, headH)
  g.fillStyle = '#fff'; g.font = font('700', 13); g.textBaseline = 'middle'
  g.fillText('EMPLEADO', pad + 12, top + headH / 2)
  g.textAlign = 'center'
  days.forEach((d, i) => {
    const dow = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7
    g.fillText(`${DAY[dow]} ${d.slice(8)}`, pad + nameW + colW * i + colW / 2, top + headH / 2)
  })
  g.textAlign = 'left'

  rows.forEach((r, ri) => {
    const y = top + headH + ri * rowH
    if (ri % 2) { g.fillStyle = '#F8F4EA'; g.fillRect(pad, y, nameW + colW * days.length, rowH) }
    g.fillStyle = '#1f1b14'; g.font = font('700', 15); g.textBaseline = 'middle'
    g.fillText(fit(r.name, nameW - 20), pad + 12, y + rowH / 2)
    r.cells.forEach((cell, i) => {
      const x = pad + nameW + colW * i + 5, w = colW - 10, h = rowH - 10, yy = y + 5
      if (!cell) { g.strokeStyle = '#D9D3C6'; g.setLineDash([4, 3]); g.strokeRect(x + 0.5, yy + 0.5, w, h); g.setLineDash([]); return }
      g.fillStyle = cell.bg; g.strokeStyle = cell.border
      g.beginPath(); g.roundRect(x, yy, w, h, 8); g.fill(); g.stroke()
      g.textAlign = 'center'; g.fillStyle = cell.color || '#1f1b14'
      if (cell.sub) {
        g.font = font('700', 14); g.fillText(cell.main, x + w / 2, yy + h / 2 - 8)
        g.font = font('400', 12); g.fillText(fit(cell.sub, w - 8), x + w / 2, yy + h / 2 + 11)
      } else {
        g.font = font('700', 14); g.fillText(cell.main, x + w / 2, yy + h / 2)
      }
      g.textAlign = 'left'
    })
  })

  const ly = top + headH + rows.length * rowH + 12
  let lx = pad
  g.font = font('400', 13); g.textBaseline = 'middle'
  legend.forEach((l) => {
    g.fillStyle = l.bg; g.strokeStyle = l.border
    g.beginPath(); g.roundRect(lx, ly + 4, 18, 18, 4); g.fill(); g.stroke()
    g.fillStyle = '#4a4438'; g.fillText(l.label, lx + 26, ly + 14)
    lx += 26 + g.measureText(l.label).width + 22
  })
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
