/// <reference types="vite/client" />

// Babel's regenerator runtime ships no types. It exists only to satisfy the
// generator-based shapers inside the `@pdf-lib/fontkit` UMD bundle.
declare module 'regenerator-runtime' {
  const regeneratorRuntime: unknown
  export default regeneratorRuntime
}
