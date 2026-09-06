const CACHE_VERSION = '__LEAFPDF_CACHE_VERSION__'
const PRECACHE_PATHS = ['__LEAFPDF_PRECACHE__']
const SCOPE_URL = new URL(self.registration.scope)
const INDEX_URL = new URL('index.html', SCOPE_URL).href
const PRECACHE_URLS = PRECACHE_PATHS.map((path) => new URL(path, SCOPE_URL).href)
const PRECACHE_URL_SET = new Set(PRECACHE_URLS)
const CACHE_PREFIX = `leafpdf-app:${SCOPE_URL.pathname}:`
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  )
})

function cacheable(request, url) {
  if (
    request.method !== 'GET'
    || url.origin !== SCOPE_URL.origin
    || !url.pathname.startsWith(SCOPE_URL.pathname)
  ) return false
  if (/\.(?:pdf|leafpdf)(?:$|\?)/i.test(url.pathname)) return false
  return PRECACHE_URL_SET.has(url.href)
    || ['document', 'script', 'style', 'worker', 'font', 'image', 'manifest'].includes(request.destination)
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (!cacheable(request, url)) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            void caches.open(CACHE_NAME).then((cache) => cache.put(INDEX_URL, copy))
          }
          return response
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME)
          return (await cache.match(INDEX_URL, { ignoreVary: true })) || Response.error()
        }),
    )
    return
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request, { ignoreVary: true })
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok) {
        const copy = response.clone()
        void cache.put(request, copy)
      }
      return response
    }),
  )
})
