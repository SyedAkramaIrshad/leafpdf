/// <reference types="vite/client" />

// Vite types `?url` and `?raw` for arbitrary assets but not `?inline`, which we
// use to embed font bytes as a data URI. Inlining keeps font loading identical
// in the browser, the export worker, and Vitest, with no runtime fetch.
declare module '*?inline' {
  const dataUri: string
  export default dataUri
}

// Babel's regenerator runtime ships no types. It exists only to satisfy the
// generator-based shapers inside the `@pdf-lib/fontkit` UMD bundle.
declare module 'regenerator-runtime' {
  const regeneratorRuntime: unknown
  export default regeneratorRuntime
}
