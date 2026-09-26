// Utilidades de huella digital de archivos, compartidas entre los distintos
// formularios que suben evidencia/documentos (comprobantes de invitados,
// verificación de empresa). Todo se calcula en el navegador, sin costo ni
// llamada a ningún servicio externo.

export async function hashFile(file) {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Hash perceptual (dHash de 64 bits): a diferencia del hash exacto de
// arriba, este detecta imágenes visualmente muy parecidas aunque el
// archivo haya sido recortado, recomprimido o le hayan puesto un filtro.
// Si algo falla (formato no soportado, PDF, etc.) devuelve null y esa
// señal simplemente no aplica para ese archivo.
export async function computePerceptualHash(file) {
  if (!file.type.startsWith('image/')) return null
  try {
    const bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = 9
    canvas.height = 8
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, 9, 8)
    const { data } = ctx.getImageData(0, 0, 9, 8)
    const gray = []
    for (let i = 0; i < data.length; i += 4) {
      gray.push((data[i] + data[i + 1] + data[i + 2]) / 3)
    }
    let hash = 0n
    let bit = 0n
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const left = gray[y * 9 + x]
        const right = gray[y * 9 + x + 1]
        if (left > right) hash |= (1n << bit)
        bit += 1n
      }
    }
    const TWO63 = 1n << 63n
    const TWO64 = 1n << 64n
    const signed = hash >= TWO63 ? hash - TWO64 : hash
    return signed.toString()
  } catch (err) {
    console.error('No se pudo calcular el hash perceptual:', err)
    return null
  }
}
