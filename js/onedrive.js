// Đọc/ghi file OneDrive qua Microsoft Graph.
const OneDrive = (function () {
  const G = 'https://graph.microsoft.com/v1.0/me/drive/root:/';
  const enc = p => p.split('/').filter(Boolean).map(encodeURIComponent).join('/');

  async function call(url, opts = {}) {
    const token = await Auth.getToken();
    if (!token) throw new Error('Đang chuyển sang trang đăng nhập Microsoft...');
    const res = await fetch(url, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + token }, opts.headers) }));
    if (!res.ok) {
      let msg = res.status + ' ' + res.statusText;
      try { msg = (await res.json()).error.message; } catch (e) { /* bỏ qua */ }
      throw new Error('OneDrive: ' + msg);
    }
    return res;
  }

  async function listFolder(folder) {
    const res = await call(G + enc(folder) + ':/children?$select=name,size,lastModifiedDateTime,file&$top=200');
    return (await res.json()).value.filter(x => x.file);
  }

  function wildcard(pattern) {
    return new RegExp('^' + pattern.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
  }

  // Tìm file input của nhà máy: file mới nhất khớp mẫu tên
  async function findInputFile(factory) {
    const files = await listFolder(Config.get().oneDrive.inputFolder);
    const re = wildcard(factory.inputFile || '*.xlsx');
    const hits = files.filter(f => re.test(f.name)).sort((a, b) => b.lastModifiedDateTime.localeCompare(a.lastModifiedDateTime));
    return { match: hits[0] || null, all: files.filter(f => /\.xlsx?$/i.test(f.name)) };
  }

  async function download(folder, name) {
    const res = await call(G + enc(folder + '/' + name) + ':/content');
    return res.arrayBuffer();
  }

  async function upload(folder, name, blob) {
    const path = G + enc(folder + '/' + name);
    if (blob.size < 4 * 1024 * 1024) {
      await call(path + ':/content', { method: 'PUT', body: blob });
      return;
    }
    // File lớn (nhiều ảnh): dùng upload session, chia khúc 5 MB
    const sess = await (await call(path + ':/createUploadSession', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } })
    })).json();
    const CHUNK = 5 * 320 * 1024 * 4;
    for (let start = 0; start < blob.size; start += CHUNK) {
      const end = Math.min(start + CHUNK, blob.size);
      const r = await fetch(sess.uploadUrl, {
        method: 'PUT', body: blob.slice(start, end),
        headers: { 'Content-Range': `bytes ${start}-${end - 1}/${blob.size}` }
      });
      if (!r.ok) throw new Error('Upload lỗi ' + r.status);
    }
  }

  // Hàng đợi: khi offline, file kết quả được giữ lại và tự gửi khi có mạng
  async function queueUpload(name, blob, folder) {
    await DB.put('outbox', { id: Util.uid(), name, folder: folder || Config.get().oneDrive.outputFolder, blob, createdAt: Date.now() });
    return flushOutbox();
  }

  async function flushOutbox() {
    if (!navigator.onLine || !Auth.useMicrosoft()) return { sent: 0, pending: (await DB.all('outbox')).length };
    const items = await DB.all('outbox');
    let sent = 0;
    for (const it of items) {
      try { await upload(it.folder, it.name, it.blob); await DB.del('outbox', it.id); sent++; } catch (e) { console.warn(e); break; }
    }
    return { sent, pending: items.length - sent };
  }

  return { listFolder, findInputFile, download, upload, queueUpload, flushOutbox };
})();
