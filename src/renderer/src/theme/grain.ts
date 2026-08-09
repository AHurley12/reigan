/**
 * Film grain is applied as a *background layer* (via --effect-grain-image),
 * never as an overlay on top of the app — an overlay sits above text and
 * muddies it no matter how low the opacity. Baking the alpha into the tile
 * lets surfaces composite it under their own content, so text always stays
 * crisp above the texture.
 */
const tileCache = new Map<string, string>()

export function grainTile(opacity: number): string {
  const key = opacity.toFixed(3)
  const cached = tileCache.get(key)
  if (cached) return cached

  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(size, size)
  const alpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255)

  for (let i = 0; i < image.data.length; i += 4) {
    // Bias toward mid-grey so the tile darkens and lightens in equal measure.
    const v = 90 + Math.random() * 110
    image.data[i] = v
    image.data[i + 1] = v
    image.data[i + 2] = v
    image.data[i + 3] = alpha
  }
  ctx.putImageData(image, 0, 0)

  const url = `url(${canvas.toDataURL('image/png')})`
  tileCache.set(key, url)
  return url
}
