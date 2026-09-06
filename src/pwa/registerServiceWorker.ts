export function resolveLeafPdfServiceWorker(basePath: string, pageUrl: string) {
  const scopePath = basePath.endsWith('/') ? basePath : `${basePath}/`
  const scopeUrl = new URL(scopePath, pageUrl)
  return {
    scriptUrl: new URL('sw.js', scopeUrl).href,
    scope: scopeUrl.pathname,
  }
}

export async function registerLeafPdfServiceWorker(
  basePath = import.meta.env.BASE_URL,
): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return null
  try {
    const { scriptUrl, scope } = resolveLeafPdfServiceWorker(basePath, window.location.href)
    return await navigator.serviceWorker.register(scriptUrl, { scope })
  } catch {
    // The editor remains fully usable without installation or offline caching.
    return null
  }
}
