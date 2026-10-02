import type { FontFamily } from '../model/editor'

/** Browser preview stacks corresponding to the three export font families. */
export const CSS_FONT_STACKS: Record<FontFamily, string> = {
  sans: 'Arial, Helvetica, sans-serif',
  serif: '"Times New Roman", Times, serif',
  mono: '"Courier New", Courier, monospace',
}
