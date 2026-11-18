// Vista previa dinámica de los enlaces de grupo (/g/:code): WhatsApp y otras
// apps leen el HTML sin ejecutar JavaScript, así que el título del grupo se
// inserta aquí. Para cualquier fallo se devuelve el index.html normal.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://leprvnyswebmuohvvabd.supabase.co'
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_Ql5iOOoHxVH40WM3RqHjsg_jBibFJG_'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export default async function handler(req, res) {
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const base = `${proto}://${req.headers.host}`
  let html = ''
  try {
    html = await (await fetch(`${base}/index.html`)).text()
  } catch {
    res.statusCode = 302
    res.setHeader('Location', '/')
    return res.end()
  }
  try {
    const code = String(req.query.code || '').slice(0, 64)
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/resolve_payment_group_link`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_link_code: code, p_member_code: null })
    })
    const rows = r.ok ? await r.json() : null
    const g = Array.isArray(rows) ? rows[0] : null
    if (g?.group_name) {
      const title = esc(g.group_name)
      const desc = esc(g.organization_name ? `Envía tu comprobante de pago a ${g.organization_name}.` : 'Envía tu comprobante de pago.')
      html = html
        .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
        .replace(/(property="og:title" content=")[^"]*"/, `$1${title}"`)
        .replace(/(name="twitter:title" content=")[^"]*"/, `$1${title}"`)
        .replace(/(property="og:description" content=")[^"]*"/, `$1${desc}"`)
        .replace(/(name="twitter:description" content=")[^"]*"/, `$1${desc}"`)
        .replace(/(name="description" content=")[^"]*"/, `$1${desc}"`)
    }
  } catch { /* se deja la vista previa general */ }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
  res.statusCode = 200
  res.end(html)
}
