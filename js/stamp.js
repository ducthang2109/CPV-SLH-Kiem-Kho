// Vị trí GPS và đóng dấu ảnh: mọi ảnh chụp trong app đều in ngày giờ, tên nhà máy, địa chỉ, kinh độ / vĩ độ.
const Geo = (function () {
  let last = null; // vị trí gần nhất, dùng lại khi GPS chậm

  // GPS chạy được khi không có mạng; trong kho kín có thể lâu hoặc không bắt được
  function get(timeout = 20000) {
    return new Promise(resolve => {
      if (!navigator.geolocation) return resolve(last || { error: 'Thiết bị không hỗ trợ định vị' });
      navigator.geolocation.getCurrentPosition(
        p => {
          last = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy), at: Date.now() };
          resolve(last);
        },
        e => {
          const msg = e.code === 1 ? 'Chưa cho phép app dùng vị trí' : e.code === 3 ? 'Hết thời gian chờ GPS' : 'Không lấy được vị trí';
          // vị trí cũ trong 5 phút vẫn dùng được, kèm ghi chú
          if (last && Date.now() - last.at < 5 * 60000) return resolve(Object.assign({}, last, { stale: true }));
          resolve({ error: msg });
        },
        { enableHighAccuracy: true, timeout, maximumAge: 30000 }
      );
    });
  }

  // Khoảng cách (m) giữa hai toạ độ
  function distance(a, b) {
    const R = 6371000, rad = x => x * Math.PI / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)));
  }

  const fmt = g => g && !g.error ? `${g.lat.toFixed(6)}, ${g.lng.toFixed(6)} (±${g.acc} m)` : (g && g.error) || 'Không có GPS';

  return { get, distance, fmt, last: () => last };
})();

const Stamp = (function () {
  const two = n => String(n).padStart(2, '0');
  const dt = d => `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Không đọc được ảnh')); };
      img.src = url;
    });
  }

  function wrap(ctx, text, maxW) {
    const words = text.split(' '), lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }

  // Thu nhỏ ảnh + in dải thông tin ở cuối ảnh. Trả về { data, time, geo }
  async function photo(file, factory, opts = {}) {
    const [img, geo] = await Promise.all([loadImage(file), opts.geo ? Promise.resolve(opts.geo) : Geo.get()]);
    const now = new Date();
    const maxSize = opts.maxSize || 1280;
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    const fs = Math.max(16, Math.round(w / 30));
    ctx.font = `600 ${fs}px Roboto, Arial, sans-serif`;
    const pad = Math.round(fs * 0.6);
    const lines = [];
    if (opts.title) lines.push(opts.title);
    lines.push('Thời gian: ' + dt(now));
    lines.push('Nhà máy: ' + (factory.name || ''));
    if (factory.address) lines.push(...wrap(ctx, 'Địa chỉ: ' + factory.address, w - pad * 2));
    const geoLine = 'Vĩ độ, kinh độ: ' + Geo.fmt(geo) + (geo && geo.stale ? ' (vị trí gần nhất)' : '');
    lines.push(geoLine);
    if (opts.extra) lines.push(...wrap(ctx, opts.extra, w - pad * 2));

    const lh = Math.round(fs * 1.35);
    const boxH = lines.length * lh + pad * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, h - boxH, w, boxH);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => {
      ctx.fillStyle = (i === 0 && opts.title) ? '#ffd54f' : (l === geoLine && geo && geo.error ? '#ff8a80' : '#fff');
      ctx.fillText(l, pad, h - boxH + pad + i * lh);
    });

    return { data: c.toDataURL('image/jpeg', 0.75), time: now.toISOString(), geo };
  }

  return { photo, dt };
})();
