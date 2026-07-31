export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Rectangle extends Point, Size {}

export function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export function normalizePoint(point: Point, size: Size): Point {
  return {
    x: clamp(point.x / size.width),
    y: clamp(point.y / size.height),
  }
}

export function denormalizePoint(point: Point, size: Size): Point {
  return {
    x: point.x * size.width,
    y: point.y * size.height,
  }
}

export function normalizeRect(rect: Rectangle, size: Size): Rectangle {
  const left = clamp(rect.x, 0, size.width)
  const top = clamp(rect.y, 0, size.height)
  const right = clamp(rect.x + rect.width, 0, size.width)
  const bottom = clamp(rect.y + rect.height, 0, size.height)
  return {
    x: left / size.width,
    y: top / size.height,
    width: (right - left) / size.width,
    height: (bottom - top) / size.height,
  }
}
