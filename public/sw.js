/* Local offline worker for «Моя смена». No remote resources are fetched or cached. */
const VERSION =
  (new URL(self.location.href).searchParams.get('v') ?? 'local')
    .replace(/[^a-z0-9._-]/gi, '-')
    .slice(0, 80) || 'local'
const CACHE_PREFIX = 'moya-smena-'
const SHELL_CACHE = `${CACHE_PREFIX}shell-${VERSION}`
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-${VERSION}`
const STATIC_SHELL_URLS = [
  '/manifest.webmanifest',
  '/icons/app-icon.svg',
  '/icons/app-icon-192.svg',
  '/icons/app-icon-512.svg',
  '/icons/app-icon-maskable.svg',
  '/icons/notification-badge.svg',
]

async function fetchAndCache(cache, url) {
  const response = await fetch(new Request(url, { cache: 'reload' }))
  if (!response.ok) throw new Error(`Precache failed: ${url}`)
  await cache.put(url, response)
}

function bundledAssetUrls(indexHtml) {
  const urls = new Set()
  for (const match of indexHtml.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) {
    const url = new URL(match[1], self.location.origin)
    if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
      urls.add(`${url.pathname}${url.search}`)
    }
  }
  return [...urls]
}

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE)
  const indexResponse = await fetch(new Request('/index.html', { cache: 'reload' }))
  if (!indexResponse.ok) throw new Error('Precache failed: /index.html')

  const indexHtml = await indexResponse.clone().text()
  await Promise.all([
    cache.put('/', indexResponse.clone()),
    cache.put('/index.html', indexResponse.clone()),
  ])
  await Promise.all(
    [...STATIC_SHELL_URLS, ...bundledAssetUrls(indexHtml)].map((url) =>
      fetchAndCache(cache, url),
    ),
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== SHELL_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

function isDevelopmentRequest(url) {
  return (
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/node_modules/') ||
    url.pathname.includes('__vite') ||
    url.searchParams.has('t')
  )
}

async function navigationResponse(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE)
      await cache.put('/index.html', response.clone())
    }
    return response
  } catch {
    const cached = await caches.match('/index.html')
    if (cached) return cached
    return new Response(
      '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Моя смена</title><body><h1>Нет подключения</h1><p>Откройте приложение снова после запуска локального сервера.</p></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE)
  const cached = await caches.match(request, { ignoreVary: true })
  const network = fetch(request)
    .then((response) => {
      if (response.ok && response.type !== 'opaque') void cache.put(request, response.clone())
      return response
    })
    .catch(() => null)

  return cached ?? (await network) ?? new Response('', { status: 504, statusText: 'Offline' })
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin || isDevelopmentRequest(url) || url.pathname.endsWith('/sw.js')) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request))
    return
  }

  event.respondWith(staleWhileRevalidate(request))
})

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type
  if (type === 'SKIP_WAITING') {
    void self.skipWaiting()
    return
  }

  if (type === 'CLEAR_RUNTIME_CACHE') {
    event.waitUntil(
      caches.delete(RUNTIME_CACHE).then((cleared) => {
        event.ports[0]?.postMessage({ type: 'RUNTIME_CACHE_CLEARED', cleared })
      }),
    )
    return
  }

  if (type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ type: 'VERSION', version: VERSION })
  }
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = new URL(event.notification.data?.url ?? '/', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const existing = clients.find((client) => new URL(client.url).origin === self.location.origin)
      if (existing) {
        await existing.focus()
        if ('navigate' in existing) await existing.navigate(targetUrl)
        return
      }
      await self.clients.openWindow(targetUrl)
    }),
  )
})
