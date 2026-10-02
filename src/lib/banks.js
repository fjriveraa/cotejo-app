// Catálogo de bancos por país. Se usa para autocompletar el banco en los
// formularios y para ayudar a la IA a reconocer el banco de un comprobante
// por nombre, aunque el texto de la imagen no sea perfectamente legible.
//
// Para agregar un país nuevo: agrega una entrada más a BANKS_BY_COUNTRY con
// el código de país (ISO 3166-1 alpha-2) y su lista de bancos. Cada banco
// puede incluir "hints" (color/rasgos visuales del logo) que se envían a la
// IA para que reconozca el banco por patrones visuales, no solo por texto.

export const COUNTRIES = [
  { code: 'HN', name: 'Honduras' },
  { code: 'GT', name: 'Guatemala' }
]

export const DEFAULT_COUNTRY = 'HN'

export const BANKS_BY_COUNTRY = {
  HN: [
    { name: 'Banco Atlántida', hints: 'logo rojo con una franja/gota, texto "Banco Atlántida"' },
    { name: 'Ficohsa', hints: 'logo azul/turquesa, texto "Ficohsa"' },
    { name: 'BAC Credomatic', hints: 'logo rojo y azul, texto "BAC"' },
    { name: 'Banco de Occidente', hints: 'logo verde, texto "Occidente"' },
    { name: 'Banpaís', hints: 'logo naranja, texto "Banpaís"' },
    { name: 'Davivienda Honduras', hints: 'logo rojo, texto "Davivienda"' },
    { name: 'Lafise Honduras', hints: 'logo azul oscuro, texto "Lafise"' },
    { name: 'Banco Promerica', hints: 'logo verde y azul, texto "Promerica"' },
    { name: 'Banco Azteca Honduras', hints: 'logo verde, texto "Azteca"' },
    { name: 'Banco Popular Honduras', hints: 'texto "Banco Popular"' },
    { name: 'BANHCAFE', hints: 'texto "Banhcafe"' }
  ],
  GT: [
    { name: 'Banrural', hints: 'logo verde, texto "Banrural"' },
    { name: 'Banco Industrial', hints: 'logo rojo, texto "Industrial" o "BI"' },
    { name: 'G&T Continental', hints: 'logo azul/dorado, texto "G&T Continental"' },
    { name: 'BAC Credomatic Guatemala', hints: 'logo rojo y azul, texto "BAC"' },
    { name: 'Banco Agromercantil (BAM)', hints: 'logo verde, texto "BAM" o "Agromercantil"' },
    { name: 'Banco Promerica Guatemala', hints: 'logo verde y azul, texto "Promerica"' },
    { name: 'Bantrab', hints: 'logo azul, texto "Bantrab"' },
    { name: 'Vivibanco', hints: 'logo morado, texto "Vivibanco"' },
    { name: 'CHN', hints: 'texto "CHN" o "Crédito Hipotecario Nacional"' },
    { name: 'Interbanco', hints: 'texto "Interbanco"' }
  ]
}

export function banksForCountry(countryCode) {
  return BANKS_BY_COUNTRY[countryCode] || BANKS_BY_COUNTRY[DEFAULT_COUNTRY]
}

export function bankNamesForCountry(countryCode) {
  return banksForCountry(countryCode).map((b) => b.name)
}
