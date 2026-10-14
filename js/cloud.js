// Dữ liệu dùng chung cho mọi máy: lưu trong một repo GitHub RIÊNG TƯ (khác repo app công khai).
//   shared/config.json          : nhà máy (Master), tài khoản nội bộ, người ký, mẫu checklist...
//   history/YYYY-MM.json        : lịch sử các lần kiểm (ai, nhà máy nào, giờ bắt đầu/kết thúc, kết quả, file)
//   files/YYYY/MM/<số BB>/<file>: biên bản, báo cáo PDF, Excel của từng lần kiểm
// Mỗi máy chỉ cần nhập "mã kết nối" (repo + token GitHub chỉ có quyền trên repo dữ liệu) một lần.
const Cloud = (function () {
  const KEY = 'kk_cloud';
  const QUEUE = 'kk_cloud_queue';
  const API = 'https://api.github.com';
  // Các phần cài đặt dùng chung giữa các máy
  const SHARED = ['companyName', 'allowedDomains', 'systemName', 'factories', 'factoriesVersion', 'masterFile', 'masterAt',
    'committeeRoles', 'nearExpiryRatio', 'nearExpiryMinDays', 'localUsers', 'msal', 'oneDrive', 'glossary'];

  function settings() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  const enabled = () => { const s = settings(); return !!(s && s.repo && s.token); };

  // Mã kết nối = base64 của {repo, token}: quản trị viên gửi riêng cho từng kế toán (Zalo/Teams), không đăng công khai
  function makeCode(s) { return 'KK1.' + btoa(unescape(encodeURIComponent(JSON.stringify({ r: s.repo, t: s.token, b: s.branch || 'main' })))); }
  function readCode(code) {
    code = String(code || '').trim();
    if (/^(github_pat_|ghp_)/.test(code)) return { repo: '', token: code };
    const m = code.match(/^KK1\.(.+)$/);
    if (!m) throw new Error('Mã kết nối không đúng');
    const o = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    return { repo: o.r, token: o.t, branch: o.b || 'main' };
  }

  async function req(method, path, body, accept) {
    const s = settings();
    if (!s) throw new Error('Chưa kết nối dữ liệu chung');
    const r = await fetch(`${API}/repos/${s.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}${method === 'GET' ? '?ref=' + (s.branch || 'main') : ''}`, {
      method,
      headers: Object.assign({ Authorization: 'Bearer ' + s.token, Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    });
    if (r.status === 404 && method === 'GET') return null;
    if (r.status === 401) throw new Error('Mã kết nối dữ liệu chung hết hạn hoặc sai (401)');
    if (!r.ok) { const e = new Error(`Lỗi lưu dữ liệu chung (${r.status})`); e.status = r.status; throw e; }
    return r;
  }

  const b64 = str => btoa(unescape(encodeURIComponent(str)));
  const unb64 = str => decodeURIComponent(escape(atob(str.replace(/\n/g, ''))));
  async function blobB64(blob) {
    const d = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
    return d.slice(d.indexOf(',') + 1);
  }

  async function getJson(path) {
    const r = await req('GET', path);
    if (!r) return { data: null, sha: null };
    const j = await r.json();
    if (j.content == null || j.encoding === 'none') { // file > 1MB
      const raw = await req('GET', path, null, 'application/vnd.github.raw');
      return { data: JSON.parse(await raw.text()), sha: j.sha };
    }
    return { data: JSON.parse(unb64(j.content)), sha: j.sha };
  }
  async function shaOf(path) { const r = await req('GET', path); return r ? (await r.json()).sha : null; }

  function who() { const u = Auth.currentUser(); return u ? u.name : 'app'; }
  async function putRaw(path, content64, sha, msg) {
    const s = settings();
    return req('PUT', path, { message: msg || `${who()}: ${path}`, content: content64, sha: sha || undefined, branch: s.branch || 'main' });
  }

  // Đọc - sửa - ghi có thử lại khi máy khác vừa ghi cùng file (409/422)
  async function updateJson(path, fn, msg) {
    for (let i = 0; i < 4; i++) {
      const { data, sha } = await getJson(path);
      const next = fn(data);
      try { await putRaw(path, b64(JSON.stringify(next, null, 1)), sha, msg); return next; } catch (e) {
        if (!(e.status === 409 || e.status === 422) || i === 3) throw e;
        await new Promise(r => setTimeout(r, 600 * (i + 1)));
      }
    }
  }

  async function putFile(path, blob, msg) {
    const sha = await shaOf(path);
    await putRaw(path, await blobB64(blob), sha, msg);
  }
  async function getBlob(path) {
    const r = await req('GET', path, null, 'application/vnd.github.raw');
    if (!r) throw new Error('Không tìm thấy file trên dữ liệu chung');
    return r.blob();
  }

  // ----- kết nối -----
  // code: mã kết nối KK1... hoặc token GitHub (khi đó cần repo)
  async function connect(code, repo) {
    const c = readCode(code);
    if (!c.repo) c.repo = String(repo || '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
    if (!c.repo) throw new Error('Nhập tên repo dữ liệu, vd ducthang2109/CPV-SLH-Kiem-Kho-Data');
    localStorage.setItem(KEY, JSON.stringify(c));
    try {
      const r = await fetch(`${API}/repos/${c.repo}`, { headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json' } });
      if (!r.ok) throw new Error(r.status === 404 || r.status === 401 ? 'Mã kết nối sai hoặc không có quyền vào repo dữ liệu' : 'Không kết nối được (' + r.status + ')');
      const j = await r.json();
      if (!j.private) throw new Error('Repo dữ liệu phải để Private để bảo vệ dữ liệu công ty');
      if (j.permissions && !j.permissions.push) throw new Error('Mã kết nối chỉ có quyền đọc, cần quyền ghi (Contents: Read and write)');
    } catch (e) { localStorage.removeItem(KEY); throw e; }
    return pullConfig();
  }
  function disconnect() { localStorage.removeItem(KEY); }

  // ----- cài đặt + tài khoản dùng chung -----
  async function pullConfig() {
    const { data } = await getJson('shared/config.json');
    if (!data) { await pushConfig(); return { created: true }; }
    const patch = {};
    SHARED.forEach(k => { if (data[k] !== undefined) patch[k] = data[k]; });
    Config.save(patch, { fromCloud: true });
    if (data.checklist) localStorage.setItem('kk_checklist', JSON.stringify(data.checklist)); else localStorage.removeItem('kk_checklist');
    localStorage.setItem('kk_cloud_pulled', new Date().toISOString());
    return { users: (data.localUsers || []).length, factories: (data.factories || []).length, updatedAt: data.updatedAt, updatedBy: data.updatedBy };
  }
  async function pushConfig() {
    if (!enabled()) return;
    const c = Config.get();
    const data = {};
    SHARED.forEach(k => { data[k] = c[k]; });
    try { const cl = JSON.parse(localStorage.getItem('kk_checklist') || 'null'); if (cl) data.checklist = cl; } catch (e) { /* bỏ qua */ }
    data.updatedAt = new Date().toISOString(); data.updatedBy = who();
    await updateJson('shared/config.json', () => data, `${who()}: cập nhật cài đặt dùng chung`);
  }
  // Ghi cài đặt chung, không có mạng thì để lần sau
  function pushConfigSoon() {
    if (!enabled()) return;
    localStorage.setItem('kk_cloud_cfg_dirty', '1');
    pushConfig().then(() => localStorage.removeItem('kk_cloud_cfg_dirty')).catch(e => console.warn('pushConfig', e));
  }

  // ----- lịch sử + file -----
  const monthOf = date => date.slice(0, 7);
  async function saveHistory(rec) {
    await updateJson(`history/${monthOf(rec.date)}.json`, d => {
      const list = (d && d.records) || [];
      // Lần kiểm đã bị quản trị viên xóa thì không ghi lại
      if (d && (d.deleted || []).some(x => x.id === rec.id)) return d;
      const i = list.findIndex(x => x.id === rec.id);
      if (i >= 0) list[i] = Object.assign({}, list[i], rec); else list.push(rec);
      return Object.assign({}, d || {}, { records: list });
    }, `${who()}: lịch sử ${rec.docNo || rec.id}`);
  }
  async function loadHistory(year) {
    const r = await req('GET', 'history');
    if (!r) return [];
    const files = (await r.json()).filter(f => f.type === 'file' && f.name.startsWith(year ? year + '-' : '') && f.name.endsWith('.json'));
    const out = [];
    for (const f of files) { const { data } = await getJson('history/' + f.name); if (data && data.records) out.push(...data.records); }
    return out;
  }

  // Lịch sử năm: đọc từ dữ liệu chung, lưu bản sao trên máy để xem khi không có mạng
  async function historyYear(year) {
    const key = 'kk_cloud_hist_' + year;
    if (navigator.onLine) {
      try { const list = await loadHistory(year); localStorage.setItem(key, JSON.stringify({ at: new Date().toISOString(), list })); return { list, at: new Date().toISOString(), live: true }; } catch (e) { console.warn('history', e); }
    }
    try { const c = JSON.parse(localStorage.getItem(key) || 'null'); if (c) return { list: c.list, at: c.at, live: false }; } catch (e) { /* bỏ qua */ }
    return { list: [], at: null, live: false };
  }
  function cachedHistory(year) { try { return (JSON.parse(localStorage.getItem('kk_cloud_hist_' + year) || 'null') || {}).list || null; } catch (e) { return null; } }

  async function deleteFile(path, msg) {
    const sha = await shaOf(path);
    if (!sha) return;
    await req('DELETE', path, { message: msg || `${who()}: xóa ${path}`, sha, branch: settings().branch || 'main' });
  }
  // Quản trị viên xóa một lần kiểm thừa: bỏ dòng lịch sử và các file của lần kiểm đó
  async function deleteHistory(rec) {
    for (const f of rec.files || []) { try { await deleteFile(f.path, `${who()}: xóa ${f.name}`); } catch (e) { console.warn('xóa file', f.path, e); } }
    await updateJson(`history/${monthOf(rec.date)}.json`, d => ({ records: ((d && d.records) || []).filter(x => x.id !== rec.id), deleted: ((d && d.deleted) || []).concat({ id: rec.id, docNo: rec.docNo, by: who(), at: new Date().toISOString() }) }),
      `${who()}: xóa lịch sử ${rec.docNo || rec.id}`);
    const key = 'kk_cloud_hist_' + rec.date.slice(0, 4);
    const list = cachedHistory(rec.date.slice(0, 4));
    if (list) localStorage.setItem(key, JSON.stringify({ at: new Date().toISOString(), list: list.filter(x => x.id !== rec.id) }));
  }

  // File Input (file tồn, Master...) do script đồng bộ trên máy tính đẩy lên: lọc theo mẫu "Thư mục/Tên*.xlsx", mới nhất trước
  async function inputFiles(pattern) {
    const { data } = await getJson('input/_index.json');
    const list = (data && data.files) || [];
    const p = String(pattern || '*').replace(/\\/g, '/');
    const folder = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    const glob = p.slice(p.lastIndexOf('/') + 1) || '*';
    const re = new RegExp('^' + glob.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
    return list.filter(x => (x.folder || '').toLowerCase() === folder.toLowerCase() && re.test(x.name) && /\.(xlsx|xls|pdf|csv)$/i.test(x.name))
      .sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
  }

  // Hàng đợi: id phiên cần gửi lên (gửi khi có mạng)
  const queue = () => { try { return JSON.parse(localStorage.getItem(QUEUE) || '[]'); } catch (e) { return []; } };
  const setQueue = q => localStorage.setItem(QUEUE, JSON.stringify([...new Set(q)]));
  function enqueue(id) { setQueue(queue().concat(id)); }

  // upload(s, files, summary): gửi file + ghi lịch sử. files = { key: { name, blob } }
  async function upload(s, files, rec) {
    const base = `files/${rec.date.slice(0, 4)}/${rec.date.slice(5, 7)}/${rec.docNo}`;
    rec.files = [];
    for (const [k, f] of Object.entries(files || {})) {
      if (!f || !f.blob) continue;
      const path = `${base}/${f.name}`;
      await putFile(path, f.blob, `${who()}: ${f.name}`);
      rec.files.push({ key: k, name: f.name, path, size: f.blob.size });
    }
    rec.uploadedAt = new Date().toISOString();
    await saveHistory(rec);
    return rec;
  }

  return { enabled, settings, makeCode, readCode, connect, disconnect, pullConfig, pushConfig, pushConfigSoon, saveHistory, loadHistory, historyYear, cachedHistory, deleteHistory, inputFiles, upload, getBlob, queue, setQueue, enqueue };
})();
