// Đọc file tồn kho theo form mẫu FDREPORT (PRODUCT_CODE, PRODUCT_NAME, LOT, Location,
// production_date, QTY, WGH, Ages(day), shelf life Ages) và chuẩn hoá thành danh sách dòng kiểm kê.
const Importer = (function () {
  const COLS = {
    code: ['product_code', 'ma hang', 'mã hàng', 'code'],
    name: ['product_name', 'ten hang', 'tên hàng', 'name'],
    lot: ['lot', 'lo', 'lô', 'batch'],
    location: ['location', 'kho', 'warehouse'],
    prodDate: ['production_date', 'ngay san xuat', 'ngày sản xuất', 'nsx', 'mfg date'],
    qty: ['qty', 'so luong', 'số lượng', 'quantity'],
    wgh: ['wgh', 'weight', 'khoi luong', 'khối lượng', 'trong luong'],
    ages: ['ages(day)', 'ages', 'tuoi'],
    unit: ['unit', 'uom', 'dvt', 'đvt', 'don vi', 'đơn vị'],
    shelfLife: ['shelf life ages', 'shelf life', 'shelf_life', 'han su dung', 'hạn sử dụng', 'hsd'],
    org: ['org_code', 'org', 'ma don vi'],          // mã nhà máy, ví dụ B43210
    stockDate: ['stk_doc_date', 'stock date', 'ngay ton'] // ngày chốt số liệu tồn
  };

  const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

  function mapHeader(header) {
    const idx = {};
    header.forEach((h, i) => {
      const n = norm(h);
      for (const key in COLS) if (idx[key] == null && COLS[key].includes(n)) idx[key] = i;
    });
    const missing = ['code', 'lot', 'location', 'prodDate', 'qty', 'shelfLife'].filter(k => idx[k] == null);
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

  function parse(arrayBuffer, fileName) {
    const rows = readRows(arrayBuffer).filter(r => r.some(c => c !== '' && c != null));
    if (rows.length < 2) throw new Error('File không có dữ liệu');
    const idx = mapHeader(rows[0]);
    const body = rows.slice(1);
    const isTcvn3 = body.some(r => looksTcvn3(r[idx.name]) || looksTcvn3(r[idx.location]));
    // Trong cùng file có dòng TCVN3 lẫn dòng Unicode (ví dụ "Nạc Vai 5kg ĐL"):
    // có ký tự đặc trưng TCVN3 -> chuyển; có chữ Việt Unicode (ạ, ư, Đ...) -> giữ nguyên; còn lại theo bảng mã chung của file
    const txt = v => {
      const s = String(v == null ? '' : v).trim();
      if (looksTcvn3(s)) return tcvn3ToUnicode(s, true);
      if (/[Ā-ỿ]/.test(s)) return s;
      return tcvn3ToUnicode(s, isTcvn3);
    };
    const orgCode = idx.org != null ? String(body[0][idx.org] || '').trim() : '';
    const stockDate = idx.stockDate != null ? parseDate(body[0][idx.stockDate]) : null;
    // Cột Unit trong file hệ thống là mã 1 ký tự (vd "D"), không phải tên đơn vị -> đoán theo tên hàng
    const unitOf = r => {
      const u = idx.unit != null ? txt(r[idx.unit]) : '';
      return u.length > 1 ? u : guessUnit(txt(r[idx.name]));
    };

    const sites = new Set();
    const items = body.map((r, i) => {
      const loc = parseLocation(txt(r[idx.location]));
      if (loc.site) sites.add(loc.site);
      return {
        id: 'L' + (i + 1),
        code: txt(r[idx.code]),
        name: idx.name != null ? txt(r[idx.name]) : '',
        unit: unitOf(r),
        lot: String(r[idx.lot]).trim(),
        warehouseCode: loc.code,
        warehouse: loc.full,
        prodDate: parseDate(r[idx.prodDate]),
        sysQty: num(r[idx.qty]),
        sysWgh: idx.wgh != null ? num(r[idx.wgh]) : 0,
        ages: idx.ages != null ? String(r[idx.ages]) : '',
        shelfLife: num(r[idx.shelfLife]),
        actualQty: null,
        actualWgh: null,
        note: '',
        photos: [],
        isExtra: false
      };
    }).filter(it => it.code);

    return { fileName, importedAt: new Date().toISOString(), encoding: isTcvn3 ? 'TCVN3' : 'Unicode', sites: [...sites], orgCode, stockDate, items };
  }

  return { parse, parseDate, parseLocation };
})();
