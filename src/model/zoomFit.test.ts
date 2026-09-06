import { describe, expect, it } from 'vitest'
import { MAX_ZOOM, MIN_ZOOM, clampZoom, fitZoomForWidth } from './zoomFit'

describe('fitZoomForWidth', () => {
  it('fits rendered paper into the viewport after real horizontal insets', () => {
    expect(fitZoomForWidth({
      currentZoom: 1,
      renderedPageWidth: 690,
      viewportWidth: 1024,
      horizontalInsets: 91,
    })).toBe(1.352)
  })

  it('uses the current zoom to recover the page intrinsic width', () => {
    expect(fitZoomForWidth({
      currentZoom: 0.5,
      renderedPageWidth: 250,
      viewportWidth: 300,
      horizontalInsets: 50,
    })).toBe(0.5)
  })

  it('rounds to milliprecision and clamps both zoom limits', () => {
    expect(fitZoomForWidth({
      currentZoom: 1,
      renderedPageWidth: 750,
      viewportWidth: 300,
      horizontalInsets: 50,
    })).toBe(0.333)
    expect(fitZoomForWidth({
      currentZoom: 1,
      renderedPageWidth: 1000,
      viewportWidth: 100,
      horizontalInsets: 0,
    })).toBe(MIN_ZOOM)
    expect(fitZoomForWidth({
      currentZoom: 1,
      renderedPageWidth: 100,
      viewportWidth: 600,
      horizontalInsets: 0,
    })).toBe(MAX_ZOOM)
  })

  it('keeps the current view for invalid or unusable measurements', () => {
    const validCurrent = {
      currentZoom: 0.8,
      renderedPageWidth: 690,
      viewportWidth: 1024,
      horizontalInsets: 91,
    }
    expect(fitZoomForWidth({ ...validCurrent, renderedPageWidth: 0 })).toBe(0.8)
    expect(fitZoomForWidth({ ...validCurrent, viewportWidth: Number.NaN })).toBe(0.8)
    expect(fitZoomForWidth({ ...validCurrent, horizontalInsets: 1200 })).toBe(0.8)
  })
})

describe('clampZoom', () => {
  it('accepts the supported zoom range and normalizes non-finite input', () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM)
    expect(clampZoom(0.33)).toBe(0.33)
    expect(clampZoom(3)).toBe(MAX_ZOOM)
    expect(clampZoom(Number.NaN)).toBe(1)
  })
})
