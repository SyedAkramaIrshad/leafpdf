import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerLeafPdfServiceWorker, resolveLeafPdfServiceWorker } from './registerServiceWorker'

const originalSecureContext = Object.getOwnPropertyDescriptor(window, 'isSecureContext')
const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')

function setSecureContext(value: boolean) {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value })
}

function setServiceWorker(value: Pick<ServiceWorkerContainer, 'register'> | undefined) {
  if (value) {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value })
  } else {
    Reflect.deleteProperty(navigator, 'serviceWorker')
  }
}

afterEach(() => {
  if (originalSecureContext) Object.defineProperty(window, 'isSecureContext', originalSecureContext)
  else Reflect.deleteProperty(window, 'isSecureContext')

  if (originalServiceWorker) Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker)
  else Reflect.deleteProperty(navigator, 'serviceWorker')
})

describe('LeafPDF service-worker registration', () => {
  it('resolves root and nested builds against the current origin', () => {
    expect(resolveLeafPdfServiceWorker('/', 'http://127.0.0.1:4173/document.html')).toEqual({
      scriptUrl: 'http://127.0.0.1:4173/sw.js',
      scope: '/',
    })
    expect(resolveLeafPdfServiceWorker('/leafpdf/', 'http://127.0.0.1:4173/another/file.html')).toEqual({
      scriptUrl: 'http://127.0.0.1:4173/leafpdf/sw.js',
      scope: '/leafpdf/',
    })
  })

  it('registers the worker inside the configured build scope', async () => {
    const registration = {} as ServiceWorkerRegistration
    const register = vi.fn().mockResolvedValue(registration)
    setSecureContext(true)
    setServiceWorker({ register })

    await expect(registerLeafPdfServiceWorker('/leafpdf/')).resolves.toBe(registration)
    expect(register).toHaveBeenCalledOnce()
    expect(register).toHaveBeenCalledWith('http://localhost:3000/leafpdf/sw.js', { scope: '/leafpdf/' })
  })

  it('stays non-fatal when service workers are unavailable, insecure, or rejected', async () => {
    setSecureContext(true)
    setServiceWorker(undefined)
    await expect(registerLeafPdfServiceWorker('/leafpdf/')).resolves.toBeNull()

    const insecureRegister = vi.fn()
    setSecureContext(false)
    setServiceWorker({ register: insecureRegister })
    await expect(registerLeafPdfServiceWorker('/leafpdf/')).resolves.toBeNull()
    expect(insecureRegister).not.toHaveBeenCalled()

    setSecureContext(true)
    setServiceWorker({ register: vi.fn().mockRejectedValue(new Error('registration rejected')) })
    await expect(registerLeafPdfServiceWorker('/leafpdf/')).resolves.toBeNull()
  })
})
