const Util = (function () {
  const pad = n => String(n).padStart(2, '0');
  const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => isoDate(new Date());
  const toDate = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (iso, n) => { const d = toDate(iso); d.setDate(d.getDate() + n); return isoDate(d); };
  const diffDays = (a, b) => Math.round((toDate(a) - toDate(b)) / 86400000);
  const vnDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
  const vnDateTime = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
  const fmt = (n, dec = 2) => (n == null || n === '') ? '' : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: dec });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

  // Tình trạng hạn sử dụng so với ngày kiểm kê
  function expiry(item, countDate, cfg) {
    if (!item.prodDate || !item.shelfLife) return { status: 'unknown', label: 'Không rõ HSD', expDate: null, daysLeft: null };
    const expDate = addDays(item.prodDate, item.shelfLife);
    const daysLeft = diffDays(expDate, countDate);
    const nearLimit = Math.max(cfg.nearExpiryMinDays, Math.ceil(item.shelfLife * cfg.nearExpiryRatio));
    if (daysLeft < 0) return { status: 'expired', label: `Hết hạn ${-daysLeft} ngày`, expDate, daysLeft };
    if (daysLeft === 0) return { status: 'near', label: 'Hết hạn hôm nay', expDate, daysLeft };
    if (daysLeft <= nearLimit) return { status: 'near', label: `Sắp hết hạn (còn ${daysLeft} ngày)`, expDate, daysLeft };
    return { status: 'ok', label: `Còn hạn ${daysLeft} ngày`, expDate, daysLeft };
  }

  // Ghi giờ đếm của dòng hàng (để biết giờ bắt đầu / kết thúc kiểm từng kho)
  function touch(item) {
    const n = new Date().toISOString();
    if (!item.countedAt) item.countedAt = n;
    item.lastAt = n;
  }

  // Nhiều lần cân / quét tem cho một dòng hàng: SL và KL thực tế = tổng các lần
  function applyWeighs(item) {
    const w = item.weighs || [];
    if (!w.length) return;
    item.actualQty = round(w.reduce((a, x) => a + (Number(x.qty) || 0), 0));
    item.actualWgh = round(w.reduce((a, x) => a + (Number(x.wgh) || 0), 0));
  }

  // Đọc nội dung tem QR: tìm số lô / mã hàng có trong danh sách, khối lượng (số thập phân, ưu tiên số đứng trước "kg")
  function parseLabel(text, items) {
    const t = String(text || '').trim();
    const up = t.toUpperCase();
    const byLot = items.filter(i => i.lot && up.includes(String(i.lot).toUpperCase()));
    const byCode = items.filter(i => i.code && up.includes(String(i.code).toUpperCase()));
    let candidates = byLot.length ? byLot : byCode;
    if (byLot.length && byCode.length) {
      const both = byLot.filter(i => byCode.includes(i));
      if (both.length) candidates = both;
    }
    // Nhiều dòng cùng lô (khác mã hàng): thử khớp thêm theo tên hàng
    if (candidates.length > 1) {
      const low = t.toLowerCase();
      const byName = candidates.filter(i => i.name && low.includes(i.name.toLowerCase()));
      if (byName.length) candidates = byName;
    }
    let wgh = null;
    const kg = t.match(/(\d+(?:[.,]\d+)?)\s*kg/i);
    if (kg) wgh = Number(kg[1].replace(',', '.'));
    else {
      const dec = t.match(/(?:^|[^\d])(\d{1,4}[.,]\d{1,3})(?!\d)/);
      if (dec) wgh = Number(dec[1].replace(',', '.'));
    }
    return { text: t, item: candidates.length === 1 ? candidates[0] : null, candidates, wgh };
  }

  // Khối lượng thực tế: nếu không cân lại thì ước theo khối lượng bình quân/đơn vị trong sổ sách
  function actualWgh(item) {
    if (item.actualQty == null) return null;
    if (item.actualWgh != null) return item.actualWgh;
    return item.sysQty ? round(item.sysWgh / item.sysQty * item.actualQty) : 0;
  }

  function variance(item) {
    if (item.actualQty == null) return null;
    return { qty: round(item.actualQty - item.sysQty), wgh: round(actualWgh(item) - item.sysWgh) };
  }

  // Thu nhỏ ảnh chụp để lưu offline và đưa vào PDF
  function compressImage(file, maxSize = 1280, quality = 0.72) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Không đọc được ảnh')); };
      img.src = url;
    });
  }

  // Cắt ảnh (dataURL) theo tỉ lệ rộng/cao, lấy phần giữa — dùng cho ảnh bìa báo cáo
  function cropImage(dataUrl, ratio, maxW = 1600) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        let sw = img.width, sh = img.width / ratio;
        if (sh > img.height) { sh = img.height; sw = img.height * ratio; }
        const w = Math.min(maxW, Math.round(sw)), h = Math.round(w / ratio);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  // Đọc logo giữ nền trong suốt (PNG), thu nhỏ chiều rộng tối đa 900px
  function readLogo(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, 900 / img.width);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Không đọc được ảnh logo')); };
      img.src = url;
    });
  }

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function canShareFile(blob, name) {
    try { return !!(navigator.canShare && navigator.canShare({ files: [new File([blob], name, { type: blob.type })] })); } catch (e) { return false; }
  }

  // App mở bên trong Zalo / Facebook / Teams... (trình duyệt nhúng) thường chặn tải file và chia sẻ
  const inAppBrowser = /FBAN|FBAV|Instagram|Line\/|Zalo|MicroMessenger|Teams|; wv\)/i.test(navigator.userAgent);

  // Các hàm dưới phải được gọi ngay trong lần bấm nút (file đã tạo sẵn), nếu chờ lâu điện thoại sẽ chặn.
  function anchorDownload(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 60000);
  }

  // Mở file bằng trình xem của máy (tab mới). Dùng khi không tải được trực tiếp.
  function openExternal(blob) {
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  function download(blob, name) {
    // iPhone/iPad không tải file trực tiếp được: mở bảng Chia sẻ để chọn "Lưu vào Tệp"
    if (isIOS) {
      if (canShareFile(blob, name)) return share(blob, name);
      openExternal(blob);
      return Promise.resolve(true);
    }
    anchorDownload(blob, name);
    return Promise.resolve(true);
  }

  function share(blob, name) {
    // Android chỉ cho chia sẻ PDF/ảnh; chia sẻ file Excel sẽ bị "Permission denied" nên tải về luôn
    const shareable = isIOS || blob.type === 'application/pdf' || /^image\//.test(blob.type);
    if (shareable && canShareFile(blob, name)) {
      return navigator.share({ files: [new File([blob], name, { type: blob.type })], title: name })
        .then(() => true)
        .catch(e => {
          if (e.name === 'AbortError') return false; // người dùng tự đóng bảng chia sẻ
          // Bị chặn (mất lượt bấm, trình duyệt nhúng...): tải về thay thế để không mất file
          if (isIOS) openExternal(blob); else anchorDownload(blob, name);
          throw new Error('Máy không cho chia sẻ trực tiếp (' + e.name + '), đã chuyển sang tải file về.');
        });
    }
    // Loại file máy không cho chia sẻ trực tiếp (ví dụ Excel trên Android): tải về rồi gửi từ thư mục Tải xuống
    if (isIOS) openExternal(blob); else anchorDownload(blob, name);
    return Promise.resolve(false);
  }

  // Chia sẻ cả bộ file một lần (để lưu vào OneDrive qua app OneDrive).
  // Chrome Android báo "Permission denied" khi chia sẻ file Excel, nên chỉ chia sẻ các file PDF;
  // nếu máy vẫn chặn thì tải tất cả file về máy để không mất file. Trả về false nếu máy không hỗ trợ chia sẻ file.
  function shareMany(list) {
    const pdfs = list.filter(f => f.blob.type === 'application/pdf').map(f => new File([f.blob], f.name, { type: 'application/pdf' }));
    let ok = false;
    try { ok = !!(pdfs.length && navigator.canShare && navigator.canShare({ files: pdfs })); } catch (e) { ok = false; }
    if (!ok) return Promise.resolve(false);
    return navigator.share({ files: pdfs, title: 'Báo cáo kiểm kê' })
      .then(() => (pdfs.length < list.length ? 'pdf-only' : true))
      .catch(e => {
        if (e.name === 'AbortError') return 'cancel';
        list.forEach(f => anchorDownload(f.blob, f.name));
        throw new Error('Máy không cho chia sẻ (' + e.name + '). Đã tải ' + list.length + ' file về thư mục Tải xuống, mở app OneDrive → Tải lên để lưu vào Output.');
      });
  }

  const safeName = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^\w.-]+/g, '_');

  return { pad, isoDate, today, addDays, diffDays, vnDate, vnDateTime, fmt, uid, esc, round, expiry, actualWgh, variance, applyWeighs, parseLabel, touch, compressImage, cropImage, readLogo, sha256, download, share, shareMany, openExternal, safeName, isIOS, inAppBrowser, canShareFile };
})();
