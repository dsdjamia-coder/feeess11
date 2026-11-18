const CACHE_NAME = 'institution-tracer-v3-05-02';
const IMAGE_CACHE_NAME = 'institution-tracer-images-v2';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/images/logo.png',
  '/assets/images/pwa-192x192.png',
  '/assets/images/pwa-512x512.png',
  '/assets/images/pwa-maskable-512x512.png',
  '/assets/images/apple-touch-icon.png',
  '/scripts/shared/session-guard.js',
  '/scripts/shared/page-guards.js',
  '/scripts/shared/hub-navigation.js'
];

const SENSITIVE_ROUTE_SUFFIXES = [
  '/company',
  '/company.html',
  '/scripts/pages/company-page.js',
  '/admin',
  '/admin.html',
  '/collection',
  '/collection.html',
  '/official',
  '/official.html',
  '/scripts/pages/admin-page.js',
  '/scripts/pages/collection-page.js',
  '/scripts/pages/student-page.js',
  '/student.html',
  '/scripts/shared/session-guard.js',
  '/scripts/shared/app-common.js'
];

const isSensitiveRequest = (url) => SENSITIVE_ROUTE_SUFFIXES.some((suffix) => url.pathname === suffix || url.pathname.endsWith(suffix));
const isSameOrigin = (url) => url.origin === self.location.origin;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        ASSETS_TO_CACHE.map(async (assetUrl) => {
          try {
            const response = await fetch(assetUrl, { cache: 'no-cache' });
            if (response && response.ok) {
              await cache.put(assetUrl, response);
            }
          } catch (_err) {}
        })
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames.map((cacheName) => (cacheName !== CACHE_NAME && cacheName !== IMAGE_CACHE_NAME) ? caches.delete(cacheName) : Promise.resolve())
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  const isImageRequest = event.request.destination === 'image';

  if (isImageRequest) {
    const isPiiImage = requestUrl.pathname.includes('/students/')
      || requestUrl.pathname.includes('studentPhotoSubmissions')
      || requestUrl.searchParams.has('token')
      || requestUrl.hostname.includes('firestore.googleapis.com');
    if (isPiiImage) {
      event.respondWith(fetch(event.request).catch(() => new Response('', { status: 404 })));
      return;
    }
    event.respondWith(
      caches.open(IMAGE_CACHE_NAME).then(async (imageCache) => {
        const cachedImage = await imageCache.match(event.request);
        if (cachedImage) return cachedImage;
        try {
          const networkImage = await fetch(event.request);
          if (networkImage && (networkImage.ok || networkImage.type === 'opaque')) {
            imageCache.put(event.request, networkImage.clone());
          }
          return networkImage;
        } catch (_error) {
          return cachedImage || fetch(event.request);
        }
      })
    );
    return;
  }

  if (!isSameOrigin(requestUrl)) return;

  if (isSensitiveRequest(requestUrl)) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(() => caches.match(event.request))
    );
    return;
  }

  if (event.request.mode === 'navigate') {
    if (
      requestUrl.pathname === '/admin'
      || requestUrl.pathname.endsWith('/admin.html')
      || requestUrl.pathname === '/collection'
      || requestUrl.pathname.endsWith('/collection.html')
    ) {
      event.respondWith(fetch(event.request, { cache: 'no-store' }));
      return;
    }
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          if (requestUrl.pathname === '/' || requestUrl.pathname.endsWith('/index.html') || requestUrl.pathname.endsWith('/student.html')) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  const path = requestUrl.pathname || '';
  const isRuntimeCriticalScript = path.includes('/scripts/');
  const isStylesheet = path.includes('/styles/');
  const isConfigFile = path.includes('/config/');

  if (isRuntimeCriticalScript || isStylesheet || isConfigFile) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            const isStaticAsset = path.includes('/styles/')
              || path.includes('/assets/')
              || path.includes('/scripts/shared/')
              || path.includes('/scripts/pages/index-page')
              || path.includes('/scripts/pages/student-page')
              || path.includes('/config/')
              || path.endsWith('/manifest.json')
              || path.endsWith('/sw.js')
              || path.endsWith('/index.html')
              || path.endsWith('/student.html')
              || path === '/';
            if (isStaticAsset) {
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            }
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (data.type === 'SYNC_APP_BADGE') {
    const count = Math.max(0, Number(data.count) || 0);
    if ('setAppBadge' in self.navigator && 'clearAppBadge' in self.navigator) {
      const promise = count > 0
        ? self.navigator.setAppBadge(count).catch(() => {})
        : self.navigator.clearAppBadge().catch(() => {});
      if (event.waitUntil) event.waitUntil(promise);
    }
    return;
  }

  if (data.type === 'SHOW_SYSTEM_NOTIFICATION') {
    const payload = data.payload || {};
    const title = String(payload.title || 'New Notification');
    const options = {
      body: String(payload.body || ''),
      icon: payload.icon || '/assets/images/pwa-192x192.png',
      badge: payload.badge || '/assets/images/pwa-192x192.png',
      tag: String(payload.tag || `notif-${Date.now()}`),
      renotify: true,
      vibrate: [200, 100, 200],
      data: {
        url: payload.url || './student.html',
        target: payload.target || 'home-page',
        notifId: payload.notifId || ''
      }
    };
    if (self.Notification && self.Notification.permission === 'granted') {
      const showPromise = self.registration.showNotification(title, options).catch(() => {});
      if (event.waitUntil) event.waitUntil(showPromise);
    }
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const notifData = event.notification.data || {};
  const targetUrl = notifData.url || './student.html';
  const targetTab = notifData.target || '';
  const notifId = notifData.notifId || '';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('student.html') && 'focus' in client) {
          client.postMessage({
            type: 'NOTIFICATION_CLICKED',
            notifId,
            target: targetTab
          });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        const hash = targetTab && !targetTab.includes('.html')
          ? `#${targetTab.replace('-page', '')}`
          : '';
        return self.clients.openWindow(`${targetUrl}${hash}`);
      }
      return null;
    })
  );
});

self.addEventListener('notificationclose', (event) => {
  const notifData = event.notification?.data || {};
  const notifId = notifData.notifId || '';
  if (!notifId) return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('student.html')) {
          client.postMessage({
            type: 'NOTIFICATION_CLOSED',
            notifId
          });
        }
      }
    })
  );
});
