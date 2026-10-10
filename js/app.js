// Giao diện app kiểm kê kho (điều hướng bằng #hash)
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const E = Util.esc, F = Util.fmt;
  const view = () => $('#view');
  let current = null; // phiên kiểm kê đang mở
  let saveTimer = null;

  // ---------- tiện ích giao diện ----------
  function toast(msg, type = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + type; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
  }
  function busy(on, text) {
    let b = $('#busy');
    if (!on) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('div'); b.id = 'busy'; document.body.appendChild(b); }
    b.innerHTML = `<div class="spinner"></div><div>${E(text || 'Đang xử lý...')}</div>`;
  }
  async function guard(fn, text) {
    busy(true, text);
    try { return await fn(); } catch (e) { console.error(e); toast(e.message || String(e), 'err'); } finally { busy(false); }
  }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function setTitle(t, back) {
    $('#title').textContent = t;
    $('#back').hidden = !back;
    $('#back').onclick = () => go(back);
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => current && DB.put('sessions', current), 400);
  }
  const factoryOf = code => Config.get().factories.find(f => f.code === code);

  // ---------- trạng thái mạng & hàng đợi ----------
  async function refreshNet() {
    const pending = (await DB.all('outbox')).length;
    const n = $('#net');
    n.className = navigator.onLine ? 'online' : 'offline';
    n.textContent = (navigator.onLine ? 'Online' : 'Offline') + (pending ? ` · ${pending} file chờ gửi` : '');
  }
  window.addEventListener('online', async () => { await OneDrive.flushOutbox().catch(() => {}); refreshNet(); });
  window.addEventListener('offline', refreshNet);

  // ---------- đăng nhập ----------
  function renderLogin() {
    setTitle('Đăng nhập');
    const cfg = Config.get();
    const ms = Auth.useMicrosoft();
    const noUsers = !cfg.localUsers.length;
    view().innerHTML = `
      <div class="card center-card">
        <img src="icons/icon-192.png" class="logo" alt="">
        <h2>CPV SLH Kiem Kho</h2>
        <p class="muted">${E(cfg.companyName)}</p>
        ${ms ? `<button class="btn primary block" id="msLogin">Đăng nhập tài khoản Microsoft công ty</button>
                <p class="muted small">Chỉ chấp nhận email: ${E((cfg.allowedDomains || []).join(', ') || 'mọi tên miền')}</p>` : ''}
        ${!ms && noUsers ? `
          <h3>Tạo tài khoản quản trị đầu tiên</h3>
          <input id="email" type="email" placeholder="Email công ty" autocomplete="username">
          <input id="name" placeholder="Họ và tên">
          <input id="pw" type="password" placeholder="Mật khẩu" autocomplete="new-password">
          <button class="btn primary block" id="create">Tạo tài khoản</button>
          <p class="muted small">Muốn dùng tài khoản Microsoft 365 + OneDrive? Nhập Client ID trong <a href="#settings">Cài đặt</a>.</p>` : ''}
        ${!noUsers ? `
          ${ms ? '<div class="sep">hoặc tài khoản nội bộ</div>' : ''}
          <input id="email" type="email" placeholder="Email công ty" autocomplete="username">
          <input id="pw" type="password" placeholder="Mật khẩu" autocomplete="current-password">
          <button class="btn ${ms ? '' : 'primary'} block" id="local">Đăng nhập</button>` : ''}
      </div>`;
    const ok = () => go('#factories');
    $('#msLogin') && ($('#msLogin').onclick = () => guard(Auth.loginMicrosoft, 'Đang mở trang đăng nhập Microsoft...'));
    $('#create') && ($('#create').onclick = () => guard(async () => {
      await Auth.addLocalUser($('#email').value, $('#name').value, $('#pw').value, true);
      await Auth.loginLocal($('#email').value, $('#pw').value); ok();
    }));
    $('#local') && ($('#local').onclick = () => guard(async () => { await Auth.loginLocal($('#email').value, $('#pw').value); ok(); }));
  }

  // ---------- chọn nhà máy ----------
  async function renderFactories() {
    const user = Auth.currentUser();
    setTitle('Chọn nhà máy');
    const cfg = Config.get();
    const datasets = await DB.all('datasets');
    const sessions = (await DB.all('sessions')).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    view().innerHTML = `
      <div class="hello">Xin chào <b>${E(user.name)}</b> · ${E(user.email)} · Ngày kiểm kê: <b>${Util.vnDate(Util.today())}</b></div>
      ${cfg.factories.map(f => {
        const ds = datasets.find(d => d.id === f.code);
        const open = sessions.filter(s => s.factory.code === f.code && s.status !== 'done');
        // Dữ liệu không tự cập nhật: nhắc tải lại khi file không phải của hôm nay
        const fileDay = ds && (ds.fileDate || ds.importedAt) ? Util.isoDate(new Date(ds.fileDate || ds.importedAt)) : null;
        const stale = ds && fileDay !== Util.today();
        return `<div class="card">
          <div class="row between"><h3>${E(f.name)}</h3><span class="tag">${E(f.code)}</span></div>
          <p class="muted small">${ds ? `Dữ liệu: ${E(ds.fileName)} · ${ds.items.length} dòng · ${ds.fileDate ? 'file cập nhật' : 'tải'} lúc ${Util.vnDateTime(ds.fileDate || ds.importedAt)}` : 'Chưa có dữ liệu tồn kho trên máy'}</p>
          ${stale ? '<p class="small warnc-text">Dữ liệu không phải của hôm nay. Nếu có file mới, bấm "Tải lại dữ liệu".</p>' : ''}
          ${open.map(s => `<button class="btn block warn" data-open="${s.id}">Tiếp tục phiên ${Util.vnDate(s.countDate)} · ${s.items.filter(i => i.actualQty != null).length}/${s.items.length} dòng</button>`).join('')}
          <div class="row gap">
            <button class="btn" data-import="${E(f.code)}">${ds ? 'Tải lại dữ liệu' : 'Tải dữ liệu'}</button>
            ${ds ? `<button class="btn primary" data-start="${E(f.code)}">Bắt đầu kiểm kê</button>` : ''}
          </div>
        </div>`;
      }).join('')}
      ${cfg.factories.length ? '' : '<div class="card">Chưa có nhà máy nào. Vào <a href="#settings">Cài đặt</a> để thêm.</div>'}
      <h3 class="section">Lịch sử kiểm kê</h3>
      ${sessions.filter(s => s.status === 'done').map(s => `
        <div class="card row between click" data-done="${s.id}">
          <div><b>${E(s.factory.name)}</b><div class="muted small">${Util.vnDate(s.countDate)} · ${E(Reports.docNo(s))} · ${E(s.user.name)}</div></div><span>›</span>
        </div>`).join('') || '<p class="muted">Chưa có.</p>'}`;
    $$('[data-import]').forEach(b => b.onclick = () => go('#import/' + b.dataset.import));
    $$('[data-start]').forEach(b => b.onclick = () => startSession(b.dataset.start));
    $$('[data-open]').forEach(b => b.onclick = () => go('#count/' + b.dataset.open));
    $$('[data-done]').forEach(b => b.onclick = () => go('#done/' + b.dataset.done));
  }

  // ---------- tải dữ liệu ----------
  async function renderImport(code) {
    const f = factoryOf(code);
    if (!f) return go('#factories');
    setTitle('Tải dữ liệu · ' + f.name, '#factories');
    const ms = Auth.useMicrosoft();
    view().innerHTML = `
      ${ms ? `<div class="card">
        <h3>Tự tìm trên OneDrive</h3>
        <p class="muted small">Thư mục: ${E(Config.get().oneDrive.inputFolder)} · mẫu tên file: ${E(f.inputFile || '*.xlsx')}</p>
        <button class="btn primary block" id="od">Tìm và tải file từ OneDrive</button>
        <div id="odList"></div>
      </div>` : ''}
      <div class="card">
        <h3>Lấy file qua app OneDrive trên điện thoại</h3>
        <p class="muted small">Không cần IT cài đặt gì. Điện thoại cần có app OneDrive đã đăng nhập tài khoản công ty. File chỉ lấy khi bạn bấm, không tự cập nhật.</p>
        <ul class="small steps">
          <li><b>Android:</b> bấm nút dưới → bấm ☰ (góc trái) → chọn <b>OneDrive</b> → Apps Kiem Kho → Input → chọn file ${E(f.inputFile || '')}.</li>
          <li><b>iPhone:</b> bấm nút dưới → <b>Chọn tệp</b> → Duyệt → <b>OneDrive</b> → Apps Kiem Kho → Input → chọn file.</li>
          <li>Không thấy OneDrive trong danh sách: mở app OneDrive, bấm ⋯ ở file → <b>Tải xuống</b> (Android) hoặc <b>Lưu vào Tệp</b> (iPhone), rồi chọn file vừa lưu.</li>
        </ul>
        <label class="btn ${ms ? '' : 'primary'} block">Chọn file Excel<input type="file" id="file" hidden accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"></label>
      </div>
      <div id="preview"></div>`;

    const load = (buf, name, fileDate) => guard(async () => {
      const ds = Importer.parse(buf, name);
      ds.id = code;
      ds.fileDate = fileDate || null;
      await DB.put('datasets', ds);
      showPreview(ds, f);
    }, 'Đang đọc file...');

    $('#file').onchange = async e => {
      const file = e.target.files[0];
      if (file) load(await file.arrayBuffer(), file.name, file.lastModified ? new Date(file.lastModified).toISOString() : null);
    };
    if ($('#od')) $('#od').onclick = () => guard(async () => {
      const { match, all } = await OneDrive.findInputFile(f);
      $('#odList').innerHTML = all.map(x => `<button class="btn block ${match && x.name === match.name ? 'primary' : ''}" data-f="${E(x.name)}">${E(x.name)} <span class="small">· ${Util.vnDateTime(x.lastModifiedDateTime)}</span></button>`).join('') || '<p class="muted">Không thấy file Excel trong thư mục.</p>';
      $$('#odList [data-f]').forEach(b => b.onclick = () => guard(async () => {
        const meta = all.find(x => x.name === b.dataset.f);
        load(await OneDrive.download(Config.get().oneDrive.inputFolder, b.dataset.f), b.dataset.f, meta && meta.lastModifiedDateTime);
      }, 'Đang tải từ OneDrive...'));
      if (match) toast('Tìm thấy ' + match.name);
    }, 'Đang tìm file trên OneDrive...');
  }

  function showPreview(ds, f) {
    const wh = {};
    ds.items.forEach(i => { wh[i.warehouse] = (wh[i.warehouse] || 0) + 1; });
    $('#preview').innerHTML = `
      <div class="card ok-card">
        <h3>Đã tải ${ds.items.length} dòng</h3>
        <p class="small">File: ${E(ds.fileName)} · Bảng mã: ${ds.encoding}${ds.encoding === 'TCVN3' ? ' (đã chuyển sang Unicode)' : ''}</p>
        ${ds.fileDate ? `<p class="small ${Util.isoDate(new Date(ds.fileDate)) === Util.today() ? '' : 'warnc-text'}">File cập nhật lúc ${Util.vnDateTime(ds.fileDate)}${Util.isoDate(new Date(ds.fileDate)) === Util.today() ? '' : ' (không phải hôm nay, kiểm tra lại có đúng file mới nhất không)'}</p>` : ''}
        ${ds.sites.length ? `<p class="small">Đơn vị trong file: ${ds.sites.map(E).join('; ')}</p>` : ''}
        <ul class="small">${Object.entries(wh).map(([k, v]) => `<li>${E(k)}: ${v} dòng</li>`).join('')}</ul>
        <p class="small muted">Dữ liệu đã lưu trên máy, có thể kiểm kê không cần mạng.</p>
        <button class="btn primary block" id="go">Bắt đầu kiểm kê</button>
      </div>`;
    $('#go').onclick = () => startSession(f.code);
    $('#preview').scrollIntoView({ behavior: 'smooth' });
  }

  async function startSession(code) {
    const ds = await DB.get('datasets', code);
    const f = factoryOf(code);
    const user = Auth.currentUser();
    const cfg = Config.get();
    const committee = cfg.committeeRoles.map(r => Object.assign({}, r, { signature: null }));
    const me = committee.find(c => /kế toán/i.test(c.role)) || committee[0];
    if (me && !me.name) me.name = user.name;
    const s = {
      id: Util.uid(),
      factory: { code: f.code, name: f.name, address: f.address || '', lat: f.lat, lng: f.lng },
      checkIn: null, checkOut: null,
      companyName: cfg.companyName,
      user: { email: user.email, name: user.name },
      countDate: Util.today(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      sourceFile: ds.fileName,
      status: 'counting',
      items: JSON.parse(JSON.stringify(ds.items)),
      committee,
      opinion: '', generalNote: '', trip: {}, generalPhotos: [], reporterSignature: null
    };
    await DB.put('sessions', s);
    go('#count/' + s.id);
  }

  async function loadSession(id) {
    if (current && current.id === id) return current;
    current = await DB.get('sessions', id);
    return current;
  }

  // ---------- kiểm kê ----------
  const filters = { q: '', wh: '', st: 'all', limit: 80 };

  async function renderCount(id) {
    const s = await loadSession(id);
    if (!s) return go('#factories');
    if (s.status === 'done') return go('#done/' + id);
    // Bước đầu tiên: chụp ảnh xác nhận kế toán có mặt tại nhà máy
    if (!s.checkIn) return renderCheckIn(s);
    // Ngày kiểm kê luôn là ngày hiện tại khi đang kiểm
    if (s.countDate !== Util.today()) { s.countDate = Util.today(); scheduleSave(); }
    setTitle(s.factory.name, '#factories');
    const whs = [...new Set(s.items.map(i => i.warehouse))];
    view().innerHTML = `
      <div class="sticky">
        <div class="row between small"><span>Ngày kiểm kê: <b>${Util.vnDate(s.countDate)}</b></span><span id="prog"></span></div>
        <div class="progress"><div id="bar"></div></div>
        <input id="q" type="search" placeholder="Tìm mã hàng, tên, số lô..." value="${E(filters.q)}">
        <div class="row gap">
          <select id="wh"><option value="">Tất cả kho (${whs.length})</option>${whs.map(w => `<option ${w === filters.wh ? 'selected' : ''}>${E(w)}</option>`).join('')}</select>
          <select id="st">
            ${[['all', 'Tất cả'], ['todo', 'Chưa kiểm'], ['done', 'Đã kiểm'], ['diff', 'Có chênh lệch'], ['expired', 'Hết hạn'], ['near', 'Sắp hết hạn'], ['extra', 'Ngoài sổ sách']]
              .map(([v, t]) => `<option value="${v}" ${filters.st === v ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
      </div>
      ${signedWarning(s)}
      <div id="list"></div>
      <div class="bottom-bar">
        <button class="btn" id="add">+ Hàng ngoài sổ sách</button>
        <button class="btn primary" id="review">Xem lại & ký ›</button>
      </div>`;
    $('#q').oninput = e => { filters.q = e.target.value; filters.limit = 80; drawList(); };
    $('#wh').onchange = e => { filters.wh = e.target.value; filters.limit = 80; drawList(); };
    $('#st').onchange = e => { filters.st = e.target.value; filters.limit = 80; drawList(); };
    $('#add').onclick = () => addExtra(s);
    $('#review').onclick = () => go('#review/' + s.id);
    drawList();
  }

  // ---------- ảnh xác nhận có mặt (bắt đầu / kết thúc) ----------
  function geoStatus(el, s) {
    el.innerHTML = '<span class="muted">Đang lấy vị trí GPS...</span>';
    Geo.get().then(g => {
      let txt = g.error ? `<span class="short">${E(g.error)}</span> · bật Vị trí (GPS) và cho phép app dùng vị trí` : `Vị trí: <b>${E(Geo.fmt(g))}</b>`;
      if (!g.error && s.factory.lat != null && s.factory.lng != null && s.factory.lat !== '') {
        const d = Geo.distance(g, { lat: Number(s.factory.lat), lng: Number(s.factory.lng) });
        txt += ` · cách nhà máy <b class="${d > 1000 ? 'short' : 'okc'}">${d >= 1000 ? (d / 1000).toFixed(1) + ' km' : d + ' m'}</b>`;
      }
      el.innerHTML = txt;
    });
  }

  function presenceCard(p) {
    if (!p) return '';
    return `<div class="presence"><img src="${p.data}" alt="ảnh xác nhận"><div class="small">
      ${E(Stamp.dt(new Date(p.time)))}<br>${E(Geo.fmt(p.geo))}</div></div>`;
  }

  async function takePresence(file, s, kind) {
    const user = Auth.currentUser();
    const title = (kind === 'in' ? 'BẮT ĐẦU KIỂM KÊ' : 'KẾT THÚC KIỂM KÊ') + ' · ' + user.name;
    return Stamp.photo(file, s.factory, { title, maxSize: 1280 });
  }

  function renderCheckIn(s) {
    setTitle('Bắt đầu kiểm kê', '#factories');
    view().innerHTML = `
      <div class="card">
        <h3>Bước 1: Chụp ảnh xác nhận có mặt</h3>
        <p class="small">Kế toán chụp ảnh của mình tại ${E(s.factory.name)}. App tự in lên ảnh: ngày giờ, tên nhà máy, địa chỉ, vĩ độ / kinh độ. Giờ chụp ảnh này là <b>giờ bắt đầu kiểm kê</b>.</p>
        <p class="small" id="gps"></p>
        <label class="btn primary block">📷 Chụp ảnh bắt đầu<input type="file" accept="image/*" capture="user" id="ci" hidden></label>
        <p class="muted small">Muốn chụp bằng camera sau thì đổi camera trong màn hình chụp.</p>
      </div>`;
    geoStatus($('#gps'), s);
    $('#ci').onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      guard(async () => {
        const p = await takePresence(file, s, 'in');
        s.checkIn = p;
        s.startedAt = p.time;
        s.countDate = Util.isoDate(new Date(p.time));
        await DB.put('sessions', s);
        if (p.geo && p.geo.error) toast('Ảnh đã lưu nhưng không có vị trí GPS: ' + p.geo.error, 'err');
        else toast('Đã ghi nhận giờ bắt đầu ' + Stamp.dt(new Date(p.time)));
        renderCount(s.id);
      }, 'Đang lấy vị trí và đóng dấu ảnh...');
    };
  }

  function signedWarning(s) {
    const n = s.committee.filter(c => c.signature).length + (s.reporterSignature ? 1 : 0);
    return n ? `<div class="card warn-card small">Biên bản đã có ${n} chữ ký. Nếu sửa số liệu, các chữ ký sẽ bị xóa để ký lại.</div>` : '';
  }

  function clearSignatures(s) {
    if (s.committee.some(c => c.signature) || s.reporterSignature) {
      s.committee.forEach(c => { c.signature = null; });
      s.reporterSignature = null;
      const w = $('.warn-card'); if (w) w.remove();
      toast('Số liệu thay đổi: đã xóa chữ ký, cần ký lại');
    }
  }

  function matches(it, s) {
    const cfg = Config.get();
    if (filters.wh && it.warehouse !== filters.wh) return false;
    if (filters.q) {
      const q = filters.q.toLowerCase();
      if (!(`${it.code} ${it.name} ${it.lot}`.toLowerCase().includes(q))) return false;
    }
    const v = Util.variance(it);
    switch (filters.st) {
      case 'todo': return it.actualQty == null;
      case 'done': return it.actualQty != null;
      case 'diff': return v && (v.qty !== 0 || Math.abs(v.wgh) > 0.0005);
      case 'expired': return Util.expiry(it, s.countDate, cfg).status === 'expired';
      case 'near': return Util.expiry(it, s.countDate, cfg).status === 'near';
      case 'extra': return it.isExtra;
    }
    return true;
  }

  function updateProgress(s) {
    const done = s.items.filter(i => i.actualQty != null).length;
    $('#prog').textContent = `Đã kiểm ${done}/${s.items.length}`;
    $('#bar').style.width = (s.items.length ? done / s.items.length * 100 : 0) + '%';
  }

  function drawList() {
    const s = current;
    const list = s.items.filter(it => matches(it, s));
    const shown = list.slice(0, filters.limit);
    $('#list').innerHTML = shown.map(it => itemCard(it, s)).join('') +
      (list.length > shown.length ? `<button class="btn block" id="more">Xem thêm ${list.length - shown.length} dòng</button>` : '') +
      (list.length ? '' : '<p class="muted center">Không có dòng nào.</p>');
    if ($('#more')) $('#more').onclick = () => { filters.limit += 100; drawList(); };
    $$('#list .item').forEach(el => bindItem(el, s));
    updateProgress(s);
  }

  function expBadge(it, s) {
    const e = Util.expiry(it, s.countDate, Config.get());
    return `<span class="badge ${e.status}">${E(e.label)}</span>`;
  }

  function varText(it) {
    const v = Util.variance(it);
    if (!v) return '<span class="muted">Chưa kiểm</span>';
    if (v.qty === 0 && Math.abs(v.wgh) <= 0.0005) return '<span class="okc">Khớp sổ sách</span>';
    const sg = n => (n > 0 ? '+' : '') + F(n);
    return `<span class="${v.qty > 0 || (v.qty === 0 && v.wgh > 0) ? 'over' : 'short'}">Chênh lệch: SL ${sg(v.qty)} · KL ${sg(v.wgh)} kg</span>`;
  }

  function itemCard(it, s) {
    const e = Util.expiry(it, s.countDate, Config.get());
    return `<div class="card item ${it.actualQty != null ? 'counted' : ''}" data-id="${it.id}">
      <div class="row between"><b>${E(it.code)}</b>${expBadge(it, s)}</div>
      <div class="name">${E(it.name)}${it.isExtra ? ' <span class="tag">ngoài sổ sách</span>' : ''}</div>
      <div class="meta">Lô <b>${E(it.lot)}</b> · ${E(it.warehouse)}</div>
      <div class="meta">NSX ${Util.vnDate(it.prodDate)} · Hạn dùng ${it.shelfLife} ngày · HSD ${Util.vnDate(e.expDate)}</div>
      <div class="meta">Sổ sách: <b>${F(it.sysQty)}</b> · ${F(it.sysWgh)} kg</div>
      <div class="row gap inputs">
        <label>SL thực tế<input type="number" inputmode="decimal" step="any" class="aq" value="${it.actualQty == null ? '' : it.actualQty}"></label>
        <label>KL thực tế (kg)<input type="number" inputmode="decimal" step="any" class="aw" placeholder="${it.actualQty != null ? F(Util.actualWgh(it)) : 'tự tính'}" value="${it.actualWgh == null ? '' : it.actualWgh}"></label>
        <button class="btn small-btn match" title="Đúng như sổ sách">= Sổ</button>
      </div>
      <div class="var">${varText(it)}</div>
      <div class="row gap tools">
        <label class="btn small-btn">📷 Ảnh<input type="file" accept="image/*" capture="environment" class="photo" hidden multiple></label>
        <button class="btn small-btn notebtn">📝 Ghi chú</button>
        ${it.isExtra ? '<button class="btn small-btn del">Xóa dòng</button>' : ''}
      </div>
      <textarea class="note" placeholder="Ghi chú (lý do chênh lệch, tình trạng hàng...)" ${it.note ? '' : 'hidden'}>${E(it.note)}</textarea>
      <div class="thumbs">${(it.photos || []).map((p, i) => `<div class="thumb"><img src="${p}" alt=""><button data-rm="${i}">×</button></div>`).join('')}</div>
    </div>`;
  }

  function bindItem(el, s) {
    const it = s.items.find(i => i.id === el.dataset.id);
    const refresh = () => {
      el.querySelector('.var').innerHTML = varText(it);
      el.classList.toggle('counted', it.actualQty != null);
      el.querySelector('.aw').placeholder = it.actualQty != null ? F(Util.actualWgh(it)) : 'tự tính';
      updateProgress(s); clearSignatures(s); scheduleSave();
    };
    const numOrNull = v => v === '' ? null : Number(v);
    el.querySelector('.aq').oninput = e => { it.actualQty = numOrNull(e.target.value); refresh(); };
    el.querySelector('.aw').oninput = e => { it.actualWgh = numOrNull(e.target.value); refresh(); };
    el.querySelector('.match').onclick = () => {
      it.actualQty = it.sysQty; it.actualWgh = null;
      el.querySelector('.aq').value = it.sysQty; el.querySelector('.aw').value = '';
      refresh();
    };
    el.querySelector('.notebtn').onclick = () => { const n = el.querySelector('.note'); n.hidden = !n.hidden; if (!n.hidden) n.focus(); };
    el.querySelector('.note').oninput = e => { it.note = e.target.value; scheduleSave(); };
    el.querySelector('.photo').onchange = async e => {
      const files = [...e.target.files];
      await guard(async () => {
        const geo = await Geo.get();
        for (const f of files) {
          const p = await Stamp.photo(f, s.factory, { geo, extra: `Hàng: ${it.code} - ${it.name} - Lô ${it.lot}` });
          it.photos.push(p.data);
        }
        await DB.put('sessions', s);
      }, 'Đang lấy vị trí và đóng dấu ảnh...');
      el.outerHTML = itemCard(it, s);
      bindItem($(`#list .item[data-id="${it.id}"]`), s);
    };
    $$('[data-rm]', el).forEach(b => b.onclick = () => {
      if (!confirm('Xóa ảnh này?')) return;
      it.photos.splice(Number(b.dataset.rm), 1); scheduleSave();
      el.outerHTML = itemCard(it, s);
      bindItem($(`#list .item[data-id="${it.id}"]`), s);
    });
    const del = el.querySelector('.del');
    if (del) del.onclick = () => {
      if (!confirm('Xóa dòng hàng ngoài sổ sách này?')) return;
      s.items = s.items.filter(i => i !== it); clearSignatures(s); scheduleSave(); drawList();
    };
  }

  function addExtra(s) {
    const whs = [...new Set(s.items.map(i => i.warehouse))];
    const d = document.createElement('div');
    d.className = 'modal';
    d.innerHTML = `<div class="card">
      <h3>Thêm hàng ngoài sổ sách</h3>
      <input id="xc" placeholder="Mã hàng">
      <input id="xn" placeholder="Tên hàng">
      <input id="xl" placeholder="Số lô">
      <select id="xw">${whs.map(w => `<option>${E(w)}</option>`).join('')}</select>
      <label class="small">Ngày sản xuất<input id="xd" type="date" value="${Util.today()}"></label>
      <input id="xs" type="number" inputmode="numeric" placeholder="Hạn dùng (số ngày)">
      <div class="row gap"><button class="btn" id="xcancel">Hủy</button><button class="btn primary" id="xok">Thêm</button></div>
    </div>`;
    document.body.appendChild(d);
    // Gợi ý tên/hạn dùng theo mã hàng đã có
    $('#xc', d).oninput = e => {
      const ref = s.items.find(i => i.code.toLowerCase() === e.target.value.trim().toLowerCase());
      if (ref) { $('#xn', d).value = ref.name; $('#xs', d).value = ref.shelfLife; }
    };
    $('#xcancel', d).onclick = () => d.remove();
    $('#xok', d).onclick = () => {
      const code = $('#xc', d).value.trim();
      if (!code) return toast('Nhập mã hàng', 'err');
      const wh = $('#xw', d).value;
      s.items.unshift({
        id: 'X' + Util.uid(), code, name: $('#xn', d).value.trim(), lot: $('#xl', d).value.trim(),
        warehouse: wh, warehouseCode: (wh.match(/^(\S+)\s-/) || [])[1] || '',
        prodDate: $('#xd', d).value || null, sysQty: 0, sysWgh: 0, ages: '', shelfLife: Number($('#xs', d).value) || 0,
        actualQty: null, actualWgh: null, note: '', photos: [], isExtra: true
      });
      d.remove(); clearSignatures(s); scheduleSave();
      filters.st = 'all'; filters.q = code; renderCount(s.id);
    };
  }

  // ---------- xem lại & ký ----------
  async function renderReview(id) {
    const s = await loadSession(id);
    if (!s) return go('#factories');
    if (s.status === 'done') return go('#done/' + id);
    setTitle('Xem lại & ký', '#count/' + id);
    const { items, sum } = Reports.summary(s);
    const diff = items.filter(i => i.var && (i.var.qty !== 0 || Math.abs(i.var.wgh) > 0.0005));
    const exp = items.filter(i => i.exp.status === 'expired' || i.exp.status === 'near');
    const todo = items.filter(i => i.actualQty == null);
    const sg = n => (n > 0 ? '+' : '') + F(n);
    const tr = s.trip || (s.trip = {});

    view().innerHTML = `
      <div class="stats">
        <div><b>${sum.counted}/${sum.lines}</b><span>đã kiểm</span></div>
        <div class="${diff.length ? 'bad' : ''}"><b>${diff.length}</b><span>chênh lệch</span></div>
        <div class="${sum.expired ? 'bad' : ''}"><b>${sum.expired}</b><span>hết hạn</span></div>
        <div class="${sum.near ? 'warnc' : ''}"><b>${sum.near}</b><span>sắp hết hạn</span></div>
      </div>
      <div class="card small">
        Sổ sách: ${F(sum.sysQty)} SL · ${F(sum.sysWgh)} kg<br>Thực tế: ${F(sum.actQty)} SL · ${F(sum.actWgh)} kg · ${sum.photos} ảnh
      </div>
      ${todo.length ? `<div class="card warn-card"><b>${todo.length} dòng chưa kiểm</b> (sẽ ghi "chưa KK" trên biên bản)
        <button class="btn small-btn" id="gotodo">Đi kiểm tiếp</button></div>` : ''}
      ${diff.length ? `<div class="card"><h3>Hàng chênh lệch</h3>${diff.map(i => `<div class="li"><b>${E(i.code)}</b> ${E(i.name)} · lô ${E(i.lot)}<br><span class="${i.var.qty >= 0 ? 'over' : 'short'}">SL ${sg(i.var.qty)} · KL ${sg(i.var.wgh)} kg</span>${i.note ? ' · ' + E(i.note) : ''}${i.photos.length ? ` · 📷${i.photos.length}` : ''}</div>`).join('')}</div>` : ''}
      ${exp.length ? `<div class="card"><h3>Cảnh báo hạn sử dụng</h3>${exp.map(i => `<div class="li"><b>${E(i.code)}</b> ${E(i.name)} · lô ${E(i.lot)} · HSD ${Util.vnDate(i.exp.expDate)} <span class="badge ${i.exp.status}">${E(i.exp.label)}</span></div>`).join('')}</div>` : ''}

      <div class="card">
        <h3>Biên bản</h3>
        <label>Kho (in dưới tiêu đề)<input id="store" value="${E(s.storeTitle || '')}" placeholder="${E(Reports.storeTitle(Object.assign({}, s, { storeTitle: '' })))}"></label>
        <label>Ý kiến giải quyết số chênh lệch<textarea id="opinion">${E(s.opinion)}</textarea></label>
        <label>Ghi chú chung<textarea id="gnote">${E(s.generalNote)}</textarea></label>
      </div>

      <div class="card">
        <h3>Báo cáo đi kiểm kê kho</h3>
        <label>Mục đích<textarea id="tp" placeholder="Mặc định: kiểm kê định kỳ, đối chiếu sổ sách, kiểm tra HSD">${E(tr.purpose || '')}</textarea></label>
        <label>Nhận xét, kết luận<textarea id="tc">${E(tr.conclusion || '')}</textarea></label>
        <label>Kiến nghị<textarea id="tk">${E(tr.recommendation || '')}</textarea></label>
        <button class="btn small-btn" id="auto">Gợi ý nội dung từ kết quả</button>
        <h4>Hình ảnh hiện trường</h4>
        <label class="btn small-btn">📷 Thêm ảnh<input type="file" accept="image/*" capture="environment" id="gph" hidden multiple></label>
        <div class="thumbs">${s.generalPhotos.map((p, i) => `<div class="thumb"><img src="${p.data}" alt=""><button data-grm="${i}">×</button></div>`).join('')}</div>
      </div>

      <div class="card">
        <h3>Ảnh bắt đầu / kết thúc kiểm kê</h3>
        <p class="small">Bắt đầu:</p>
        ${presenceCard(s.checkIn) || '<p class="muted small">Chưa có</p>'}
        <p class="small">Kết thúc: ${s.checkOut ? '' : '<span class="short">chưa chụp, bắt buộc trước khi kết thúc</span>'}</p>
        ${presenceCard(s.checkOut)}
        <p class="small" id="gps"></p>
        <label class="btn ${s.checkOut ? '' : 'primary'} block">📷 ${s.checkOut ? 'Chụp lại ảnh kết thúc' : 'Chụp ảnh kết thúc'}<input type="file" accept="image/*" capture="user" id="co" hidden></label>
      </div>

      <div class="card">
        <h3>Xem trước</h3>
        <div class="row gap">
          <button class="btn small-btn" id="pv1">Biên bản kiểm kê</button>
          <button class="btn small-btn" id="pv2">Báo cáo đi kiểm kê</button>
        </div>
      </div>

      <div class="card">
        <h3>Ban kiểm kê ký xác nhận</h3>
        <div id="committee"></div>
        <button class="btn small-btn" id="addm">+ Thêm thành viên</button>
      </div>
      <div class="card">
        <h3>Người lập báo cáo: ${E(s.user.name)}</h3>
        ${sigBox('rep', s.reporterSignature)}
      </div>
      <div class="bottom-bar">
        <button class="btn" id="back2">‹ Kiểm tiếp</button>
        <button class="btn primary" id="finish">Kết thúc & xuất biên bản</button>
      </div>`;

    const bindText = (sel, fn) => { $(sel).oninput = e => { fn(e.target.value); scheduleSave(); }; };
    bindText('#store', v => { s.storeTitle = v.trim(); });
    bindText('#opinion', v => { s.opinion = v; });
    bindText('#gnote', v => { s.generalNote = v; });
    bindText('#tp', v => { tr.purpose = v; });
    bindText('#tc', v => { tr.conclusion = v; });
    bindText('#tk', v => { tr.recommendation = v; });
    if ($('#gotodo')) $('#gotodo').onclick = () => { filters.st = 'todo'; go('#count/' + id); };
    $('#back2').onclick = () => go('#count/' + id);
    $('#auto').onclick = () => {
      const parts = [`Đã kiểm ${sum.counted}/${sum.lines} dòng hàng tại ${new Set(items.map(i => i.warehouse)).size} kho.`];
      parts.push(diff.length ? `Có ${diff.length} dòng chênh lệch so với sổ sách (${sum.overLines} thừa, ${sum.shortLines} thiếu).` : 'Số lượng thực tế khớp với sổ sách.');
      if (sum.expired || sum.near) parts.push(`Có ${sum.expired} dòng hết hạn và ${sum.near} dòng sắp hết hạn.`);
      if (todo.length) parts.push(`Còn ${todo.length} dòng chưa kiểm được.`);
      tr.conclusion = tr.conclusion || parts.join(' ');
      const rec = [];
      if (diff.length) rec.push('Thủ kho và kế toán đối chiếu chứng từ nhập/xuất, giải trình nguyên nhân chênh lệch và điều chỉnh sổ sách sau khi được phê duyệt.');
      if (sum.expired) rec.push('Cách ly, lập biên bản xử lý/hủy hàng đã hết hạn.');
      if (sum.near) rec.push('Ưu tiên xuất bán/sử dụng hàng sắp hết hạn (FEFO).');
      if (!rec.length) rec.push('Duy trì công tác quản lý kho hiện tại.');
      tr.recommendation = tr.recommendation || rec.join('\n');
      if (!s.opinion && diff.length) s.opinion = 'Giao thủ kho giải trình nguyên nhân chênh lệch; kế toán điều chỉnh sổ sách theo kết quả kiểm kê sau khi được Giám đốc phê duyệt.';
      scheduleSave(); renderReview(id);
    };
    $('#gph').onchange = async e => {
      const files = [...e.target.files];
      await guard(async () => {
        const geo = await Geo.get();
        for (const f of files) {
          const p = await Stamp.photo(f, s.factory, { geo });
          s.generalPhotos.push({ data: p.data, caption: '', time: p.time, geo: p.geo });
        }
        await DB.put('sessions', s);
      }, 'Đang lấy vị trí và đóng dấu ảnh...');
      renderReview(id);
    };
    $$('[data-grm]').forEach(b => b.onclick = () => { s.generalPhotos.splice(Number(b.dataset.grm), 1); scheduleSave(); renderReview(id); });
    $('#addm').onclick = () => { s.committee.push({ role: 'Ủy viên', title: '', name: '', signature: null }); scheduleSave(); drawCommittee(s); };
    bindSig('rep', () => s.reporterSignature, v => { s.reporterSignature = v; });
    drawCommittee(s);
    geoStatus($('#gps'), s);
    $('#co').onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      guard(async () => {
        s.checkOut = await takePresence(file, s, 'out');
        await DB.put('sessions', s);
        if (s.checkOut.geo && s.checkOut.geo.error) toast('Ảnh đã lưu nhưng không có vị trí GPS: ' + s.checkOut.geo.error, 'err');
        renderReview(id);
      }, 'Đang lấy vị trí và đóng dấu ảnh...');
    };
    const preview = (doc, title) => guard(async () => {
      await DB.put('sessions', s);
      const blob = await Reports.toBlob(doc());
      Viewer.open(blob, title + ' (bản nháp)');
    }, 'Đang tạo bản xem trước...');
    $('#pv1').onclick = () => preview(() => Reports.inventoryDoc(s, true), 'Biên bản kiểm kê');
    $('#pv2').onclick = () => preview(() => Reports.tripDoc(s), 'Báo cáo đi kiểm kê');
    $('#finish').onclick = () => finish(s);
  }

  function sigBox(key, sig) {
    return `<div class="sig" data-sig="${key}">
      ${sig ? `<img src="${sig}" class="sigimg" alt="chữ ký"><div class="row gap"><button class="btn small-btn" data-resign>Ký lại</button></div>`
        : `<canvas class="pad"></canvas><div class="row gap"><button class="btn small-btn" data-clear>Xóa</button><button class="btn small-btn primary" data-save>Xác nhận chữ ký</button></div>`}
    </div>`;
  }

  function bindSig(key, get, set) {
    const box = $(`[data-sig="${key}"]`);
    if (!box) return;
    const redraw = () => { box.outerHTML = sigBox(key, get()); bindSig(key, get, set); };
    const resign = box.querySelector('[data-resign]');
    if (resign) { resign.onclick = () => { set(null); scheduleSave(); redraw(); }; return; }
    const pad = SignaturePad(box.querySelector('canvas'));
    box.querySelector('[data-clear]').onclick = () => pad.clear();
    box.querySelector('[data-save]').onclick = () => {
      if (pad.isEmpty()) return toast('Chưa ký', 'err');
      set(pad.toDataURL()); scheduleSave(); redraw();
    };
  }

  function drawCommittee(s) {
    $('#committee').innerHTML = s.committee.map((m, i) => `
      <div class="member" data-i="${i}">
        <div class="row gap">
          <input class="mr" placeholder="Chức danh (in dưới chữ ký)" value="${E(m.role)}">
          <input class="mt" placeholder="Ghi thêm (không bắt buộc)" value="${E(m.title)}">
        </div>
        <div class="row gap"><input class="mn" placeholder="Họ và tên" value="${E(m.name)}"><button class="btn small-btn mdel" title="Xóa">✕</button></div>
        ${sigBox('m' + i, m.signature)}
      </div>`).join('');
    $$('#committee .member').forEach(el => {
      const m = s.committee[Number(el.dataset.i)];
      el.querySelector('.mr').oninput = e => { m.role = e.target.value; scheduleSave(); };
      el.querySelector('.mt').oninput = e => { m.title = e.target.value; scheduleSave(); };
      el.querySelector('.mn').oninput = e => { m.name = e.target.value; scheduleSave(); };
      el.querySelector('.mdel').onclick = () => { if (confirm('Xóa thành viên này?')) { s.committee.splice(Number(el.dataset.i), 1); scheduleSave(); drawCommittee(s); } };
      bindSig('m' + el.dataset.i, () => m.signature, v => { m.signature = v; });
    });
  }

  async function finish(s) {
    if (!s.checkOut) {
      toast('Chụp ảnh kết thúc kiểm kê trước khi kết thúc', 'err');
      $('#co').closest('.card').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const members = s.committee.filter(m => m.name.trim());
    if (!members.length) return toast('Nhập tên ít nhất một thành viên ban kiểm kê', 'err');
    const unsigned = members.filter(m => !m.signature).map(m => m.name);
    const todo = s.items.filter(i => i.actualQty == null).length;
    let msg = 'Kết thúc kiểm kê và khóa số liệu?';
    if (todo) msg += `\n- ${todo} dòng chưa kiểm.`;
    if (unsigned.length) msg += `\n- Chưa ký: ${unsigned.join(', ')}.`;
    if (!confirm(msg)) return;
    // Giữ cả chức danh chưa có tên để bản ký tay vẫn có chỗ ký
    s.committee = s.committee.filter(m => m.name.trim() || m.role.trim() || m.signature);
    s.status = 'done';
    s.finishedAt = new Date().toISOString();
    await DB.put('sessions', s);
    await guard(async () => {
      const files = await buildFiles(s);
      // Lưu sẵn file để các nút Xem / Tải về / Chia sẻ chạy ngay khi bấm
      await DB.put('files', { id: s.id, files });
      if (Auth.useMicrosoft()) {
        // Bản biên bản trống chữ ký + báo cáo + Excel trả về thư mục Output để ký thêm bên ngoài
        for (const k of ['unsigned', 'signed', 'trip', 'excel']) await DB.put('outbox', { id: Util.uid(), name: files[k].name, folder: Config.get().oneDrive.outputFolder, blob: files[k].blob, createdAt: Date.now() });
        const r = await OneDrive.flushOutbox().catch(() => ({ sent: 0 }));
        toast(r.sent ? `Đã gửi ${r.sent} file lên OneDrive/Output` : 'Đang offline: file sẽ tự gửi lên OneDrive khi có mạng');
      }
    }, 'Đang tạo biên bản PDF...');
    refreshNet();
    go('#done/' + s.id);
  }

  async function buildFiles(s) {
    const n = Reports.fileNames(s);
    return {
      signed: { name: n.signed, blob: await Reports.toBlob(Reports.inventoryDoc(s, true)) },
      unsigned: { name: n.unsigned, blob: await Reports.toBlob(Reports.inventoryDoc(s, false)) },
      trip: { name: n.trip, blob: await Reports.toBlob(Reports.tripDoc(s)) },
      excel: { name: n.excel, blob: Reports.excelBlob(s) }
    };
  }

  // ---------- hoàn tất ----------
  async function renderDone(id) {
    const s = await loadSession(id);
    if (!s) return go('#factories');
    setTitle('Kết quả kiểm kê', '#factories');
    const { sum } = Reports.summary(s);
    const n = Reports.fileNames(s);
    const ms = Auth.useMicrosoft();
    view().innerHTML = `
      <div class="card ok-card">
        <h3>${E(Reports.docNo(s))}</h3>
        <p class="small">${E(s.factory.name)} · ${Util.vnDate(s.countDate)} · kết thúc ${Util.vnDateTime(s.finishedAt)}<br>
        Đã kiểm ${sum.counted}/${sum.lines} dòng · ${sum.overLines} thừa · ${sum.shortLines} thiếu · ${sum.expired} hết hạn · ${sum.near} sắp hết hạn</p>
      </div>
      ${[['signed', 'Biên bản kiểm kê (đã ký trên app)', n.signed], ['unsigned', 'Biên bản để in ký tay', n.unsigned], ['trip', 'Báo cáo đi kiểm kê kho', n.trip], ['excel', 'File Excel kết quả', n.excel]].map(([k, t, fn]) => `
        <div class="card">
          <b>${t}</b><div class="muted small">${E(fn)}</div>
          <div class="row gap">
            ${k !== 'excel' ? `<button class="btn small-btn" data-view="${k}">Xem</button>` : ''}
            <button class="btn small-btn" data-dl="${k}">Tải về</button>
            <button class="btn small-btn" data-share="${k}">Chia sẻ</button>
            ${ms ? `<button class="btn small-btn" data-up="${k}">Gửi OneDrive</button>` : ''}
          </div>
        </div>`).join('')}
      <p class="muted small">${Util.isIOS ? 'iPhone: nút Tải về mở bảng Chia sẻ, chọn "Lưu vào Tệp" để lưu file.' : 'File tải về nằm trong thư mục Tải xuống (Download) của điện thoại.'}</p>
      <button class="btn block" id="reopen">Mở lại để sửa (xóa chữ ký)</button>`;

    // File được tạo sẵn (lúc kết thúc hoặc ngay khi mở màn hình này) và giữ trong bộ nhớ,
    // vì điện thoại chỉ cho tải/chia sẻ khi lệnh chạy ngay trong lần bấm.
    let files = (await DB.get('files', s.id) || {}).files;
    if (!files) {
      busy(true, 'Đang tạo file...');
      try { files = await buildFiles(s); await DB.put('files', { id: s.id, files }); } catch (e) { toast(e.message, 'err'); } finally { busy(false); }
    }
    if (!files) return;
    const act = (fn) => { try { const p = fn(); if (p && p.catch) p.catch(e => toast(e.message, 'err')); } catch (e) { toast(e.message, 'err'); } };
    const doDownload = f => act(() => Util.download(f.blob, f.name));
    const doShare = f => act(() => Util.share(f.blob, f.name));
    $$('[data-view]').forEach(b => b.onclick = () => {
      const f = files[b.dataset.view];
      Viewer.open(f.blob, f.name, [{ label: 'Tải về', run: () => doDownload(f) }, { label: 'Chia sẻ', run: () => doShare(f) }]);
    });
    $$('[data-dl]').forEach(b => b.onclick = () => doDownload(files[b.dataset.dl]));
    $$('[data-share]').forEach(b => b.onclick = () => doShare(files[b.dataset.share]));
    $$('[data-up]').forEach(b => b.onclick = () => guard(async () => {
      const f = files[b.dataset.up];
      const r = await OneDrive.queueUpload(f.name, f.blob);
      toast(r.sent ? 'Đã gửi lên OneDrive/Output' : 'Đã xếp hàng, sẽ gửi khi có mạng');
      refreshNet();
    }, 'Đang gửi...'));
    $('#reopen').onclick = async () => {
      if (!confirm('Mở lại phiên kiểm kê? Toàn bộ chữ ký sẽ bị xóa.')) return;
      s.status = 'counting'; s.finishedAt = null;
      s.committee.forEach(c => { c.signature = null; }); s.reporterSignature = null;
      await DB.put('sessions', s); await DB.del('files', s.id); go('#review/' + s.id);
    };
  }

  // ---------- cài đặt ----------
  function renderSettings() {
    const user = Auth.currentUser();
    setTitle('Cài đặt', user ? '#factories' : '#login');
    const c = Config.get();
    const canEdit = !user || user.provider === 'microsoft' || user.admin || !c.localUsers.length;
    if (!canEdit) { view().innerHTML = '<div class="card">Chỉ tài khoản quản trị được sửa cài đặt.</div>'; return; }
    view().innerHTML = `
      <div class="card">
        <h3>Công ty</h3>
        <label>Tên công ty<input id="cn" value="${E(c.companyName)}"></label>
        <label>Tên miền email được phép (cách nhau dấu phẩy)<input id="dom" value="${E((c.allowedDomains || []).join(', '))}"></label>
        <label>Tên hệ thống sổ sách (cột (1) trên biên bản)<input id="sysn" value="${E(c.systemName || '')}"></label>
      </div>
      <div class="card">
        <h3>Microsoft 365 / OneDrive</h3>
        <label>Client ID (Azure AD app)<input id="cid" value="${E(c.msal.clientId)}" placeholder="xxxxxxxx-xxxx-..."></label>
        <label>Tenant ID<input id="tid" value="${E(c.msal.tenantId)}"></label>
        <label>Thư mục Input<input id="inf" value="${E(c.oneDrive.inputFolder)}"></label>
        <label>Thư mục Output<input id="outf" value="${E(c.oneDrive.outputFolder)}"></label>
        <p class="muted small">Redirect URI cần đăng ký trong Azure: ${E(location.origin + location.pathname)}</p>
      </div>
      <div class="card">
        <h3>Nhà máy</h3>
        <div id="facs">${c.factories.map(f => facRow(f)).join('')}</div>
        <button class="btn small-btn" id="addf">+ Thêm nhà máy</button>
      </div>
      <div class="card">
        <h3>Cảnh báo hạn sử dụng</h3>
        <label>Sắp hết hạn khi còn ≤ (% hạn dùng)<input id="ratio" type="number" value="${c.nearExpiryRatio * 100}"></label>
        <label>và tối thiểu (ngày)<input id="mind" type="number" value="${c.nearExpiryMinDays}"></label>
      </div>
      <div class="card">
        <h3>Người ký biên bản mặc định</h3>
        <textarea id="roles" rows="6">${E(c.committeeRoles.map(r => [r.role, r.title, r.name].join(' | ')).join('\n'))}</textarea>
        <p class="muted small">Mỗi dòng: Chức danh | Ghi thêm | Họ tên</p>
      </div>
      <button class="btn primary block" id="save">Lưu cài đặt</button>
      <div class="card">
        <h3>Tài khoản nội bộ</h3>
        ${c.localUsers.map(u => `<div class="row between li"><span>${E(u.name)} · ${E(u.email)}${u.admin ? ' · quản trị' : ''}</span><button class="btn small-btn" data-rmu="${E(u.email)}">Xóa</button></div>`).join('') || '<p class="muted small">Chưa có</p>'}
        <input id="ue" type="email" placeholder="Email"><input id="un" placeholder="Họ tên"><input id="up" type="password" placeholder="Mật khẩu">
        <label class="row gap small"><input type="checkbox" id="ua" style="width:auto"> Quản trị</label>
        <button class="btn small-btn" id="addu">Thêm tài khoản</button>
      </div>
      ${user ? '<button class="btn block" id="logout">Đăng xuất</button>' : ''}
      <p class="muted small center">Phiên bản ${window.APP_VERSION}</p>`;

    $('#addf').onclick = () => $('#facs').insertAdjacentHTML('beforeend', facRow({ code: '', name: '', address: '', inputFile: '' }));
    $('#facs').onclick = e => {
      if (e.target.matches('.fdel')) e.target.closest('.fac').remove();
      if (e.target.matches('.fhere')) {
        const input = $('.fg', e.target.closest('.fac'));
        guard(async () => {
          const g = await Geo.get();
          if (g.error) throw new Error(g.error);
          input.value = `${g.lat.toFixed(6)}, ${g.lng.toFixed(6)}`;
        }, 'Đang lấy vị trí...');
      }
    };
    $('#save').onclick = () => {
      const factories = $$('#facs .fac').map(r => ({
        code: $('.fc', r).value.trim(), name: $('.fn', r).value.trim(), address: $('.fa', r).value.trim(), inputFile: $('.ff', r).value.trim(),
        ...parseLatLng($('.fg', r).value)
      })).filter(f => f.code && f.name);
      const committeeRoles = $('#roles').value.split('\n').map(l => l.split('|').map(x => x.trim())).filter(a => a[0] || a[1])
        .map(([role, title, name]) => ({ role: role || '', title: title || '', name: name || '' }));
      Config.save({
        companyName: $('#cn').value.trim(),
        systemName: $('#sysn').value.trim(),
        allowedDomains: $('#dom').value.split(',').map(x => x.trim()).filter(Boolean),
        msal: { clientId: $('#cid').value.trim(), tenantId: $('#tid').value.trim() || 'organizations' },
        oneDrive: { inputFolder: $('#inf').value.trim(), outputFolder: $('#outf').value.trim() },
        factories, committeeRoles,
        nearExpiryRatio: Number($('#ratio').value) / 100 || 0.25,
        nearExpiryMinDays: Number($('#mind').value) || 0
      });
      toast('Đã lưu. App sẽ tải lại.');
      setTimeout(() => location.reload(), 800);
    };
    $('#addu').onclick = () => guard(async () => {
      await Auth.addLocalUser($('#ue').value, $('#un').value, $('#up').value, $('#ua').checked);
      toast('Đã thêm tài khoản'); renderSettings();
    });
    $$('[data-rmu]').forEach(b => b.onclick = () => { if (confirm('Xóa tài khoản ' + b.dataset.rmu + '?')) { Auth.removeLocalUser(b.dataset.rmu); renderSettings(); } });
    if ($('#logout')) $('#logout').onclick = () => { Auth.logout(); current = null; go('#login'); };
  }

  function facRow(f) {
    return `<div class="fac">
      <div class="row gap"><input class="fc" placeholder="Mã" value="${E(f.code)}" style="max-width:90px"><input class="fn" placeholder="Tên nhà máy" value="${E(f.name)}"></div>
      <div class="row gap"><input class="fa" placeholder="Địa chỉ (in trên biên bản)" value="${E(f.address || '')}"><input class="ff" placeholder="Tên file input, vd FDREPORT-333*.xlsx" value="${E(f.inputFile || '')}"></div>
      <div class="row gap"><input class="fg" placeholder="Toạ độ nhà máy: vĩ độ, kinh độ (để đối chiếu ảnh)" value="${f.lat != null && f.lat !== '' ? E(f.lat + ', ' + f.lng) : ''}"><button class="btn small-btn fhere">Lấy vị trí hiện tại</button></div>
      <button class="btn small-btn fdel">Xóa nhà máy</button>
    </div>`;
  }

  function parseLatLng(v) {
    const m = String(v || '').match(/(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)/);
    return m ? { lat: Number(m[1]), lng: Number(m[2]) } : { lat: null, lng: null };
  }

  // ---------- điều hướng ----------
  async function route() {
    const [page, arg] = location.hash.replace(/^#/, '').split('/');
    const user = Auth.currentUser();
    if (page === 'settings') return renderSettings();
    if (!user) return renderLogin();
    window.scrollTo(0, 0);
    switch (page) {
      case 'import': return renderImport(arg);
      case 'count': return renderCount(arg);
      case 'review': return renderReview(arg);
      case 'done': return renderDone(arg);
      default: return renderFactories();
    }
  }

  async function boot() {
    const setHdr = () => document.documentElement.style.setProperty('--hdr', ($('header').offsetHeight - 1) + 'px');
    setHdr(); window.addEventListener('resize', setHdr);
    $('#settingsBtn').onclick = () => go('#settings');
    $('#net').onclick = () => guard(async () => { const r = await OneDrive.flushOutbox(); toast(`Đã gửi ${r.sent}, còn chờ ${r.pending}`); refreshNet(); }, 'Đang đồng bộ...');
    try { await Auth.init(); } catch (e) { toast(e.message, 'err'); }
    window.addEventListener('hashchange', route);
    window.addEventListener('pagehide', () => current && DB.put('sessions', current));
    refreshNet();
    route();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
  }
  boot();
})();
