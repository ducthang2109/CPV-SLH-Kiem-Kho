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
    const ok = () => go('#home');
    $('#msLogin') && ($('#msLogin').onclick = () => guard(Auth.loginMicrosoft, 'Đang mở trang đăng nhập Microsoft...'));
    $('#create') && ($('#create').onclick = () => guard(async () => {
      await Auth.addLocalUser($('#email').value, $('#name').value, $('#pw').value, true);
      await Auth.loginLocal($('#email').value, $('#pw').value); ok();
    }));
    $('#local') && ($('#local').onclick = () => guard(async () => { await Auth.loginLocal($('#email').value, $('#pw').value); ok(); }));
  }

  // ---------- trang đầu: chọn loại kiểm ----------
  const TYPES = {
    branch: { icon: '🏭', name: 'Kiểm tra chi nhánh', desc: 'Checklist Đạt / Không đạt theo mẫu kiểm tra nhà máy, kèm ảnh và ký xác nhận' },
    meat: { icon: '🥩', name: 'Kiểm kê kho Meat', desc: 'Thành phẩm thịt: số lượng, trọng lượng, lô, hạn sử dụng, quét tem' },
    supplies: { icon: '📦', name: 'Kiểm kê kho Spare part, Supplies, Package, Ingredient', desc: 'Vật tư, phụ tùng, bao bì, nguyên liệu: đếm số lượng theo mã SAP' }
  };
  const typeOf = s => (s && s.type) || 'meat';
  const dsId = (code, type) => type === 'supplies' ? 'S:' + code : code;

  async function renderHome() {
    const user = Auth.currentUser();
    setTitle('CPV SLH Kiem Kho');
    const open = (await DB.all('sessions')).filter(s => s.status !== 'done').sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    view().innerHTML = `
      <div class="hello">Xin chào <b>${E(user.name)}</b> · ${E(user.email)} · Hôm nay: <b>${Util.vnDate(Util.today())}</b></div>
      <h3 class="section">Bạn đi kiểm gì?</h3>
      ${Object.entries(TYPES).map(([k, t], i) => `
        <div class="card type-card click" data-type="${k}">
          <div class="type-no">${i + 1}</div>
          <div><div class="type-name">${t.icon} ${E(t.name)}</div><div class="muted small">${E(t.desc)}</div></div>
          <span class="chev">›</span>
        </div>`).join('')}
      <div class="card type-card click dash" data-dash>
        <div class="type-no">📊</div>
        <div><div class="type-name">Dashboard & lịch sử kiểm kho</div><div class="muted small">Theo năm, tháng, timeline từng kế toán</div></div>
        <span class="chev">›</span>
      </div>
      ${open.length ? `<h3 class="section">Phiên đang làm dở</h3>${open.map(s => `
        <div class="card row between click" data-open="${s.id}">
          <div><b>${E(TYPES[typeOf(s)].name)}</b><div class="muted small">${E(s.factory.name)} · ${Util.vnDate(s.countDate)}</div></div><span>›</span>
        </div>`).join('')}` : ''}`;
    $$('[data-type]').forEach(b => b.onclick = () => go('#factories/' + b.dataset.type));
    $('[data-dash]').onclick = () => go('#dashboard');
    $$('[data-open]').forEach(b => b.onclick = () => go('#count/' + b.dataset.open));
  }

  // ---------- chọn nhà máy (theo loại kiểm) ----------
  async function renderFactories(type) {
    type = TYPES[type] ? type : 'meat';
    setTitle(TYPES[type].name, '#home');
    const cfg = Config.get();
    const datasets = await DB.all('datasets');
    const sessions = (await DB.all('sessions')).filter(s => typeOf(s) === type).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    view().innerHTML = `
      <div class="hello">${TYPES[type].icon} ${E(TYPES[type].desc)} · Ngày: <b>${Util.vnDate(Util.today())}</b></div>
      ${cfg.masterFile ? `<p class="muted small">Danh sách nhà máy từ file Master: ${E(cfg.masterFile)} (${Util.vnDateTime(cfg.masterAt)})</p>` : ''}
      ${cfg.factories.map(f => {
        const ds = type === 'branch' ? null : datasets.find(d => d.id === dsId(f.code, type));
        const open = sessions.filter(s => s.factory.code === f.code && s.status !== 'done');
        const fileDay = ds && (ds.stockDate || ds.fileDate || ds.importedAt) ? (ds.stockDate || Util.isoDate(new Date(ds.fileDate || ds.importedAt))) : null;
        const stale = ds && fileDay !== Util.today();
        return `<div class="card">
          <div class="row between"><h3>${E(f.name)}</h3><span class="tag">${E(f.code)}</span></div>
          ${f.address ? `<p class="muted small">${E(f.address)}</p>` : ''}
          ${type !== 'branch' ? `<p class="muted small">${ds ? `Dữ liệu: ${E(ds.fileName)} · ${ds.items.length} dòng${ds.stockDate ? ' · tồn ngày ' + Util.vnDate(ds.stockDate) : ''}` : 'Chưa có dữ liệu tồn kho trên máy'}</p>
          ${stale ? '<p class="small warnc-text">Dữ liệu không phải của hôm nay. Nếu có file mới, bấm "Tải lại dữ liệu".</p>' : ''}` : ''}
          ${open.map(s => `<button class="btn block warn" data-open="${s.id}">Tiếp tục phiên ${Util.vnDate(s.countDate)}${type === 'branch' ? '' : ` · ${s.items.filter(i => i.actualQty != null).length}/${s.items.length} dòng`}</button>`).join('')}
          <div class="row gap">
            ${type !== 'branch' ? `<button class="btn" data-import="${E(f.code)}">${ds ? 'Tải lại dữ liệu' : 'Tải dữ liệu'}</button>` : ''}
            ${type === 'branch' || ds ? `<button class="btn primary" data-start="${E(f.code)}">${type === 'branch' ? 'Bắt đầu kiểm tra' : 'Bắt đầu kiểm kê'}</button>` : ''}
          </div>
        </div>`;
      }).join('')}
      ${cfg.factories.length ? '' : '<div class="card">Chưa có nhà máy nào. Vào <a href="#settings">Cài đặt</a> để nạp file Master nhà máy.</div>'}
      <h3 class="section">Lịch sử ${E(TYPES[type].name.toLowerCase())}</h3>
      ${sessions.filter(s => s.status === 'done').map(s => `
        <div class="card row between click" data-done="${s.id}">
          <div><b>${E(s.factory.name)}</b><div class="muted small">${Util.vnDate(s.countDate)} · ${E(docNoOf(s))} · ${E(s.user.name)}</div></div><span>›</span>
        </div>`).join('') || '<p class="muted">Chưa có.</p>'}`;
    $$('[data-import]').forEach(b => b.onclick = () => go('#import/' + b.dataset.import + '/' + type));
    $$('[data-start]').forEach(b => b.onclick = () => startSession(b.dataset.start, type));
    $$('[data-open]').forEach(b => b.onclick = () => go('#count/' + b.dataset.open));
    $$('[data-done]').forEach(b => b.onclick = () => go('#done/' + b.dataset.done));
  }

  // ---------- tải dữ liệu ----------
  async function renderImport(code, type) {
    type = type === 'supplies' ? 'supplies' : 'meat';
    const f = factoryOf(code);
    if (!f) return go('#factories/' + type);
    setTitle('Tải dữ liệu · ' + f.name, '#factories/' + type);
    const ms = Auth.useMicrosoft();
    const pattern = type === 'supplies' ? (f.suppliesFile || '*.xlsx') : (f.inputFile || '*.xlsx');
    view().innerHTML = `
      ${ms ? `<div class="card">
        <h3>Tự tìm trên OneDrive</h3>
        <p class="muted small">Thư mục: ${E(Config.get().oneDrive.inputFolder)} · mẫu tên file: ${E(pattern)}</p>
        <button class="btn primary block" id="od">Tìm và tải file từ OneDrive</button>
        <div id="odList"></div>
      </div>` : ''}
      <div class="card">
        <h3>Lấy file qua app OneDrive trên điện thoại</h3>
        <p class="muted small">${type === 'supplies' ? 'File tồn vật tư cần các cột: Mã SAP, Tên sản phẩm, ĐVT, Số lượng, Kho (mẫu: Mau_TonKho_VatTu.xlsx trong Input).' : 'File tồn kho theo mẫu FDREPORT (có ORG_CODE thì app tự nhận nhà máy).'} File chỉ lấy khi bạn bấm, không tự cập nhật.</p>
        <ul class="small steps">
          <li><b>Android:</b> bấm nút dưới → ☰ → <b>OneDrive</b> → Apps Kiem Kho → Input → chọn file ${E(pattern)}.</li>
          <li><b>iPhone:</b> bấm nút dưới → <b>Chọn tệp</b> → Duyệt → <b>OneDrive</b> → Apps Kiem Kho → Input → chọn file.</li>
        </ul>
        <label class="btn ${ms ? '' : 'primary'} block">Chọn file Excel<input type="file" id="file" hidden accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"></label>
      </div>
      <div id="preview"></div>`;

    const load = (buf, name, fileDate) => guard(async () => {
      const ds = Importer.parse(buf, name, type);
      let target = f;
      // File có ORG_CODE: tự liên kết với nhà máy trong Master
      if (ds.orgCode && ds.orgCode !== f.code) {
        const other = factoryOf(ds.orgCode);
        if (other && confirm(`File này của nhà máy ${other.name} (${ds.orgCode}), không phải ${f.name}. Lưu dữ liệu cho ${other.name}?`)) target = other;
        else if (!other) toast(`File có ORG_CODE ${ds.orgCode} chưa có trong Master nhà máy`, 'err');
      }
      ds.id = dsId(target.code, type);
      ds.fileDate = fileDate || null;
      await DB.put('datasets', ds);
      showPreview(ds, target, type);
    }, 'Đang đọc file...');

    $('#file').onchange = async e => {
      const file = e.target.files[0];
      if (file) load(await file.arrayBuffer(), file.name, file.lastModified ? new Date(file.lastModified).toISOString() : null);
    };
    if ($('#od')) $('#od').onclick = () => guard(async () => {
      const { folder, match, all } = await OneDrive.findInputFile(Object.assign({}, f, { inputFile: pattern }));
      $('#odList').innerHTML = all.map(x => `<button class="btn block ${match && x.name === match.name ? 'primary' : ''}" data-f="${E(x.name)}">${E(x.name)} <span class="small">· ${Util.vnDateTime(x.lastModifiedDateTime)}</span></button>`).join('') || '<p class="muted">Không thấy file Excel trong thư mục.</p>';
      $$('#odList [data-f]').forEach(b => b.onclick = () => guard(async () => {
        const meta = all.find(x => x.name === b.dataset.f);
        load(await OneDrive.download(folder, b.dataset.f), b.dataset.f, meta && meta.lastModifiedDateTime);
      }, 'Đang tải từ OneDrive...'));
      if (match) toast('Tìm thấy ' + match.name);
    }, 'Đang tìm file trên OneDrive...');
  }

  function showPreview(ds, f, type) {
    const wh = {};
    ds.items.forEach(i => { wh[i.warehouse] = (wh[i.warehouse] || 0) + 1; });
    $('#preview').innerHTML = `
      <div class="card ok-card">
        <h3>Đã tải ${ds.items.length} dòng · ${E(f.name)}</h3>
        <p class="small">File: ${E(ds.fileName)}${ds.orgCode ? ' · ORG_CODE ' + E(ds.orgCode) : ''}${ds.stockDate ? ' · tồn ngày ' + Util.vnDate(ds.stockDate) : ''} · Bảng mã: ${ds.encoding}</p>
        ${ds.fileDate ? `<p class="small ${Util.isoDate(new Date(ds.fileDate)) === Util.today() ? '' : 'warnc-text'}">File cập nhật lúc ${Util.vnDateTime(ds.fileDate)}${Util.isoDate(new Date(ds.fileDate)) === Util.today() ? '' : ' (không phải hôm nay, kiểm tra lại có đúng file mới nhất không)'}</p>` : ''}
        <ul class="small">${Object.entries(wh).map(([k, v]) => `<li>${E(k)}: ${v} dòng</li>`).join('')}</ul>
        <p class="small muted">Dữ liệu đã lưu trên máy, có thể kiểm kê không cần mạng.</p>
        <button class="btn primary block" id="go">Bắt đầu kiểm kê</button>
      </div>`;
    $('#go').onclick = () => startSession(f.code, type);
    $('#preview').scrollIntoView({ behavior: 'smooth' });
  }

  // Chọn kho cần kiểm (không bắt buộc kiểm hết)
  function pickWarehouses(ds) {
    const counts = new Map();
    ds.items.forEach(i => counts.set(i.warehouse, (counts.get(i.warehouse) || 0) + 1));
    return new Promise(resolve => {
      const d = document.createElement('div');
      d.className = 'modal';
      d.innerHTML = `<div class="card">
        <h3>Chọn kho để kiểm</h3>
        <p class="muted small">Chỉ những kho được chọn mới có trong danh sách kiểm và trên biên bản.</p>
        <label class="row gap check"><input type="checkbox" id="whall" checked> <b>Tất cả kho</b></label>
        ${[...counts].map(([w, n], i) => `<label class="row gap check"><input type="checkbox" class="whc" value="${i}" checked> ${E(w)} <span class="muted small">(${n} dòng)</span></label>`).join('')}
        <div class="row gap"><button class="btn" id="whcancel">Hủy</button><button class="btn primary" id="whok">Bắt đầu</button></div>
      </div>`;
      document.body.appendChild(d);
      const list = [...counts.keys()];
      const boxes = $$('.whc', d);
      $('#whall', d).onchange = e => boxes.forEach(b => { b.checked = e.target.checked; });
      boxes.forEach(b => b.onchange = () => { $('#whall', d).checked = boxes.every(x => x.checked); });
      $('#whcancel', d).onclick = () => { d.remove(); resolve(null); };
      $('#whok', d).onclick = () => {
        const chosen = boxes.filter(b => b.checked).map(b => list[Number(b.value)]);
        if (!chosen.length) return toast('Chọn ít nhất một kho', 'err');
        d.remove(); resolve(chosen);
      };
    });
  }

  // Người ký mặc định theo loại kiểm, tên lấy từ Master nhà máy
  function defaultCommittee(type, f, user) {
    const sg = f.signers || {};
    if (type === 'branch') return [
      { role: 'Đại diện nhà máy', title: '', name: sg.storeManager || '' },
      { role: 'Người kiểm', title: '', name: user.name },
      { role: 'Kế toán trưởng', title: '', name: '' },
      { role: 'Giám đốc', title: '', name: sg.director || '' }
    ];
    if (type === 'supplies') return [
      { role: 'Nhân Viên Kho', title: '', name: sg.storekeeper || '' },
      { role: 'Quản lý kho', title: '', name: sg.storeManager || '' },
      { role: 'Kế Toán', title: '', name: sg.accountant || user.name },
      { role: 'Giám Đốc Nhà Máy', title: '', name: sg.director || '' }
    ];
    const list = Config.get().committeeRoles.map(r => Object.assign({}, r));
    list.forEach(r => {
      if (r.name) return;
      if (/kế toán/i.test(r.role)) r.name = sg.accountant || user.name;
      else if (/giám đốc/i.test(r.role)) r.name = sg.director || '';
      else if (/quản lý kho/i.test(r.role)) r.name = sg.storeManager || '';
      else if (/nhân viên kho/i.test(r.role)) r.name = sg.storekeeper || '';
    });
    return list;
  }

  function checklistTemplate() {
    try { const c = JSON.parse(localStorage.getItem('kk_checklist')); if (c && c.sections) return c; } catch (e) { /* bỏ qua */ }
    return window.DEFAULT_CHECKLIST;
  }

  async function startSession(code, type) {
    type = TYPES[type] ? type : 'meat';
    const f = factoryOf(code);
    let ds = null, chosen = [];
    if (type !== 'branch') {
      ds = await DB.get('datasets', dsId(code, type));
      chosen = await pickWarehouses(ds);
      if (!chosen) return;
    }
    const user = Auth.currentUser();
    const cfg = Config.get();
    const committee = defaultCommittee(type, f, user).map(r => Object.assign(r, { signature: null }));
    const s = {
      id: Util.uid(),
      type,
      factory: { code: f.code, name: f.name, shortName: f.shortName || '', address: f.address || '', lat: f.lat, lng: f.lng,
        systemName: f.systemName || '', suppliesSystem: f.suppliesSystem || '', signers: f.signers || {} },
      checkIn: null, checkOut: null,
      companyName: f.company || cfg.companyName,
      user: { email: user.email, name: user.name },
      countDate: Util.today(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      sourceFile: ds ? ds.fileName : '',
      status: 'counting',
      items: ds ? JSON.parse(JSON.stringify(ds.items.filter(i => chosen.includes(i.warehouse)))) : [],
      warehouses: chosen,
      allWarehouses: ds ? [...new Set(ds.items.map(i => i.warehouse))] : [],
      checklist: type === 'branch' ? JSON.parse(JSON.stringify(checklistTemplate())) : null,
      productType: '',
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
    if (!s) return go('#home');
    if (s.status === 'done') return go('#done/' + id);
    // Bước đầu tiên: chụp ảnh xác nhận kế toán có mặt tại nhà máy
    if (!s.checkIn) return renderCheckIn(s);
    if (typeOf(s) === 'branch') return renderChecklist(s);
    // Ngày kiểm kê luôn là ngày hiện tại khi đang kiểm
    if (s.countDate !== Util.today()) { s.countDate = Util.today(); scheduleSave(); }
    setTitle(s.factory.name, '#factories/' + typeOf(s));
    const whs = [...new Set(s.items.map(i => i.warehouse))];
    view().innerHTML = `
      <div class="sticky">
        <div class="row between small"><span>Ngày kiểm kê: <b>${Util.vnDate(s.countDate)}</b></span><span id="prog"></span></div>
        <div class="progress"><div id="bar"></div></div>
        <div class="row gap search-row">
          <input id="q" type="search" placeholder="Tìm mã hàng, tên, số lô..." value="${E(filters.q)}">
          <button class="btn small-btn" id="scan" title="Quét mã vạch / QR trên nhãn">▦ Quét</button>
        </div>
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
    $('#scan').onclick = () => scanCode(s, () => drawList());
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
    setTitle(typeOf(s) === 'branch' ? 'Bắt đầu kiểm tra' : 'Bắt đầu kiểm kê', '#factories/' + typeOf(s));
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

  // Quét tem QR / mã vạch liên tục: mỗi tem quét = 1 đơn vị đã đếm, cộng khối lượng in trên tem,
  // so với tồn sổ sách và báo còn lại bao nhiêu. Tem đã quét rồi sẽ bị chặn để không đếm trùng.
  function scanCode(s, onDone) {
    if (typeof Html5Qrcode === 'undefined') return toast('Không tải được bộ quét mã', 'err');
    s.scannedTags = s.scannedTags || {};
    s.unknownScans = s.unknownScans || [];
    const d = document.createElement('div');
    d.className = 'modal';
    d.innerHTML = `<div class="card scan-card">
      <div class="row between"><h3>Quét tem kiểm đếm</h3><span class="tag" id="scanCount">0 tem</span></div>
      <div id="reader"></div>
      <div id="scanResult" class="scan-result muted small">Đưa mã QR / mã vạch trên tem vào khung. Mỗi tem quét được tính 1 đơn vị và cộng khối lượng trên tem.</div>
      <div class="row gap"><button class="btn" id="scanUndo" disabled>↶ Hủy tem vừa quét</button><button class="btn primary" id="scanClose">Xong</button></div>
    </div>`;
    document.body.appendChild(d);
    const q = new Html5Qrcode('reader');
    let count = 0, lastText = '', lastAt = 0, lastAdded = null;
    const show = (html, cls) => { const r = $('#scanResult', d); r.className = 'scan-result small ' + (cls || ''); r.innerHTML = html; };
    const close = () => {
      const done = () => { d.remove(); scheduleSave(); onDone && onDone(); };
      q.isScanning ? q.stop().catch(() => {}).finally(done) : done();
    };
    $('#scanClose', d).onclick = close;
    $('#scanUndo', d).onclick = () => {
      if (!lastAdded) return;
      const { item, entry } = lastAdded;
      item.weighs = item.weighs.filter(x => x !== entry);
      delete s.scannedTags[entry.tag];
      if (item.weighs.length) Util.applyWeighs(item); else { item.actualQty = null; item.actualWgh = null; }
      count--; $('#scanCount', d).textContent = count + ' tem';
      show(`Đã hủy tem vừa quét của <b>${E(item.code)}</b>.`, '');
      lastAdded = null; $('#scanUndo', d).disabled = true; scheduleSave();
    };

    q.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, raw => {
      const text = String(raw).trim();
      const now = Date.now();
      if (text === lastText && now - lastAt < 2500) return; // camera đọc lại cùng một tem
      lastText = text; lastAt = now;
      if (s.scannedTags[text]) {
        if (navigator.vibrate) navigator.vibrate([60, 60, 60]);
        const it = s.items.find(i => i.id === s.scannedTags[text]);
        return show(`⚠ Tem này <b>đã quét rồi</b>${it ? ` (${E(it.code)} – lô ${E(it.lot)})` : ''}, không cộng thêm.`, 'warnc-text');
      }
      const p = Util.parseLabel(text, s.items);
      if (!p.item) {
        if (navigator.vibrate) navigator.vibrate([200]);
        s.unknownScans.push({ text, time: new Date().toISOString() });
        s.scannedTags[text] = '?';
        return show(p.candidates.length > 1
          ? `Tem khớp ${p.candidates.length} dòng (${p.candidates.map(i => E(i.code)).join(', ')}), chưa xác định được. Nội dung: <code>${E(text)}</code>`
          : `❌ Không có trong tồn sổ sách. Đã ghi lại để báo cáo. Nội dung tem: <code>${E(text)}</code>`, 'short');
      }
      const it = p.item;
      it.weighs = it.weighs || [];
      // Tem không in khối lượng: dùng khối lượng bình quân/đơn vị theo sổ sách
      const wgh = p.wgh != null ? p.wgh : (it.sysQty ? Util.round(it.sysWgh / it.sysQty) : 0);
      const entry = { qty: 1, wgh, time: new Date().toISOString(), src: 'scan', tag: text, estimated: p.wgh == null };
      it.weighs.push(entry);
      Util.applyWeighs(it); Util.touch(it);
      s.scannedTags[text] = it.id;
      lastAdded = { item: it, entry }; $('#scanUndo', d).disabled = false;
      count++; $('#scanCount', d).textContent = count + ' tem';
      if (navigator.vibrate) navigator.vibrate(80);
      clearSignatures(s);
      const left = Util.round(it.sysQty - it.actualQty);
      show(`✅ <b>${E(it.code)}</b> – ${E(it.name)} · lô ${E(it.lot)}<br>
        +1 · ${F(wgh)} kg${entry.estimated ? ' (ước tính, tem không có KL)' : ''}<br>
        Đã quét <b>${F(it.actualQty)}</b>/${F(it.sysQty)} · ${F(it.actualWgh)} kg · ${left > 0 ? `còn lại <b>${F(left)}</b>` : left === 0 ? '<b class="okc">đủ theo sổ</b>' : `<b class="over">thừa ${F(-left)}</b>`}`, '');
      scheduleSave();
    }, () => {}).catch(e => { toast('Không mở được camera: ' + (e.message || e), 'err'); d.remove(); });
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
    const kgPart = it.sysWgh || it.actualWgh ? ` · KL ${sg(v.wgh)} kg` : '';
    return `<span class="${v.qty > 0 || (v.qty === 0 && v.wgh > 0) ? 'over' : 'short'}">Chênh lệch: SL ${sg(v.qty)}${kgPart}</span>`;
  }

  function weighList(it) {
    const w = it.weighs || [];
    if (!w.length) return '';
    return `<div class="weighs">${w.map((x, i) => `<div class="wrow"><span>#${i + 1}</span><span>${F(x.qty)} ĐV</span><span>${F(x.wgh)} kg${x.estimated ? '*' : ''}</span><span class="muted">${x.src === 'scan' ? 'quét tem' : 'cân'} ${new Date(x.time).toTimeString().slice(0, 5)}</span><button data-wrm="${i}" title="Xóa lần cân">✕</button></div>`).join('')}
      <div class="wrow total"><span>Tổng</span><span>${F(it.actualQty)} ĐV</span><span>${F(it.actualWgh)} kg</span><span>${w.length} lần</span><span></span></div></div>`;
  }

  function itemCard(it, s) {
    if (typeOf(s) === 'supplies') return supplyCard(it, s);
    const e = Util.expiry(it, s.countDate, Config.get());
    const multi = (it.weighs || []).length > 0;
    const left = it.actualQty != null ? Util.round(it.sysQty - it.actualQty) : null;
    return `<div class="card item ${it.actualQty != null ? 'counted' : ''}" data-id="${it.id}">
      <div class="row between"><b>${E(it.code)}</b>${expBadge(it, s)}</div>
      <div class="name">${E(it.name)}${it.isExtra ? ' <span class="tag">ngoài sổ sách</span>' : ''}</div>
      <div class="meta">Lô <b>${E(it.lot)}</b> · ${E(it.warehouse)}</div>
      <div class="meta">NSX ${Util.vnDate(it.prodDate)} · Hạn dùng ${it.shelfLife} ngày · HSD ${Util.vnDate(e.expDate)}</div>
      <div class="meta">Sổ sách: <b>${F(it.sysQty)}</b> · ${F(it.sysWgh)} kg${multi && left != null ? ` · ${left > 0 ? `còn lại <b>${F(left)}</b>` : left === 0 ? '<b class="okc">đủ</b>' : `<b class="over">thừa ${F(-left)}</b>`}` : ''}</div>
      <div class="row gap inputs">
        <label>SL thực tế<input type="number" inputmode="decimal" step="any" class="aq" value="${it.actualQty == null ? '' : it.actualQty}" ${multi ? 'readonly' : ''}></label>
        <label>KL thực tế (kg)<input type="number" inputmode="decimal" step="any" class="aw" placeholder="${it.actualQty != null ? F(Util.actualWgh(it)) : 'tự tính'}" value="${it.actualWgh == null ? '' : it.actualWgh}" ${multi ? 'readonly' : ''}></label>
        <button class="btn small-btn match" title="Đúng như sổ sách">= Sổ</button>
      </div>
      <div class="var">${varText(it)}</div>
      ${weighList(it)}
      <div class="addw" hidden>
        <div class="row gap">
          <label>Số lượng<input type="number" inputmode="decimal" step="any" class="wq" value="1"></label>
          <label>Khối lượng cân (kg)<input type="number" inputmode="decimal" step="any" class="ww" placeholder="vd 19.67"></label>
          <button class="btn small-btn primary wadd">+ Ghi</button>
        </div>
      </div>
      <div class="row gap tools">
        <button class="btn small-btn wbtn">⚖ Cân nhiều lần</button>
        <label class="btn small-btn">📷 Ảnh<input type="file" accept="image/*" capture="environment" class="photo" hidden multiple></label>
        <button class="btn small-btn notebtn">📝 Ghi chú</button>
        ${it.isExtra ? '<button class="btn small-btn del">Xóa dòng</button>' : ''}
      </div>
      <textarea class="note" placeholder="Ghi chú (lý do chênh lệch, tình trạng hàng...)" ${it.note ? '' : 'hidden'}>${E(it.note)}</textarea>
      <div class="thumbs">${(it.photos || []).map((p, i) => `<div class="thumb"><img src="${p}" alt=""><button data-rm="${i}">×</button></div>`).join('')}</div>
    </div>`;
  }

  // Thẻ dòng vật tư: chỉ số lượng, không có trọng lượng / hạn dùng
  function supplyCard(it, s) {
    const multi = (it.weighs || []).length > 0;
    return `<div class="card item ${it.actualQty != null ? 'counted' : ''}" data-id="${it.id}">
      <div class="row between"><b>${E(it.code)}</b><span class="tag">${E(it.unit || '')}</span></div>
      <div class="name">${E(it.name)}${it.isExtra ? ' <span class="tag">ngoài sổ sách</span>' : ''}</div>
      <div class="meta">${E(it.warehouse)} · Sổ sách: <b>${F(it.sysQty)}</b> ${E(it.unit || '')}</div>
      <div class="row gap inputs">
        <label>SL thực tế<input type="number" inputmode="decimal" step="any" class="aq" value="${it.actualQty == null ? '' : it.actualQty}" ${multi ? 'readonly' : ''}></label>
        <input type="hidden" class="aw">
        <button class="btn small-btn match" title="Đúng như sổ sách">= Sổ</button>
      </div>
      <div class="var">${varText(it)}</div>
      ${weighList(it)}
      <div class="addw" hidden>
        <div class="row gap">
          <label>Số lượng đếm thêm<input type="number" inputmode="decimal" step="any" class="wq" value="1"></label>
          <input type="hidden" class="ww" value="0">
          <button class="btn small-btn primary wadd">+ Cộng</button>
        </div>
      </div>
      <div class="row gap tools">
        <button class="btn small-btn wbtn">➕ Đếm nhiều lần</button>
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
    const redraw = (openAdd) => {
      el.outerHTML = itemCard(it, s);
      const n = $(`#list .item[data-id="${it.id}"]`);
      bindItem(n, s);
      if (openAdd) { n.querySelector('.addw').hidden = false; n.querySelector('.ww').focus(); }
      updateProgress(s);
    };
    const refresh = () => {
      Util.touch(it);
      el.querySelector('.var').innerHTML = varText(it);
      el.classList.toggle('counted', it.actualQty != null);
      el.querySelector('.aw').placeholder = it.actualQty != null ? F(Util.actualWgh(it)) : 'tự tính';
      updateProgress(s); clearSignatures(s); scheduleSave();
    };
    const numOrNull = v => v === '' ? null : Number(v);
    el.querySelector('.aq').oninput = e => { it.actualQty = numOrNull(e.target.value); refresh(); };
    el.querySelector('.aw').oninput = e => { it.actualWgh = numOrNull(e.target.value); refresh(); };
    el.querySelector('.match').onclick = () => {
      if ((it.weighs || []).length && !confirm('Dòng này đã có ' + it.weighs.length + ' lần cân / quét. Xóa các lần đó và lấy đúng theo sổ sách?')) return;
      it.weighs = [];
      Object.keys(s.scannedTags || {}).forEach(k => { if (s.scannedTags[k] === it.id) delete s.scannedTags[k]; });
      it.actualQty = it.sysQty; it.actualWgh = null; Util.touch(it);
      clearSignatures(s); scheduleSave(); redraw();
    };
    // Cân nhiều lần cho cùng một mã: ghi từng lần, app tự cộng
    el.querySelector('.wbtn').onclick = () => { const a = el.querySelector('.addw'); a.hidden = !a.hidden; if (!a.hidden) el.querySelector('.ww').focus(); };
    const addW = () => {
      const qty = Number(el.querySelector('.wq').value) || 0;
      const wgh = Number(el.querySelector('.ww').value);
      if (!(wgh > 0) && !(qty > 0)) return toast('Nhập số lượng hoặc khối lượng', 'err');
      if (typeOf(s) === 'supplies' && !(qty > 0)) return toast('Nhập số lượng', 'err');
      // Lần cân đầu tiên mà trước đó đã nhập tay: giữ số nhập tay làm lần #1
      if (!(it.weighs || []).length && it.actualQty != null) {
        it.weighs = [{ qty: it.actualQty, wgh: Util.actualWgh(it), time: new Date().toISOString(), src: 'manual' }];
      }
      it.weighs = it.weighs || [];
      it.weighs.push({ qty, wgh: wgh || 0, time: new Date().toISOString(), src: 'manual' });
      Util.applyWeighs(it); Util.touch(it);
      clearSignatures(s); scheduleSave(); redraw(true);
      toast(typeOf(s) === 'supplies' ? `Đã cộng lần đếm #${it.weighs.length}: tổng ${F(it.actualQty)} ${it.unit || ''}` : `Đã ghi lần cân #${it.weighs.length}: tổng ${F(it.actualQty)} ĐV · ${F(it.actualWgh)} kg`);
    };
    el.querySelector('.wadd').onclick = addW;
    el.querySelector('.ww').onkeydown = e => { if (e.key === 'Enter') addW(); };
    $$('[data-wrm]', el).forEach(b => b.onclick = () => {
      const i = Number(b.dataset.wrm);
      const entry = it.weighs[i];
      if (!confirm(`Xóa lần cân #${i + 1} (${F(entry.wgh)} kg)?`)) return;
      it.weighs.splice(i, 1);
      if (entry.tag && s.scannedTags) delete s.scannedTags[entry.tag];
      if (it.weighs.length) Util.applyWeighs(it); else { it.actualQty = null; it.actualWgh = null; }
      clearSignatures(s); scheduleSave(); redraw();
    });
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
      redraw();
    };
    $$('[data-rm]', el).forEach(b => b.onclick = () => {
      if (!confirm('Xóa ảnh này?')) return;
      it.photos.splice(Number(b.dataset.rm), 1); scheduleSave();
      redraw();
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
    if (!s) return go('#home');
    if (s.status === 'done') return go('#done/' + id);
    if (typeOf(s) === 'branch') return renderBranchReview(s);
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
        <h3>Báo cáo kiểm kê</h3>
        <h4>Ảnh bìa (trang đầu báo cáo)</h4>
        ${coverOf(s) ? `<img src="${coverOf(s)}" class="cover-thumb" alt="ảnh bìa">` : '<p class="muted small">Chưa có ảnh bìa: báo cáo sẽ dùng ảnh bắt đầu kiểm kê.</p>'}
        <div class="row gap">
          <label class="btn small-btn">🖼 Chọn ảnh bìa<input type="file" accept="image/*" id="cov" hidden></label>
          ${s.coverPhoto ? '<button class="btn small-btn" id="covrm">Dùng ảnh mặc định của nhà máy</button>' : ''}
        </div>
        <label>Mục đích<textarea id="tp" placeholder="Mặc định: kiểm kê định kỳ, đối chiếu sổ sách, kiểm tra HSD">${E(tr.purpose || '')}</textarea></label>
        <label>Nhận xét, kết luận<textarea id="tc">${E(tr.conclusion || '')}</textarea></label>
        <label>Kiến nghị<textarea id="tk">${E(tr.recommendation || '')}</textarea></label>
        <button class="btn small-btn" id="auto">Gợi ý nội dung từ kết quả</button>
        <h4>Hình ảnh hiện trường</h4>
        ${typeOf(s) === 'supplies' ? `<label class="small">Ảnh của kho<select id="gwh"><option value="">Ảnh chung</option>${[...new Set(s.items.map(i => i.warehouse))].map(w => `<option>${E(w)}</option>`).join('')}</select></label>` : ''}
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
          <button class="btn small-btn" id="pv2">Báo cáo kiểm kê</button>
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
          const wh = $('#gwh') ? $('#gwh').value : '';
          s.generalPhotos.push({ data: p.data, caption: wh ? 'Kho ' + wh : '', wh, time: p.time, geo: p.geo });
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
    $('#cov').onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      guard(async () => {
        s.coverPhoto = await Util.compressImage(file, 1600, 0.8);
        await DB.put('sessions', s);
        renderReview(id);
      }, 'Đang lưu ảnh bìa...');
    };
    if ($('#covrm')) $('#covrm').onclick = () => { s.coverPhoto = null; scheduleSave(); renderReview(id); };
    const preview = (make, title) => guard(async () => {
      await DB.put('sessions', s);
      Viewer.open(await make(), title + ' (bản nháp)');
    }, 'Đang tạo bản xem trước...');
    $('#pv1').onclick = () => preview(() => Reports.toBlob(Reports.inventoryDoc(s, true)), 'Biên bản kiểm kê');
    $('#pv2').onclick = () => preview(() => tripBlob(s), 'Báo cáo kiểm kê');
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
    if (!members.length) return toast('Nhập tên ít nhất một người ký', 'err');
    const unsigned = members.filter(m => !m.signature).map(m => m.name);
    const todo = typeOf(s) === 'branch' ? Docs2.branchSummary(s).todo.length : s.items.filter(i => i.actualQty == null).length;
    let msg = typeOf(s) === 'branch' ? 'Kết thúc kiểm tra và khóa kết quả?' : 'Kết thúc kiểm kê và khóa số liệu?';
    if (todo) msg += typeOf(s) === 'branch' ? `\n- ${todo} chỉ tiêu chưa đánh giá.` : `\n- ${todo} dòng chưa kiểm.`;
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

  // Ảnh bìa: ảnh chọn riêng cho lần kiểm này, nếu không có thì ảnh mặc định của nhà máy (Cài đặt)
  function coverOf(s) {
    return s.coverPhoto || Covers.get(s.factory.code) || null;
  }

  // Báo cáo kiểm kê có chèn các trang biên bản đã ký (dạng ảnh)
  async function tripBlob(s) {
    // Biên bản đã ký (không kèm phụ lục ảnh) được chèn vào báo cáo dưới dạng ảnh từng trang
    const signedBlob = await Reports.toBlob(Reports.inventoryDoc(s, true, { appendix: false }));
    let minutesImages = [];
    try {
      // Không để việc chèn ảnh biên bản làm treo cả bước xuất file
      minutesImages = await Promise.race([
        Viewer.toImages(signedBlob),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000))
      ]);
    } catch (e) { console.warn('minutes images', e); }
    // Ảnh bìa cắt theo khung nửa trái trang bìa (slide A4 ngang)
    const cover = coverOf(s) ? await Util.cropImage(coverOf(s), (841.89 * 0.52) / 595.28) : null;
    return Reports.toBlob(Reports.tripDoc(s, { cover, minutesImages }));
  }

  // Báo cáo vật tư: chèn ảnh trang biên bản của từng kho
  async function suppliesReportBlob(s) {
    const whImages = {};
    for (const wh of Docs2.byWarehouse(s.items).keys()) {
      try {
        const b = await Reports.toBlob(Docs2.suppliesRecordDoc(s, true, { onlyWh: wh }));
        whImages[wh] = await Promise.race([Viewer.toImages(b), new Promise((_, rj) => setTimeout(() => rj(new Error('timeout')), 30000))]);
      } catch (e) { console.warn('wh images', e); }
    }
    return Reports.toBlob(Docs2.suppliesReportDoc(s, { whImages }));
  }

  async function buildFiles(s) {
    const t = typeOf(s);
    if (t !== 'meat') {
      const n = fileNamesFor(s);
      if (t === 'branch') return {
        signed: { name: n.signed, blob: await Reports.toBlob(Docs2.branchRecordDoc(s, true)) },
        unsigned: { name: n.unsigned, blob: await Reports.toBlob(Docs2.branchRecordDoc(s, false)) },
        excel: { name: n.excel, blob: Docs2.branchExcel(s) }
      };
      return {
        trip: { name: n.trip, blob: await suppliesReportBlob(s) },
        signed: { name: n.signed, blob: await Reports.toBlob(Docs2.suppliesRecordDoc(s, true)) },
        unsigned: { name: n.unsigned, blob: await Reports.toBlob(Docs2.suppliesRecordDoc(s, false)) },
        excel: { name: n.excel, blob: Docs2.suppliesExcel(s) }
      };
    }
    const n = Reports.fileNames(s);
    const signed = await Reports.toBlob(Reports.inventoryDoc(s, true));
    return {
      signed: { name: n.signed, blob: signed },
      unsigned: { name: n.unsigned, blob: await Reports.toBlob(Reports.inventoryDoc(s, false)) },
      trip: { name: n.trip, blob: await tripBlob(s) },
      excel: { name: n.excel, blob: Reports.excelBlob(s) }
    };
  }

  // ---------- hoàn tất ----------
  async function renderDone(id) {
    const s = await loadSession(id);
    if (!s) return go('#home');
    setTitle('Kết quả ' + TYPES[typeOf(s)].name.toLowerCase(), '#factories/' + typeOf(s));
    const { sum } = Reports.summary(s);
    const n = fileNamesFor(s);
    const ms = Auth.useMicrosoft();
    const bsum = typeOf(s) === 'branch' ? Docs2.branchSummary(s) : null;
    view().innerHTML = `
      <div class="card ok-card">
        <h3>${E(docNoOf(s))}</h3>
        <p class="small">${E(TYPES[typeOf(s)].name)} · ${E(s.factory.name)} · ${Util.vnDate(s.countDate)} · kết thúc ${Util.vnDateTime(s.finishedAt)}<br>
        ${bsum ? `Đánh giá ${bsum.pass.length + bsum.fail.length}/${bsum.all.length} chỉ tiêu · ${bsum.pass.length} đạt · ${bsum.fail.length} không đạt · tỉ lệ đạt ${Util.fmt(bsum.score)}%`
          : `Đã kiểm ${sum.counted}/${sum.lines} dòng · ${sum.overLines} thừa · ${sum.shortLines} thiếu${typeOf(s) === 'meat' ? ` · ${sum.expired} hết hạn · ${sum.near} sắp hết hạn` : ''}`}</p>
      </div>
      <div class="card od-card">
        <h3>Lưu vào OneDrive / Output</h3>
        ${ms ? `<p class="small">Gửi cả 4 file thẳng vào thư mục <b>${E(Config.get().oneDrive.outputFolder)}</b> trên OneDrive.</p>
          <button class="btn primary block" id="odall">☁ Lưu tất cả vào OneDrive Output</button>` : `
          <p class="small">Bấm nút dưới → chọn <b>OneDrive</b> trong bảng chia sẻ → mở thư mục <b>Apps Kiem Kho › Output</b> → <b>Tải lên</b>. Cả bộ file được lưu một lần.</p>
          <button class="btn primary block" id="odall">☁ Lưu tất cả vào OneDrive</button>
          <p class="muted small">Muốn app tự lưu thẳng vào Output không cần chọn thư mục: IT cấp Client ID Microsoft 365 rồi nhập ở ⚙ Cài đặt.</p>`}
      </div>
      ${Util.inAppBrowser ? '<div class="card warn-card small"><b>App đang mở trong Zalo/Facebook/Teams.</b> Các ứng dụng này chặn tải và chia sẻ file. Bấm ⋮ hoặc ⋯ → <b>Mở bằng trình duyệt</b> (Chrome/Safari), hoặc mở app từ biểu tượng trên màn hình chính.</div>' : ''}
      ${Object.keys(n).filter(k => FILE_LABELS[k]).sort((a, b) => ['trip', 'signed', 'unsigned', 'excel'].indexOf(a) - ['trip', 'signed', 'unsigned', 'excel'].indexOf(b)).map(k => [k, FILE_LABELS[k], n[k]]).map(([k, t, fn]) => `
        <div class="card">
          <b>${t}</b><div class="muted small">${E(fn)}</div>
          <div class="row gap">
            ${k !== 'excel' ? `<button class="btn small-btn" data-view="${k}">Xem</button>` : ''}
            <button class="btn small-btn" data-dl="${k}">Tải về</button>
            <button class="btn small-btn" data-share="${k}">Chia sẻ</button>
            ${k !== 'excel' ? `<button class="btn small-btn" data-ext="${k}">Mở bằng app khác</button>` : ''}
            ${ms ? `<button class="btn small-btn" data-up="${k}">Gửi OneDrive</button>` : ''}
          </div>
        </div>`).join('')}
      <p class="muted small">${Util.isIOS ? 'iPhone: nút Tải về mở bảng Chia sẻ, chọn "Lưu vào Tệp" để lưu file.' : 'File tải về nằm trong thư mục Tải xuống (Download) của điện thoại. Nếu Tải về không được, bấm "Mở bằng app khác" rồi lưu từ trình xem PDF.'}</p>
      <p class="muted small center">Phiên bản app ${window.APP_VERSION}</p>
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
    $$('[data-ext]').forEach(b => b.onclick = () => act(() => Util.openExternal(files[b.dataset.ext].blob)));
    const all = ['trip', 'signed', 'unsigned', 'excel'].map(k => files[k]).filter(Boolean);
    $('#odall').onclick = () => {
      if (ms) {
        guard(async () => {
          for (const f of all) await DB.put('outbox', { id: Util.uid(), name: f.name, folder: Config.get().oneDrive.outputFolder, blob: f.blob, createdAt: Date.now() });
          const r = await OneDrive.flushOutbox();
          toast(r.pending ? `Đã gửi ${r.sent}, còn ${r.pending} file sẽ gửi khi có mạng` : `Đã lưu ${r.sent} file vào OneDrive Output`);
          refreshNet();
        }, 'Đang lưu lên OneDrive...');
        return;
      }
      // Gọi chia sẻ ngay trong lần bấm (file đã tạo sẵn)
      act(() => Util.shareMany(all).then(r => {
        if (r === false) {
          toast('Máy này không chia sẻ được nhiều file một lúc: dùng nút Chia sẻ ở từng file → OneDrive', 'err');
        } else if (r === 'pdf-only') {
          toast('Đã gửi 3 file PDF. File Excel đã tải về máy: mở app OneDrive → Tải lên vào Output.'); const x = files.excel; Util.download(x.blob, x.name);
        }
      }));
    };
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

  // ---------- số biên bản / tên file theo loại kiểm ----------
  function docNoOf(s) { return typeOf(s) === 'meat' ? Reports.docNo(s) : Docs2.docNo(s); }
  function fileNamesFor(s) {
    if (typeOf(s) === 'meat') return Reports.fileNames(s);
    const b = Docs2.docNo(s);
    return typeOf(s) === 'branch'
      ? { signed: `${b}_BienBanKiemTra_DaKy.pdf`, unsigned: `${b}_BienBanKiemTra_KyTay.pdf`, excel: `${b}_KetQua.xlsx` }
      : { trip: `${b}_BaoCaoKiemKe.pdf`, signed: `${b}_BienBan_DaKy.pdf`, unsigned: `${b}_BienBan_KyTay.pdf`, excel: `${b}_KetQua.xlsx` };
  }
  const FILE_LABELS = {
    trip: 'Báo cáo kiểm kê (slide)', signed: 'Biên bản (đã ký trên app)', unsigned: 'Biên bản để in ký tay', excel: 'File Excel kết quả'
  };

  // ---------- kiểm tra chi nhánh: checklist ----------
  function renderChecklist(s) {
    setTitle('Kiểm tra · ' + s.factory.name, '#factories/branch');
    const cl = s.checklist;
    const sum = Docs2.branchSummary(s);
    view().innerHTML = `
      <div class="sticky">
        <div class="row between small"><span>Ngày: <b>${Util.vnDate(s.countDate)}</b></span><span id="prog"></span></div>
        <div class="progress"><div id="bar"></div></div>
      </div>
      <div class="card">
        <h3>${E(cl.title)}</h3>
        <label>Loại sản phẩm<input id="ptype" value="${E(s.productType || '')}" placeholder="vd Heo thịt, thịt heo pha lóc"></label>
        <p class="muted small">Bấm <b>Đạt</b> / <b>Không đạt</b> cho từng chỉ tiêu. Không đạt thì ghi chú và chụp ảnh (ảnh có ngày giờ, vị trí).</p>
      </div>
      <div id="secs">${cl.sections.map((sec, si) => `
        <details class="card sec" data-s="${si}" ${si === 0 ? 'open' : ''}>
          <summary><b>${E(sec.no)}. ${E(sec.title)}</b> <span class="sec-stat small"></span></summary>
          ${sec.items.map((it, ii) => checkItemHtml(sec, si, it, ii)).join('')}
        </details>`).join('')}
      </div>
      <div class="bottom-bar">
        <button class="btn" id="allpass">✓ Đánh dấu còn lại là Đạt</button>
        <button class="btn primary" id="review">Xem lại & ký ›</button>
      </div>`;
    const refresh = () => {
      const t = Docs2.branchSummary(s);
      const done = t.pass.length + t.fail.length;
      $('#prog').innerHTML = `Đã đánh giá ${done}/${t.all.length} · <span class="okc">${t.pass.length} đạt</span> · <span class="short">${t.fail.length} không đạt</span>`;
      $('#bar').style.width = (t.all.length ? done / t.all.length * 100 : 0) + '%';
      $$('#secs .sec').forEach(d => {
        const sec = cl.sections[Number(d.dataset.s)];
        const p = sec.items.filter(i => i.result === 'pass').length, f = sec.items.filter(i => i.result === 'fail').length;
        d.querySelector('.sec-stat').innerHTML = `${p + f}/${sec.items.length}${f ? ` · <span class="short">${f} KĐ</span>` : ''}`;
      });
    };
    $('#ptype').oninput = e => { s.productType = e.target.value; scheduleSave(); };
    const bindItems = root => $$('.ck', root).forEach(el => bindCheckItem(el, s, refresh));
    bindItems(document);
    $('#allpass').onclick = () => {
      if (!confirm('Đánh dấu tất cả chỉ tiêu chưa đánh giá là Đạt?')) return;
      cl.sections.forEach(sec => sec.items.forEach(it => { if (!it.result) it.result = 'pass'; }));
      clearSignatures(s); scheduleSave(); renderChecklist(s);
    };
    $('#review').onclick = () => go('#review/' + s.id);
    refresh();
    sum && null;
  }

  function checkItemHtml(sec, si, it, ii) {
    return `<div class="ck ${it.result || ''}" data-s="${si}" data-i="${ii}">
      <div class="ck-text"><b>${E(it.no)}.</b> ${E(it.text)}${it.method ? `<div class="muted small">Cách kiểm: ${E(it.method)}</div>` : ''}</div>
      <div class="row gap ck-btns">
        <button class="btn small-btn pass ${it.result === 'pass' ? 'on' : ''}">✓ Đạt</button>
        <button class="btn small-btn fail ${it.result === 'fail' ? 'on' : ''}">✕ Không đạt</button>
        <label class="btn small-btn">📷<input type="file" accept="image/*" capture="environment" class="photo" hidden multiple></label>
        <button class="btn small-btn notebtn">📝</button>
      </div>
      <textarea class="note" placeholder="Ghi chú / lý do không đạt" ${it.note || it.result === 'fail' ? '' : 'hidden'}>${E(it.note || '')}</textarea>
      <div class="thumbs">${(it.photos || []).map((p, k) => `<div class="thumb"><img src="${p}" alt=""><button data-rm="${k}">×</button></div>`).join('')}</div>
    </div>`;
  }

  function bindCheckItem(el, s, refresh) {
    const sec = s.checklist.sections[Number(el.dataset.s)];
    const it = sec.items[Number(el.dataset.i)];
    const redraw = () => {
      el.outerHTML = checkItemHtml(sec, Number(el.dataset.s), it, Number(el.dataset.i));
      bindCheckItem($(`.ck[data-s="${el.dataset.s}"][data-i="${el.dataset.i}"]`), s, refresh);
      refresh();
    };
    const set = r => { it.result = it.result === r ? null : r; it.at = new Date().toISOString(); clearSignatures(s); scheduleSave(); redraw(); };
    el.querySelector('.pass').onclick = () => set('pass');
    el.querySelector('.fail').onclick = () => set('fail');
    el.querySelector('.notebtn').onclick = () => { const n = el.querySelector('.note'); n.hidden = !n.hidden; if (!n.hidden) n.focus(); };
    el.querySelector('.note').oninput = e => { it.note = e.target.value; scheduleSave(); };
    el.querySelector('.photo').onchange = async e => {
      const files = [...e.target.files];
      await guard(async () => {
        const geo = await Geo.get();
        it.photos = it.photos || [];
        for (const f of files) it.photos.push((await Stamp.photo(f, s.factory, { geo, extra: `${sec.no}.${it.no} ${it.text}`.slice(0, 120) })).data);
        await DB.put('sessions', s);
      }, 'Đang lấy vị trí và đóng dấu ảnh...');
      redraw();
    };
    $$('[data-rm]', el).forEach(b => b.onclick = () => { if (confirm('Xóa ảnh này?')) { it.photos.splice(Number(b.dataset.rm), 1); scheduleSave(); redraw(); } });
  }

  async function renderBranchReview(s) {
    setTitle('Xem lại & ký', '#count/' + s.id);
    const t = Docs2.branchSummary(s);
    view().innerHTML = `
      <div class="stats">
        <div><b>${t.pass.length + t.fail.length}/${t.all.length}</b><span>đã đánh giá</span></div>
        <div><b class="okc">${t.pass.length}</b><span>đạt</span></div>
        <div class="${t.fail.length ? 'bad' : ''}"><b>${t.fail.length}</b><span>không đạt</span></div>
        <div><b>${Util.fmt(t.score)}%</b><span>tỉ lệ đạt</span></div>
      </div>
      ${t.todo.length ? `<div class="card warn-card"><b>${t.todo.length} chỉ tiêu chưa đánh giá</b> <button class="btn small-btn" id="gotodo">Đánh giá tiếp</button></div>` : ''}
      ${t.fail.length ? `<div class="card"><h3>Chỉ tiêu không đạt</h3>${t.fail.map(i => `<div class="li"><b>${E(i.sec.no)}.${E(i.no)}</b> ${E(i.text)}${i.note ? ' · ' + E(i.note) : ''}${(i.photos || []).length ? ' · 📷' + i.photos.length : ''}</div>`).join('')}</div>` : ''}
      <div class="card">
        <h3>Ý kiến của giám đốc</h3>
        <textarea id="opinion">${E(s.opinion)}</textarea>
      </div>
      <div class="card">
        <h3>Ảnh bắt đầu / kết thúc</h3>
        ${presenceCard(s.checkIn) || ''}
        <p class="small">Kết thúc: ${s.checkOut ? '' : '<span class="short">chưa chụp, bắt buộc trước khi kết thúc</span>'}</p>
        ${presenceCard(s.checkOut)}
        <p class="small" id="gps"></p>
        <label class="btn ${s.checkOut ? '' : 'primary'} block">📷 ${s.checkOut ? 'Chụp lại ảnh kết thúc' : 'Chụp ảnh kết thúc'}<input type="file" accept="image/*" capture="user" id="co" hidden></label>
      </div>
      <div class="card"><h3>Xem trước</h3><button class="btn small-btn" id="pv1">Biên bản kiểm tra</button></div>
      <div class="card">
        <h3>Ký xác nhận</h3>
        <div id="committee"></div>
        <button class="btn small-btn" id="addm">+ Thêm người ký</button>
      </div>
      <div class="bottom-bar">
        <button class="btn" id="back2">‹ Kiểm tiếp</button>
        <button class="btn primary" id="finish">Kết thúc & xuất biên bản</button>
      </div>`;
    $('#opinion').oninput = e => { s.opinion = e.target.value; scheduleSave(); };
    if ($('#gotodo')) $('#gotodo').onclick = () => go('#count/' + s.id);
    $('#back2').onclick = () => go('#count/' + s.id);
    geoStatus($('#gps'), s);
    $('#co').onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      guard(async () => { s.checkOut = await takePresence(file, s, 'out'); await DB.put('sessions', s); renderBranchReview(s); }, 'Đang lấy vị trí và đóng dấu ảnh...');
    };
    $('#pv1').onclick = () => guard(async () => { await DB.put('sessions', s); Viewer.open(await Reports.toBlob(Docs2.branchRecordDoc(s, true)), 'Biên bản kiểm tra (bản nháp)'); }, 'Đang tạo bản xem trước...');
    $('#addm').onclick = () => { s.committee.push({ role: '', title: '', name: '', signature: null }); scheduleSave(); drawCommittee(s); };
    drawCommittee(s);
    $('#finish').onclick = () => finish(s);
  }

  // ---------- dashboard ----------
  const HIST_KEY = 'kk_history_ext';
  function summaryOf(s) {
    const type = typeOf(s);
    let stats = {};
    if (type === 'branch') {
      const t = Docs2.branchSummary(s);
      stats = { total: t.all.length, pass: t.pass.length, fail: t.fail.length, score: t.score };
    } else {
      const counted = s.items.filter(i => i.actualQty != null);
      const diff = counted.filter(i => { const v = Util.variance(i); return v && (v.qty !== 0 || Math.abs(v.wgh) > 0.0005); });
      stats = { lines: s.items.length, counted: counted.length, diff: diff.length, varQty: Util.round(counted.reduce((a, i) => a + Util.variance(i).qty, 0)) };
    }
    return {
      id: s.id, type, factory: s.factory.name, factoryCode: s.factory.code, date: s.countDate, user: s.user.name, email: s.user.email,
      start: (s.checkIn && s.checkIn.time) || s.startedAt, end: (s.checkOut && s.checkOut.time) || s.finishedAt, status: s.status, stats, local: true
    };
  }
  function externalHistory() { try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch (e) { return []; } }

  async function renderDashboard() {
    setTitle('Dashboard kiểm kho', '#home');
    const own = (await DB.all('sessions')).map(summaryOf);
    const ids = new Set(own.map(h => h.id));
    const all = own.concat(externalHistory().filter(h => !ids.has(h.id))).sort((a, b) => b.date.localeCompare(a.date) || String(b.start).localeCompare(String(a.start)));
    const years = [...new Set(all.map(h => h.date.slice(0, 4)))].sort().reverse();
    const st = renderDashboard.state = renderDashboard.state || { year: years[0] || String(new Date().getFullYear()), month: '', type: '', user: '' };
    if (!years.includes(st.year)) years.unshift(st.year);
    const users = [...new Set(all.map(h => h.user))].sort();
    const inYear = all.filter(h => h.date.startsWith(st.year) && (!st.type || h.type === st.type) && (!st.user || h.user === st.user));
    const list = inYear.filter(h => !st.month || h.date.slice(5, 7) === st.month);
    const byMonth = Array.from({ length: 12 }, (_, m) => {
      const mm = String(m + 1).padStart(2, '0');
      const r = inYear.filter(h => h.date.slice(5, 7) === mm);
      return { mm, n: r.length, t: { branch: r.filter(h => h.type === 'branch').length, meat: r.filter(h => h.type === 'meat').length, supplies: r.filter(h => h.type === 'supplies').length } };
    });
    const max = Math.max(1, ...byMonth.map(b => b.n));
    const done = list.filter(h => h.status === 'done');
    const diffLines = list.reduce((a, h) => a + (h.stats.diff || 0) + (h.stats.fail || 0), 0);
    const byUser = new Map();
    list.forEach(h => { if (!byUser.has(h.user)) byUser.set(h.user, []); byUser.get(h.user).push(h); });
    const COLORS = { branch: '#f39200', meat: '#0a7a3c', supplies: '#1565c0' };
    view().innerHTML = `
      <div class="card">
        <div class="row gap">
          <select id="dy">${years.map(y => `<option ${y === st.year ? 'selected' : ''}>${y}</option>`).join('')}</select>
          <select id="dm"><option value="">Cả năm</option>${byMonth.map(b => `<option value="${b.mm}" ${b.mm === st.month ? 'selected' : ''}>Tháng ${Number(b.mm)}</option>`).join('')}</select>
        </div>
        <div class="row gap">
          <select id="dt"><option value="">Tất cả loại kiểm</option>${Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${k === st.type ? 'selected' : ''}>${E(t.name)}</option>`).join('')}</select>
          <select id="du"><option value="">Tất cả kế toán</option>${users.map(u => `<option ${u === st.user ? 'selected' : ''}>${E(u)}</option>`).join('')}</select>
        </div>
      </div>
      <div class="stats">
        <div><b>${list.length}</b><span>lần kiểm</span></div>
        <div><b>${done.length}</b><span>đã hoàn tất</span></div>
        <div><b>${new Set(list.map(h => h.factoryCode)).size}</b><span>nhà máy</span></div>
        <div class="${diffLines ? 'bad' : ''}"><b>${diffLines}</b><span>dòng lệch / KĐ</span></div>
      </div>
      <div class="card">
        <h3>Số lần kiểm theo tháng · ${E(st.year)}</h3>
        <div class="mchart">${byMonth.map(b => `
          <div class="mcol ${b.mm === st.month ? 'sel' : ''}" data-m="${b.mm}" title="Tháng ${Number(b.mm)}: ${b.n} lần">
            <div class="mbar" style="height:${b.n / max * 100}%">${['supplies', 'meat', 'branch'].map(k => b.t[k] ? `<div style="flex:${b.t[k]};background:${COLORS[k]}"></div>` : '').join('')}</div>
            <div class="mval">${b.n || ''}</div><div class="mlab">T${Number(b.mm)}</div>
          </div>`).join('')}
        </div>
        <div class="legend small">${Object.entries(TYPES).map(([k, t]) => `<span><i style="background:${COLORS[k]}"></i>${E(t.name.replace('Kiểm kê kho ', ''))}</span>`).join('')}</div>
      </div>
      <div class="card">
        <h3>Timeline theo kế toán${st.month ? ' · tháng ' + Number(st.month) : ''}</h3>
        ${[...byUser].map(([u, hs]) => `
          <div class="tl-user"><b>${E(u)}</b> <span class="muted small">${hs.length} lần</span></div>
          <div class="timeline">${hs.slice().sort((a, b) => a.date.localeCompare(b.date)).map(h => `
            <div class="tl-item ${h.local ? 'click' : ''}" ${h.local ? `data-id="${h.id}" data-st="${h.status}"` : ''}>
              <span class="tl-dot" style="background:${COLORS[h.type]}"></span>
              <div><b>${Util.vnDate(h.date)}</b> · ${E(h.factory)}<div class="muted small">${E(TYPES[h.type].name)} · ${h.start ? new Date(h.start).toTimeString().slice(0, 5) : ''}${h.end ? '–' + new Date(h.end).toTimeString().slice(0, 5) : ''} · ${h.status === 'done' ? 'Hoàn tất' : 'Đang làm'}${h.type === 'branch' ? ` · ${h.stats.fail || 0} KĐ` : ` · ${h.stats.diff || 0} dòng lệch`}${h.local ? '' : ' · (nhập từ máy khác)'}</div></div>
            </div>`).join('')}</div>`).join('') || '<p class="muted">Không có lần kiểm nào trong khoảng này.</p>'}
      </div>
      <div class="card">
        <h3>Lịch sử chung nhiều kế toán</h3>
        <p class="muted small">Mỗi máy lưu lịch sử riêng. Để xem chung: mỗi người bấm "Xuất lịch sử" rồi gửi file qua OneDrive/Zalo, người tổng hợp bấm "Nhập lịch sử".</p>
        <div class="row gap">
          <button class="btn small-btn" id="hx">⬇ Xuất lịch sử (.json)</button>
          <label class="btn small-btn">⬆ Nhập lịch sử<input type="file" id="hi" accept=".json,application/json" hidden multiple></label>
          <button class="btn small-btn" id="hxl">⬇ Excel lịch sử</button>
        </div>
      </div>`;
    const upd = (k, v) => { st[k] = v; renderDashboard(); };
    $('#dy').onchange = e => upd('year', e.target.value);
    $('#dm').onchange = e => upd('month', e.target.value);
    $('#dt').onchange = e => upd('type', e.target.value);
    $('#du').onchange = e => upd('user', e.target.value);
    $$('.mcol').forEach(c => c.onclick = () => upd('month', st.month === c.dataset.m ? '' : c.dataset.m));
    $$('.tl-item[data-id]').forEach(el => el.onclick = () => go((el.dataset.st === 'done' ? '#done/' : '#count/') + el.dataset.id));
    const user = Auth.currentUser();
    $('#hx').onclick = () => {
      const blob = new Blob([JSON.stringify({ app: 'CPV SLH Kiem Kho', exportedBy: user.name, at: new Date().toISOString(), history: own.map(h => Object.assign({}, h, { local: false })) }, null, 1)], { type: 'application/json' });
      Util.download(blob, `LichSuKiemKho_${Util.safeName(user.name)}_${Util.today()}.json`);
    };
    $('#hi').onchange = async e => {
      let n = 0;
      const ext = externalHistory();
      for (const f of e.target.files) {
        try {
          const d = JSON.parse(await f.text());
          (d.history || []).forEach(h => { if (h.id && !ext.some(x => x.id === h.id)) { ext.push(Object.assign(h, { local: false })); n++; } });
        } catch (err) { toast('File không đúng định dạng: ' + f.name, 'err'); }
      }
      localStorage.setItem(HIST_KEY, JSON.stringify(ext));
      toast(`Đã nhập ${n} lần kiểm`); renderDashboard();
    };
    $('#hxl').onclick = () => {
      const rows = all.map(h => ({ 'Ngày': Util.vnDate(h.date), 'Loại kiểm': TYPES[h.type].name, 'Nhà máy': h.factory, 'Mã NM': h.factoryCode, 'Kế toán': h.user,
        'Bắt đầu': h.start ? Util.vnDateTime(h.start) : '', 'Kết thúc': h.end ? Util.vnDateTime(h.end) : '', 'Trạng thái': h.status === 'done' ? 'Hoàn tất' : 'Đang làm',
        'Số dòng / chỉ tiêu': h.stats.lines || h.stats.total || '', 'Dòng lệch': h.stats.diff == null ? '' : h.stats.diff, 'Không đạt': h.stats.fail == null ? '' : h.stats.fail }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'LichSu');
      Util.download(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `LichSuKiemKho_${Util.today()}.xlsx`);
    };
  }

  // ---------- cài đặt ----------
  function renderSettings() {
    const user = Auth.currentUser();
    setTitle('Cài đặt', user ? '#home' : '#login');
    const c = Config.get();
    const canEdit = !user || user.provider === 'microsoft' || user.admin || !c.localUsers.length;
    if (!canEdit) { view().innerHTML = '<div class="card">Chỉ tài khoản quản trị được sửa cài đặt.</div>'; return; }
    view().innerHTML = `
      <div class="card">
        <h3>Công ty</h3>
        <label>Tên công ty<input id="cn" value="${E(c.companyName)}"></label>
        <label>Tên miền email được phép (cách nhau dấu phẩy)<input id="dom" value="${E((c.allowedDomains || []).join(', '))}"></label>
        <label>Tên hệ thống sổ sách (cột (1) trên biên bản)<input id="sysn" value="${E(c.systemName || '')}"></label>
        <h4>Logo đầu trang báo cáo</h4>
        <div id="logoBox">${Branding.logo() ? `<img src="${Branding.logo()}" class="logo-preview" alt="logo">` : '<p class="muted small">Chưa có logo</p>'}</div>
        <p class="muted small">Chọn file logo (ví dụ "Refined green CP pig emblem.png" trong OneDrive › Apps Kiem Kho › Input). Logo in ở đầu mỗi trang báo cáo và biên bản.</p>
        <div class="row gap">
          <label class="btn small-btn">🖼 Chọn logo<input type="file" accept="image/*" id="logoIn" hidden></label>
          ${Branding.logo() ? '<button class="btn small-btn" id="logoRm">Bỏ logo</button>' : ''}
          ${Branding.custom() ? '<button class="btn small-btn" id="logoDef">Dùng logo mặc định</button>' : ''}
        </div>
      </div>
      <div class="card">
        <h3>File Master nhà máy</h3>
        <p class="small">${c.masterFile ? `Đang dùng: <b>${E(c.masterFile)}</b> (nạp lúc ${Util.vnDateTime(c.masterAt)}) · ${c.factories.length} nhà máy` : `Chưa nạp file Master · đang có ${c.factories.length} nhà máy`}</p>
        <p class="muted small">Mỗi dòng một nhà máy: ORG_CODE, tên công ty, tên nhà máy, địa chỉ, toạ độ, mẫu tên file tồn, người ký... Khi tải file tồn có ORG_CODE, app tự lấy thông tin nhà máy từ đây.</p>
        <div class="row gap">
          <label class="btn small-btn primary">⬆ Nạp file Master (Excel)<input type="file" id="mIn" hidden accept=".xlsx,.xls"></label>
          <button class="btn small-btn" id="mTpl">⬇ Tải file mẫu Master</button>
          ${Auth.useMicrosoft() ? '<button class="btn small-btn" id="mOd">☁ Nạp từ OneDrive</button>' : ''}
        </div>
      </div>
      <div class="card">
        <h3>Mẫu kiểm tra chi nhánh</h3>
        <p class="small">${(() => { const cl = checklistTemplate(); return `<b>${E(cl.title)}</b> · ${cl.sections.length} khu vực · ${cl.sections.reduce((a, x) => a + x.items.length, 0)} chỉ tiêu${localStorage.getItem('kk_checklist') ? ' (mẫu riêng)' : ' (mẫu mặc định SLH.01)'}`; })()}</p>
        <div class="row gap">
          <label class="btn small-btn">⬆ Nạp mẫu checklist (Excel)<input type="file" id="cIn" hidden accept=".xlsx,.xls"></label>
          ${localStorage.getItem('kk_checklist') ? '<button class="btn small-btn" id="cDef">Dùng mẫu mặc định</button>' : ''}
        </div>
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

    const loadMaster = (buf, name) => guard(async () => {
      const list = Master.parse(buf);
      if (!list.length) throw new Error('File Master không có dòng nhà máy nào');
      if (!confirm(`Nạp ${list.length} nhà máy từ ${name}? Danh sách nhà máy hiện tại sẽ được thay thế.`)) return;
      Master.apply(list, name);
      toast(`Đã nạp ${list.length} nhà máy`); renderSettings();
    }, 'Đang đọc file Master...');
    $('#mIn').onchange = async e => { const f = e.target.files[0]; if (f) loadMaster(await f.arrayBuffer(), f.name); };
    $('#mTpl').onclick = () => Util.download(Master.templateBlob(Config.get().factories), 'Master_NhaMay.xlsx');
    if ($('#mOd')) $('#mOd').onclick = () => guard(async () => loadMaster(await OneDrive.download(Config.get().oneDrive.inputFolder, 'Master_NhaMay.xlsx'), 'Master_NhaMay.xlsx'), 'Đang tải từ OneDrive...');
    $('#cIn').onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      guard(async () => {
        const cl = Master.parseChecklist(await f.arrayBuffer());
        if (!confirm(`Dùng mẫu "${cl.title}" (sheet ${cl.sheet}, ${cl.sections.length} khu vực) cho kiểm tra chi nhánh?`)) return;
        localStorage.setItem('kk_checklist', JSON.stringify(cl));
        toast('Đã cập nhật mẫu kiểm tra chi nhánh'); renderSettings();
      }, 'Đang đọc mẫu checklist...');
    };
    if ($('#cDef')) $('#cDef').onclick = () => { localStorage.removeItem('kk_checklist'); renderSettings(); };
    $('#logoIn').onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      guard(async () => { Branding.setLogo(await Util.readLogo(file)); toast('Đã lưu logo'); renderSettings(); }, 'Đang lưu logo...');
    };
    if ($('#logoRm')) $('#logoRm').onclick = () => { Branding.setLogo('none'); renderSettings(); };
    if ($('#logoDef')) $('#logoDef').onclick = () => { Branding.reset(); renderSettings(); };
    $('#addf').onclick = () => $('#facs').insertAdjacentHTML('beforeend', facRow({ code: '', name: '', address: '', inputFile: '' }));
    $('#facs').onchange = e => {
      if (!e.target.matches('.fcov') || !e.target.files[0]) return;
      const row = e.target.closest('.fac');
      const code = $('.fc', row).value.trim();
      if (!code) return toast('Nhập mã nhà máy trước', 'err');
      guard(async () => {
        const data = await Util.compressImage(e.target.files[0], 1600, 0.8);
        Covers.set(code, data);
        $('.cov-row', row).firstElementChild.outerHTML = `<img src="${data}" class="cover-thumb small" alt="">`;
        toast('Đã lưu ảnh bìa cho nhà máy ' + code);
      }, 'Đang lưu ảnh...');
    };
    $('#facs').onclick = e => {
      if (e.target.matches('.fdel')) e.target.closest('.fac').remove();
      if (e.target.matches('.fcovdef')) {
        Covers.set($('.fc', e.target.closest('.fac')).value.trim(), null);
        toast('Đã dùng lại ảnh nhà máy mặc định'); renderSettings();
      }
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
        factories, committeeRoles, factoriesVersion: window.APP_DEFAULT_CONFIG.factoriesVersion,
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
      <div class="row gap cov-row">
        ${Covers.get(f.code) ? `<img src="${Covers.get(f.code)}" class="cover-thumb small" alt="">` : '<span class="muted small">Chưa có ảnh bìa báo cáo</span>'}
        <span class="muted small">${f.code && Covers.custom(f.code) ? 'Ảnh riêng' : 'Ảnh mặc định'}</span>
        ${f.code && Covers.custom(f.code) ? `<button class="btn small-btn fcovdef">Dùng ảnh mặc định</button>` : ''}
        <label class="btn small-btn">🖼 Ảnh bìa báo cáo<input type="file" accept="image/*" class="fcov" hidden></label>
      </div>
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
      case 'factories': return renderFactories(arg);
      case 'import': return renderImport(arg, location.hash.split('/')[2]);
      case 'count': return renderCount(arg);
      case 'review': return renderReview(arg);
      case 'done': return renderDone(arg);
      case 'dashboard': return renderDashboard();
      default: return renderHome();
    }
  }

  async function boot() {
    const setHdr = () => document.documentElement.style.setProperty('--hdr', ($('header').offsetHeight - 1) + 'px');
    setHdr(); window.addEventListener('resize', setHdr);
    $('#settingsBtn').onclick = () => go('#settings');
    $('#net').onclick = () => guard(async () => { const r = await OneDrive.flushOutbox(); toast(`Đã gửi ${r.sent}, còn chờ ${r.pending}`); refreshNet(); }, 'Đang đồng bộ...');
    await loadDefaultAssets();
    try { await Auth.init(); } catch (e) { toast(e.message, 'err'); }
    window.addEventListener('hashchange', route);
    window.addEventListener('pagehide', () => current && DB.put('sessions', current));
    refreshNet();
    route();
    if (Util.inAppBrowser) toast('Đang mở trong Zalo/Facebook/Teams: hãy mở bằng Chrome/Safari để tải và chia sẻ được file', 'err');
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('sw.js').then(reg => reg.update()).catch(e => console.warn('SW', e));
      // Có bản mới: hiện nút cập nhật (không tự tải lại để không mất chữ ký đang ký dở)
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || $('#updbar')) return;
        const b = document.createElement('div');
        b.id = 'updbar'; b.className = 'updbar';
        b.innerHTML = 'Đã có phiên bản mới của app. <button class="btn small-btn">Cập nhật</button>';
        b.querySelector('button').onclick = async () => { if (current) await DB.put('sessions', current); location.reload(); };
        document.body.appendChild(b);
      });
    }
  }
  boot();
})();
