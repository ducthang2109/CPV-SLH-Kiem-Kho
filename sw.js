// Service worker: lưu toàn bộ app trên máy để chạy không cần mạng.
const CACHE = 'kiem-kho-v1.3.0';
const ASSETS = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/xlsx.full.min.js', 'vendor/pdfmake.min.js', 'vendor/vfs_fonts.js', 'vendor/msal-browser.min.js',
  'vendor/pdf.min.js', 'vendor/pdf.worker.min.js',
  'js/config.js', 'js/tcvn3.js', 'js/util.js', 'js/db.js', 'js/importer.js', 'js/auth.js',
  'js/onedrive.js', 'js/signature.js', 'js/stamp.js', 'js/viewer.js', 'js/reports.js', 'js/app.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Graph / đăng nhập đi thẳng ra mạng
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }))
  );
});
