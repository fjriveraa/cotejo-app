// Vista previa dinámica de los enlaces de grupo (/g/:code): WhatsApp y otras
// apps leen el HTML sin ejecutar JavaScript, así que el título del grupo se
// inserta aquí. Para cualquier fallo se devuelve el index.html normal.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://leprvnyswebmuohvvabd.supabase.co'
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_Ql5iOOoHxVH40WM3RqHjsg_jBibFJG_'

// WhatsApp no admite negrita en la descripción: se usan los dígitos y la L en negrita de Unicode.
const bold = (t) => Array.from(t).map((ch) => {
  if (ch >= '0' && ch <= '9') return String.fromCodePoint(0x1D7EC + Number(ch))
  if (ch >= 'A' && ch <= 'Z') return String.fromCodePoint(0x1D5D4 + ch.charCodeAt(0) - 65)
  return ch
}).join('')

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export default async function handler(req, res) {
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const base = `${proto}://${req.headers.host}`
  const code = String(req.query.code || '').slice(0, 64)
  // Las tres consultas van a la vez y con tiempo límite: las apps de mensajería
  // descartan la vista previa si la página tarda unos segundos.
  const rpc = (fn) => fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_link_code: code }),
    signal: AbortSignal.timeout(2500)
  }).then((r) => (r.ok ? r.json() : [])).catch(() => [])
  const [htmlRes, rows, optsRaw] = await Promise.all([
    fetch(`${base}/index.html`).then((r) => r.text()).catch(() => null),
    rpc('payment_group_public_info'),
    rpc('payment_group_options')
  ])
  let html = htmlRes
  if (!html) {
    res.statusCode = 302
    res.setHeader('Location', '/')
    return res.end()
  }
  try {
    const g = Array.isArray(rows) ? rows[0] : null
    const opts = Array.isArray(optsRaw) ? optsRaw : []
    if (g?.group_name) {
      const title = esc(g.group_name)
      const amt = Number(g.expected_amount)
      const org = g.organization_name
      const fmt = (n) => Number(n).toLocaleString('es-HN', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 })
      const amounts = opts.map((o) => Number(o.expected_amount)).filter((n) => n > 0)
      const cta = opts.length
        ? (org ? `Elige tu paquete y sube tu comprobante de pago a ${org}.` : 'Elige tu paquete y sube tu comprobante de pago.')
        : (org ? `Sube tu comprobante de pago a ${org} y consulta su confirmación.` : 'Sube tu comprobante de pago y consulta su confirmación.')
      const money = amounts.length
        ? amounts.map((n) => bold(`L ${fmt(n)}`)).join(' · ')
        : amt > 0 ? bold(`L ${amt.toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`) : ''
      const desc = esc(money ? `💰 ${money} · ${cta}` : cta)
      html = html
        .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
        .replace(/(property="og:title" content=")[^"]*"/, `$1${title}"`)
        .replace(/(name="twitter:title" content=")[^"]*"/, `$1${title}"`)
        .replace(/(property="og:description" content=")[^"]*"/, `$1${desc}"`)
        .replace(/(name="twitter:description" content=")[^"]*"/, `$1${desc}"`)
        .replace(/(name="description" content=")[^"]*"/, `$1${desc}"`)
      const first = Array.isArray(g.image_paths) ? g.image_paths[0] : null
      if (first) {
        const img = esc(`${SUPABASE_URL}/storage/v1/object/public/group-images/${first.split('/').map(encodeURIComponent).join('/')}`)
        html = html
          .replace(/(property="og:image" content=")[^"]*"/, `$1${img}"`)
          .replace(/(name="twitter:image" content=")[^"]*"/, `$1${img}"`)
          .replace(/<meta property="og:image:width"[^>]*>\s*/, '')
          .replace(/<meta property="og:image:height"[^>]*>\s*/, '')
      }
    }
  } catch { /* se deja la vista previa general */ }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
  res.statusCode = 200
  res.end(html)
}
