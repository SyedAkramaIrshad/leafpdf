const SAFE_TEXT_COLOR = '#182026'

function rgbFromHex(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const expanded = clean.length === 3
    ? clean.split('').map((part) => part + part).join('')
    : clean.padEnd(6, '0').slice(0, 6)
  const value = Number.parseInt(expanded, 16)
  return [value >> 16 & 255, value >> 8 & 255, value & 255]
}

function hexFromRgb(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0'))
    .join('')}`
}

/**
 * Find the dominant non-paper colour in a rendered source-text rectangle.
 *
 * Anti-aliasing creates several nearby shades, so pixels are grouped into
 * eight-level RGB buckets while the returned colour is the average of the
 * original pixels in the winning bucket.
 */
export function dominantTextColor(
  rgba: Uint8ClampedArray | Uint8Array,
  backgroundColor: string,
  fallback = SAFE_TEXT_COLOR,
): string {
  const background = rgbFromHex(backgroundColor)
  const buckets = new Map<string, { count: number; red: number; green: number; blue: number }>()

  for (let index = 0; index + 3 < rgba.length; index += 4) {
    const red = rgba[index]
    const green = rgba[index + 1]
    const blue = rgba[index + 2]
    const alpha = rgba[index + 3]
    if (alpha < 128) continue

    const distance = Math.hypot(red - background[0], green - background[1], blue - background[2])
    if (distance <= 24) continue

    const key = `${red >> 3}:${green >> 3}:${blue >> 3}`
    const bucket = buckets.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 }
    bucket.count += 1
    bucket.red += red
    bucket.green += green
    bucket.blue += blue
    buckets.set(key, bucket)
  }

  let winner: { count: number; red: number; green: number; blue: number } | null = null
  for (const bucket of buckets.values()) {
    if (!winner || bucket.count > winner.count) winner = bucket
  }
  if (!winner) return fallback

  return hexFromRgb(
    winner.red / winner.count,
    winner.green / winner.count,
    winner.blue / winner.count,
  )
}
