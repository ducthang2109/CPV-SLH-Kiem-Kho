// File Master nhà máy (Excel) và mẫu checklist kiểm tra chi nhánh.
// Master: mỗi dòng một nhà máy, khóa là ORG_CODE. Khi tải file tồn kho có cột ORG_CODE, app tự lấy
// tên, địa chỉ, toạ độ, người ký... của nhà máy đó.
const Master = (function () {
  const norm = s => String(s || '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
  const COLS = {
    code: ['org_code', 'org code', 'mã nhà máy', 'ma nha may', 'code'],
    company: ['tên công ty', 'ten cong ty', 'company'],
    name: ['tên nhà máy', 'ten nha may', 'tên chi nhánh', 'chi nhánh', 'factory', 'branch'],
    shortName: ['tên viết tắt', 'ten viet tat', 'short name'],
    address: ['địa chỉ', 'dia chi', 'address'],
    lat: ['vĩ độ', 'vi do', 'latitude', 'lat'],
    lng: ['kinh độ', 'kinh do', 'longitude', 'lng', 'long'],
    meatFile: ['file tồn meat', 'file ton meat', 'file meat', 'input file', 'meat file'],
    suppliesFile: ['file tồn vật tư', 'file ton vat tu', 'file vật tư', 'supplies file'],
    packageFile: ['file tồn bao bì', 'file ton bao bi', 'file bao bì', 'file package', 'package file'],
    systemName: ['hệ thống meat', 'he thong meat', 'tên hệ thống', 'system'],
    suppliesSystem: ['hệ thống vật tư', 'he thong vat tu', 'supplies system'],
    packageSystem: ['hệ thống bao bì', 'he thong bao bi', 'package system'],
    storekeeper: ['nhân viên kho', 'nhan vien kho'],
    storeManager: ['quản lý kho', 'quan ly kho'],
    accountant: ['kế toán', 'ke toan'],
    director: ['giám đốc nhà máy', 'giam doc nha may', 'giám đốc', 'giam doc']
  };
  const HEAD = ['ORG_CODE', 'Tên công ty', 'Tên nhà máy', 'Tên viết tắt', 'Địa chỉ', 'Vĩ độ', 'Kinh độ',
    'File tồn Meat', 'File tồn vật tư', 'File tồn bao bì', 'Hệ thống Meat', 'Hệ thống vật tư', 'Hệ thống bao bì', 'Nhân viên kho', 'Quản lý kho', 'Kế toán', 'Giám đốc nhà máy'];

  function parse(arrayBuffer) {
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    const hi = rows.findIndex(r => r.some(c => COLS.code.includes(norm(c))));
    if (hi < 0) throw new Error('File master phải có cột ORG_CODE');
    const idx = {};
    rows[hi].forEach((h, i) => { const n = norm(h); for (const k in COLS) if (idx[k] == null && COLS[k].includes(n)) idx[k] = i; });
    const v = (r, k) => idx[k] != null ? String(r[idx[k]] == null ? '' : r[idx[k]]).trim() : '';
    return rows.slice(hi + 1).filter(r => v(r, 'code')).map(r => {
      const lat = parseFloat(String(v(r, 'lat')).replace(',', '.')), lng = parseFloat(String(v(r, 'lng')).replace(',', '.'));
      return {
        code: v(r, 'code'), company: v(r, 'company'), name: v(r, 'name') || v(r, 'code'), shortName: v(r, 'shortName'),
        address: v(r, 'address'), lat: isNaN(lat) ? null : lat, lng: isNaN(lng) ? null : lng,
        inputFile: v(r, 'meatFile'), suppliesFile: v(r, 'suppliesFile'), packageFile: v(r, 'packageFile'),
        systemName: v(r, 'systemName'), suppliesSystem: v(r, 'suppliesSystem'), packageSystem: v(r, 'packageSystem'),
        signers: { storekeeper: v(r, 'storekeeper'), storeManager: v(r, 'storeManager'), accountant: v(r, 'accountant'), director: v(r, 'director') }
      };
    });
  }

  // Áp dụng master: thay danh sách nhà máy (giữ ảnh bìa đã chọn vì lưu riêng theo mã)
  function apply(list, fileName) {
    Config.save({ factories: list, factoriesVersion: window.APP_DEFAULT_CONFIG.factoriesVersion, masterFile: fileName, masterAt: new Date().toISOString() });
  }

  // File Excel mẫu để người dùng điền
  function templateBlob(factories) {
    const rows = [HEAD].concat((factories || []).map(f => [f.code, f.company || Config.get().companyName, f.name, f.shortName || '', f.address || '',
      f.lat == null ? '' : f.lat, f.lng == null ? '' : f.lng, f.inputFile || '', f.suppliesFile || '', f.packageFile || '', f.systemName || 'SmartSoft_Food', f.suppliesSystem || 'SAP', f.packageSystem || 'Winfood',
      (f.signers || {}).storekeeper || '', (f.signers || {}).storeManager || '', (f.signers || {}).accountant || '', (f.signers || {}).director || '']));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = HEAD.map((h, i) => ({ wch: [10, 34, 30, 14, 50, 10, 10, 22, 22, 22, 16, 16, 16, 20, 20, 20, 24][i] }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Master_NhaMay');
    return new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // ---------- Checklist kiểm tra chi nhánh ----------
  // Đọc sheet theo mẫu "BIÊN BẢN KIỂM TRA NHÀ MÁY": dòng mục La Mã (I., II. ...) và dòng chỉ tiêu đánh số
  function parseChecklist(arrayBuffer, sheetName) {
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const sn = sheetName && wb.Sheets[sheetName] ? sheetName
      : wb.SheetNames.find(n => XLSX.utils.sheet_to_csv(wb.Sheets[n]).toUpperCase().includes('BIÊN BẢN KIỂM TRA')) || wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
    const title = (rows.find(r => r.some(c => /BIÊN BẢN KIỂM TRA/i.test(String(c)))) || []).find(c => /BIÊN BẢN KIỂM TRA/i.test(String(c))) || 'BIÊN BẢN KIỂM TRA NHÀ MÁY';
    let methodCol = -1;
    rows.forEach(r => r.forEach((c, i) => { if (/CÁCH KIỂM/i.test(String(c))) methodCol = i; }));
    const sections = [];
    let cur = null;
    rows.forEach(r => {
      const cells = r.map(c => String(c).replace(/\s+/g, ' ').trim());
      const ni = cells.findIndex(c => c !== '');
      if (ni < 0) return;
      const no = cells[ni], text = cells.slice(ni + 1).find(c => c !== '') || '';
      if (/^[IVXL]+\.?$/.test(no) && text) {
        cur = { no: no.replace(/\.$/, ''), title: text, items: [] };
        sections.push(cur);
      } else if (cur && /^\d+$/.test(no) && text) {
        cur.items.push({ no, text, method: methodCol >= 0 ? cells[methodCol] || '' : '' });
      }
    });
    if (!sections.length) throw new Error('Không tìm thấy mục kiểm tra (I., II., ...) trong sheet ' + sn);
    // File mẫu có chỗ đánh số mục bị trùng (VI, XIII...): đánh lại số La Mã theo thứ tự
    const roman = n => [['M', 1000], ['CM', 900], ['D', 500], ['CD', 400], ['C', 100], ['XC', 90], ['L', 50], ['XL', 40], ['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1]]
      .reduce((a, [r, v]) => { while (n >= v) { a += r; n -= v; } return a; }, '');
    sections.forEach((s, i) => { s.no = roman(i + 1); });
    return { title: String(title).trim(), sheet: sn, sections };
  }

  return { parse, apply, templateBlob, parseChecklist, HEAD };
})();
