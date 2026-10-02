// Un mismo banco llega escrito de varias formas ("BAC", "BAC Credomatic",
// "Banco BAC Honduras"). Para agrupar y filtrar por banco se normaliza al
// nombre canónico, y cada banco tiene un color propio para reconocerlo de
// un vistazo en la bandeja.
const RULES = [
  [/credomatic|(^|[^a-záéíóúñ])bac([^a-záéíóúñ]|$)/i, 'BAC Credomatic', '#D71920'],
  [/atl[aá]ntida/i, 'Banco Atlántida', '#E8590C'],
  [/ficohsa/i, 'Ficohsa', '#0B7285'],
  [/occidente/i, 'Banco de Occidente', '#2F9E44'],
  [/banpa[ií]s/i, 'Banpaís', '#F08C00'],
  [/davivienda/i, 'Davivienda Honduras', '#C2255C'],
  [/lafise/i, 'Lafise Honduras', '#1C3F94'],
  [/promerica/i, 'Banco Promerica', '#5C940D'],
  [/azteca/i, 'Banco Azteca Honduras', '#37B24D'],
  [/popular/i, 'Banco Popular Honduras', '#1971C2'],
  [/banhcafe/i, 'BANHCAFE', '#5F3DC4'],
  [/banrural/i, 'Banrural', '#2B8A3E'],
  [/g&t|continental/i, 'G&T Continental', '#1864AB']
]

export const NO_BANK = 'Sin identificar'

export function canonicalBank(name) {
  const t = (name || '').trim()
  if (!t) return NO_BANK
  for (const [re, label] of RULES) if (re.test(t)) return label
  return t
}

export function bankColor(name) {
  const t = (name || '').trim()
  for (const [re, , color] of RULES) if (re.test(t)) return color
  return '#6B7280'
}
