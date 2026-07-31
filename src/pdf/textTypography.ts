import type { FontFamily } from '../model/editor'

/** Browser preview stacks corresponding to the three export font families. */
export const CSS_FONT_STACKS: Record<FontFamily, string> = {
  sans: '"Noto Sans", Arial, Helvetica, sans-serif',
  serif: '"Noto Serif", Georgia, "Times New Roman", serif',
  mono: '"Noto Sans Mono", "SFMono-Regular", Consolas, monospace',
}
