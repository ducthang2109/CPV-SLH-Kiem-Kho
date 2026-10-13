// Đọc file tồn kho theo form mẫu FDREPORT (PRODUCT_CODE, PRODUCT_NAME, LOT, Location,
// production_date, QTY, WGH, Ages(day), shelf life Ages) và chuẩn hoá thành danh sách dòng kiểm kê.
const Importer = (function () {
  const COLS = {
    code: ['product_code', 'ma hang', 'mã hàng', 'code', 'mã sap', 'ma sap', 'material', 'material code', 'mã vật tư', 'ma vat tu'],
    name: ['product_name', 'ten hang', 'tên hàng', 'name', 'tên sản phẩm', 'ten san pham', 'material description', 'tên vật tư', 'ten vat tu', 'description'],
    nameVi: ['tên tiếng việt', 'ten tieng viet', 'tên tv', 'vietnamese name', 'mô tả tiếng việt'],
    lot: ['lot', 'lo', 'lô', 'batch'],
    location: ['location', 'kho', 'warehouse', 'storage location', 'sloc', 'mã kho', 'ma kho'],
    whName: ['tên kho', 'ten kho', 'warehouse name', 'storage location description', 'descr. of storage loc.'],
    sysName: ['system', 'hệ thống', 'he thong'],
    prodDate: ['production_date', 'ngay san xuat', 'ngày sản xuất', 'nsx', 'mfg date'],
    qty: ['qty', 'so luong', 'số lượng', 'quantity', 'unrestricted', 'unrestricted stock', 'tồn kho', 'ton kho', 'sl tồn'],
    wgh: ['wgh', 'weight', 'khoi luong', 'khối lượng', 'trong luong'],
    ages: ['ages(day)', 'ages', 'tuoi'],
    unit: ['unit', 'uom', 'dvt', 'đvt', 'don vi', 'đơn vị', 'base unit of measure', 'bun'],
    shelfLife: ['shelf life ages', 'shelf life', 'shelf_life', 'han su dung', 'hạn sử dụng', 'hsd'],
    org: ['org_code', 'org', 'ma don vi', 'plant'], // mã nhà máy, ví dụ B43210 (file SAP: Plant B657)
    value: ['value unrestricted', 'giá trị', 'gia tri', 'value', 'thành tiền'], // giá trị tồn (file SAP)
    stockDate: ['stk_doc_date', 'stock date', 'ngay ton'] // ngày chốt số liệu tồn
  };

  // Tên kho theo mã Storage Location khi file SAP chỉ có mã kho (0001, 0002...)
  const WH_NAMES = { '0001': 'Spare Parts', '0002': 'Supplies', '0003': 'Ingredient', '8010': 'Packaging Main WH', '8020': 'PKG WH for Production' };

  const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

  // mode 'meat': file FDREPORT (có lô, NSX, hạn dùng); mode 'supplies': vật tư / bao bì chỉ cần mã và số lượng
  function mapHeader(header, mode) {
    const idx = {};
    header.forEach((h, i) => {
      const n = norm(h);
      for (const key in COLS) if (idx[key] == null && COLS[key].includes(n)) idx[key] = i;
    });
    const need = mode === 'supplies' ? ['code', 'qty'] : ['code', 'lot', 'location', 'prodDate', 'qty', 'shelfLife'];
    const missing = need.filter(k => idx[k] == null);
    if (missing.length) throw new Error('File không đúng form mẫu, thiếu cột: ' + missing.join(', '));
    return idx;
  }

  // Ngày trong file có dạng "10/10/2026 0:00:00:AM" (dd/MM/yyyy). Trả về 'YYYY-MM-DD'.
  function parseDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) return Util.isoDate(v);
    if (typeof v === 'number') { // số serial Excel
      const d = XLSX.SSF.parse_date_code(v);
      return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null;
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return null;
  }

  // "0002 - Chill Room (RM)-Cty Cổ Phần ...-CN NM3 Tại Hà Nội" -> { code: '0002', name: 'Chill Room (RM)', site: '...' }
  function parseLocation(s) {
    s = String(s || '').trim();
    const m = s.match(/^(\S+)\s*-\s*(.*)$/);
    let code = m ? m[1] : '', rest = m ? m[2] : s, site = '';
    const ci = rest.search(/-\s*Cty\b/i);
    if (ci > 0) { site = rest.slice(ci + 1).trim(); rest = rest.slice(0, ci).trim(); }
    return { code, name: rest, site, full: code ? `${code} - ${rest}` : rest };
  }

  // File FDREPORT chưa có cột ĐVT: đoán theo tên hàng (thêm cột UNIT vào file để in chính xác)
  function guessUnit(name) {
    const n = String(name || '').toLowerCase();
    if (/hộp|\(h\)/.test(n)) return 'Hộp';
    if (/khay/.test(n)) return 'Khay';
    if (/túi/.test(n)) return 'Túi';
    return 'KG';
  }

  const num = v => {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return v;
    const n = parseFloat(String(v).replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
  };

  // Đọc sheet thô (không để thư viện tự đoán ngày, vì ngày dạng dd/MM dễ bị hiểu nhầm là MM/dd)
  function readRows(arrayBuffer) {
    const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: false, cellText: true, raw: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    restoreDateText(arrayBuffer, ws);
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', rawNumbers: true });
  }

  // File xuất từ hệ thống ghi ô ngày kiểu t="d" với chữ "10/10/2026 0:00:00:AM" (không phải chuẩn ISO).
  // Thư viện không hiểu và thay bằng giờ hiện tại, nên đọc lại chữ gốc trong XML của sheet.
  function restoreDateText(arrayBuffer, ws) {
    try {
      const zip = XLSX.CFB.read(new Uint8Array(arrayBuffer), { type: 'array' });
      const entry = zip.FullPaths.map((p, i) => ({ p, i })).filter(x => /worksheets\/sheet\d+\.xml$/i.test(x.p))
        .sort((a, b) => parseInt(a.p.match(/sheet(\d+)\.xml/i)[1]) - parseInt(b.p.match(/sheet(\d+)\.xml/i)[1]))[0];
      if (!entry) return;
      const xml = new TextDecoder().decode(zip.FileIndex[entry.i].content);
      const re = /<(?:\w+:)?c\b([^>]*)>\s*<(?:\w+:)?v>([^<]*)<\/(?:\w+:)?v>/g;
      let m;
      while ((m = re.exec(xml))) {
        const attrs = m[1];
        if (!/\bt="d"/.test(attrs)) continue;
        const ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1];
        if (ref) ws[ref] = { t: 's', v: m[2], w: m[2] };
      }
    } catch (e) {
      console.warn('restoreDateText', e);
    }
  }

  function parse(arrayBuffer, fileName, mode) {
    mode = mode || 'meat';
    const all = readRows(arrayBuffer).filter(r => r.some(c => c !== '' && c != null));
    if (all.length < 2) throw new Error('File không có dữ liệu');
    // Dòng tiêu đề có thể không nằm ở dòng 1 (file xuất từ SAP có dòng tên báo cáo phía trên)
    let hi = 0, idx = null, firstErr = null;
    for (let i = 0; i < Math.min(10, all.length - 1); i++) {
      try { idx = mapHeader(all[i], mode); hi = i; break; } catch (e) { firstErr = firstErr || e; }
    }
    if (!idx) throw firstErr;
    const body = all.slice(hi + 1);
    const isTcvn3 = body.some(r => looksTcvn3(r[idx.name]) || looksTcvn3(r[idx.location]));
    // Trong cùng file có dòng TCVN3 lẫn dòng Unicode (ví dụ "Nạc Vai 5kg ĐL"):
    // có ký tự đặc trưng TCVN3 -> chuyển; có chữ Việt Unicode (ạ, ư, Đ...) -> giữ nguyên; còn lại theo bảng mã chung của file
    const txt = v => {
      const s = String(v == null ? '' : v).trim();
      if (looksTcvn3(s)) return tcvn3ToUnicode(s, true);
      if (/[\u0100-\u1EFF]/.test(s)) return s;
      return tcvn3ToUnicode(s, isTcvn3);
    };
    const orgCode = idx.org != null ? String(body[0][idx.org] || '').trim() : '';
    const stockDate = idx.stockDate != null ? parseDate(body[0][idx.stockDate]) : null;
    // Meat: cột Unit là mã 1 ký tự (vd "D"), không phải tên đơn vị -> đoán theo tên hàng. Vật tư: dùng đúng ĐVT trong file (PC, M, BOX...)
    const unitOf = r => {
      const u = idx.unit != null ? txt(r[idx.unit]) : '';
      if (mode === 'supplies') return u;
      return u.length > 1 ? u : guessUnit(txt(r[idx.name]));
    };
    // Kho: "0001 - Kho Spare Parts" hoặc mã kho + cột tên kho riêng
    const locOf = r => {
      const raw = idx.location != null ? txt(r[idx.location]) : '';
      const name = idx.whName != null ? txt(r[idx.whName]) : '';
      if (raw && name && !raw.includes(' - ')) return parseLocation(`${raw} - ${name}`);
      if (/^\d{3,5}$/.test(raw)) return parseLocation(`${raw} - ${WH_NAMES[raw] || 'Kho ' + raw}`);
      return parseLocation(raw || name || 'Kho');
    };

    const sites = new Set();
    const items = body.map((r, i) => {
      const loc = locOf(r);
      if (loc.site) sites.add(loc.site);
      return {
        id: 'L' + (i + 1),
        code: txt(r[idx.code]),
        name: idx.name != null ? txt(r[idx.name]) : '',
        nameVi: idx.nameVi != null ? txt(r[idx.nameVi]) : '', // không có thì app tự dịch (Glossary)
        unit: unitOf(r),
        lot: idx.lot != null ? String(r[idx.lot]).trim() : '',
        warehouseCode: loc.code,
        warehouse: loc.full,
        system: idx.sysName != null ? txt(r[idx.sysName]) : '',
        prodDate: idx.prodDate != null ? parseDate(r[idx.prodDate]) : null,
        sysQty: num(r[idx.qty]),
        sysWgh: idx.wgh != null ? num(r[idx.wgh]) : 0,
        sysValue: idx.value != null ? num(r[idx.value]) : null,
        ages: idx.ages != null ? String(r[idx.ages]) : '',
        shelfLife: idx.shelfLife != null ? num(r[idx.shelfLife]) : 0,
        actualQty: null,
        actualWgh: null,
        note: '',
        photos: [],
        isExtra: false
      };
    }).filter(it => it.code && !/^t[ổo]ng/i.test(it.code));

    return { fileName, mode, importedAt: new Date().toISOString(), encoding: isTcvn3 ? 'TCVN3' : 'Unicode', sites: [...sites], orgCode, stockDate, items };
  }

  // Gộp nhiều file tồn (vd 0001.xlsx + 0002.xlsx: mỗi file một kho SAP) thành một bộ dữ liệu
  function merge(list) {
    if (list.length === 1) return list[0];
    const items = [];
    list.forEach((d, k) => d.items.forEach(it => items.push(Object.assign(it, { id: 'F' + (k + 1) + it.id }))));
    return Object.assign({}, list[0], { fileName: list.map(d => d.fileName).join(' + '), items, sites: [...new Set([].concat(...list.map(d => d.sites)))] });
  }

  return { parse, merge, parseDate, parseLocation, WH_NAMES };
})();
