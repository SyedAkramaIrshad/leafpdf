import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// jsdom has no 2D canvas and logs "Not implemented" to stderr on every call. The
// components already handle a null context, so this returns the same null quietly
// rather than leaving warnings in the suite output that could mask a real problem.
// Assigned rather than spied, so the `vi.restoreAllMocks()` below cannot undo it;
// tests that need a real context still spy on top of this.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext

// `globals` is off in the Vitest config, so Testing Library's automatic cleanup
// never registers. Without this, each test inherits the previous test's DOM.
afterEach(() => {
  cleanup()
  // Spies and stubbed globals otherwise leak into later tests in the same file:
  // a canvas `getContext` stub from one test made an unrelated component throw.
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
