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
  // Bước 1 bắt buộc: kết nối dữ liệu chung bằng mã kết nối (máy đã kết nối thì nhớ mã, không hỏi lại).
  // Bước 2: email + mật khẩu, có "Ghi nhớ đăng nhập" để lần sau vào thẳng app.
  function renderLogin() {
    setTitle('Đăng nhập');
    const cfg = Config.get();
    const connected = Cloud.enabled();
    const ms = connected && Auth.useMicrosoft();
    const noUsers = !cfg.localUsers.length;
    const lastEmail = Auth.lastEmail();
    const step = (n, title, on, done) => `<div class="lstep ${on ? 'on' : ''} ${done ? 'done' : ''}"><span>${done ? '✓' : n}</span>${title}</div>`;
    view().innerHTML = `
      <div class="card center-card">
        <img src="assets/cp-mark.png" class="logo login-logo" alt="C.P">
        <h2>CPV SLH Kiểm Kê</h2>
        <p class="muted">${E(cfg.companyName)}</p>
        <div class="lsteps">${step(1, 'Kết nối dữ liệu chung', !connected, connected)}${step(2, 'Đăng nhập tài khoản', connected, false)}</div>
      </div>
      ${!connected ? `
      <div class="card">
        <h3>Bước 1: Nhập mã kết nối</h3>
        <p class="small">Nhập <b>mã kết nối</b> quản trị viên gửi riêng cho bạn (bắt đầu bằng <b>KK1.</b>). Chỉ cần nhập <b>một lần</b> trên máy này, app sẽ ghi nhớ.</p>
        <textarea id="ccode" rows="3" placeholder="Dán mã kết nối KK1..." autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
        <button class="btn primary block" id="cconnect">Kết nối</button>
        <details class="small admin-setup">
          <summary>Quản trị viên thiết lập lần đầu bằng token GitHub</summary>
          <label class="small">Repo dữ liệu (Private)<input id="crepo" value="ducthang2109/CPV-SLH-Kiem-Kho-Data"></label>
          <p class="muted small">Dán token GitHub (github_pat_...) vào ô mã kết nối phía trên rồi bấm Kết nối.</p>
        </details>
      </div>
      <div class="card disabled-card">
        <h3>Bước 2: Đăng nhập</h3>
        <p class="muted small">Kết nối xong mới nhập được email và mật khẩu.</p>
        <input type="email" placeholder="Email công ty" disabled>
        <input type="password" placeholder="Mật khẩu" disabled>
      </div>` : `
      <div class="card">
        <h3>Bước 2: Đăng nhập</h3>
        ${ms ? `<button class="btn primary block" id="msLogin">Đăng nhập tài khoản Microsoft công ty</button><div class="sep">hoặc tài khoản nội bộ</div>` : ''}
        ${noUsers ? `
          <p class="small">Dữ liệu chung chưa có tài khoản nào: tạo tài khoản quản trị đầu tiên.</p>
          <input id="email" type="email" placeholder="Email công ty" autocomplete="username">
          <input id="name" placeholder="Họ và tên">
          <input id="pw" type="password" placeholder="Mật khẩu" autocomplete="new-password">
          <button class="btn primary block" id="create">Tạo tài khoản</button>` : `
          <form id="lform" autocomplete="on">
            <input id="email" name="email" type="email" placeholder="Email công ty" autocomplete="username" value="${E(lastEmail)}">
            <input id="pw" name="password" type="password" placeholder="Mật khẩu" autocomplete="current-password">
            <label class="row gap small remember"><input type="checkbox" id="remember" checked> Ghi nhớ đăng nhập trên máy này</label>
            <button class="btn ${ms ? '' : 'primary'} block" id="local" type="submit">Đăng nhập</button>
          </form>`}
        <p class="muted small center">☁ Đã kết nối dữ liệu chung (${E(Cloud.settings().repo.split('/').pop())}) · <a href="#" id="resync">Cập nhật tài khoản</a> · <a href="#" id="cchange">Đổi mã kết nối</a></p>
      </div>`}`;
    const ok = () => go('#home');
    if ($('#cconnect')) $('#cconnect').onclick = () => guard(async () => {
      const code = $('#ccode').value.trim();
      if (!code) throw new Error('Nhập mã kết nối quản trị viên gửi cho bạn');
      const r = await Cloud.connect(code, $('#crepo') ? $('#crepo').value : '');
      toast(r.created ? 'Đã kết nối, dữ liệu chung đang trống' : `Đã kết nối: ${r.users} tài khoản, ${r.factories} nhà máy`);
      renderLogin();
      if ($('#email') && !$('#email').value) $('#email').focus(); else if ($('#pw')) $('#pw').focus();
    }, 'Đang kết nối dữ liệu chung...');
    if ($('#resync')) $('#resync').onclick = e => { e.preventDefault(); guard(async () => { const r = await Cloud.pullConfig(); toast(`Đã cập nhật ${r.users || 0} tài khoản`); renderLogin(); }, 'Đang tải tài khoản...'); };
    if ($('#cchange')) $('#cchange').onclick = e => { e.preventDefault(); if (confirm('Nhập mã kết nối khác cho máy này?')) { Cloud.disconnect(); renderLogin(); } };
    $('#msLogin') && ($('#msLogin').onclick = () => guard(Auth.loginMicrosoft, 'Đang mở trang đăng nhập Microsoft...'));
    $('#create') && ($('#create').onclick = () => guard(async () => {
      await Auth.addLocalUser($('#email').value, $('#name').value, $('#pw').value, true);
      await Auth.loginLocal($('#email').value, $('#pw').value, true); ok();
    }));
    if ($('#lform')) $('#lform').onsubmit = e => { e.preventDefault(); guard(async () => { await Auth.loginLocal($('#email').value, $('#pw').value, $('#remember').checked); ok(); }); };
  }
  // ---------- trang đầu: chọn loại kiểm ----------
  const TYPES = {
    branch: { icon: '🏭', name: 'Kiểm tra chi nhánh', desc: 'Checklist Đạt / Không đạt theo mẫu kiểm tra nhà máy, kèm ảnh và ký xác nhận' },
    meat: { icon: '🥩', name: 'Kiểm kê kho Meat', desc: 'Thành phẩm thịt: số lượng, trọng lượng, lô, hạn sử dụng, quét tem' },
    supplies: { icon: '🔧', name: 'Kiểm kê kho Spare part, Supplies', desc: 'Phụ tùng, vật tư: file tồn SAP theo kho (0001, 0002...), đếm số lượng theo mã SAP' },
    package: { icon: '📦', name: 'Kiểm kê kho Package, Ingredient', desc: 'Bao bì, nguyên liệu: báo cáo tồn PDF xuất từ chương trình (Data Package), đếm theo lô' }
  };
  const typeOf = s => (s && s.type) || 'meat';
  const isQtyType = t => t === 'supplies' || t === 'package'; // chỉ đếm số lượng, không cân / hạn dùng
  const dsId = (code, type) => type === 'supplies' ? 'S:' + code : type === 'package' ? 'P:' + code : code;
  const TYPE_COLORS = { branch: '#f39200', meat: '#0a7a3c', supplies: '#1565c0', package: '#8e24aa' };
  // Mã nhà máy trong file: khớp đúng, hoặc file SAP ghi Plant 4 ký tự (B657) cho nhà máy B65710
  function matchFactory(org) {
    if (!org) return null;
    const list = Config.get().factories;
    const o = String(org).toUpperCase();
    return list.find(f => f.code.toUpperCase() === o) || list.find(f => f.code.toUpperCase().startsWith(o) || o.startsWith(f.code.toUpperCase())) || null;
  }

  async function renderHome() {
    const user = Auth.currentUser();
    setTitle('CPV SLH Kiểm Kê');
    const open = (await DB.all('sessions')).filter(s => s.status !== 'done').sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const canCount = Auth.can.count();
    view().innerHTML = `
      <div class="hello">Xin chào <b>${E(user.name)}</b> <span class="tag">${E(Auth.ROLES[Auth.role()] || '')}</span> · Hôm nay: <b>${Util.vnDate(Util.today())}</b>${Cloud.enabled() ? ' · ☁ dữ liệu chung' : ''}</div>
      ${canCount ? '<h3 class="section">Bạn đi kiểm gì?</h3>' : '<p class="muted small">Tài khoản chỉ xem: xem dashboard, lịch sử và file biên bản.</p>'}
      ${Object.entries(TYPES).filter(() => canCount).map(([k, t], i) => `
        <div class="card type-card click" data-type="${k}">
          <div class="type-no">${i + 1}</div>
          <div><div class="type-name">${t.icon} ${E(t.name)}</div><div class="muted small">${E(t.desc)}</div></div>
          <span class="chev">›</span>
        </div>`).join('')}
      <div class="card type-card click dash" data-dash>
        <div class="type-no">📊</div>
        <div><div class="type-name">Dashboard & lịch sử kiểm kho</div><div class="muted small">Tổng quan, lịch kiểm từng kế toán, file biên bản</div></div>
        <span class="chev">›</span>
      </div>
      ${open.length && canCount ? `<h3 class="section">Phiên đang làm dở (${open.length})</h3>${open.map(s => `
        <div class="card open-row">
          <div data-open="${s.id}"><b>${TYPES[typeOf(s)].icon} ${E(TYPES[typeOf(s)].name)}</b><div class="muted small">${E(s.factory.name)} · ${Util.vnDate(s.countDate)} · ${E(s.user.name)}${typeOf(s) === 'branch' ? '' : ` · ${s.items.filter(i => i.actualQty != null).length}/${s.items.length} dòng`}</div></div>
          <button class="btn small-btn icon-del" data-delopen="${s.id}" title="Xóa phiên này">🗑</button>
          <span class="chev" data-open="${s.id}">›</span>
        </div>`).join('')}` : ''}`;
    $$('[data-type]').forEach(b => b.onclick = () => go('#factories/' + b.dataset.type));
    $('[data-dash]').onclick = () => go('#dashboard');
    $$('[data-open]').forEach(b => b.onclick = () => go('#count/' + b.dataset.open));
    $$('[data-delopen]').forEach(b => b.onclick = () => deleteOpenSession(b.dataset.delopen, renderHome));
  }

  // Xóa phiên đang làm dở (kế toán và quản trị): xóa trên máy và dòng "đang kiểm" trên dữ liệu chung
  async function deleteOpenSession(id, after) {
    const s = await DB.get('sessions', id);
    if (!s || s.status === 'done') return;
    const n = typeOf(s) === 'branch' ? 0 : s.items.filter(i => i.actualQty != null).length;
    if (!confirm(`Xóa phiên ${TYPES[typeOf(s)].name} · ${s.factory.name} · ${Util.vnDate(s.countDate)}?${n ? `\nĐã đếm ${n} dòng, toàn bộ số liệu, ảnh và chữ ký của phiên này sẽ mất.` : ''}\nKhông khôi phục được.`)) return;
    await guard(async () => {
      await DB.del('sessions', id);
      await DB.del('files', id).catch(() => {});
      await DB.del('files', 'src:' + id).catch(() => {});
      if (current && current.id === id) current = null;
      Cloud.setQueue(Cloud.queue().filter(x => x !== id));
      if (Cloud.enabled() && (s.cloud || s.checkIn)) {
        try { await Cloud.deleteHistory(cloudRecord(s)); } catch (e) { console.warn(e); toast('Đã xóa trên máy. Chưa xóa được dòng "đang kiểm" trên dữ liệu chung (kiểm tra mạng)', 'err'); return; }
      }
      toast('Đã xóa phiên đang làm dở');
    }, 'Đang xóa phiên...');
    after && after();
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
          ${open.map(s => `<div class="row gap"><button class="btn block warn" data-open="${s.id}">Tiếp tục phiên ${Util.vnDate(s.countDate)}${type === 'branch' ? '' : ` · ${s.items.filter(i => i.actualQty != null).length}/${s.items.length} dòng`}</button><button class="btn small-btn icon-del" data-delopen="${s.id}" title="Xóa phiên này">🗑</button></div>`).join('')}
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
    $$('[data-delopen]').forEach(b => b.onclick = () => deleteOpenSession(b.dataset.delopen, () => renderFactories(type)));
    $$('[data-open]').forEach(b => b.onclick = () => go('#count/' + b.dataset.open));
    $$('[data-done]').forEach(b => b.onclick = () => go('#done/' + b.dataset.done));
  }

  // ---------- tải dữ liệu ----------
  async function renderImport(code, type) {
    type = isQtyType(type) ? type : 'meat';
    const f = factoryOf(code);
    if (!f) return go('#factories/' + type);
    setTitle('Tải dữ liệu · ' + f.name, '#factories/' + type);
    const ms = Auth.useMicrosoft();
    const pattern = type === 'supplies' ? (f.suppliesFile || '*.xlsx') : type === 'package' ? (f.packageFile || `Data Package/${f.code}_*.pdf`) : (f.inputFile || '*.xlsx');
    const HELP = {
      supplies: 'File tồn SAP của từng kho (vd 0001.xlsx, 0002.xlsx) với các cột Plant, Storage Location, Material, Material Description, Base Unit of Measure, Unrestricted. Chọn được nhiều file một lúc, mỗi file là một kho.',
      package: 'File PDF "Inventory Report" xuất từ chương trình (thư mục Data Package, vd B43210_12.10.pdf). App đọc số tồn Balance của từng lô; file PDF gốc được đính kèm vào báo cáo. Cũng nhận file Excel có cột Mã, Tên, Lô, Số lượng.',
      meat: 'File tồn kho theo mẫu FDREPORT (có ORG_CODE thì app tự nhận nhà máy).'
    };
    view().innerHTML = `
      ${Cloud.enabled() ? `<div class="card ok-card">
        <h3>☁ Lấy file mới nhất từ dữ liệu chung</h3>
        <p class="muted small">File trong OneDrive › Apps Kiem Kho › Input được máy tính đồng bộ lên tự động. Mẫu tên file: ${E(pattern)}</p>
        <div id="cloudFiles"><p class="muted small">Đang tải danh sách file...</p></div>
      </div>` : ''}
      ${ms ? `<div class="card">
        <h3>Tự tìm trên OneDrive</h3>
        <p class="muted small">Thư mục: ${E(Config.get().oneDrive.inputFolder)} · mẫu tên file: ${E(pattern)}</p>
        <button class="btn primary block" id="od">Tìm và tải file từ OneDrive</button>
        <div id="odList"></div>
      </div>` : ''}
      <details class="card" ${Cloud.enabled() ? '' : 'open'}>
        <summary><b>Cách khác: chọn file trên điện thoại</b></summary>
        <p class="muted small">${HELP[type]}</p>
        <ul class="small steps">
          <li><b>Android:</b> bấm nút dưới → ☰ → <b>OneDrive</b> → Apps Kiem Kho → Input → chọn file ${E(pattern)}.</li>
          <li><b>iPhone:</b> bấm nút dưới → <b>Chọn tệp</b> → Duyệt → <b>OneDrive</b> → Apps Kiem Kho → Input → chọn file.</li>
        </ul>
        <label class="btn block">${type === 'package' ? 'Chọn file PDF / Excel' : type === 'supplies' ? 'Chọn file Excel (chọn được nhiều file)' : 'Chọn file Excel'}<input type="file" id="file" hidden ${type === 'supplies' ? 'multiple' : ''} accept="${type === 'package' ? '.pdf,application/pdf,' : ''}.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"></label>
      </details>
      <div id="preview"></div>`;

    const parseOne = async (buf, name) => /\.pdf$/i.test(name) ? PdfStock.parse(buf, name) : Importer.parse(buf, name, type === 'meat' ? 'meat' : 'supplies');
    // files: [{ buf, name, fileDate }]
    const load = files => guard(async () => {
      const parsed = [];
      for (const x of files) parsed.push(await parseOne(x.buf, x.name));
      const ds = Importer.merge(parsed);
      let target = f;
      // File có ORG_CODE / Plant: tự liên kết với nhà máy trong Master
      const other = matchFactory(ds.orgCode);
      if (ds.orgCode && other && other.code !== f.code) {
        if (confirm(`File này của nhà máy ${other.name} (${ds.orgCode}), không phải ${f.name}. Lưu dữ liệu cho ${other.name}?`)) target = other;
      } else if (ds.orgCode && !other) toast(`File có mã nhà máy ${ds.orgCode} chưa có trong Master nhà máy`, 'err');
      ds.id = dsId(target.code, type);
      ds.fileDate = files.map(x => x.fileDate).filter(Boolean).sort().pop() || null;
      // Giữ file PDF gốc của chương trình để đính kèm vào báo cáo
      const pdfs = files.filter(x => /\.pdf$/i.test(x.name));
      ds.sourceFiles = pdfs.map(x => ({ name: x.name, blob: new Blob([x.buf], { type: 'application/pdf' }) }));
      await DB.put('datasets', ds);
      showPreview(ds, target, type);
    }, 'Đang đọc file...');

    $('#file').onchange = async e => {
      const list = [];
      for (const file of e.target.files) list.push({ buf: await file.arrayBuffer(), name: file.name, fileDate: file.lastModified ? new Date(file.lastModified).toISOString() : null });
      if (list.length) load(list);
    };
    // Danh sách file Input trên dữ liệu chung (script đồng bộ trên máy tính đẩy lên), mới nhất lên đầu
    if ($('#cloudFiles')) Cloud.inputFiles(pattern).then(list => {
      const box = $('#cloudFiles');
      if (!box) return;
      if (!list.length) { box.innerHTML = '<p class="muted small">Chưa có file phù hợp trên dữ liệu chung. Kiểm tra máy tính đồng bộ đang bật, hoặc chọn file trên điện thoại ở mục bên dưới.</p>'; return; }
      const multi = type === 'supplies';
      box.innerHTML = list.slice(0, 12).map((x, i) => `<label class="cfile ${i === 0 ? 'newest' : ''}">
          <input type="${multi ? 'checkbox' : 'radio'}" name="cf" value="${i}" ${i === 0 || (multi && x.folder === list[0].folder && /^\d{4}\.xlsx$/i.test(x.name)) ? 'checked' : ''}>
          <span><b>${E(x.name)}</b><span class="muted small"> · ${Util.vnDateTime(x.modified)}${i === 0 ? ' · mới nhất' : ''}</span></span>
        </label>`).join('') + `<button class="btn primary block" id="cfLoad">Tải ${multi ? 'các file đã chọn' : 'file đã chọn'}</button>`;
      $('#cfLoad').onclick = () => {
        const picked = $$('#cloudFiles input:checked').map(x => list[Number(x.value)]);
        if (!picked.length) return toast('Chọn ít nhất một file', 'err');
        guard(async () => {
          const files = [];
          for (const x of picked) files.push({ buf: await (await Cloud.getBlob(x.path)).arrayBuffer(), name: x.name, fileDate: x.modified });
          load(files);
        }, 'Đang tải file từ dữ liệu chung...');
      };
    }).catch(e => { const box = $('#cloudFiles'); if (box) box.innerHTML = `<p class="small short">Không đọc được danh sách file: ${E(e.message)}</p>`; });
    if ($('#od')) $('#od').onclick = () => guard(async () => {
      const { folder, match, all } = await OneDrive.findInputFile(Object.assign({}, f, { inputFile: pattern }));
      $('#odList').innerHTML = all.map(x => `<button class="btn block ${match && x.name === match.name ? 'primary' : ''}" data-f="${E(x.name)}">${E(x.name)} <span class="small">· ${Util.vnDateTime(x.lastModifiedDateTime)}</span></button>`).join('') || '<p class="muted">Không thấy file Excel trong thư mục.</p>';
      $$('#odList [data-f]').forEach(b => b.onclick = () => guard(async () => {
        const meta = all.find(x => x.name === b.dataset.f);
        load([{ buf: await OneDrive.download(folder, b.dataset.f), name: b.dataset.f, fileDate: meta && meta.lastModifiedDateTime }]);
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
        <p class="small">File: ${E(ds.fileName)}${ds.orgCode ? ' · mã nhà máy ' + E(ds.orgCode) : ''}${ds.stockDate ? ' · tồn ngày ' + Util.vnDate(ds.stockDate) : ''} · ${ds.encoding === 'PDF' ? 'đọc từ PDF chương trình' : 'Bảng mã: ' + ds.encoding}${ds.skippedZero ? ` · bỏ ${ds.skippedZero} lô tồn bằng 0` : ''}</p>
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
    if (isQtyType(type)) return [
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
        systemName: f.systemName || '', suppliesSystem: f.suppliesSystem || '', packageSystem: f.packageSystem || '', signers: f.signers || {} },
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
    // File PDF gốc từ chương trình đi kèm phiên kiểm (đính kèm vào bộ file kết quả)
    if (ds && (ds.sourceFiles || []).length) await DB.put('files', { id: 'src:' + s.id, files: ds.sourceFiles });
    go('#count/' + s.id);
  }

  async function loadSession(id) {
    if (current && current.id === id) return current;
    current = await DB.get('sessions', id);
    return current;
  }

  // ---------- kiểm kê ----------
  const filters = { q: '', wh: '', st: 'all', sort: '', limit: 80 };
  // Sắp xếp danh sách kiểm: theo mã / tên, tăng hoặc giảm (mặc định giữ thứ tự trong file)
  const SORTS = [['', 'Thứ tự trong file'], ['code', 'Mã: nhỏ → lớn'], ['-code', 'Mã: lớn → nhỏ'], ['name', 'Tên: A → Z'], ['-name', 'Tên: Z → A'], ['qty', 'SL sổ sách: ít → nhiều'], ['-qty', 'SL sổ sách: nhiều → ít']];
  const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });
  function sortItems(list, key) {
    if (!key) return list;
    const dir = key.startsWith('-') ? -1 : 1, k = key.replace('-', '');
    const val = it => k === 'qty' ? it.sysQty : k === 'name' ? (Glossary.nameVi(it) || it.name || '') : String(it.code || '') + ' ' + (it.lot || '');
    return list.slice().sort((a, b) => dir * (k === 'qty' ? val(a) - val(b) : collator.compare(val(a), val(b))));
  }

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
        <div class="row gap sort-row"><select id="so">${SORTS.map(([v, t]) => `<option value="${v}" ${filters.sort === v ? 'selected' : ''}>↕ Sắp xếp: ${t}</option>`).join('')}</select></div>
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
    $('#so').onchange = e => { filters.sort = e.target.value; filters.limit = 80; drawList(); };
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
        cloudTouch(s);
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
      if (!(`${it.code} ${it.name} ${Glossary.nameVi(it)} ${it.lot}`.toLowerCase().includes(q))) return false;
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
    const list = sortItems(s.items.filter(it => matches(it, s)), filters.sort);
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
    if (isQtyType(typeOf(s))) return supplyCard(it, s);
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
      <div class="name">${Glossary.nameVi(it) ? `<b>${E(Glossary.nameVi(it))}</b><div class="muted small">${E(it.name)}</div>` : E(it.name)}${it.isExtra ? ' <span class="tag">ngoài sổ sách</span>' : ''}</div>
      ${it.lot ? `<div class="meta">Lô <b>${E(it.lot)}</b></div>` : ''}
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
      if (isQtyType(typeOf(s)) && !(qty > 0)) return toast('Nhập số lượng', 'err');
      // Lần cân đầu tiên mà trước đó đã nhập tay: giữ số nhập tay làm lần #1
      if (!(it.weighs || []).length && it.actualQty != null) {
        it.weighs = [{ qty: it.actualQty, wgh: Util.actualWgh(it), time: new Date().toISOString(), src: 'manual' }];
      }
      it.weighs = it.weighs || [];
      it.weighs.push({ qty, wgh: wgh || 0, time: new Date().toISOString(), src: 'manual' });
      Util.applyWeighs(it); Util.touch(it);
      clearSignatures(s); scheduleSave(); redraw(true);
      toast(isQtyType(typeOf(s)) ? `Đã cộng lần đếm #${it.weighs.length}: tổng ${F(it.actualQty)} ${it.unit || ''}` : `Đã ghi lần cân #${it.weighs.length}: tổng ${F(it.actualQty)} ĐV · ${F(it.actualWgh)} kg`);
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
        <div class="${diff.length ? 'bad' : ''}"><b>${diff.length}</b><span>lệch sổ</span></div>
        <div class="${sum.expired ? 'bad' : ''}"><b>${sum.expired}</b><span>hết hạn</span></div>
        <div class="${sum.near ? 'warnc' : ''}"><b>${sum.near}</b><span>sắp hết hạn</span></div>
      </div>
      <div class="card small">
        Sổ sách: ${F(sum.sysQty)} SL · ${F(sum.sysWgh)} kg<br>Thực tế: ${F(sum.actQty)} SL · ${F(sum.actWgh)} kg · ${sum.photos} ảnh
      </div>
      ${todo.length ? `<div class="card warn-card"><b>${todo.length} dòng chưa kiểm</b> (biên bản sẽ ghi "Chưa kiểm")
        <button class="btn small-btn" id="gotodo">Đi kiểm tiếp</button></div>` : ''}
      ${diff.length ? `<div class="card"><h3>Hàng lệch sổ</h3>${diff.map(i => `<div class="li"><b>${E(i.code)}</b> ${E(i.name)} · lô ${E(i.lot)}<br><span class="${i.var.qty >= 0 ? 'over' : 'short'}">SL ${sg(i.var.qty)} · KL ${sg(i.var.wgh)} kg</span>${i.note ? ' · ' + E(i.note) : ''}${i.photos.length ? ` · 📷${i.photos.length}` : ''}</div>`).join('')}</div>` : ''}
      ${exp.length ? `<div class="card"><h3>Hàng hết hạn / sắp hết hạn</h3>${exp.map(i => `<div class="li"><b>${E(i.code)}</b> ${E(i.name)} · lô ${E(i.lot)} · HSD ${Util.vnDate(i.exp.expDate)} <span class="badge ${i.exp.status}">${E(i.exp.label)}</span></div>`).join('')}</div>` : ''}

      <div class="card">
        <h3>Biên bản</h3>
        <label>Kho (in dưới tiêu đề)<input id="store" value="${E(s.storeTitle || '')}" placeholder="${E(Reports.storeTitle(Object.assign({}, s, { storeTitle: '' })))}"></label>
        <label>Ý kiến xử lý chênh lệch<textarea id="opinion">${E(s.opinion)}</textarea></label>
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
        <label>Mục đích<textarea id="tp" placeholder="Mặc định: kiểm kê định kỳ, đối chiếu sổ, kiểm tra hạn dùng">${E(tr.purpose || '')}</textarea></label>
        <label>Nhận xét, kết luận<textarea id="tc">${E(tr.conclusion || '')}</textarea></label>
        <label>Kiến nghị<textarea id="tk">${E(tr.recommendation || '')}</textarea></label>
        <button class="btn small-btn" id="auto">Gợi ý nội dung từ kết quả</button>
        <h4>Ảnh tại kho</h4>
        ${isQtyType(typeOf(s)) ? `<label class="small">Ảnh của kho<select id="gwh"><option value="">Ảnh chung</option>${[...new Set(s.items.map(i => i.warehouse))].map(w => `<option>${E(w)}</option>`).join('')}</select></label>` : ''}
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
        <h3>Người ký biên bản</h3>
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
      parts.push(diff.length ? `Có ${diff.length} dòng lệch sổ (${sum.overLines} thừa, ${sum.shortLines} thiếu).` : 'Hàng thực tế khớp sổ.');
      if (sum.expired || sum.near) parts.push(`Có ${sum.expired} dòng hết hạn, ${sum.near} dòng sắp hết hạn.`);
      if (todo.length) parts.push(`Còn ${todo.length} dòng chưa kiểm.`);
      tr.conclusion = tr.conclusion || parts.join(' ');
      const rec = [];
      if (diff.length) rec.push('Thủ kho và kế toán đối chiếu phiếu nhập/xuất, giải trình lý do lệch, điều chỉnh sổ khi được duyệt.');
      if (sum.expired) rec.push('Để riêng hàng hết hạn, lập biên bản xử lý hoặc hủy.');
      if (sum.near) rec.push('Xuất trước hàng sắp hết hạn.');
      if (!rec.length) rec.push('Giữ cách quản lý kho hiện tại.');
      tr.recommendation = tr.recommendation || rec.join('\n');
      if (!s.opinion && diff.length) s.opinion = 'Thủ kho giải trình lý do lệch; kế toán điều chỉnh sổ theo kết quả kiểm kê sau khi Giám đốc duyệt.';
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
    const qty = isQtyType(typeOf(s));
    $('#pv1').onclick = () => preview(() => qty ? recordWithSource(s, true) : Reports.toBlob(Reports.inventoryDoc(s, true)), 'Biên bản kiểm kê');
    $('#pv2').onclick = () => preview(() => qty ? suppliesReportBlob(s) : tripBlob(s), 'Báo cáo kiểm kê');
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
        for (const k of FILE_ORDER.filter(k => files[k])) await DB.put('outbox', { id: Util.uid(), name: files[k].name, folder: Config.get().oneDrive.outputFolder, blob: files[k].blob, createdAt: Date.now() });
        const r = await OneDrive.flushOutbox().catch(() => ({ sent: 0 }));
        toast(r.sent ? `Đã gửi ${r.sent} file lên OneDrive/Output` : 'Đang offline: file sẽ tự gửi lên OneDrive khi có mạng');
      }
    }, 'Đang tạo biên bản PDF...');
    // Lưu file + lịch sử lên dữ liệu chung (không có mạng thì tự gửi lại sau)
    if (Cloud.enabled()) {
      Cloud.enqueue(s.id);
      await guard(async () => {
        const r = await flushCloud();
        if (r.failed) toast('Chưa lưu được lên dữ liệu chung, app sẽ tự gửi lại khi có mạng', 'err');
        else if (r.sent) toast('Đã lưu biên bản và lịch sử lên dữ liệu chung');
      }, 'Đang lưu lên dữ liệu chung...');
    }
    refreshNet();
    go('#done/' + s.id);
  }

  // ---------- dữ liệu chung (GitHub riêng tư) ----------
  function cloudRecord(s) {
    return Object.assign(summaryOf(s), { docNo: docNoOf(s), local: undefined, sourceFile: s.sourceFile || '' });
  }
  // Gửi các phiên đã kết thúc đang chờ: file PDF/Excel + dòng lịch sử
  let flushing = null;
  function flushCloud() {
    if (!Cloud.enabled() || !navigator.onLine) return Promise.resolve({ sent: 0, failed: 0 });
    if (flushing) return flushing;
    flushing = (async () => {
      let sent = 0, failed = 0;
      for (const id of Cloud.queue()) {
        try {
          const s = await DB.get('sessions', id);
          if (!s) { Cloud.setQueue(Cloud.queue().filter(x => x !== id)); continue; }
          const rec = cloudRecord(s);
          if (s.status === 'done') {
            let files = (await DB.get('files', s.id) || {}).files;
            if (!files) { files = await buildFiles(s); await DB.put('files', { id: s.id, files }); }
            await Cloud.upload(s, files, rec);
          } else await Cloud.saveHistory(rec);
          s.cloud = { at: new Date().toISOString(), files: rec.files || [] };
          await DB.put('sessions', s);
          if (current && current.id === s.id) current.cloud = s.cloud;
          Cloud.setQueue(Cloud.queue().filter(x => x !== id));
          sent++;
        } catch (e) { console.warn('cloud', id, e); failed++; }
      }
      return { sent, failed };
    })().finally(() => { flushing = null; });
    return flushing;
  }
  // Ghi lịch sử "đang kiểm" ngay khi bắt đầu để dashboard chung thấy ai đang đi kiểm
  function cloudTouch(s) {
    if (!Cloud.enabled()) return;
    Cloud.enqueue(s.id);
    flushCloud().catch(() => {});
  }
  function cloudStatusCard(s) {
    if (!Cloud.enabled()) return `<div class="card small muted">Chưa bật lưu dữ liệu chung: file và lịch sử chỉ nằm trên máy này. Quản trị viên vào ⚙ Cài đặt → <b>Dữ liệu chung</b> để bật.</div>`;
    const pending = Cloud.queue().includes(s.id) || !s.cloud;
    return `<div class="card small ${pending ? 'warn-card' : 'ok-card'}">${pending
      ? `☁ Chưa lưu lên dữ liệu chung. <button class="btn small-btn" id="cloudNow">Gửi ngay</button>`
      : `☁ Đã lưu ${(s.cloud && s.cloud.files || []).length} file lên dữ liệu chung${s.cloud ? ' lúc ' + Util.vnDateTime(s.cloud.at) : ''}. Máy tính đồng bộ tự đưa file vào OneDrive › Apps Kiem Kho › Output, máy khác xem được trong Dashboard.`}</div>`;
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
  async function sourceFiles(s) { return ((await DB.get('files', 'src:' + s.id)) || {}).files || []; }

  // Biên bản kiểm kê + ghép nguyên các trang PDF tồn kho in từ chương trình vào cuối (Package / Ingredient)
  async function recordWithSource(s, withSig) {
    const rec = await Reports.toBlob(Docs2.suppliesRecordDoc(s, withSig));
    const src = await sourceFiles(s);
    if (!src.length || typeof PDFLib === 'undefined') return rec;
    try {
      const out = await PDFLib.PDFDocument.load(await rec.arrayBuffer());
      for (const f of src) {
        const doc = await PDFLib.PDFDocument.load(await f.blob.arrayBuffer(), { ignoreEncryption: true });
        (await out.copyPages(doc, doc.getPageIndices())).forEach(p => out.addPage(p));
      }
      return new Blob([await out.save()], { type: 'application/pdf' });
    } catch (e) { console.warn('ghép PDF chương trình', e); return rec; }
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
        signed: { name: n.signed, blob: await recordWithSource(s, true) },
        unsigned: { name: n.unsigned, blob: await recordWithSource(s, false) },
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
    // File được tạo sẵn (lúc kết thúc hoặc ngay khi mở màn hình này) và giữ trong bộ nhớ,
    // vì điện thoại chỉ cho tải/chia sẻ khi lệnh chạy ngay trong lần bấm.
    let files = (await DB.get('files', s.id) || {}).files;
    if (!files) {
      busy(true, 'Đang tạo file...');
      try { files = await buildFiles(s); await DB.put('files', { id: s.id, files }); } catch (e) { toast(e.message, 'err'); } finally { busy(false); }
    }
    if (!files) return;
    const keys = FILE_ORDER.filter(k => files[k] && files[k].blob);
    view().innerHTML = `
      <div class="card ok-card">
        <h3>${E(docNoOf(s))}</h3>
        <p class="small">${E(TYPES[typeOf(s)].name)} · ${E(s.factory.name)} · ${Util.vnDate(s.countDate)} · kết thúc ${Util.vnDateTime(s.finishedAt)}<br>
        ${bsum ? `Đánh giá ${bsum.pass.length + bsum.fail.length}/${bsum.all.length} chỉ tiêu · ${bsum.pass.length} đạt · ${bsum.fail.length} không đạt · tỉ lệ đạt ${Util.fmt(bsum.score)}%`
          : `Đã kiểm ${sum.counted}/${sum.lines} dòng · ${sum.overLines} thừa · ${sum.shortLines} thiếu${typeOf(s) === 'meat' ? ` · ${sum.expired} hết hạn · ${sum.near} sắp hết hạn` : ''}`}</p>
      </div>
      ${ms ? `<div class="card od-card">
        <h3>Lưu vào OneDrive / Output</h3>
        <p class="small">Gửi cả bộ file thẳng vào thư mục <b>${E(Config.get().oneDrive.outputFolder)}</b> trên OneDrive.</p>
        <button class="btn primary block" id="odall">☁ Lưu tất cả vào OneDrive Output</button>
      </div>` : ''}
      ${Util.inAppBrowser ? '<div class="card warn-card small"><b>App đang mở trong Zalo/Facebook/Teams.</b> Các ứng dụng này chặn tải và chia sẻ file. Bấm ⋮ hoặc ⋯ → <b>Mở bằng trình duyệt</b> (Chrome/Safari), hoặc mở app từ biểu tượng trên màn hình chính.</div>' : ''}
      ${cloudStatusCard(s)}
      ${keys.map(k => [k, FILE_LABELS[k], files[k].name]).map(([k, t, fn]) => `
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
    const all = keys.map(k => files[k]);
    if ($('#cloudNow')) $('#cloudNow').onclick = () => guard(async () => { Cloud.enqueue(s.id); const r = await flushCloud(); if (r.failed) toast('Chưa gửi được, kiểm tra mạng hoặc mã kết nối', 'err'); current = null; renderDone(id); }, 'Đang lưu lên dữ liệu chung...');
    if ($('#odall')) $('#odall').onclick = () => guard(async () => {
      for (const f of all) await DB.put('outbox', { id: Util.uid(), name: f.name, folder: Config.get().oneDrive.outputFolder, blob: f.blob, createdAt: Date.now() });
      const r = await OneDrive.flushOutbox();
      toast(r.pending ? `Đã gửi ${r.sent}, còn ${r.pending} file sẽ gửi khi có mạng` : `Đã lưu ${r.sent} file vào OneDrive Output`);
      refreshNet();
    }, 'Đang lưu lên OneDrive...');
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
    trip: 'Báo cáo kiểm kê (slide)', signed: 'Biên bản (đã ký trên app)', unsigned: 'Biên bản để in ký tay', excel: 'File Excel kết quả',
    source: 'Báo cáo tồn từ chương trình (PDF gốc, đính kèm)'
  };
  const FILE_ORDER = ['trip', 'signed', 'unsigned', 'source', 'excel'];

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
    const st = renderDashboard.state = renderDashboard.state || { year: String(new Date().getFullYear()), month: String(new Date().getMonth() + 1).padStart(2, '0'), type: '', user: '', factory: '', status: '', view: 'month' };
    const own = (await DB.all('sessions')).filter(s => s.checkIn || s.status === 'done').map(summaryOf);
    // Lịch sử chung: hiện ngay bản đã lưu trên máy, rồi tải bản mới nhất
    const cloudList = Cloud.enabled() ? (Cloud.cachedHistory(st.year) || []) : [];
    drawDashboard(own, cloudList, Cloud.enabled() ? 'loading' : 'off');
    if (Cloud.enabled()) {
      const r = await Cloud.historyYear(st.year);
      if (location.hash.startsWith('#dashboard')) drawDashboard(own, r.list, r.live ? 'live' : 'offline', r.at);
    }
  }

  function mergeHistory(own, cloudList) {
    const map = new Map();
    cloudList.forEach(h => map.set(h.id, Object.assign({}, h, { cloud: true })));
    own.forEach(h => {
      const c = map.get(h.id);
      // Trên máy này còn phiên kiểm: mở thẳng được; trạng thái lấy bản mới hơn
      map.set(h.id, Object.assign({}, c || {}, h, { cloud: !!c, files: (c && c.files) || [], local: true }));
    });
    externalHistory().forEach(h => { if (!map.has(h.id)) map.set(h.id, Object.assign({}, h, { local: false })); });
    return [...map.values()].filter(h => h.date && TYPES[h.type]);
  }

  const hm = ts => ts ? new Date(ts).toTimeString().slice(0, 5) : '';
  const dur = (a, b) => {
    if (!a || !b) return '';
    const m = Math.round((new Date(b) - new Date(a)) / 60000);
    return m <= 0 ? '' : m < 60 ? `${m} phút` : `${Math.floor(m / 60)} giờ ${String(m % 60).padStart(2, '0')}`;
  };
  const initials = n => String(n || '?').trim().split(/\s+/).slice(-2).map(w => w[0]).join('').toUpperCase();
  const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

  function drawDashboard(own, cloudList, cloudState, cloudAt) {
    const st = renderDashboard.state;
    const all = mergeHistory(own, cloudList).sort((a, b) => b.date.localeCompare(a.date) || String(b.start).localeCompare(String(a.start)));
    const thisYear = String(new Date().getFullYear());
    const years = [...new Set(all.map(h => h.date.slice(0, 4)).concat(thisYear, st.year))].sort().reverse();
    const users = [...new Set(all.map(h => h.user))].sort();
    const facNames = new Map(); all.forEach(h => { if (h.factoryCode && !facNames.has(h.factoryCode)) facNames.set(h.factoryCode, h.factory); });
    Config.get().factories.forEach(f => { if (!facNames.has(f.code)) facNames.set(f.code, f.name); });
    const pass = h => (!st.type || h.type === st.type) && (!st.user || h.user === st.user) && (!st.factory || h.factoryCode === st.factory)
      && (!st.status || (st.status === 'done' ? h.status === 'done' : h.status !== 'done'));
    const inYear = all.filter(h => h.date.startsWith(st.year) && pass(h));
    const list = inYear.filter(h => !st.month || h.date.slice(5, 7) === st.month);
    const byMonth = Array.from({ length: 12 }, (_, m) => {
      const mm = String(m + 1).padStart(2, '0');
      const r = inYear.filter(h => h.date.slice(5, 7) === mm);
      const t = {};
      Object.keys(TYPES).forEach(k => { t[k] = r.filter(h => h.type === k).length; });
      return { mm, n: r.length, t };
    });
    const max = Math.max(1, ...byMonth.map(b => b.n));
    const done = list.filter(h => h.status === 'done');
    const issues = list.reduce((a, h) => a + ((h.stats || {}).diff || 0) + ((h.stats || {}).fail || 0), 0);
    const people = [...new Set(list.map(h => h.user))];
    // Bảng theo chi nhánh: số lần kiểm, lần gần nhất, ai đã kiểm
    const facMap = new Map();
    list.forEach(h => { const k = h.factoryCode || h.factory; if (!facMap.has(k)) facMap.set(k, []); facMap.get(k).push(h); });
    const facRows = [...facMap].map(([code, hs]) => ({ code, name: facNames.get(code) || hs[0].factory, n: hs.length, done: hs.filter(h => h.status === 'done').length,
      issues: hs.reduce((a, h) => a + ((h.stats || {}).diff || 0) + ((h.stats || {}).fail || 0), 0), last: hs.slice().sort((a, b) => b.date.localeCompare(a.date))[0],
      people: [...new Set(hs.map(h => h.user))] })).sort((a, b) => b.n - a.n);
    const facMax = Math.max(1, ...facRows.map(r => r.n));
    const admin = Auth.can.deleteHistory();
    // Kế toán và quản trị được tải về / chia sẻ file biên bản; tài khoản chỉ xem chỉ được xem
    const canFiles = Auth.can.count();
    const C = TYPE_COLORS;
    const short = k => ({ branch: 'Chi nhánh', meat: 'Meat', supplies: 'Spare part / Supplies', package: 'Package / Ingredient' })[k];
    const periodLabel = st.month ? `Tháng ${Number(st.month)}/${st.year}` : `Năm ${st.year}`;
    const pctDone = list.length ? Math.round(done.length / list.length * 100) : 0;
    const tab = st.tab = st.tab || 'overview';

    // ----- Tổng quan: theo tháng, theo loại kiểm, theo chi nhánh -----
    const typeRows = Object.keys(TYPES).map(k => ({ k, n: list.filter(h => h.type === k).length }));
    const typeMax = Math.max(1, ...typeRows.map(r => r.n));
    const overview = `
      <div class="card">
        <h3>Số lần kiểm theo tháng · ${E(st.year)}</h3>
        <div class="mchart">${byMonth.map(b => `
          <div class="mcol ${b.mm === st.month ? 'sel' : ''}" data-m="${b.mm}" title="Tháng ${Number(b.mm)}: ${b.n} lần">
            <div class="mval">${b.n || ''}</div>
            <div class="mbar" style="height:${b.n / max * 100}%">${['package', 'supplies', 'meat', 'branch'].map(k => b.t[k] ? `<div style="flex:${b.t[k]};background:${C[k]}"></div>` : '').join('')}</div>
            <div class="mlab">T${Number(b.mm)}</div>
          </div>`).join('')}
        </div>
        <p class="muted small">Bấm vào cột để xem tháng đó.</p>
      </div>
      <div class="card">
        <h3>Theo loại kiểm</h3>
        ${typeRows.map(r => `<div class="hbar click ${st.type === r.k ? 'on' : ''}" data-ty="${r.k}">
          <span class="hb-l"><i style="background:${C[r.k]}"></i>${short(r.k)}</span>
          <span class="hb-t"><i style="width:${r.n / typeMax * 100}%;background:${C[r.k]}"></i></span><b>${r.n}</b></div>`).join('')}
      </div>
      <div class="card">
        <h3>Theo chi nhánh</h3>
        ${facRows.length ? facRows.map(r => `<div class="frow click ${st.factory === r.code ? 'on' : ''}" data-fac="${E(r.code)}">
          <div class="frow-main"><b>${E(r.name)}</b>
            <span class="muted small">Gần nhất ${Util.vnDate(r.last.date)} · ${E(r.last.user)}</span>
            <div class="mini-bar"><i style="width:${r.n / facMax * 100}%"></i></div></div>
          <div class="frow-num"><b>${r.n}</b><span>${r.done}/${r.n} xong${r.issues ? ` · <em>${r.issues} lệch</em>` : ''}</span></div>
        </div>`).join('') + '<p class="muted small">Bấm vào chi nhánh để lọc.</p>' : '<p class="muted small">Chưa có lần kiểm nào.</p>'}
      </div>`;

    // ----- Lịch kiểm: mỗi kế toán một thẻ, tên hiện đầy đủ; tháng = lịch tuần, năm = 12 ô tháng -----
    const lanes = st.user ? [st.user] : [...new Set(inYear.map(h => h.user))].sort((a, b) => a.localeCompare(b, 'vi'));
    const today = Util.today();
    const who = (u, sub) => `<div class="cal-who"><span class="ava">${E(initials(u))}</span><div><b>${E(u)}</b><span class="muted small">${sub}</span></div></div>`;
    let cal;
    if (st.month) {
      const y = Number(st.year), m = Number(st.month);
      const days = new Date(y, m, 0).getDate();
      const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // tuần bắt đầu từ thứ 2
      const head = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(d => `<span class="cal-h">${d}</span>`).join('');
      cal = lanes.map(u => {
        const mine = list.filter(h => h.user === u);
        const cells = '<span></span>'.repeat(lead) + Array.from({ length: days }, (_, i) => {
          const iso = `${st.year}-${st.month}-${String(i + 1).padStart(2, '0')}`;
          const hs = mine.filter(h => h.date === iso);
          const dow = new Date(y, m - 1, i + 1).getDay();
          return `<span class="cal-d ${hs.length ? 'has' : ''} ${dow === 0 ? 'sun' : ''} ${iso === today ? 'today' : ''}" ${hs.length ? `data-day="${iso}" style="--c:${C[hs[0].type]}" title="${E(hs.map(h => short(h.type) + ' · ' + h.factory).join('\n'))}"` : ''}>${i + 1}${hs.length > 1 ? `<sup>${hs.length}</sup>` : ''}</span>`;
        }).join('');
        return `<div class="cal-card">${who(u, `${mine.length} lần kiểm · ${new Set(mine.map(h => h.factoryCode)).size} chi nhánh`)}<div class="cal-grid">${head}${cells}</div></div>`;
      }).join('');
    } else {
      cal = lanes.map(u => {
        const mine = inYear.filter(h => h.user === u);
        const per = byMonth.map(b => mine.filter(h => h.date.slice(5, 7) === b.mm).length);
        const top = Math.max(1, ...per);
        return `<div class="cal-card">${who(u, `${mine.length} lần kiểm trong năm`)}<div class="cal-year">${byMonth.map((b, i) =>
          `<span class="cal-m ${per[i] ? 'has' : ''}" data-m="${b.mm}" style="--a:${per[i] ? 0.25 + 0.75 * per[i] / top : 0}"><i>T${Number(b.mm)}</i><b>${per[i] || ''}</b></span>`).join('')}</div></div>`;
      }).join('');
    }
    const calendar = `<div class="cal-list">${cal || '<div class="card muted">Chưa có lần kiểm nào.</div>'}</div>
      <div class="legend small">${Object.keys(TYPES).map(k => `<span><i style="background:${C[k]}"></i>${short(k)}</span>`).join('')}</div>
      <p class="muted small">${st.month ? 'Bấm vào ngày có màu để xem lần kiểm đó.' : 'Bấm vào tháng để xem lịch chi tiết.'}</p>`;

    // ----- Dòng thời gian: nhóm theo ngày, mới nhất trước -----
    const byDay = new Map();
    list.forEach(h => { if (!byDay.has(h.date)) byDay.set(h.date, []); byDay.get(h.date).push(h); });
    const feed = [...byDay].map(([d, hs]) => {
      const dt = new Date(d + 'T00:00:00');
      return `<div class="day-head" data-d="${d}"><b>${DOW[dt.getDay()]}, ${Util.vnDate(d)}</b><span>${hs.length} lần kiểm</span></div>
        ${hs.map(h => {
          const s = h.stats || {};
          const res = h.type === 'branch'
            ? `<span class="pill ${s.fail ? 'bad' : 'good'}">${s.pass || 0} đạt · ${s.fail || 0} không đạt</span>`
            : `<span class="pill ${s.diff ? 'bad' : s.counted ? 'good' : ''}">${s.counted || 0}/${s.lines || 0} dòng · ${s.diff ? s.diff + ' lệch' : s.counted ? 'khớp sổ' : 'chưa đếm'}</span>`;
          const pdfs = (h.files || []).filter(f => /\.pdf$/i.test(f.name));
          const xls = canFiles ? (h.files || []).filter(f => /\.xlsx?$/i.test(f.name)) : [];
          return `<div class="ev" style="--c:${C[h.type]}">
            <div class="ev-time"><b>${hm(h.start)}</b><span>${hm(h.end)}</span></div>
            <div class="ev-body">
              <div class="ev-top"><span class="tchip" style="--c:${C[h.type]}">${TYPES[h.type].icon} ${short(h.type)}</span><span class="pill ${h.status === 'done' ? 'done' : 'run'}">${h.status === 'done' ? 'Hoàn tất' : 'Đang kiểm'}</span></div>
              <div class="ev-title">${E(h.factory)}</div>
              <div class="ev-meta"><span class="ava sm">${E(initials(h.user))}</span>${E(h.user)}${dur(h.start, h.end) ? ` · ⏱ ${dur(h.start, h.end)}` : ''}${h.docNo ? ` · ${E(h.docNo)}` : ''}</div>
              <div class="ev-meta">${res}</div>
              <div class="ev-act">
                ${h.local ? `<button class="btn small-btn" data-open="${h.id}" data-st="${h.status}">${h.status === 'done' ? 'Mở kết quả' : 'Tiếp tục'}</button>` : ''}
                ${!h.local ? pdfs.map(f => `<button class="btn small-btn" data-cf="${E(f.path)}" data-cn="${E(f.name)}">📄 ${E(FILE_LABELS[f.key] || f.name)}</button>`).join('')
                  + xls.map(f => `<button class="btn small-btn" data-cx="${E(f.path)}" data-cn="${E(f.name)}">⬇ ${E(FILE_LABELS[f.key] || f.name)}</button>`).join('') : ''}
                ${admin && (h.cloud || h.local) ? `<button class="btn small-btn danger" data-del="${h.id}">🗑 Xóa</button>` : ''}
              </div>
            </div>
          </div>`;
        }).join('')}`;
    }).join('');
    const feedHtml = `<div class="feed">${feed || '<div class="card muted">Không có lần kiểm nào trong khoảng này.</div>'}</div>
      ${canFiles ? '' : '<p class="muted small">Tài khoản chỉ xem: xem được file biên bản, không tải về hay chia sẻ.</p>'}`;

    const sel = (id, all, opts) => `<select id="${id}"><option value="">${all}</option>${opts}</select>`;
    view().innerHTML = `
      <div class="dash-hero">
        <div class="hero-top">
          <div><div class="hero-sub">Tình hình kiểm kho</div><div class="hero-title">${periodLabel}</div></div>
          <div class="hero-ctl">
            ${st.month ? '<button class="hero-nav" data-mv="-1" aria-label="Tháng trước">‹</button>' : ''}
            <select id="dm" class="hero-sel"><option value="">Cả năm</option>${byMonth.map(b => `<option value="${b.mm}" ${b.mm === st.month ? 'selected' : ''}>Tháng ${Number(b.mm)}</option>`).join('')}</select>
            <select id="dy" class="hero-sel">${years.map(y => `<option ${y === st.year ? 'selected' : ''}>${y}</option>`).join('')}</select>
            ${st.month ? '<button class="hero-nav" data-mv="1" aria-label="Tháng sau">›</button>' : ''}
          </div>
        </div>
        <div class="kpis">
          <div><b>${list.length}</b><span>lần kiểm</span></div>
          <div><b>${new Set(list.map(h => h.factoryCode)).size}</b><span>chi nhánh</span></div>
          <div><b>${people.length}</b><span>kế toán</span></div>
          <div class="${issues ? 'warn' : ''}"><b>${issues}</b><span>lệch / không đạt</span></div>
        </div>
        <div class="hero-prog"><div class="row between"><span>Hoàn tất ${done.length}/${list.length}</span><b>${pctDone}%</b></div><div class="hp-bar"><i style="width:${pctDone}%"></i></div></div>
        <div class="sync-line">${cloudState === 'loading' ? '☁ Đang tải lịch sử chung...' : cloudState === 'live' ? '☁ Dữ liệu chung của mọi kế toán, vừa cập nhật' : cloudState === 'off' ? '📱 Chỉ dữ liệu trên máy này' : `☁ Đang offline, bản lưu lúc ${cloudAt ? Util.vnDateTime(cloudAt) : '—'}`}</div>
      </div>

      <div class="chips">
        <button class="chip ${!st.type ? 'on' : ''}" data-t="">Tất cả</button>
        ${Object.keys(TYPES).map(k => `<button class="chip ${st.type === k ? 'on' : ''}" data-t="${k}"><i style="background:${C[k]}"></i>${short(k)}</button>`).join('')}
      </div>
      <div class="dfilters">
        ${sel('dfac', 'Mọi chi nhánh', [...facNames].sort((a, b) => a[1].localeCompare(b[1], 'vi')).map(([k, n]) => `<option value="${E(k)}" ${k === st.factory ? 'selected' : ''}>${E(n)}</option>`).join(''))}
        ${sel('du', 'Mọi kế toán', users.map(u => `<option ${u === st.user ? 'selected' : ''}>${E(u)}</option>`).join(''))}
        ${sel('dst', 'Mọi trạng thái', `<option value="done" ${st.status === 'done' ? 'selected' : ''}>Hoàn tất</option><option value="counting" ${st.status === 'counting' ? 'selected' : ''}>Đang kiểm</option>`)}
      </div>
      ${(st.status || st.factory || st.user || st.type) ? '<button class="ftag clear" data-clr="all">✕ Bỏ bộ lọc</button>' : ''}

      <div class="seg">${[['overview', 'Tổng quan'], ['calendar', 'Lịch kiểm'], ['feed', 'Dòng thời gian']].map(([k, t]) =>
        `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}</div>
      ${tab === 'calendar' ? calendar : tab === 'feed' ? feedHtml : overview}

      <button class="btn small-btn" id="hxl">⬇ Xuất Excel lịch sử ${E(periodLabel.toLowerCase())}</button>`;

    const redraw = () => drawDashboard(own, cloudList, cloudState, cloudAt);
    const upd = (k, v) => { st[k] = v; if (k === 'year') { st.month = ''; return renderDashboard(); } redraw(); };
    $('#dy').onchange = e => upd('year', e.target.value);
    $('#du').onchange = e => upd('user', e.target.value);
    $('#dm').onchange = e => upd('month', e.target.value);
    $('#dst').onchange = e => upd('status', e.target.value);
    $('#dfac').onchange = e => upd('factory', e.target.value);
    $$('[data-mv]').forEach(b => b.onclick = () => {
      const d = new Date(Number(st.year), Number(st.month) - 1 + Number(b.dataset.mv), 1);
      const y = String(d.getFullYear()), m = String(d.getMonth() + 1).padStart(2, '0');
      if (y !== st.year) { st.year = y; st.month = m; return renderDashboard(); }
      upd('month', m);
    });
    $$('[data-tab]').forEach(b => b.onclick = () => upd('tab', b.dataset.tab));
    $$('[data-fac]').forEach(r => r.onclick = () => upd('factory', st.factory === r.dataset.fac ? '' : r.dataset.fac));
    $$('[data-ty]').forEach(r => r.onclick = () => upd('type', st.type === r.dataset.ty ? '' : r.dataset.ty));
    $$('[data-clr]').forEach(b => b.onclick = () => { st.type = st.status = st.factory = st.user = ''; redraw(); });
    $$('.chip').forEach(c => c.onclick = () => upd('type', c.dataset.t));
    $$('.mcol').forEach(c => c.onclick = () => upd('month', st.month === c.dataset.m ? '' : c.dataset.m));
    $$('.cal-m[data-m]').forEach(c => c.onclick = () => upd('month', c.dataset.m));
    // Bấm ngày trên lịch: sang Dòng thời gian, cuộn tới ngày đó
    $$('.cal-d[data-day]').forEach(c => c.onclick = () => { st.focusDay = c.dataset.day; upd('tab', 'feed'); });
    if (tab === 'feed' && st.focusDay) {
      const el = $(`.day-head[data-d="${st.focusDay}"]`);
      st.focusDay = '';
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
    $$('[data-open]').forEach(b => b.onclick = () => go((b.dataset.st === 'done' ? '#done/' : '#count/') + b.dataset.open));
    const act = p => Promise.resolve(p).catch(e => toast(e.message, 'err'));
    $$('[data-cf]').forEach(b => b.onclick = () => guard(async () => {
      const blob = await Cloud.getBlob(b.dataset.cf), name = b.dataset.cn;
      Viewer.open(blob, name, canFiles ? [{ label: 'Tải về', run: () => act(Util.download(blob, name)) }, { label: 'Chia sẻ', run: () => act(Util.share(blob, name)) }] : []);
    }, 'Đang tải file...'));
    $$('[data-cx]').forEach(b => b.onclick = () => guard(async () => act(Util.download(await Cloud.getBlob(b.dataset.cx), b.dataset.cn)), 'Đang tải file...'));
    $$('[data-del]').forEach(b => b.onclick = () => {
      const h = all.find(x => x.id === b.dataset.del);
      if (!h || !confirm(`Xóa lần kiểm ${h.docNo || ''} · ${h.factory} · ${Util.vnDate(h.date)} của ${h.user}?\nLịch sử và các file biên bản của lần này sẽ bị xóa khỏi dữ liệu chung${h.local ? ' và khỏi máy này' : ''}. Không khôi phục được.`)) return;
      guard(async () => {
        if (h.cloud) await Cloud.deleteHistory(h);
        if (h.local) { await DB.del('sessions', h.id); await DB.del('files', h.id); await DB.del('files', 'src:' + h.id).catch(() => {}); Cloud.setQueue(Cloud.queue().filter(x => x !== h.id)); }
        toast('Đã xóa lần kiểm'); renderDashboard();
      }, 'Đang xóa...');
    });
    $('#hxl').onclick = () => {
      const rows = list.map(h => ({ 'Ngày': Util.vnDate(h.date), 'Loại kiểm': TYPES[h.type].name, 'Nhà máy': h.factory, 'Mã NM': h.factoryCode, 'Số biên bản': h.docNo || '', 'Kế toán': h.user,
        'Bắt đầu': h.start ? Util.vnDateTime(h.start) : '', 'Kết thúc': h.end ? Util.vnDateTime(h.end) : '', 'Thời gian': dur(h.start, h.end), 'Trạng thái': h.status === 'done' ? 'Hoàn tất' : 'Đang kiểm',
        'Số dòng / chỉ tiêu': (h.stats || {}).lines || (h.stats || {}).total || '', 'Dòng lệch': (h.stats || {}).diff == null ? '' : h.stats.diff, 'Không đạt': (h.stats || {}).fail == null ? '' : h.stats.fail,
        'File': (h.files || []).map(f => f.name).join(', ') }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'LichSu');
      Util.download(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `LichSuKiemKho_${Util.safeName(periodLabel)}.xlsx`);
    };
  }

  // ---------- cài đặt ----------
  function renderSettings() {
    const user = Auth.currentUser();
    setTitle('Cài đặt', user ? '#home' : '#login');
    const c = Config.get();
    const canEdit = user ? Auth.can.settings() : !c.localUsers.length;
    if (!canEdit) {
      view().innerHTML = `${cloudCard(false)}
        <div class="card small">Tài khoản <b>${E(user ? user.name : '')}</b> · quyền <b>${E(Auth.ROLES[Auth.role()] || '')}</b>. Chỉ quản trị viên được sửa cài đặt, nhà máy và tài khoản.</div>
        ${user ? '<button class="btn block" id="logout">Đăng xuất</button>' : ''}
        <p class="muted small center">Phiên bản ${window.APP_VERSION}</p>`;
      bindCloudCard(false);
      if ($('#logout')) $('#logout').onclick = () => { Auth.logout(); current = null; go('#login'); };
      return;
    }
    view().innerHTML = `
      ${cloudCard(true)}
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
          ${Cloud.enabled() ? '<button class="btn small-btn" id="mCloud">☁ Nạp Master mới nhất từ dữ liệu chung</button>' : ''}
        </div>
      </div>
      <div class="card">
        <h3>Mẫu kiểm tra chi nhánh</h3>
        <p class="small">${(() => { const cl = checklistTemplate(); return `<b>${E(cl.title)}</b> · ${cl.sections.length} khu vực · ${cl.sections.reduce((a, x) => a + x.items.length, 0)} chỉ tiêu${localStorage.getItem('kk_checklist') ? ' (mẫu riêng)' : ' (mẫu mặc định SLH.01)'}`; })()}</p>
        <div class="row gap">
          <label class="btn small-btn">⬆ Nạp mẫu checklist (Excel)<input type="file" id="cIn" hidden accept=".xlsx,.xls"></label>
          ${Cloud.enabled() ? '<button class="btn small-btn" id="cCloud">☁ Lấy mẫu từ Data check Branch</button>' : ''}
          ${localStorage.getItem('kk_checklist') ? '<button class="btn small-btn" id="cDef">Dùng mẫu mặc định</button>' : ''}
        </div>
      </div>
      <details class="card" ${c.msal.clientId ? 'open' : ''}>
        <summary><b>Nâng cao: đăng nhập Microsoft 365</b> <span class="muted small">(chỉ cần khi IT cấp Client ID)</span></summary>
        <label>Client ID (Azure AD app)<input id="cid" value="${E(c.msal.clientId)}" placeholder="xxxxxxxx-xxxx-..."></label>
        <label>Tenant ID<input id="tid" value="${E(c.msal.tenantId)}"></label>
        <label>Thư mục Input<input id="inf" value="${E(c.oneDrive.inputFolder)}"></label>
        <label>Thư mục Output<input id="outf" value="${E(c.oneDrive.outputFolder)}"></label>
        <p class="muted small">Redirect URI cần đăng ký trong Azure: ${E(location.origin + location.pathname)}</p>
      </details>
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
      <div class="card">
        <h3>Từ điển dịch tên vật tư (tiếng Anh → tiếng Việt)</h3>
        <p class="muted small">App tự dịch tên SAP tiếng Anh để in biên bản tiếng Việt, vd "Proximity Sensor" → "Cảm biến tiệm cận". Thêm hoặc sửa cách dịch ở đây, mỗi dòng: <code>tiếng Anh = tiếng Việt</code>. Dòng ở đây được ưu tiên hơn từ điển có sẵn và dùng chung cho mọi máy.</p>
        <textarea id="gloss" rows="5" placeholder="Bearing = Vòng bi&#10;Overload = Rơ le nhiệt">${E(c.glossary || '')}</textarea>
        <label class="small">Thử dịch<input id="gtest" placeholder="Gõ tên tiếng Anh, vd Omron Proximity Sensor E2E-X5Y1"></label>
        <p class="small" id="gout"></p>
      </div>
      <button class="btn primary block" id="save">Lưu cài đặt</button>
      <div class="card">
        <h3>Tài khoản & phân quyền</h3>
        <p class="muted small"><b>Quản trị</b>: sửa cài đặt, nhà máy, tài khoản, xóa lịch sử kiểm thừa · <b>Kế toán</b>: đi kiểm, xem dashboard · <b>Chỉ xem</b>: xem dashboard và file biên bản.${Cloud.enabled() ? ' Tài khoản dùng chung cho mọi máy đã kết nối.' : ''}</p>
        ${c.localUsers.map(u => `<div class="urow-wrap">
          <div class="urow">
            <div><b>${E(u.name)}</b><div class="muted small">${E(u.email)}</div></div>
            <select data-role="${E(u.email)}">${Object.entries(Auth.ROLES).map(([k, t]) => `<option value="${k}" ${Auth.roleOf(u) === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
            <button class="btn small-btn" data-edu="${E(u.email)}">Sửa</button>
            <button class="btn small-btn" data-rmu="${E(u.email)}" ${user && user.email === u.email ? 'disabled title="Không tự xóa tài khoản đang dùng"' : ''}>Xóa</button>
          </div>
          <div class="uedit" data-uedit="${E(u.email)}" hidden>
            <label class="small">Tên hiển thị<input class="uen" value="${E(u.name)}"></label>
            <label class="small">Mật khẩu mới (để trống nếu giữ nguyên)<input class="uep" type="password" autocomplete="new-password"></label>
            <div class="row gap"><button class="btn small-btn primary" data-usv="${E(u.email)}">Lưu</button><button class="btn small-btn" data-edu="${E(u.email)}">Hủy</button></div>
          </div>
        </div>`).join('') || '<p class="muted small">Chưa có</p>'}
        <h4>Thêm tài khoản</h4>
        <input id="ue" type="email" placeholder="Email"><input id="un" placeholder="Họ tên"><input id="up" type="password" placeholder="Mật khẩu">
        <select id="ua">${Object.entries(Auth.ROLES).map(([k, t]) => `<option value="${k}" ${k === 'accountant' ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <button class="btn small-btn primary" id="addu">Thêm tài khoản</button>
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
    if ($('#mCloud')) $('#mCloud').onclick = () => guard(async () => {
      const [m] = await Cloud.inputFiles('Master_NhaMay.xlsx');
      if (!m) throw new Error('Chưa có Master_NhaMay.xlsx trên dữ liệu chung (máy tính đồng bộ chưa đẩy lên)');
      loadMaster(await (await Cloud.getBlob(m.path)).arrayBuffer(), m.name + ' (' + Util.vnDateTime(m.modified) + ')');
    }, 'Đang tải Master...');
    if ($('#cCloud')) $('#cCloud').onclick = () => guard(async () => {
      const [m] = await Cloud.inputFiles('Data check Branch/*.xlsx');
      if (!m) throw new Error('Chưa có file mẫu trong Data check Branch trên dữ liệu chung');
      const cl = Master.parseChecklist(await (await Cloud.getBlob(m.path)).arrayBuffer());
      if (!confirm(`Dùng mẫu "${cl.title}" từ file ${m.name} (${cl.sections.length} khu vực) cho kiểm tra chi nhánh?`)) return;
      localStorage.setItem('kk_checklist', JSON.stringify(cl)); Cloud.pushConfigSoon();
      toast('Đã cập nhật mẫu kiểm tra chi nhánh'); renderSettings();
    }, 'Đang tải mẫu checklist...');
    $('#cIn').onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      guard(async () => {
        const cl = Master.parseChecklist(await f.arrayBuffer());
        if (!confirm(`Dùng mẫu "${cl.title}" (sheet ${cl.sheet}, ${cl.sections.length} khu vực) cho kiểm tra chi nhánh?`)) return;
        localStorage.setItem('kk_checklist', JSON.stringify(cl)); Cloud.pushConfigSoon();
        toast('Đã cập nhật mẫu kiểm tra chi nhánh'); renderSettings();
      }, 'Đang đọc mẫu checklist...');
    };
    if ($('#cDef')) $('#cDef').onclick = () => { localStorage.removeItem('kk_checklist'); Cloud.pushConfigSoon(); renderSettings(); };
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
      // Giữ các thông tin khác của nhà máy lấy từ file Master (file vật tư, bao bì, người ký...)
      const old = new Map(c.factories.map(f => [f.code, f]));
      const factories = $$('#facs .fac').map(r => Object.assign({}, old.get($('.fc', r).value.trim()) || {}, {
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
        nearExpiryMinDays: Number($('#mind').value) || 0,
        glossary: $('#gloss').value.trim()
      });
      toast('Đã lưu. App sẽ tải lại.');
      setTimeout(() => location.reload(), 1500);
    };
    $('#gtest').oninput = () => {
      const keep = Config.get().glossary;
      // Thử ngay với từ điển đang gõ (chưa lưu)
      Config.get().glossary = $('#gloss').value;
      $('#gout').textContent = $('#gtest').value ? '→ ' + (Glossary.vi($('#gtest').value) || '(chưa có trong từ điển)') : '';
      Config.get().glossary = keep;
    };
    $('#addu').onclick = () => guard(async () => {
      await Auth.addLocalUser($('#ue').value, $('#un').value, $('#up').value, $('#ua').value);
      toast('Đã thêm tài khoản'); renderSettings();
    });
    $$('[data-role]').forEach(s => s.onchange = () => {
      try { Auth.setRole(s.dataset.role, s.value); toast('Đã đổi quyền ' + s.dataset.role); } catch (e) { toast(e.message, 'err'); }
      Auth.refreshUser(); renderSettings();
    });
    $$('[data-edu]').forEach(b => b.onclick = () => { const box = $(`[data-uedit="${CSS.escape(b.dataset.edu)}"]`); box.hidden = !box.hidden; });
    $$('[data-usv]').forEach(b => b.onclick = () => guard(async () => {
      const box = b.closest('.uedit');
      await Auth.updateLocalUser(b.dataset.usv, $('.uen', box).value, $('.uep', box).value);
      Auth.refreshUser();
      toast('Đã cập nhật tài khoản ' + b.dataset.usv); renderSettings();
    }));
    $$('[data-rmu]').forEach(b => b.onclick = () => { if (confirm('Xóa tài khoản ' + b.dataset.rmu + '?')) { Auth.removeLocalUser(b.dataset.rmu); renderSettings(); } });
    if ($('#logout')) $('#logout').onclick = () => { Auth.logout(); current = null; go('#login'); };
    bindCloudCard(true);
  }

  // ---------- thẻ dữ liệu chung trong Cài đặt ----------
  const DATA_REPO = 'ducthang2109/CPV-SLH-Kiem-Kho-Data';
  function cloudCard(admin) {
    if (!Cloud.enabled()) return `
      <div class="card cloud-card">
        <h3>☁ Dữ liệu chung (lịch sử, file, tài khoản)</h3>
        <p class="small">Chưa kết nối: lịch sử và file chỉ nằm trên máy này. ${admin ? 'Nhập token GitHub của repo dữ liệu riêng tư (xem hướng dẫn) hoặc mã kết nối KK1.' : 'Nhập mã kết nối quản trị viên gửi cho bạn.'}</p>
        ${admin ? `<label class="small">Repo dữ liệu (Private)<input id="crepo" value="${E(DATA_REPO)}"></label>` : ''}
        <input id="ccode" placeholder="${admin ? 'Token GitHub (github_pat_...) hoặc mã kết nối KK1...' : 'Mã kết nối KK1...'}" autocomplete="off">
        <button class="btn primary block" id="cconnect">Kết nối</button>
      </div>`;
    const st = Cloud.settings();
    const q = Cloud.queue().length;
    return `
      <div class="card cloud-card ok-card">
        <h3>☁ Dữ liệu chung đã kết nối</h3>
        <p class="small">Repo riêng tư <b>${E(st.repo)}</b> · lần đồng bộ gần nhất ${localStorage.getItem('kk_cloud_pulled') ? Util.vnDateTime(localStorage.getItem('kk_cloud_pulled')) : 'chưa có'}${q ? ` · <b class="short">${q} lần kiểm chờ gửi</b>` : ''}</p>
        <div class="row gap">
          <button class="btn small-btn primary" id="csync">⟳ Đồng bộ ngay</button>
          ${admin ? '<button class="btn small-btn" id="ccopy">🔑 Lấy mã kết nối cho máy khác</button>' : ''}
          <button class="btn small-btn" id="coff">Ngắt kết nối máy này</button>
        </div>
        <div id="ccodebox"></div>
      </div>`;
  }
  function bindCloudCard(admin) {
    if ($('#cconnect')) $('#cconnect').onclick = () => guard(async () => {
      const r = await Cloud.connect($('#ccode').value, $('#crepo') ? $('#crepo').value : '');
      // Lần đầu: đưa lịch sử các lần kiểm đã có trên máy này lên dữ liệu chung
      (await DB.all('sessions')).filter(s => s.checkIn).forEach(s => Cloud.enqueue(s.id));
      Auth.refreshUser();
      toast(r.created ? 'Đã kết nối. Dữ liệu chung mới tạo từ cài đặt của máy này' : `Đã kết nối: ${r.users} tài khoản, ${r.factories} nhà máy`);
      flushCloud().then(x => x.sent && toast(`Đã gửi ${x.sent} lần kiểm lên dữ liệu chung`));
      renderSettings();
    }, 'Đang kết nối dữ liệu chung...');
    if ($('#csync')) $('#csync').onclick = () => guard(() => syncCloud(true).then(() => renderSettings()), 'Đang đồng bộ...');
    if ($('#coff')) $('#coff').onclick = () => { if (confirm('Ngắt kết nối dữ liệu chung trên máy này? Dữ liệu chung vẫn còn nguyên, máy này chỉ không đồng bộ nữa.')) { Cloud.disconnect(); renderSettings(); } };
    if ($('#ccopy')) $('#ccopy').onclick = () => {
      const code = Cloud.makeCode(Cloud.settings());
      $('#ccodebox').innerHTML = `<p class="small warnc-text">Gửi mã này <b>riêng</b> cho từng kế toán (tin nhắn cá nhân), không đăng lên nhóm chung. Ai có mã đều đọc/ghi được dữ liệu chung.</p>
        <textarea readonly rows="3" id="ccodetxt">${E(code)}</textarea><button class="btn small-btn" id="ccp">Sao chép</button>`;
      $('#ccp').onclick = () => { $('#ccodetxt').select(); (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(() => toast('Đã sao chép mã'), () => { document.execCommand('copy'); toast('Đã sao chép mã'); }); };
    };
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
    // Bắt buộc kết nối dữ liệu chung: máy chưa kết nối thì về màn hình đăng nhập (bước nhập mã)
    if (user && !Cloud.enabled()) { Auth.logoutLocal(); return renderLogin(); }
    if (!user) return renderLogin();
    window.scrollTo(0, 0);
    // Tài khoản chỉ xem không vào các màn hình kiểm kê
    if (!Auth.can.count() && ['factories', 'import', 'count', 'review'].includes(page)) return go('#dashboard');
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

  // Đồng bộ dữ liệu chung khi mở app / có mạng lại: gửi cài đặt đang chờ hoặc nhận cài đặt + tài khoản mới, rồi gửi các lần kiểm đang chờ
  async function syncCloud(showToast) {
    if (!Cloud.enabled() || !navigator.onLine) return;
    try {
      if (localStorage.getItem('kk_cloud_cfg_dirty')) { await Cloud.pushConfig(); localStorage.removeItem('kk_cloud_cfg_dirty'); }
      else await Cloud.pullConfig();
      if (!Auth.refreshUser()) { toast('Tài khoản của bạn đã bị quản trị viên xóa', 'err'); current = null; return go('#login'); }
      const r = await flushCloud();
      if (showToast) toast(`Đã đồng bộ${r.sent ? `, gửi ${r.sent} lần kiểm` : ''}`);
      const page = location.hash.replace(/^#/, '').split('/')[0];
      if (['', 'home', 'login', 'factories'].includes(page)) route();
    } catch (e) { console.warn('syncCloud', e); if (showToast) toast(e.message, 'err'); }
  }

  let updatePending = false;
  async function applyUpdate() {
    toast('Đang cập nhật phiên bản mới...');
    try { if (current) await DB.put('sessions', current); } catch (e) { /* bỏ qua */ }
    setTimeout(() => location.reload(), 900);
  }

  async function boot() {
    const setHdr = () => document.documentElement.style.setProperty('--hdr', ($('header').offsetHeight - 1) + 'px');
    setHdr(); window.addEventListener('resize', setHdr);
    $('#settingsBtn').onclick = () => go('#settings');
    $('#hdrLogo').onclick = () => go('#home');
    $('#net').onclick = () => guard(async () => { const r = await OneDrive.flushOutbox(); toast(`Đã gửi ${r.sent}, còn chờ ${r.pending}`); refreshNet(); }, 'Đang đồng bộ...');
    await loadDefaultAssets();
    try { await Auth.init(); } catch (e) { toast(e.message, 'err'); }
    // Bản mới yêu cầu đăng nhập lại một lần (đi qua bước nhập mã kết nối nếu máy chưa kết nối)
    if (Auth.needsRelogin()) { Auth.logoutLocal(); setTimeout(() => toast('App đã cập nhật phiên bản ' + window.APP_VERSION + ', vui lòng đăng nhập lại'), 300); }
    window.addEventListener('hashchange', () => { if (updatePending && !location.hash.startsWith('#review')) return applyUpdate(); route(); });
    window.addEventListener('pagehide', () => current && DB.put('sessions', current));
    refreshNet();
    route();
    syncCloud(false);
    window.addEventListener('online', () => syncCloud(false));
    if (Util.inAppBrowser) toast('Đang mở trong Zalo/Facebook/Teams: hãy mở bằng Chrome/Safari để tải và chia sẻ được file', 'err');
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('sw.js').then(reg => {
        reg.update();
        // Kiểm tra bản mới mỗi khi mở lại app và mỗi 30 phút
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
        setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
      }).catch(e => console.warn('SW', e));
      // Có bản mới: tự cập nhật trên mọi máy. Đang ở màn hình ký thì chờ rời màn hình đó (không mất chữ ký đang ký dở)
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || updatePending) return;
        updatePending = true;
        const page = location.hash.replace(/^#/, '').split('/')[0];
        if (page !== 'review') return applyUpdate();
        const b = document.createElement('div');
        b.id = 'updbar'; b.className = 'updbar';
        b.innerHTML = 'Đã có phiên bản mới, app sẽ tự cập nhật khi rời màn hình ký. <button class="btn small-btn">Cập nhật ngay</button>';
        b.querySelector('button').onclick = applyUpdate;
        document.body.appendChild(b);
      });
    }
  }
  boot();
})();
