// Service worker: lưu toàn bộ app trên máy để chạy không cần mạng.
// Có mạng thì lấy bản mới nhất từ máy chủ (để điện thoại không bị kẹt ở bản cũ), mất mạng thì dùng bản đã lưu.
const CACHE = 'kiem-kho-v2.5.0';
const ASSETS = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'assets/factory-default.jpg', 'assets/logo.png', 'assets/cp-mark.png',
  'vendor/xlsx.full.min.js', 'vendor/pdfmake.min.js', 'vendor/vfs_fonts.js', 'vendor/msal-browser.min.js',
  'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'vendor/html5-qrcode.min.js', 'vendor/pdf-lib.min.js',
  'js/config.js', 'js/tcvn3.js', 'js/util.js', 'js/db.js', 'js/importer.js', 'js/pdfstock.js', 'js/glossary.js', 'js/auth.js', 'js/cloud.js',
  'js/onedrive.js', 'js/signature.js', 'js/stamp.js', 'js/viewer.js', 'js/reports.js', 'js/reports2.js', 'js/master.js', 'js/checklist.js', 'js/app.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Thư viện lớn ít thay đổi: lấy từ bộ nhớ trước cho nhanh
const isVendor = url => url.pathname.includes('/vendor/');

function fromNetwork(req) {
  // Sóng yếu trong kho: chờ tối đa 4 giây rồi dùng bản đã lưu
  return Promise.race([
    fetch(req, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
  ]);
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Graph / đăng nhập đi thẳng ra mạng
  const cached = () => caches.match(e.request, { ignoreSearch: true });
  if (isVendor(url)) {
    e.respondWith(cached().then(hit => hit || fromNetwork(e.request)));
    return;
  }
  e.respondWith(fromNetwork(e.request).catch(() => cached().then(hit => hit || caches.match('index.html'))));
});
